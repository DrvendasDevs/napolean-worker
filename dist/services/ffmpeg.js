import path from 'node:path';
import { promises as fs } from 'node:fs';
import { run, runOrThrow } from './shell.js';
import { config } from '../config.js';
/** Inspeciona um arquivo de áudio com ffprobe (integridade, duração, etc.). */
export async function probe(filePath) {
    const { stdout, code, stderr } = await run(config.ffprobePath, [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
    ]);
    if (code !== 0)
        throw new Error(`ffprobe falhou: ${stderr}`);
    const json = JSON.parse(stdout);
    const audioStream = (json.streams || []).find((s) => s.codec_type === 'audio');
    if (!audioStream)
        throw new Error('Nenhuma faixa de áudio encontrada no arquivo');
    return {
        durationSec: parseFloat(json.format?.duration ?? '0'),
        bitrate: parseInt(json.format?.bit_rate ?? '0', 10),
        channels: audioStream.channels ?? 1,
        codec: audioStream.codec_name ?? 'unknown',
        format: json.format?.format_name ?? 'unknown',
    };
}
/**
 * Normaliza o áudio para fala: mono, 16kHz, codec compatível (m4a/aac),
 * gerando uma versão processada separada (preserva o original).
 */
export async function normalizeForSpeech(inputPath, outputDir) {
    const outPath = path.join(outputDir, 'normalized.m4a');
    await runOrThrow(config.ffmpegPath, [
        '-y',
        '-i', inputPath,
        '-ac', '1', // mono
        '-ar', '16000', // 16kHz
        '-c:a', 'aac',
        '-b:a', '48k',
        outPath,
    ]);
    return outPath;
}
/**
 * Divide o áudio em chunks de duração fixa com pequena sobreposição.
 * Retorna a lista de chunks com start/end em ms.
 */
export async function splitIntoChunks(inputPath, outputDir, totalDurationSec) {
    await fs.mkdir(outputDir, { recursive: true });
    const chunkSec = config.audioChunkSeconds;
    const overlap = config.audioChunkOverlapSeconds;
    const chunks = [];
    let start = 0;
    let index = 0;
    while (start < totalDurationSec) {
        const duration = Math.min(chunkSec + overlap, totalDurationSec - start + overlap);
        const outPath = path.join(outputDir, `chunk_${String(index).padStart(4, '0')}.m4a`);
        await runOrThrow(config.ffmpegPath, [
            '-y',
            '-ss', String(start),
            '-t', String(duration),
            '-i', inputPath,
            '-ac', '1',
            '-ar', '16000',
            '-c:a', 'aac',
            '-b:a', '48k',
            outPath,
        ]);
        const realEnd = Math.min(start + duration, totalDurationSec);
        chunks.push({
            chunkNumber: index,
            path: outPath,
            startMs: Math.round(start * 1000),
            endMs: Math.round(realEnd * 1000),
        });
        index += 1;
        start += chunkSec; // avança sem a sobreposição
    }
    return chunks;
}
/** Tamanho do arquivo em bytes. */
export async function fileSize(filePath) {
    const st = await fs.stat(filePath);
    return st.size;
}
//# sourceMappingURL=ffmpeg.js.map