import path from 'node:path';
import { promises as fs } from 'node:fs';
import { run } from './shell.js';
import { config } from '../config.js';
/** Conta as páginas do PDF via pdfinfo/pdftotext. */
async function countPages(pdfPath) {
    // pdfinfo faz parte do poppler-utils
    const res = await run('pdfinfo', [pdfPath]);
    if (res.code === 0) {
        const m = res.stdout.match(/Pages:\s+(\d+)/);
        if (m)
            return parseInt(m[1], 10);
    }
    // fallback: tentar pdftotext por páginas incrementais é custoso; assume 1
    return 1;
}
/**
 * Extrai texto nativo por página com pdftotext, detectando páginas
 * digitalizadas (sem camada de texto) que precisarão de OCR.
 */
export async function extractPdfPages(pdfPath) {
    const pages = await countPages(pdfPath);
    const result = [];
    for (let p = 1; p <= pages; p++) {
        const res = await run(config.pdftotextPath, ['-f', String(p), '-l', String(p), '-layout', pdfPath, '-']);
        const text = res.code === 0 ? res.stdout.trim() : '';
        // Página com pouquíssimo texto é tratada como digitalizada (necessita OCR).
        const needsOcr = text.replace(/\s+/g, '').length < 20;
        result.push({ page: p, text, needsOcr });
    }
    return result;
}
/**
 * Rasteriza um intervalo de páginas para PNG (para OCR). Usa pdftoppm.
 * Retorna caminhos dos PNGs gerados, em ordem de página.
 */
export async function rasterizePages(pdfPath, pageStart, pageEnd, outDir) {
    await fs.mkdir(outDir, { recursive: true });
    const prefix = path.join(outDir, `page`);
    const res = await run(config.pdftoppmPath, [
        '-png',
        '-r', '200',
        '-f', String(pageStart),
        '-l', String(pageEnd),
        pdfPath,
        prefix,
    ]);
    if (res.code !== 0)
        throw new Error(`pdftoppm falhou: ${res.stderr}`);
    const out = [];
    for (let p = pageStart; p <= pageEnd; p++) {
        // pdftoppm nomeia como prefix-<page>.png (zero-padded conforme total)
        const candidates = [
            `${prefix}-${p}.png`,
            `${prefix}-${String(p).padStart(2, '0')}.png`,
            `${prefix}-${String(p).padStart(3, '0')}.png`,
        ];
        for (const c of candidates) {
            try {
                await fs.access(c);
                out.push({ page: p, imagePath: c });
                break;
            }
            catch {
                /* tenta próximo padrão */
            }
        }
    }
    return out;
}
//# sourceMappingURL=pdf-extract.js.map