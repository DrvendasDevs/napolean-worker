/**
 * Logs estruturados (seção 38). Nunca registra tokens, API keys, documentos
 * completos, transcrições completas, URLs assinadas ou credenciais.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  correlation_id?: string
  analysis_id?: string
  job_id?: string
  workspace_id?: string
  zapi_message_id?: string
  processing_stage?: string
  attempt?: number
  duration_ms?: number
  error_code?: string
}

// Chaves que jamais devem ser logadas.
const FORBIDDEN = /token|secret|api[_-]?key|authorization|password|signed|credential/i

function sanitize(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN.test(k)) {
      out[k] = '[REDACTED]'
      continue
    }
    if (typeof v === 'string' && v.length > 300) {
      out[k] = `${v.slice(0, 120)}…(${v.length} chars)`
    } else {
      out[k] = v
    }
  }
  return out
}

function emit(level: LogLevel, msg: string, ctx: LogContext = {}, extra: Record<string, unknown> = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...sanitize({ ...ctx, ...extra }),
  }
  const serialized = JSON.stringify(line)
  if (level === 'error') console.error(serialized)
  else if (level === 'warn') console.warn(serialized)
  else console.log(serialized)
}

export const logger = {
  debug: (msg: string, ctx?: LogContext, extra?: Record<string, unknown>) => emit('debug', msg, ctx, extra),
  info: (msg: string, ctx?: LogContext, extra?: Record<string, unknown>) => emit('info', msg, ctx, extra),
  warn: (msg: string, ctx?: LogContext, extra?: Record<string, unknown>) => emit('warn', msg, ctx, extra),
  error: (msg: string, ctx?: LogContext, extra?: Record<string, unknown>) => emit('error', msg, ctx, extra),
}
