import PDFDocument from 'pdfkit'
import { STAGES, type Evaluation } from '../shared/evaluation.js'

export interface ReportHeader {
  fileName: string
  clientName: string | null
  dateBr: string
  durationLabel: string | null
  sellerName: string | null
  managerName: string | null
  companyName: string
  analysisId: string
  source: string
  finalScore: number
}

/** Gera o relatório legível em Markdown (seção 31), determinístico. */
export function buildReportMarkdown(header: ReportHeader, ev: Evaluation): string {
  const lines: string[] = []
  lines.push(`# Relatório de Análise de Call — ${header.fileName}`)
  lines.push('')
  lines.push(`- **Cliente:** ${ev.client.name ?? header.clientName ?? 'Não identificado'}`)
  lines.push(`- **Data (America/Sao_Paulo):** ${header.dateBr}`)
  lines.push(`- **Duração:** ${header.durationLabel ?? 'Não informada'}`)
  lines.push(`- **Vendedor:** ${header.sellerName ?? 'Não informado'}`)
  lines.push(`- **Gestor:** ${header.managerName ?? 'Não informado'}`)
  lines.push(`- **Empresa:** ${header.companyName}`)
  lines.push(`- **Nota final:** ${header.finalScore.toFixed(2)}`)
  lines.push('')

  if (ev.transcription_limitations.length > 0) {
    lines.push('> **Limitações da transcrição:** ' + ev.transcription_limitations.join(' '))
    lines.push('')
  }

  for (const def of STAGES) {
    const stage = ev.stages.find((s) => s.key === def.key)
    if (!stage) continue
    lines.push(`## ${def.name}`)
    lines.push('')
    lines.push('**1. Pontos Fortes**')
    lines.push(stage.strengths.length ? stage.strengths.map((s) => `- ${s}`).join('\n') : '- —')
    lines.push('')
    lines.push('**2. Evidências**')
    if (stage.evidence.length) {
      for (const e of stage.evidence) {
        const meta = [e.timestamp, e.speaker].filter(Boolean).join(' — ')
        lines.push(`- "${e.quote}"${meta ? ` (${meta})` : ''}`)
      }
    } else {
      lines.push('- —')
    }
    lines.push('')
    lines.push('**3. Pontos de Melhoria**')
    lines.push(stage.improvements.length ? stage.improvements.map((s) => `- ${s}`).join('\n') : '- —')
    lines.push('')
    lines.push('**4. Ausências**')
    lines.push(stage.absences.length ? stage.absences.map((s) => `- ${s}`).join('\n') : '- —')
    lines.push('')
    lines.push(`**5. Nota da Etapa:** ${stage.score}`)
    lines.push('')
    lines.push(`**6. Justificativa da Nota:** ${stage.rationale}`)
    lines.push('')
  }

  lines.push('## Resumo Geral')
  lines.push('')
  lines.push('**Pontos Fortes**')
  const strengths = resolveOverallStrengths(ev)
  lines.push(strengths.length ? strengths.map((s) => `- ${s}`).join('\n') : '- —')
  lines.push('')
  lines.push('**Pontos de Melhoria**')
  const improvements = resolveOverallImprovements(ev)
  lines.push(improvements.length ? improvements.map((s) => `- ${s}`).join('\n') : '- —')
  lines.push('')

  return lines.join('\n')
}

/** Labels curtos das etapas no relatório resumido do WhatsApp. */
const SUMMARY_STAGE_LABELS: Record<string, string> = {
  boas_vindas: 'Boas-vindas',
  identificacao: 'Identificação',
  historia: 'História Pessoal',
  pilares: 'Pilares da Mentoria',
  objecoes: 'Objeções',
  impacto: 'Impacto/Transformação',
  proposta: 'Proposta/Escassez',
}

function aggregateStageItems(ev: Evaluation, field: 'strengths' | 'improvements'): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const stage of ev.stages) {
    for (const item of stage[field]) {
      const text = item.trim()
      if (!text || seen.has(text)) continue
      seen.add(text)
      out.push(text)
    }
  }
  return out
}

/** Preferência: resumo geral da IA; fallback: agrega pontos das 7 etapas (como no PDF). */
export function resolveOverallStrengths(ev: Evaluation): string[] {
  const direct = ev.overall.strengths.map((s) => s.trim()).filter(Boolean)
  if (direct.length) return direct
  return aggregateStageItems(ev, 'strengths')
}

export function resolveOverallImprovements(ev: Evaluation): string[] {
  const direct = ev.overall.improvements.map((s) => s.trim()).filter(Boolean)
  if (direct.length) return direct
  return aggregateStageItems(ev, 'improvements')
}

function formatWhatsAppBullets(items: string[]): string {
  const parts = items.map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return '—'
  return parts.map((p) => `• ${p}`).join('\n')
}

