import { db } from './db.js'
import { config } from './config.js'
import { backoffMs } from './shared/stages.js'

export interface Job {
  id: string
  analysis_id: string
  job_type: string
  status: string
  stage: string | null
  attempt_count: number
  max_attempts: number
  metadata: Record<string, unknown>
}

/** Reivindica o próximo job pronto com lock transacional (SKIP LOCKED). */
export async function claimNextJob(): Promise<Job | null> {
  const { data, error } = await db.rpc('claim_next_job', {
    p_worker_id: config.workerId,
    p_job_types: ['pipeline'],
  })
  if (error) throw new Error(`claim_next_job falhou: ${error.message}`)
  const rows = (data as Job[]) || []
  return rows.length > 0 ? rows[0]! : null
}

/** Atualiza o estágio atual do job (e da análise). */
export async function setJobStage(jobId: string, analysisId: string, stage: string): Promise<void> {
  await db.from('processing_jobs').update({ stage }).eq('id', jobId)
  await db.from('analises').update({ stage }).eq('id', analysisId)
}

export async function completeJob(jobId: string, analysisId: string, finalStage: string): Promise<void> {
  await db
    .from('processing_jobs')
    .update({ status: 'completed', stage: finalStage, completed_at: new Date().toISOString(), locked_by: null })
    .eq('id', jobId)
  await db.from('analises').update({ stage: finalStage }).eq('id', analysisId)
}

/**
 * Marca falha do job. Reagenda (status 'retry') com backoff enquanto houver
 * tentativas; caso contrário marca 'failed'. Nunca reinicia estágios já
 * concluídos — o worker retoma a partir de `stage`.
 */
export async function failJob(
  job: Job,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const exhausted = job.attempt_count >= job.max_attempts
  if (exhausted) {
    await db
      .from('processing_jobs')
      .update({ status: 'failed', error_code: errorCode, error_message: errorMessage, locked_by: null })
      .eq('id', job.id)
    await db
      .from('analises')
      .update({ stage: 'failed', error_code: errorCode, error_message: errorMessage })
      .eq('id', job.analysis_id)
  } else {
    const next = new Date(Date.now() + backoffMs(job.attempt_count)).toISOString()
    await db
      .from('processing_jobs')
      .update({
        status: 'retry',
        next_retry_at: next,
        error_code: errorCode,
        error_message: errorMessage,
        locked_by: null,
      })
      .eq('id', job.id)
  }
}

/** Cria (ou garante) um job de pipeline para uma análise. */
export async function enqueuePipeline(analysisId: string, metadata: Record<string, unknown> = {}): Promise<void> {
  const { data: existing } = await db
    .from('processing_jobs')
    .select('id')
    .eq('analysis_id', analysisId)
    .eq('job_type', 'pipeline')
    .maybeSingle()
  if (existing) return
  await db.from('processing_jobs').insert({
    analysis_id: analysisId,
    job_type: 'pipeline',
    status: 'queued',
    stage: 'queued',
    max_attempts: config.maxAttempts,
    metadata,
  })
}
