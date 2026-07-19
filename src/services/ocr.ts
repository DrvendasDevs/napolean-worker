import path from 'node:path'
import { run } from './shell.js'
import { config } from '../config.js'

/** Aplica OCR (Tesseract) em uma imagem PNG e retorna o texto. */
export async function ocrImage(imagePath: string): Promise<string> {
  // tesseract <img> stdout -l <lang>
  const res = await run(config.tesseractPath, [imagePath, 'stdout', '-l', config.ocrLang])
  if (res.code !== 0) throw new Error(`tesseract falhou: ${res.stderr}`)
  return res.stdout.trim()
}

/** OCR de várias imagens em ordem, concatenando o texto. */
export async function ocrImages(images: { page: number; imagePath: string }[]): Promise<string> {
  const parts: string[] = []
  for (const img of images.sort((a, b) => a.page - b.page)) {
    const text = await ocrImage(img.imagePath)
    parts.push(text)
  }
  return parts.join('\n\n').trim()
}

export function batchName(pdfPath: string, start: number, end: number): string {
  return `${path.basename(pdfPath)}_${start}_${end}`
}
