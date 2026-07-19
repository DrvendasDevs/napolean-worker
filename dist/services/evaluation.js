import { chatStructured } from './openai.js';
import { evaluationSchema, evaluationJsonSchema, } from '../shared/evaluation.js';
/** Monta o contexto dinâmico enviado ao modelo (seção 27), separado do prompt. */
export function buildUserContext(ctx) {
    return [
        `DATA ATUAL:\n${ctx.currentDatetimeBr}`,
        '',
        `EMPRESA:\n${ctx.workspaceName}`,
        '',
        `VENDEDOR AVALIADO:\n${ctx.sellerName ?? 'Não informado'}`,
        '',
        `GESTOR:\n${ctx.managerName ?? 'Não informado'}`,
        '',
        `ARQUIVO:\n${ctx.fileName}`,
        '',
        `DURAÇÃO:\n${ctx.durationLabel ?? 'Não informada'}`,
        '',
        '────────────────────────────────────',
        'DOCUMENTO MESTRE',
        '────────────────────────────────────',
        '',
        ctx.masterDocument,
        '',
        '────────────────────────────────────',
        'SCRIPT NOTA 10',
        '────────────────────────────────────',
        '',
        ctx.salesScript,
        '',
        '────────────────────────────────────',
        'TRANSCRIÇÃO',
        '────────────────────────────────────',
        '',
        ctx.transcription,
    ].join('\n');
}
/**
 * Executa a avaliação: chama a IA com Structured Outputs, valida com Zod e,
 * se inválida, faz UMA tentativa controlada de correção (sem retranscrever/OCR/RAG).
 */
export async function runEvaluation(client, model, systemPrompt, ctx) {
    const userContent = buildUserContext(ctx);
    const first = await chatStructured(client, model, systemPrompt, userContent, evaluationJsonSchema);
    const firstParsed = tryParse(first);
    if (firstParsed.ok)
        return firstParsed.value;
    // Tentativa única de correção estruturada.
    const correctionSystem = systemPrompt +
        '\n\nATENÇÃO: A resposta anterior foi inválida pelo seguinte motivo: ' +
        firstParsed.error +
        '\nCorrija estritamente para respeitar o schema (exatamente 7 etapas, notas inteiras 0-10, chaves corretas). Retorne apenas o JSON válido.';
    const second = await chatStructured(client, model, correctionSystem, userContent, evaluationJsonSchema);
    const secondParsed = tryParse(second);
    if (secondParsed.ok)
        return secondParsed.value;
    throw new Error(`Resposta da IA inválida após correção: ${secondParsed.error}`);
}
function tryParse(raw) {
    let json;
    try {
        json = JSON.parse(raw);
    }
    catch {
        return { ok: false, error: 'JSON inválido retornado pelo modelo' };
    }
    const parsed = evaluationSchema.safeParse(json);
    if (!parsed.success) {
        return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
    }
    return { ok: true, value: parsed.data };
}
//# sourceMappingURL=evaluation.js.map