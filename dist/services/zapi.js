import { db } from '../db.js';
import { getSecret } from '../vault.js';
async function loadCredentials() {
    const { data, error } = await db
        .from('zapi_integration')
        .select('instance_id_secret_id, instance_token_secret_id, client_token_secret_id')
        .eq('id', 1)
        .single();
    if (error || !data)
        throw new Error('Integração Z-API não configurada');
    const [instanceId, instanceToken, clientToken] = await Promise.all([
        getSecret(data.instance_id_secret_id),
        getSecret(data.instance_token_secret_id),
        getSecret(data.client_token_secret_id),
    ]);
    if (!instanceId || !instanceToken || !clientToken) {
        throw new Error('Credenciais Z-API incompletas no Vault');
    }
    return { instanceId, instanceToken, clientToken };
}
function baseUrl(c) {
    return `https://api.z-api.io/instances/${c.instanceId}/token/${c.instanceToken}`;
}
async function post(path, body) {
    const creds = await loadCredentials();
    const res = await fetch(`${baseUrl(creds)}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Client-Token': creds.clientToken,
        },
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
}
async function get(path) {
    const creds = await loadCredentials();
    const res = await fetch(`${baseUrl(creds)}${path}`, {
        headers: { 'Client-Token': creds.clientToken },
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
}
export const zapi = {
    async sendText(phone, message) {
        return post('/send-text', { phone, message });
    },
    async sendDocument(phone, extension, documentUrl, fileName) {
        return post(`/send-document/${extension}`, { phone, document: documentUrl, fileName });
    },
    async sendAudio(phone, audioUrl) {
        return post('/send-audio', { phone, audio: audioUrl });
    },
    async status() {
        return get('/status');
    },
    async connectedPhone() {
        const res = await get('/device');
        const j = res.json;
        return j?.phone ?? null;
    },
    /** Baixa mídia recebida via URL fornecida pela Z-API no webhook. */
    async downloadMedia(url) {
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`Falha ao baixar mídia Z-API: ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
    },
};
/** Lê metadados públicos (não sensíveis) da integração. */
export async function getIntegrationMeta() {
    const { data } = await db
        .from('zapi_integration')
        .select('connected_phone, connection_status')
        .eq('id', 1)
        .single();
    return {
        connectedPhone: data?.connected_phone ?? null,
        connectionStatus: data?.connection_status ?? null,
    };
}
//# sourceMappingURL=zapi.js.map