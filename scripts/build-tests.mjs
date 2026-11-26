// Bundles every src/test/*.test.ts into out-test/ so `node --test` can run them.
import { build } from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';

const entryPoints = readdirSync('src/test')
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => `src/test/${f}`);

rmSync('out-test', { recursive: true, force: true });

await build({
    entryPoints,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
    sourcemap: 'inline',
    outdir: 'out-test',
    logLevel: 'warning',
});
