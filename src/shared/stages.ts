/** Estados conceituais do pipeline persistente (seção 7). */
export const PIPELINE_STAGES = [
  'received',
  'queued',
  'downloading',
  'preparing_file',
  'transcribing',
  'extracting_text',
  'performing_ocr',
  'preparing_context',
  'evaluating',
  'validating_result',
  'calculating_score',
  'generating_transcription_pdf',
  'generating_report_pdf',
  'creating_deliveries',
  'sending_whatsapp',
  'completed',
  'partial_delivery',
  'failed',
  'pending_link',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'retry'

export type DeliveryStatus = 'complete' | 'partial' | 'failed'

/** Backoff exponencial (ms) por tentativa, com teto. */
export function backoffMs(attempt: number): number {
  const base = 30_000 // 30s
  const max = 30 * 60_000 // 30min
  return Math.min(base * Math.pow(2, Math.max(0, attempt - 1)), max)
}
