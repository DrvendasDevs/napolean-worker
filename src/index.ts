import { config } from './config.js'
import { logger } from './logger.js'
import { db } from './db.js'
import { failJob, type Job } from './queue.js'
import { processAnalysis } from './pipeline.js'
import { processIndexDocument } from './documents.js'

let shuttingDown = false

/** Reivindica o próximo job pronto (pipeline ou index_document). */
async function claimNext(): Promise<Job | null> {
  const { data, error } = await db.rpc('claim_next_job', {
    p_worker_id: config.workerId,
    p_job_types: ['pipeline', 'index_document'],
  })
  if (error) throw new Error(`claim_next_job falhou: ${error.message}`)
  const rows = (data as Job[]) || []
  return rows.length > 0 ? rows[0]! : null
}

async function handleJob(job: Job): Promise<void> {
  const start = Date.now()
  try {
    if (job.job_type === 'index_document') {
      await processIndexDocument(job)
      await db
        .from('processing_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString(), locked_by: null })
        .eq('id', job.id)
    } else {
      await processAnalysis(job)
    }
    logger.info('job.completed', { job_id: job.id, analysis_id: job.analysis_id, duration_ms: Date.now() - start })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = err instanceof Error && 'code' in err ? String((err as { code: unknown }).code) : 'pipeline_error'
    logger.error('job.failed', {
      job_id: job.id,
      analysis_id: job.analysis_id,
      duration_ms: Date.now() - start,
      error_code: code,
    }, { error: msg })
    await failJob(job, code, msg)
  }
}

async function loop(): Promise<void> {
  logger.info('worker.started', {}, { workerId: config.workerId })
  while (!shuttingDown) {
    try {
      const job = await claimNext()
      if (!job) {
        await sleep(config.pollIntervalMs)
        continue
      }
      logger.info('job.claimed', { job_id: job.id, analysis_id: job.analysis_id, attempt: job.attempt_count })
      await handleJob(job)
    } catch (err) {
      logger.error('worker.loop_error', {}, { error: err instanceof Error ? err.message : String(err) })
      await sleep(config.pollIntervalMs)
    }
  }
  logger.info('worker.stopped', {})
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

process.on('SIGTERM', () => {
  logger.info('worker.sigterm', {})
  shuttingDown = true
})
process.on('SIGINT', () => {
  logger.info('worker.sigint', {})
  shuttingDown = true
})

loop().catch((err) => {
  logger.error('worker.fatal', {}, { error: err instanceof Error ? err.message : String(err) })
  process.exit(1)
})
