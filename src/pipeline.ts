import path from 'node:path'
import { promises as fs } from 'node:fs'
import mammoth from 'mammoth'
import { db } from './db.js'
import { config } from './config.js'
import { logger } from './logger.js'
import { setJobStage, completeJob, type Job } from './queue.js'
import {
  ensureTmp,
  cleanupTmp,
  downloadToFile,
  uploadFile,
  uploadBuffer,
  sha256File,
} from './services/storage.js'
import { probe, normalizeForSpeech, splitIntoChunks, fileSize } from './services/ffmpeg.js'
import {
  transcribePendingChunks,
  allChunksDone,
  consolidateTranscript,
} from './services/transcription.js'
import { extractPdfPages, rasterizePages } from './services/pdf-extract.js'
import { ocrImages } from './services/ocr.js'
import { getAgentModelConfig, makeClient } from './services/openai.js'
import { buildDocumentContext } from './services/rag.js'
import { runEvaluation, type EvaluationContext } from './services/evaluation.js'
import {
  buildReportMarkdown,
  buildSummary,
  generateReportPdf,
  generateTranscriptionPdf,
  resolveOverallImprovements,
  resolveOverallStrengths,
  type ReportHeader,
} from './services/report.js'
import {
  resolveRecipients,
  ensureDeliveries,
  sendPendingDeliveries,
  type DeliveryArtifacts,
} from './services/deliveries.js'
import {
  STAGE_TO_COLUMN,
  computeFinalScore,
  scoresFromEvaluation,
  type Evaluation,
} from './shared/evaluation.js'

interface Analise {
  id: string
  workspace_id: string | null
  usuario_avaliado_id?: string | null
  arquivo_nome: string
  arquivo_tipo: string
  arquivo_mime: string | null
  storage_bucket: string | null
  storage_path: string | null
  source: string
  pending_link: boolean
  duration_ms: number | null
  prompt_version_id: string | null
  documento_mestre_version_id: string | null
  script_nota_10_version_id: string | null
  model_provider: string | null
  model_name: string | null
}

function nowBr(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: config.tz,
  }).format(new Date())
}

