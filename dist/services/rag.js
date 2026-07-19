import { db } from '../db.js';
import { embed } from './openai.js';
import { STAGES } from '../shared/evaluation.js';
// Orçamento de caracteres para inclusão integral do documento no contexto.
const WHOLE_DOC_CHAR_BUDGET = 60_000;
const CHUNK_CHAR_SIZE = 1_200;
const CHUNK_OVERLAP = 150;
/** Divide texto em chunks com sobreposição para embeddings. */
export function chunkText(text) {
    const clean = text.replace(/\r\n/g, '\n');
    const chunks = [];
    let start = 0;
    let position = 0;
    while (start < clean.length) {
        const end = Math.min(start + CHUNK_CHAR_SIZE, clean.length);
        chunks.push({ content: clean.slice(start, end), position });
        position += 1;
        if (end >= clean.length)
            break;
        start = end - CHUNK_OVERLAP;
    }
    return chunks;
}
/**
 * Indexa uma versão de documento: gera embeddings por chunk e persiste.
 * Idempotente: limpa embeddings anteriores da versão antes de inserir.
 */
export async function indexDocumentVersion(client, version) {
    if (!version.extracted_text || !version.extracted_text.trim()) {
        throw new Error('Documento sem texto extraído para indexar');
    }
    await db.from('document_embeddings').delete().eq('document_version_id', version.id);
    const chunks = chunkText(version.extracted_text);
    for (const c of chunks) {
        const vector = await embed(client, c.content);
        await db.from('document_embeddings').insert({
            workspace_id: version.workspace_id,
            document_type: version.document_type,
            document_version_id: version.id,
            chunk_index: c.position,
            content: c.content,
            position: c.position,
            embedding: vector,
        });
    }
}
/**
 * Constrói o contexto de um documento para a chamada da IA:
 *  - inclui o conteúdo integral quando couber no orçamento;
 *  - caso contrário, garante cobertura das 7 etapas via similaridade.
 */
export async function buildDocumentContext(client, versionId, extractedText) {
    const text = extractedText ?? '';
    if (text.length <= WHOLE_DOC_CHAR_BUDGET) {
        return text;
    }
    // Recuperação por etapa: garante que todas as 7 etapas sejam cobertas.
    const seen = new Set();
    const parts = [];
    for (const stage of STAGES) {
        const query = `${stage.name}. Critérios de execução, erros críticos e boas práticas da etapa.`;
        const qVec = await embed(client, query);
        const { data, error } = await db.rpc('match_document_chunks', {
            p_version_id: versionId,
            p_query_embedding: qVec,
            p_match_count: 4,
        });
        if (error)
            throw new Error(`match_document_chunks falhou: ${error.message}`);
        for (const row of data ?? []) {
            if (!seen.has(row.id)) {
                seen.add(row.id);
                parts.push(row.content);
            }
        }
    }
    return parts.join('\n---\n');
}
//# sourceMappingURL=rag.js.map