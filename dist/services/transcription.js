import { db } from '../db.js';
import { transcribeFile } from './openai.js';
import { downloadToFile, ensureTmp } from './storage.js';
import path from 'node:path';
import { config } from '../config.js';
function msToTimestamp(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}
/**
 * Transcreve os chunks pendentes de uma análise (retomável por chunk).
 * Não retranscreve chunks já concluídos.
 */
export async function transcribePendingChunks(analysisId, client) {
    const { data: chunks, error } = await db
        .from('audio_chunks')
        .select('*')
        .eq('analysis_id', analysisId)
        .neq('status', 'completed')
        .order('chunk_number', { ascending: true });
    if (error)
        throw new Error(`Falha ao listar chunks: ${error.message}`);
    const tmp = await ensureTmp(`${analysisId}/chunks`);
    for (const chunk of chunks ?? []) {
        await db.from('audio_chunks').update({ status: 'processing' }).eq('id', chunk.id);
        try {
            const local = path.join(tmp, `chunk_${chunk.chunk_number}.m4a`);
            await downloadToFile(config.bucketMedia, chunk.storage_path, local);
            const result = await transcribeFile(client, local);
            // Mantém apenas segmentos dentro da janela não sobreposta (exceto último chunk),
            // removendo duplicação causada pela sobreposição entre chunks.
            const windowSec = config.audioChunkSeconds;
            const kept = result.segments.filter((seg) => seg.start < windowSec);
            const text = (kept.length > 0 ? kept.map((s) => s.text).join(' ') : result.text).trim();
            await db
                .from('audio_chunks')
                .update({ status: 'completed', transcription_text: text, error_message: null })
                .eq('id', chunk.id);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await db
                .from('audio_chunks')
                .update({
                status: 'failed',
                attempt_count: (chunk.attempt_count ?? 0) + 1,
                error_message: msg,
            })
                .eq('id', chunk.id);
            throw new Error(`Chunk ${chunk.chunk_number} falhou: ${msg}`);
        }
    }
}
/** True se todos os chunks obrigatórios estão concluídos. */
export async function allChunksDone(analysisId) {
    const { count } = await db
        .from('audio_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('analysis_id', analysisId)
        .neq('status', 'completed');
    return (count ?? 0) === 0;
}
/** Consolida a transcrição final ordenada, com timestamps por chunk. */
export async function consolidateTranscript(analysisId) {
    const { data: chunks, error } = await db
        .from('audio_chunks')
        .select('chunk_number, start_ms, transcription_text')
        .eq('analysis_id', analysisId)
        .order('chunk_number', { ascending: true });
    if (error)
        throw new Error(`Falha ao consolidar transcrição: ${error.message}`);
    return (chunks ?? [])
        .map((c) => `[${msToTimestamp(c.start_ms ?? 0)}]\n${(c.transcription_text ?? '').trim()}`)
        .join('\n\n')
        .trim();
}
//# sourceMappingURL=transcription.js.map