import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
/** Garante um diretório temporário isolado por análise. */
export async function ensureTmp(sub) {
    const dir = path.join(config.tmpDir, sub);
    await fs.mkdir(dir, { recursive: true });
    return dir;
}
export async function cleanupTmp(sub) {
    const dir = path.join(config.tmpDir, sub);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => { });
}
/** Baixa um objeto de um bucket privado para um arquivo local. */
export async function downloadToFile(bucket, remotePath, localPath) {
    const { data, error } = await db.storage.from(bucket).download(remotePath);
    if (error || !data)
        throw new Error(`Falha ao baixar ${bucket}/${remotePath}: ${error?.message}`);
    const buf = Buffer.from(await data.arrayBuffer());
    await fs.writeFile(localPath, buf);
}
/** Envia um arquivo local para um bucket privado. */
export async function uploadFile(bucket, remotePath, localPath, contentType) {
    const buf = await fs.readFile(localPath);
    const { error } = await db.storage.from(bucket).upload(remotePath, buf, {
        contentType,
        upsert: true,
    });
    if (error)
        throw new Error(`Falha ao enviar ${bucket}/${remotePath}: ${error.message}`);
}
/** Envia um buffer para um bucket privado. */
export async function uploadBuffer(bucket, remotePath, buf, contentType) {
    const { error } = await db.storage.from(bucket).upload(remotePath, buf, { contentType, upsert: true });
    if (error)
        throw new Error(`Falha ao enviar ${bucket}/${remotePath}: ${error.message}`);
}
/** Gera URL assinada temporária (usada só quando necessário; nunca pública). */
export async function signedUrl(bucket, remotePath, expiresInSec = 900) {
    const { data, error } = await db.storage.from(bucket).createSignedUrl(remotePath, expiresInSec);
    if (error || !data)
        throw new Error(`Falha ao assinar ${bucket}/${remotePath}: ${error?.message}`);
    return data.signedUrl;
}
export async function sha256File(localPath) {
    const buf = await fs.readFile(localPath);
    return crypto.createHash('sha256').update(buf).digest('hex');
}
//# sourceMappingURL=storage.js.map