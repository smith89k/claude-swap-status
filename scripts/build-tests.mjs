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
    // Tests get a small stand-in for the editor API instead of the real one.
    alias: { vscode: './src/test/fakes/vscode.ts' },
    sourcemap: 'inline',
    outdir: 'out-test',
    logLevel: 'warning',
});
