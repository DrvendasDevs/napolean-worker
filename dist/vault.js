import { db } from './db.js';
/** Lê um segredo do Supabase Vault via RPC (restrita a service_role). */
export async function getSecret(secretId) {
    if (!secretId)
        return null;
    const { data, error } = await db.rpc('vault_get_secret', { p_id: secretId });
    if (error)
        throw new Error(`Falha ao ler segredo do Vault: ${error.message}`);
    return data ?? null;
}
/** Cria/atualiza um segredo no Vault e retorna o id. */
export async function setSecret(name, secret) {
    const { data, error } = await db.rpc('vault_set_secret', { p_name: name, p_secret: secret });
    if (error)
        throw new Error(`Falha ao gravar segredo no Vault: ${error.message}`);
    return data;
}
//# sourceMappingURL=vault.js.map