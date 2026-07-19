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
];
/** Backoff exponencial (ms) por tentativa, com teto. */
export function backoffMs(attempt) {
    const base = 30_000; // 30s
    const max = 30 * 60_000; // 30min
    return Math.min(base * Math.pow(2, Math.max(0, attempt - 1)), max);
}
//# sourceMappingURL=stages.js.map