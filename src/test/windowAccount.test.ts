import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyWindowAccount } from '../vscode/windowAccount';
import { Registry } from '../core/registry';
import { WINDOW_ACCOUNT_KEY } from '../core/windowEnv';
import { fake, FakeEnvCollection, FakeLog, FakeMemento } from './fakes/vscode';

async function setup(choice?: string) {
    fake.reset();
    const root = await mkdtemp(join(tmpdir(), 'cs-apply-'));
    const main = join(root, 'main');
    await mkdir(join(main, 'projects'), { recursive: true });
    await writeFile(join(main, '.claude.json'), JSON.stringify({ mcpServers: { m: {} } }));
    const registry = new Registry(join(root, 'accounts'));
    const folder = join(root, 'accounts', 'a1');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'w@x' } }));
    await registry.add({ id: 'a1', folder });
    const state = new FakeMemento();
    if (choice) {
        await state.update(WINDOW_ACCOUNT_KEY, choice);
    }
    const env = new FakeEnvCollection();
    const context = { workspaceState: state, environmentVariableCollection: env } as any;
    return { root, main, folder, registry, state, env, context, log: new FakeLog() as any };
}

test.afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR;
});

test('an account window exports its folder to Claude and to terminals, and shares the main setup', async () => {
    const s = await setup('a1');
    const r = await applyWindowAccount(s.context, s.main, s.registry, s.log);
    assert.deepEqual(r, { key: 'a1', configDir: s.folder });
    assert.equal(process.env.CLAUDE_CONFIG_DIR, s.folder);
    assert.equal(s.env.vars.get('CLAUDE_CONFIG_DIR'), s.folder);
    assert.ok((await lstat(join(s.folder, 'projects'))).isSymbolicLink());
    assert.equal(fake.messages.length, 0);
});

test('a main-login window exports the original folder (here: none)', async () => {
    const s = await setup();
    process.env.CLAUDE_CONFIG_DIR = '/left/over';
    const r = await applyWindowAccount(s.context, undefined, s.registry, s.log);
    assert.deepEqual(r, { key: 'main', configDir: undefined });
    assert.equal(process.env.CLAUDE_CONFIG_DIR, undefined);
    assert.equal(s.env.vars.has('CLAUDE_CONFIG_DIR'), false);
});

test('a window whose account folder is gone falls back to main and says so', async () => {
    const s = await setup('zz');
    const r = await applyWindowAccount(s.context, s.main, s.registry, s.log);
    assert.equal(r.key, 'main');
    assert.equal(s.state.get(WINDOW_ACCOUNT_KEY), 'main');
    assert.ok(fake.messages.some((m) => m.level === 'warning' && /main login/.test(m.text)));
    assert.ok(!existsSync(join(s.root, 'accounts', 'zz')));
});

test('warns when claudeCode.environmentVariables forces one folder on every window', async () => {
    const s = await setup('a1');
    fake.config['claudeCode.environmentVariables'] = [{ name: 'CLAUDE_CONFIG_DIR', value: 'C:\\x' }];
    await applyWindowAccount(s.context, s.main, s.registry, s.log);
    assert.ok(fake.messages.some((m) => m.level === 'warning' && /CLAUDE_CONFIG_DIR/.test(m.text) && m.items.includes('Open Settings')));
});

test('asks to reload once when Claude already started with another folder', async () => {
    const s = await setup('a1');
    fake.activeExtensions.add('anthropic.claude-code');
    await applyWindowAccount(s.context, s.main, s.registry, s.log);
    await applyWindowAccount(s.context, s.main, s.registry, s.log);
    const prompts = fake.messages.filter((m) => m.items.includes('Reload'));
    assert.equal(prompts.length, 1);
});
