import path from 'node:path';
import { promises as fs } from 'node:fs';
import mammoth from 'mammoth';
import { db } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { ensureTmp, cleanupTmp, downloadToFile } from './services/storage.js';
import { extractPdfPages, rasterizePages } from './services/pdf-extract.js';
import { ocrImages } from './services/ocr.js';
import { getAgentModelConfig, makeClient } from './services/openai.js';
import { indexDocumentVersion } from './services/rag.js';
/**
 * Processa uma versão de documento do agente: extrai texto (nativo/OCR),
 * gera embeddings (RAG) e marca a versão como pronta. Idempotente.
 */
export async function processIndexDocument(job) {
    const versionId = job.metadata?.version_id || null;
    if (!versionId)
        throw new Error('Job index_document sem version_id');
    const { data: version, error } = await db
        .from('agent_document_versions')
        .select('*')
        .eq('id', versionId)
        .single();
    if (error || !version)
        throw new Error(`Versão de documento ${versionId} não encontrada`);
    const ctx = { workspace_id: version.workspace_id, processing_stage: 'index_document' };
    await db.from('agent_document_versions').update({ processing_status: 'processing' }).eq('id', versionId);
    const tmp = await ensureTmp(`doc/${versionId}`);
    try {
        const local = path.join(tmp, version.original_name || 'document');
        await downloadToFile(version.storage_bucket || config.bucketDocuments, version.storage_path, local);
        const text = await extractDocumentText(local, version.mime_type || '', tmp);
        if (!text.trim())
            throw new Error('Documento sem texto extraível');
        await db.from('agent_document_versions').update({ extracted_text: text }).eq('id', versionId);
        const cfg = await getAgentModelConfig(version.workspace_id);
        const client = makeClient(cfg.apiKey);
        await indexDocumentVersion(client, {
            id: version.id,
            workspace_id: version.workspace_id,
            document_type: version.document_type,
            extracted_text: text,
        });
        await db
            .from('agent_document_versions')
            .update({ processing_status: 'ready', processing_error: null })
            .eq('id', versionId);
        // Auto-ativa a versão recém-indexada (nova versão passa a ser a ativa).
        await db
            .from('agent_document_versions')
            .update({ is_active: false })
            .eq('workspace_id', version.workspace_id)
            .eq('document_type', version.document_type)
            .eq('is_active', true);
        await db
            .from('agent_document_versions')
            .update({ is_active: true, activated_at: new Date().toISOString() })
            .eq('id', versionId);
        // Garante a linha de config e aponta a referência ativa.
        const { data: cfgRow } = await db
            .from('agentes_config')
            .select('id')
            .eq('workspace_id', version.workspace_id)
            .maybeSingle();
        if (!cfgRow) {
            await db.from('agentes_config').insert({ workspace_id: version.workspace_id });
        }
        const refCol = version.document_type === 'documento_mestre'
            ? 'active_documento_mestre_version_id'
            : 'active_script_nota_10_version_id';
        await db
            .from('agentes_config')
            .update({ [refCol]: versionId })
            .eq('workspace_id', version.workspace_id);
        logger.info('document.indexed', ctx);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db
            .from('agent_document_versions')
            .update({ processing_status: 'failed', processing_error: msg })
            .eq('id', versionId);
        throw err;
    }
    finally {
        await cleanupTmp(`doc/${versionId}`);
    }
}
async function extractDocumentText(localPath, mime, tmp) {
    const lower = localPath.toLowerCase();
    if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
        const pages = await extractPdfPages(localPath);
        const parts = [];
        for (const page of pages) {
            if (page.needsOcr) {
                const images = await rasterizePages(localPath, page.page, page.page, path.join(tmp, 'ocr'));
                parts.push(await ocrImages(images));
            }
            else {
                parts.push(page.text);
            }
        }
        return parts.join('\n\n').trim();
    }
    if (lower.endsWith('.docx') || mime.includes('officedocument.wordprocessingml')) {
        const res = await mammoth.extractRawText({ path: localPath });
        return res.value.trim();
    }
    // txt / md
    return (await fs.readFile(localPath, 'utf8')).trim();
}
//# sourceMappingURL=documents.js.map