function durationLabel(ms: number | null): string | null {
  if (!ms) return null
  const totalMin = Math.round(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}min` : `${m}min`
}

/** Processa uma análise através de todos os estágios (idempotente/retomável). */
export async function processAnalysis(job: Job): Promise<void> {
  const analysisId = job.analysis_id
  const { data: analiseData, error } = await db.from('analises').select('*').eq('id', analysisId).single()
  if (error || !analiseData) throw new Error(`Análise ${analysisId} não encontrada`)
  const analise = analiseData as Analise
  const workspaceId = analise.workspace_id
  if (!workspaceId) throw new Error('Análise sem workspace_id')

  const ctx = { correlation_id: analysisId, analysis_id: analysisId, job_id: job.id, workspace_id: workspaceId }
  const tmpBase = await ensureTmp(analysisId)

  // ----- 1. DOWNLOADING -----
  await setJobStage(job.id, analysisId, 'downloading')
  logger.info('stage.downloading', { ...ctx, processing_stage: 'downloading' })
  if (!analise.storage_path || !analise.storage_bucket) {
    throw new Error('Análise sem arquivo original em Storage')
  }
  const originalPath = path.join(tmpBase, analise.arquivo_nome || 'original')
  await downloadToFile(analise.storage_bucket, analise.storage_path, originalPath)

  // ----- 2. PREPARING_FILE + 3. TRANSCRIBE/EXTRACT/OCR -----
  const isAudio = analise.arquivo_tipo === 'audio' || (analise.arquivo_mime ?? '').startsWith('audio/')
  const isPdf = analise.arquivo_tipo === 'pdf' || (analise.arquivo_mime ?? '') === 'application/pdf'
  const mime = (analise.arquivo_mime ?? '').toLowerCase()
  const lowerName = (analise.arquivo_nome ?? '').toLowerCase()
  const isDocx =
    lowerName.endsWith('.docx') || mime.includes('officedocument.wordprocessingml')

  let transcription = await getExistingTranscription(analysisId)

  if (!transcription) {
    if (isAudio) {
      transcription = await handleAudio(job, analise, originalPath, tmpBase, ctx)
    } else if (isPdf) {
      transcription = await handlePdf(job, analise, originalPath, tmpBase, ctx)
    } else if (isDocx) {
      await setJobStage(job.id, analysisId, 'extracting_text')
      const res = await mammoth.extractRawText({ path: originalPath })
      transcription = (res.value ?? '').trim()
    } else {
      // txt / md / texto puro
      await setJobStage(job.id, analysisId, 'extracting_text')
      transcription = (await fs.readFile(originalPath, 'utf8')).trim()
    }
    // Atualiza só o conteúdo — preserva usuario_avaliado_id já gravado no webhook
    const { data: existingTr } = await db
      .from('transcricoes')
      .select('id')
      .eq('analise_id', analysisId)
      .maybeSingle()
    if (existingTr) {
      await db.from('transcricoes').update({ conteudo: transcription }).eq('analise_id', analysisId)
    } else {
      await db.from('transcricoes').insert({ analise_id: analysisId, conteudo: transcription })
    }
  }

  // ----- Vinculação determinística (WhatsApp sem vendedor) -----
  if (analise.pending_link) {
    await setJobStage(job.id, analysisId, 'pending_link')
    logger.warn('pipeline.pending_link', { ...ctx, processing_stage: 'pending_link' })
    // Preserva arquivo e transcrição; não avalia até vinculação correta.
    await completeJob(job.id, analysisId, 'pending_link')
    return
  }

  // ----- 4. PREPARING_CONTEXT (congela versões) -----
  await setJobStage(job.id, analysisId, 'preparing_context')
  const frozen = await freezeVersions(analise)
  const modelCfg = await getAgentModelConfig(workspaceId)
  const client = makeClient(modelCfg.apiKey)

  const masterDoc = await getDocText(frozen.documentoMestreVersionId)
  const script = await getDocText(frozen.scriptNota10VersionId)
  const masterContext = await buildDocumentContext(client, frozen.documentoMestreVersionId, masterDoc)
  const scriptContext = await buildDocumentContext(client, frozen.scriptNota10VersionId, script)

  const meta = await gatherMeta(analysisId, workspaceId)

  // ----- 5. EVALUATING + 6. VALIDATING -----
  let evaluation = await getExistingEvaluation(analysisId)
  if (!evaluation) {
    await setJobStage(job.id, analysisId, 'evaluating')
    const evalCtx: EvaluationContext = {
      currentDatetimeBr: nowBr(),
      workspaceName: meta.workspaceName,
      sellerName: meta.sellerName,
      managerName: meta.managerName,
      fileName: analise.arquivo_nome,
      durationLabel: durationLabel(analise.duration_ms),
      masterDocument: masterContext,
      salesScript: scriptContext,
      transcription,
    }
    await setJobStage(job.id, analysisId, 'validating_result')
    evaluation = await runEvaluation(client, frozen.modelName, frozen.promptContent, evalCtx)
  }

  // ----- 7. CALCULATING_SCORE (backend é a fonte de verdade) -----
  await setJobStage(job.id, analysisId, 'calculating_score')
  const scores = scoresFromEvaluation(evaluation)
  const finalScore = computeFinalScore(scores)

  // ----- 8. PERSISTIR relatório + notas -----
  const header: ReportHeader = {
    fileName: analise.arquivo_nome,
    clientName: evaluation.client.name,
    dateBr: nowBr(),
    durationLabel: durationLabel(analise.duration_ms),
    sellerName: meta.sellerName,
    managerName: meta.managerName,
    companyName: meta.workspaceName,
    analysisId,
    source: analise.source,
    finalScore,
  }
  const markdown = buildReportMarkdown(header, evaluation)
  await persistReport(analysisId, workspaceId, evaluation, scores, finalScore, markdown)
  await db.from('analises').update({ nota_geral: finalScore, status: 'concluido' }).eq('id', analysisId)

  // ----- 9/10. GERAR PDFs -----
  await setJobStage(job.id, analysisId, 'generating_transcription_pdf')
  const transcriptionPdf = await generateTranscriptionPdf(header, transcription)
  const transcriptionPdfPath = `${analysisId}/transcription.pdf`
  await uploadBuffer(config.bucketArtifacts, transcriptionPdfPath, transcriptionPdf, 'application/pdf')

  await setJobStage(job.id, analysisId, 'generating_report_pdf')
  const reportPdf = await generateReportPdf(header, evaluation)
  const reportPdfPath = `${analysisId}/report.pdf`
  await uploadBuffer(config.bucketArtifacts, reportPdfPath, reportPdf, 'application/pdf')

  // ----- 11. CRIAR ENTREGAS -----
  await setJobStage(job.id, analysisId, 'creating_deliveries')
  const summary = buildSummary(header, evaluation)
  const artifacts: DeliveryArtifacts = {
    summaryText: summary,
    reportPdfPath,
    transcriptionPdfPath,
    originalAudio: isAudio
      ? { path: analise.storage_path, sizeBytes: await fileSize(originalPath) }
      : null,
    fileName: (analise.arquivo_nome || 'arquivo').replace(/\.[^.]+$/, ''),
  }
  const recipients = await resolveRecipients(analise)
  await ensureDeliveries(analysisId, recipients, artifacts)

  // ----- 12. ENVIAR WHATSAPP -----
  await setJobStage(job.id, analysisId, 'sending_whatsapp')
  const deliveryStatus = await sendPendingDeliveries(analysisId, artifacts)
  await db.from('analises').update({ delivery_status: deliveryStatus }).eq('id', analysisId)

  const finalStage = deliveryStatus === 'complete' ? 'completed' : 'partial_delivery'
  await completeJob(job.id, analysisId, finalStage)
  logger.info('pipeline.done', { ...ctx, processing_stage: finalStage }, { finalScore, deliveryStatus })

  await cleanupTmp(analysisId)
}

// ------------------------- Helpers -------------------------

async function getExistingTranscription(analysisId: string): Promise<string | null> {
  const { data } = await db.from('transcricoes').select('conteudo').eq('analise_id', analysisId).maybeSingle()
  const text = data?.conteudo?.trim()
  return text ? text : null
}

async function handleAudio(
  job: Job,
  analise: Analise,
  originalPath: string,
  tmpBase: string,
  ctx: Record<string, unknown>,
): Promise<string> {
  await setJobStage(job.id, analise.id, 'preparing_file')

  // Só divide se ainda não houver chunks (idempotente/retomável).
  const { count } = await db
    .from('audio_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('analysis_id', analise.id)

  if ((count ?? 0) === 0) {
    const info = await probe(originalPath)
    await db.from('analises').update({ duration_ms: Math.round(info.durationSec * 1000) }).eq('id', analise.id)
    const normalized = await normalizeForSpeech(originalPath, tmpBase)
    const chunks = await splitIntoChunks(normalized, path.join(tmpBase, 'chunks'), info.durationSec)
    for (const c of chunks) {
      const remote = `${analise.id}/chunks/chunk_${c.chunkNumber}.m4a`
      await uploadFile(config.bucketMedia, remote, c.path, 'audio/mp4')
      await db.from('audio_chunks').upsert(
        {
          analysis_id: analise.id,
          chunk_number: c.chunkNumber,
          start_ms: c.startMs,
          end_ms: c.endMs,
          storage_path: remote,
          checksum: await sha256File(c.path),
          status: 'pending',
        },
        { onConflict: 'analysis_id,chunk_number' },
      )
    }
  }

  await setJobStage(job.id, analise.id, 'transcribing')
  const cfg = await getAgentModelConfig(analise.workspace_id!)
  const client = makeClient(cfg.apiKey)

  await transcribePendingChunks(analise.id, client)
  if (!(await allChunksDone(analise.id))) {
    throw new Error('Nem todos os chunks foram transcritos')
  }
  logger.info('audio.transcribed', { ...ctx, processing_stage: 'transcribing' })
  return consolidateTranscript(analise.id)
}

async function handlePdf(
  job: Job,
  analise: Analise,
  originalPath: string,
  tmpBase: string,
  ctx: Record<string, unknown>,
): Promise<string> {
  await setJobStage(job.id, analise.id, 'extracting_text')
  const pages = await extractPdfPages(originalPath)

  const ocrDir = path.join(tmpBase, 'ocr')
  const finalTexts: string[] = []
  let performedOcr = false

  // Agrupa páginas que precisam de OCR em lotes (retomáveis).
  for (const page of pages) {
    if (!page.needsOcr) {
      finalTexts.push(page.text)
      continue
    }
    performedOcr = true
    if (!ctx['ocr_started']) {
      await setJobStage(job.id, analise.id, 'performing_ocr')
      ctx['ocr_started'] = true
    }
    // registra/recupera lote
    await db.from('document_ocr_batches').upsert(
      {
        analysis_id: analise.id,
        page_start: page.page,
        page_end: page.page,
        needs_ocr: true,
        status: 'processing',
      },
      { onConflict: 'analysis_id,page_start,page_end' },
    )
    const images = await rasterizePages(originalPath, page.page, page.page, ocrDir)
    const text = await ocrImages(images)
    finalTexts.push(text)
    await db
      .from('document_ocr_batches')
      .update({ status: 'completed', extracted_text: text })
      .eq('analysis_id', analise.id)
      .eq('page_start', page.page)
      .eq('page_end', page.page)
  }

  if (performedOcr) logger.info('pdf.ocr.done', { ...ctx, processing_stage: 'performing_ocr' })
  return finalTexts.join('\n\n').trim()
}

interface FrozenVersions {
  promptVersionId: string
  promptContent: string
  documentoMestreVersionId: string
  scriptNota10VersionId: string
  modelProvider: string
  modelName: string
}

/** Congela versões ativas de prompt/documentos e modelo (uma única vez). */
async function freezeVersions(analise: Analise): Promise<FrozenVersions> {
  const { data: cfg } = await db
    .from('agentes_config')
    .select(
      'active_prompt_version_id, active_documento_mestre_version_id, active_script_nota_10_version_id, model_provider, model_name',
    )
    .eq('workspace_id', analise.workspace_id)
    .maybeSingle()

  // Resolve versões ativas: prioriza o que já foi congelado na análise, depois a
  // referência em agentes_config, e por fim consulta diretamente o flag is_active.
  const promptVersionId =
    analise.prompt_version_id ??
    cfg?.active_prompt_version_id ??
    (await activePromptVersionId(analise.workspace_id!))
  const docMestreId =
    analise.documento_mestre_version_id ??
    cfg?.active_documento_mestre_version_id ??
    (await activeDocVersionId(analise.workspace_id!, 'documento_mestre'))
  const scriptId =
    analise.script_nota_10_version_id ??
    cfg?.active_script_nota_10_version_id ??
    (await activeDocVersionId(analise.workspace_id!, 'script_nota_10'))

  if (!promptVersionId) throw new Error('Nenhum prompt ativo configurado para o workspace')
  if (!docMestreId) throw new Error('Documento Mestre não configurado — avaliação não iniciada')
  if (!scriptId) throw new Error('Script Nota 10 não configurado — avaliação não iniciada')

  // Garante documentos prontos (indexados)
  const { data: docs } = await db
    .from('agent_document_versions')
    .select('id, processing_status')
    .in('id', [docMestreId, scriptId])
  for (const d of docs ?? []) {
    if (d.processing_status !== 'ready') {
      throw new Error(`Documento ${d.id} ainda não está pronto (status ${d.processing_status})`)
    }
  }

  const { data: prompt } = await db
    .from('agent_prompt_versions')
    .select('prompt_content')
    .eq('id', promptVersionId)
    .single()
  if (!prompt) throw new Error('Versão de prompt não encontrada')

  const modelProvider = cfg?.model_provider ?? 'openai'
  const modelName = cfg?.model_name ?? 'gpt-4o'

  // Persiste versões congeladas na análise (se ainda não persistidas)
  await db
    .from('analises')
    .update({
      prompt_version_id: promptVersionId,
      documento_mestre_version_id: docMestreId,
      script_nota_10_version_id: scriptId,
      model_provider: modelProvider,
      model_name: modelName,
    })
    .eq('id', analise.id)

  return {
    promptVersionId,
    promptContent: prompt.prompt_content,
    documentoMestreVersionId: docMestreId,
    scriptNota10VersionId: scriptId,
    modelProvider,
    modelName,
  }
}

async function activePromptVersionId(workspaceId: string): Promise<string | null> {
  const { data } = await db
    .from('agent_prompt_versions')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .maybeSingle()
  return data?.id ?? null
}

async function activeDocVersionId(workspaceId: string, tipo: string): Promise<string | null> {
  const { data } = await db
    .from('agent_document_versions')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('document_type', tipo)
    .eq('is_active', true)
    .maybeSingle()
  return data?.id ?? null
}

async function getDocText(versionId: string): Promise<string | null> {
  const { data } = await db.from('agent_document_versions').select('extracted_text').eq('id', versionId).single()
  return data?.extracted_text ?? null
}

async function gatherMeta(
  analysisId: string,
  workspaceId: string,
): Promise<{ workspaceName: string; sellerName: string | null; managerName: string | null }> {
  const { data: ws } = await db.from('workspaces').select('name').eq('id', workspaceId).maybeSingle()
  const { data: transc } = await db
    .from('transcricoes')
    .select('usuario_avaliado_id')
    .eq('analise_id', analysisId)
    .maybeSingle()

  let sellerName: string | null = null
  let managerName: string | null = null
  if (transc?.usuario_avaliado_id) {
    const { data: seller } = await db
      .from('users_profile')
      .select('name, manager_id')
      .eq('id', transc.usuario_avaliado_id)
      .maybeSingle()
    sellerName = seller?.name ?? null
    if (seller?.manager_id) {
      const { data: manager } = await db
        .from('users_profile')
        .select('name')
        .eq('id', seller.manager_id)
        .maybeSingle()
      managerName = manager?.name ?? null
    }
  }
  return { workspaceName: ws?.name ?? 'Empresa', sellerName, managerName }
}

async function getExistingEvaluation(analysisId: string): Promise<Evaluation | null> {
  const { data } = await db.from('relatorios').select('avaliacao_json').eq('analise_id', analysisId).maybeSingle()
  return (data?.avaliacao_json as Evaluation) ?? null
}

async function persistReport(
  analysisId: string,
  workspaceId: string,
  evaluation: Evaluation,
  scores: Record<string, number>,
  finalScore: number,
  markdown: string,
): Promise<void> {
  const row: Record<string, unknown> = {
    analise_id: analysisId,
    workspace_id: workspaceId,
    avaliacao_json: evaluation,
    nota_media: finalScore,
    cliente_nome: evaluation.client.name,
    duracao_minutos: evaluation.client.estimated_duration_minutes,
    limitacoes_transcricao: evaluation.transcription_limitations,
    resumo_pontos_fortes: resolveOverallStrengths(evaluation).join('\n'),
    resumo_melhorias: resolveOverallImprovements(evaluation).join('\n'),
    texto_relatorio_completo: markdown,
    conteudo: markdown,
  }
  for (const [key, col] of Object.entries(STAGE_TO_COLUMN)) {
    row[col] = scores[key] ?? null
  }
  await db.from('relatorios').upsert(row, { onConflict: 'analise_id' })
}
