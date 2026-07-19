import { db } from '../db.js'
import { getSecret } from '../vault.js'

/**
 * Cliente isolado da Z-API. Lê credenciais do Vault e nunca as expõe/loga.
 * A instância pertence à Napoleon (global).
 */
export interface ZapiCredentials {
  instanceId: string
  instanceToken: string
  clientToken: string
}

export interface ZapiIntegration {
  connectedPhone: string | null
  connectionStatus: string | null
}

async function loadCredentials(): Promise<ZapiCredentials> {
  const { data, error } = await db
    .from('zapi_integration')
    .select('instance_id_secret_id, instance_token_secret_id, client_token_secret_id')
    .eq('id', 1)
    .single()
  if (error || !data) throw new Error('Integração Z-API não configurada')

  const [instanceId, instanceToken, clientToken] = await Promise.all([
    getSecret(data.instance_id_secret_id),
    getSecret(data.instance_token_secret_id),
    getSecret(data.client_token_secret_id),
  ])
  if (!instanceId || !instanceToken || !clientToken) {
    throw new Error('Credenciais Z-API incompletas no Vault')
  }
  return { instanceId, instanceToken, clientToken }
}

function baseUrl(c: ZapiCredentials): string {
  return `https://api.z-api.io/instances/${c.instanceId}/token/${c.instanceToken}`
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
  const creds = await loadCredentials()
  const res = await fetch(`${baseUrl(creds)}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': creds.clientToken,
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

async function get(path: string): Promise<{ ok: boolean; status: number; json: unknown }> {
  const creds = await loadCredentials()
  const res = await fetch(`${baseUrl(creds)}${path}`, {
    headers: { 'Client-Token': creds.clientToken },
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

export const zapi = {
  async sendText(phone: string, message: string) {
    return post('/send-text', { phone, message })
  },

  async sendDocument(phone: string, extension: string, documentUrl: string, fileName: string) {
    return post(`/send-document/${extension}`, { phone, document: documentUrl, fileName })
  },

  async sendAudio(phone: string, audioUrl: string) {
    return post('/send-audio', { phone, audio: audioUrl })
  },

  async status() {
    return get('/status')
  },

  async connectedPhone(): Promise<string | null> {
    const res = await get('/device')
    const j = res.json as { phone?: string }
    return j?.phone ?? null
  },

  /** Baixa mídia recebida via URL fornecida pela Z-API no webhook. */
  async downloadMedia(url: string): Promise<Buffer> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Falha ao baixar mídia Z-API: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  },
}

/** Lê metadados públicos (não sensíveis) da integração. */
export async function getIntegrationMeta(): Promise<ZapiIntegration> {
  const { data } = await db
    .from('zapi_integration')
    .select('connected_phone, connection_status')
    .eq('id', 1)
    .single()
  return {
    connectedPhone: data?.connected_phone ?? null,
    connectionStatus: data?.connection_status ?? null,
  }
}
