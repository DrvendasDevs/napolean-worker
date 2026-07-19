import OpenAI from 'openai'
import fs from 'node:fs'
import { config } from '../config.js'
import { db } from '../db.js'
import { getSecret } from '../vault.js'

export interface AgentModelConfig {
  apiKey: string
  provider: string
  model: string
}

/**
 * Resolve a configuração de modelo/credencial do workspace.
 * Preferência: segredo no Vault; fallback: coluna legada (service_role).
 */
export async function getAgentModelConfig(workspaceId: string): Promise<AgentModelConfig> {
  const { data, error } = await db
    .from('agentes_config')
    .select('openai_api_key, openai_api_key_secret_id, model_provider, model_name')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw new Error(`Falha ao ler agentes_config: ${error.message}`)
  if (!data) throw new Error('Configuração do agente não encontrada para o workspace')

  let apiKey: string | null = null
  if (data.openai_api_key_secret_id) {
    apiKey = await getSecret(data.openai_api_key_secret_id)
  }
  if (!apiKey) apiKey = data.openai_api_key ?? null
  if (!apiKey) throw new Error('Credencial de IA não configurada para o workspace')

  return {
    apiKey,
    provider: data.model_provider ?? 'openai',
    model: data.model_name ?? 'gpt-4o',
  }
}

export function makeClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey })
}

/** Gera embedding de um texto. */
export async function embed(client: OpenAI, text: string): Promise<number[]> {
  const res = await client.embeddings.create({ model: config.embeddingModel, input: text })
  return res.data[0]!.embedding as number[]
}

/** Transcreve um arquivo de áudio com Whisper, retornando texto + segmentos. */
export async function transcribeFile(
  client: OpenAI,
  filePath: string,
): Promise<{ text: string; segments: { start: number; end: number; text: string }[] }> {
  const res = (await client.audio.transcriptions.create({
    file: fs.createReadStream(filePath) as unknown as File,
    model: config.whisperModel,
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  })) as unknown as { text: string; segments?: { start: number; end: number; text: string }[] }

  return {
    text: res.text ?? '',
    segments: (res.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text })),
  }
}

/** Chamada de chat com Structured Outputs (JSON Schema estrito). */
export async function chatStructured(
  client: OpenAI,
  model: string,
  system: string,
  user: string,
  jsonSchema: { name: string; strict: boolean; schema: unknown },
): Promise<string> {
  const res = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: jsonSchema as never,
    },
  })
  return res.choices[0]?.message?.content ?? ''
}