/** Relatório resumido individual para envio no WhatsApp (funcionário e gestor). */
export function buildSummary(header: ReportHeader, ev: Evaluation): string {
  const fileLabel = (header.fileName || 'arquivo').replace(/\.[^.]+$/, '')
  const stageLines = STAGES.map((def, i) => {
    const stage = ev.stages.find((s) => s.key === def.key)
    const label = SUMMARY_STAGE_LABELS[def.key] ?? def.name
    const score = stage?.score ?? 0
    return `${i + 1}. ${label}: ${score}`
  })

  return [
    `📊 Avaliação — ${header.sellerName ?? 'Vendedor'}`,
    `Empresa: ${header.companyName}`,
    `Nota final: ${header.finalScore.toFixed(2)}`,
    '',
    '*RELATÓRIO RESUMIDO*',
    fileLabel,
    '',
    '*NOTAS POR ETAPA:*',
    ...stageLines,
    `*Média Geral: ${header.finalScore.toFixed(1)}*`,
    '',
    '*PONTOS FORTES:*',
    formatWhatsAppBullets(resolveOverallStrengths(ev)),
    '',
    '*PONTOS DE MELHORIA:*',
    formatWhatsAppBullets(resolveOverallImprovements(ev)),
    '',
    '*RELATÓRIO DETALHADO*',
    'Acesse o site www.napolean.com.br',
  ].join('\n')
}

function pdfToBuffer(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (d: Buffer) => chunks.push(d))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    build(doc)
    doc.end()
  })
}

/** Gera o PDF do relatório de avaliação. */
export function generateReportPdf(header: ReportHeader, ev: Evaluation): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    doc.fontSize(16).text(`Relatório de Análise de Call`, { align: 'left' })
    doc.moveDown(0.3)
    doc.fontSize(11).fillColor('#444').text(header.fileName)
    doc.moveDown(0.6)
    doc.fillColor('#000').fontSize(10)
    const meta = [
      ['Cliente', ev.client.name ?? header.clientName ?? 'Não identificado'],
      ['Data (America/Sao_Paulo)', header.dateBr],
      ['Duração', header.durationLabel ?? 'Não informada'],
      ['Vendedor', header.sellerName ?? 'Não informado'],
      ['Gestor', header.managerName ?? 'Não informado'],
      ['Empresa', header.companyName],
      ['Nota final', header.finalScore.toFixed(2)],
    ]
    for (const [k, v] of meta) doc.text(`${k}: ${v}`)
    doc.moveDown(0.5)

    if (ev.transcription_limitations.length > 0) {
      doc.fontSize(9).fillColor('#a15c00').text('Limitações da transcrição: ' + ev.transcription_limitations.join(' '))
      doc.fillColor('#000')
      doc.moveDown(0.5)
    }

    for (const def of STAGES) {
      const stage = ev.stages.find((s) => s.key === def.key)
      if (!stage) continue
      doc.moveDown(0.4)
      doc.fontSize(12).fillColor('#111').text(`${def.name} — Nota ${stage.score}`)
      doc.fontSize(9.5).fillColor('#000')
      writeList(doc, '1. Pontos Fortes', stage.strengths)
      doc.text('2. Evidências:')
      if (stage.evidence.length) {
        for (const e of stage.evidence) {
          const meta = [e.timestamp, e.speaker].filter(Boolean).join(' — ')
          doc.text(`   • "${e.quote}"${meta ? ` (${meta})` : ''}`)
        }
      } else doc.text('   • —')
      writeList(doc, '3. Pontos de Melhoria', stage.improvements)
      writeList(doc, '4. Ausências', stage.absences)
      doc.text(`6. Justificativa: ${stage.rationale}`)
    }

    doc.moveDown(0.6)
    doc.fontSize(12).text('Resumo Geral')
    doc.fontSize(9.5)
    writeList(doc, 'Pontos Fortes', resolveOverallStrengths(ev))
    writeList(doc, 'Pontos de Melhoria', resolveOverallImprovements(ev))
  })
}

function writeList(doc: PDFKit.PDFDocument, title: string, items: string[]) {
  doc.text(`${title}:`)
  if (items.length) for (const i of items) doc.text(`   • ${i}`)
  else doc.text('   • —')
}

/** Gera o PDF da transcrição (seção 20). */
export function generateTranscriptionPdf(header: ReportHeader, transcription: string): Promise<Buffer> {
  return pdfToBuffer((doc) => {
    doc.fontSize(16).text('Transcrição da Ligação')
    doc.moveDown(0.4)
    doc.fontSize(10)
    const meta = [
      ['Empresa', header.companyName],
      ['Vendedor avaliado', header.sellerName ?? 'Não informado'],
      ['Gestor', header.managerName ?? 'Não informado'],
      ['Data', header.dateBr],
      ['Duração', header.durationLabel ?? 'Não informada'],
      ['Arquivo', header.fileName],
      ['Análise', header.analysisId],
      ['Origem', header.source],
    ]
    for (const [k, v] of meta) doc.text(`${k}: ${v}`)
    doc.moveDown(0.6)
    doc.fontSize(10).fillColor('#000').text(transcription || '(sem conteúdo)', { align: 'left' })
  })
}
