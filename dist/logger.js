/**
 * Logs estruturados (seção 38). Nunca registra tokens, API keys, documentos
 * completos, transcrições completas, URLs assinadas ou credenciais.
 */
// Chaves que jamais devem ser logadas.
const FORBIDDEN = /token|secret|api[_-]?key|authorization|password|signed|credential/i;
function sanitize(meta) {
    const out = {};
    for (const [k, v] of Object.entries(meta)) {
        if (FORBIDDEN.test(k)) {
            out[k] = '[REDACTED]';
            continue;
        }
        if (typeof v === 'string' && v.length > 300) {
            out[k] = `${v.slice(0, 120)}…(${v.length} chars)`;
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
function emit(level, msg, ctx = {}, extra = {}) {
    const line = {
        ts: new Date().toISOString(),
        level,
        msg,
        ...sanitize({ ...ctx, ...extra }),
    };
    const serialized = JSON.stringify(line);
    if (level === 'error')
        console.error(serialized);
    else if (level === 'warn')
        console.warn(serialized);
    else
        console.log(serialized);
}
export const logger = {
    debug: (msg, ctx, extra) => emit('debug', msg, ctx, extra),
    info: (msg, ctx, extra) => emit('info', msg, ctx, extra),
    warn: (msg, ctx, extra) => emit('warn', msg, ctx, extra),
    error: (msg, ctx, extra) => emit('error', msg, ctx, extra),
};
//# sourceMappingURL=logger.js.map