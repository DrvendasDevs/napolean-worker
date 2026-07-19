import { db } from './db.js';
import { config } from './config.js';
import { backoffMs } from './shared/stages.js';
/** Reivindica o próximo job pronto com lock transacional (SKIP LOCKED). */
export async function claimNextJob() {
    const { data, error } = await db.rpc('claim_next_job', {
        p_worker_id: config.workerId,
        p_job_types: ['pipeline'],
    });
    if (error)
        throw new Error(`claim_next_job falhou: ${error.message}`);
    const rows = data || [];
    return rows.length > 0 ? rows[0] : null;
}
/** Atualiza o estágio atual do job (e da análise). */
export async function setJobStage(jobId, analysisId, stage) {
    await db.from('processing_jobs').update({ stage }).eq('id', jobId);
    await db.from('analises').update({ stage }).eq('id', analysisId);
}
export async function completeJob(jobId, analysisId, finalStage) {
    await db
        .from('processing_jobs')
        .update({ status: 'completed', stage: finalStage, completed_at: new Date().toISOString(), locked_by: null })
        .eq('id', jobId);
    await db.from('analises').update({ stage: finalStage }).eq('id', analysisId);
}
/**
 * Marca falha do job. Reagenda (status 'retry') com backoff enquanto houver
 * tentativas; caso contrário marca 'failed'. Nunca reinicia estágios já
 * concluídos — o worker retoma a partir de `stage`.
 */
export async function failJob(job, errorCode, errorMessage) {
    const exhausted = job.attempt_count >= job.max_attempts;
    if (exhausted) {
        await db
            .from('processing_jobs')
            .update({ status: 'failed', error_code: errorCode, error_message: errorMessage, locked_by: null })
            .eq('id', job.id);
        await db
            .from('analises')
            .update({ stage: 'failed', error_code: errorCode, error_message: errorMessage })
            .eq('id', job.analysis_id);
    }
    else {
        const next = new Date(Date.now() + backoffMs(job.attempt_count)).toISOString();
        await db
            .from('processing_jobs')
            .update({
            status: 'retry',
            next_retry_at: next,
            error_code: errorCode,
            error_message: errorMessage,
            locked_by: null,
        })
            .eq('id', job.id);
    }
}
/** Cria (ou garante) um job de pipeline para uma análise. */
export async function enqueuePipeline(analysisId, metadata = {}) {
    const { data: existing } = await db
        .from('processing_jobs')
        .select('id')
        .eq('analysis_id', analysisId)
        .eq('job_type', 'pipeline')
        .maybeSingle();
    if (existing)
        return;
    await db.from('processing_jobs').insert({
        analysis_id: analysisId,
        job_type: 'pipeline',
        status: 'queued',
        stage: 'queued',
        max_attempts: config.maxAttempts,
        metadata,
    });
}
//# sourceMappingURL=queue.js.map