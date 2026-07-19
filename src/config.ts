/** Configuração do worker a partir de variáveis de ambiente. */
// Carrega o .env local (em produção/Docker as variáveis vêm do ambiente).
import 'dotenv/config'

function required(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`)
  }
  return v.trim()
}

function optional(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : fallback
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name]
  const n = v ? parseInt(v, 10) : NaN
  return Number.isFinite(n) ? n : fallback
}

export const config = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  workerId: optional('WORKER_ID', `worker-${process.pid}`),
  pollIntervalMs: intEnv('WORKER_POLL_INTERVAL_MS', 3000),
  maxAttempts: intEnv('WORKER_MAX_ATTEMPTS', 5),

  // Buckets privados
  bucketMedia: optional('BUCKET_MEDIA', 'napoleon-media'),
  bucketArtifacts: optional('BUCKET_ARTIFACTS', 'napoleon-artifacts'),
  bucketDocuments: optional('BUCKET_DOCUMENTS', 'napoleon-documents'),

  // Áudio / transcrição
  whisperModel: optional('WHISPER_MODEL', 'whisper-1'),
  audioChunkSeconds: intEnv('AUDIO_CHUNK_SECONDS', 600), // 10 min por chunk
  audioChunkOverlapSeconds: intEnv('AUDIO_CHUNK_OVERLAP_SECONDS', 3),

  // OpenAI
  embeddingModel: optional('EMBEDDING_MODEL', 'text-embedding-3-small'),

  // OCR
  ocrLang: optional('OCR_LANG', 'por+eng'),
  ocrBatchPages: intEnv('OCR_BATCH_PAGES', 5),

  // Ferramentas do sistema (instaladas no container)
  ffmpegPath: optional('FFMPEG_PATH', 'ffmpeg'),
  ffprobePath: optional('FFPROBE_PATH', 'ffprobe'),
  pdftotextPath: optional('PDFTOTEXT_PATH', 'pdftotext'),
  pdftoppmPath: optional('PDFTOPPM_PATH', 'pdftoppm'),
  tesseractPath: optional('TESSERACT_PATH', 'tesseract'),

  // Diretório temporário
  tmpDir: optional('WORKER_TMP_DIR', '/tmp/napoleon'),

  tz: optional('TZ', 'America/Sao_Paulo'),
}

export type Config = typeof config
