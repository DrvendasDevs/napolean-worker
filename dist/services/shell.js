import { spawn } from 'node:child_process';
/** Executa um comando externo capturando stdout/stderr (sem shell, args explícitos). */
export function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        const out = [];
        const err = [];
        child.stdout.on('data', (d) => out.push(Buffer.from(d)));
        child.stderr.on('data', (d) => err.push(Buffer.from(d)));
        child.on('error', reject);
        child.on('close', (code) => {
            resolve({
                stdout: Buffer.concat(out).toString('utf8'),
                stderr: Buffer.concat(err).toString('utf8'),
                code: code ?? -1,
            });
        });
        if (opts.input) {
            child.stdin.write(opts.input);
            child.stdin.end();
        }
    });
}
/** Executa e lança erro se o código de saída não for 0. */
export async function runOrThrow(cmd, args) {
    const res = await run(cmd, args);
    if (res.code !== 0) {
        throw new Error(`Comando falhou (${cmd} ${args.join(' ')}): ${res.stderr || res.stdout}`);
    }
    return res;
}
//# sourceMappingURL=shell.js.map