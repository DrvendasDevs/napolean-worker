import { db } from '../db.js';
import { config } from '../config.js';
import { zapi } from './zapi.js';
import { signedUrl } from './storage.js';
import { normalizePhone } from '../shared/telefone.js';
async function getArtifactConfig() {
    const { data } = await db.from('delivery_artifact_config').select('*').eq('id', 1).single();
    return (data ?? {
        send_summary: true,
        send_report_pdf: true,
        send_transcription_pdf: true,
        send_original_audio: false,
        audio_size_limit_mb: 15,
    });
}
/**
 * Resolve os 3 destinos lógicos (Napoleon, gestor, vendedor), normaliza e
 * deduplica telefones (mesmo telefone em vários papéis => envio único).
 */
export async function resolveRecipients(analysis) {
    const recipients = [];
    // 1. Napoleon (número conectado à instância Z-API)
    const { data: integ } = await db.from('zapi_integration').select('connected_phone').eq('id', 1).single();
    const napoleonPhone = normalizePhone(integ?.connected_phone);
    if (napoleonPhone)
        recipients.push({ role: 'napoleon', userId: null, phone: napoleonPhone });
    // 2. Vendedor avaliado (transcricoes.usuario_avaliado_id)
    const { data: transc } = await db
        .from('transcricoes')
        .select('usuario_avaliado_id')
        .eq('analise_id', analysis.id)
        .maybeSingle();
    let sellerManagerId = null;
    if (transc?.usuario_avaliado_id) {
        const { data: seller } = await db
            .from('users_profile')
            .select('id, phone, manager_id')
            .eq('id', transc.usuario_avaliado_id)
            .maybeSingle();
        if (seller) {
            sellerManagerId = seller.manager_id;
            const p = normalizePhone(seller.phone);
            if (p)
                recipients.push({ role: 'vendedor', userId: seller.id, phone: p });
        }
    }
    // 3. Gestor do vendedor
    if (sellerManagerId) {
        const { data: manager } = await db
            .from('users_profile')
            .select('id, phone')
            .eq('id', sellerManagerId)
            .maybeSingle();
        if (manager) {
            const p = normalizePhone(manager.phone);
            if (p)
                recipients.push({ role: 'gestor', userId: manager.id, phone: p });
        }
    }
    // Dedupe por telefone, agregando papéis (não duplica mensagens).
    const byPhone = new Map();
    for (const r of recipients) {
        const existing = byPhone.get(r.phone);
        if (existing) {
            existing.roles.push(r.role);
        }
        else {
            byPhone.set(r.phone, { ...r, roles: [r.role] });
        }
    }
    return Array.from(byPhone.values());
}
/** Cria registros de entrega idempotentes por destinatário + artefato. */
export async function ensureDeliveries(analysisId, recipients, artifacts) {
    const cfg = await getArtifactConfig();
    const enabled = [];
    if (cfg.send_summary)
        enabled.push('summary');
    if (cfg.send_report_pdf && artifacts.reportPdfPath)
        enabled.push('report_pdf');
    if (cfg.send_transcription_pdf && artifacts.transcriptionPdfPath)
        enabled.push('transcription_pdf');
    if (cfg.send_original_audio &&
        artifacts.originalAudio &&
        artifacts.originalAudio.sizeBytes <= cfg.audio_size_limit_mb * 1024 * 1024) {
        enabled.push('original_audio');
    }
    for (const r of recipients) {
        const roles = r.roles ?? [r.role];
        // Funcionário e gestor: somente o texto do relatório resumido (sem PDF/áudio).
        const isSellerOrManager = roles.includes('vendedor') || roles.includes('gestor');
        const artifactsForRecipient = isSellerOrManager ? ['summary'] : enabled;
        for (const artifact of artifactsForRecipient) {
            const idempotencyKey = `${analysisId}:${r.phone}:${artifact}`;
            await db
                .from('analysis_deliveries')
                .upsert({
                analysis_id: analysisId,
                recipient_role: r.role,
                recipient_user_id: r.userId,
                recipient_phone: r.phone,
                artifact_type: artifact,
                idempotency_key: idempotencyKey,
                roles,
                status: 'pending',
            }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
        }
    }
}
/**
 * Envia todas as entregas pendentes (idempotente). Uma falha em um
 * destinatário não afeta os demais. Retorna o status agregado.
 */
export async function sendPendingDeliveries(analysisId, artifacts) {
    const { data: deliveries } = await db
        .from('analysis_deliveries')
        .select('*')
        .eq('analysis_id', analysisId)
        .neq('status', 'sent')
        .neq('status', 'delivered');
    for (const d of deliveries ?? []) {
        await db.from('analysis_deliveries').update({ status: 'sending' }).eq('id', d.id);
        try {
            let resp;
            if (d.artifact_type === 'summary') {
                resp = await zapi.sendText(d.recipient_phone, artifacts.summaryText);
            }
            else if (d.artifact_type === 'report_pdf' && artifacts.reportPdfPath) {
                const url = await signedUrl(config.bucketArtifacts, artifacts.reportPdfPath, 3600);
                const baseName = artifacts.fileName.replace(/\.(pdf|docx|txt|md)$/i, '');
                resp = await zapi.sendDocument(d.recipient_phone, 'pdf', url, `relatorio_${baseName}.pdf`);
            }
            else if (d.artifact_type === 'transcription_pdf' && artifacts.transcriptionPdfPath) {
                const url = await signedUrl(config.bucketArtifacts, artifacts.transcriptionPdfPath, 3600);
                const baseName = artifacts.fileName.replace(/\.(pdf|docx|txt|md)$/i, '');
                resp = await zapi.sendDocument(d.recipient_phone, 'pdf', url, `transcricao_${baseName}.pdf`);
            }
            else if (d.artifact_type === 'original_audio' && artifacts.originalAudio) {
                const url = await signedUrl(config.bucketMedia, artifacts.originalAudio.path, 3600);
                resp = await zapi.sendAudio(d.recipient_phone, url);
            }
            else {
                // Artefato indisponível: marca como falho sem travar o restante.
                await db
                    .from('analysis_deliveries')
                    .update({ status: 'failed', error_code: 'artifact_unavailable', error_message: 'Artefato indisponível' })
                    .eq('id', d.id);
                continue;
            }
            if (resp.ok) {
                await db
                    .from('analysis_deliveries')
                    .update({
                    status: 'sent',
                    sent_at: new Date().toISOString(),
                    attempt_count: (d.attempt_count ?? 0) + 1,
                    zapi_response: resp.json,
                    error_code: null,
                    error_message: null,
                })
                    .eq('id', d.id);
            }
            else {
                await db
                    .from('analysis_deliveries')
                    .update({
                    status: 'failed',
                    attempt_count: (d.attempt_count ?? 0) + 1,
                    error_code: `http_${resp.status}`,
                    error_message: JSON.stringify(resp.json).slice(0, 500),
                })
                    .eq('id', d.id);
            }
        }
        catch (err) {
            await db
                .from('analysis_deliveries')
                .update({
                status: 'failed',
                attempt_count: (d.attempt_count ?? 0) + 1,
                error_code: 'send_exception',
                error_message: err instanceof Error ? err.message : String(err),
            })
                .eq('id', d.id);
        }
    }
    // Status agregado
    const { data: all } = await db.from('analysis_deliveries').select('status').eq('analysis_id', analysisId);
    const statuses = (all ?? []).map((x) => x.status);
    if (statuses.length === 0)
        return 'complete';
    const anySent = statuses.some((s) => s === 'sent' || s === 'delivered');
    const anyFailed = statuses.some((s) => s === 'failed' || s === 'pending' || s === 'sending');
    if (anySent && anyFailed)
        return 'partial';
    if (!anyFailed)
        return 'complete';
    return 'failed';
}
//# sourceMappingURL=deliveries.js.map