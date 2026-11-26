import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncSharedSetup, seedGlobalConfig, syncMcpServers, MANIFEST } from '../core/share';
import { removeAccountFolder } from '../core/safeDelete';
import { readJson, writeJsonAtomic } from '../core/fsjson';

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'cs space ễ-'));
    const mainHome = join(root, 'main');
    const accountHome = join(root, 'acc1');
    const mainGlobal = join(root, 'main.claude.json');
    const accGlobal = join(accountHome, '.claude.json');
    await mkdir(join(mainHome, 'projects'), { recursive: true });
    await writeFile(join(mainHome, 'projects', 'p.txt'), 'x');
    await mkdir(join(mainHome, 'skills'));
    await writeFile(join(mainHome, 'settings.json'), '{"a":1}');
    await writeFile(join(mainHome, '.credentials.json'), 'secret');
    await mkdir(join(mainHome, 'sessions'));
    await writeFile(join(mainHome, 'sessions', '1.json'), '{}');
    await mkdir(accountHome);
    await writeFile(mainGlobal, JSON.stringify({
        hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.332', mcpServers: { a: {} },
        oauthAccount: { emailAddress: 'me@x' }, projects: {},
    }));
    return { root, mainHome, accountHome, mainGlobal, accGlobal };
}

test('links shared folders that exist, never secrets or runtime dirs, and records them', async () => {
    const { mainHome, accountHome } = await fixture();
    const m = await syncSharedSetup({ mainHome, accountHome, platform: process.platform });
    assert.ok((await lstat(join(accountHome, 'projects'))).isSymbolicLink());
    assert.equal(await readFile(join(accountHome, 'projects', 'p.txt'), 'utf8'), 'x');
    assert.ok(!existsSync(join(accountHome, '.credentials.json')));
    assert.ok(!existsSync(join(accountHome, 'sessions')));
    assert.deepEqual([...m.links].sort(), process.platform === 'win32' ? ['projects', 'skills'] : ['projects', 'settings.json', 'skills']);
    assert.equal(await readFile(join(accountHome, 'settings.json'), 'utf8'), '{"a":1}');
    assert.ok(existsSync(join(accountHome, MANIFEST)));
});

test('missing source is skipped, then linked once it exists', async () => {
    const { mainHome, accountHome } = await fixture();
    await syncSharedSetup({ mainHome, accountHome, platform: process.platform });
    assert.ok(!existsSync(join(accountHome, 'agents')));
    await mkdir(join(mainHome, 'agents'));
    await syncSharedSetup({ mainHome, accountHome, platform: process.platform });
    assert.ok((await lstat(join(accountHome, 'agents'))).isSymbolicLink());
});

test('Windows mode copies files from main every time (main wins)', async () => {
    const { mainHome, accountHome } = await fixture();
    await writeFile(join(mainHome, 'settings.json'), '{"v":1}');
    await writeFile(join(mainHome, 'history.jsonl'), '{}\n');
    await syncSharedSetup({ mainHome, accountHome, platform: 'win32' });
    await writeFile(join(accountHome, 'settings.json'), '{"edited":true}');
    await writeFile(join(mainHome, 'settings.json'), '{"v":2}');
    const m = await syncSharedSetup({ mainHome, accountHome, platform: 'win32' });
    assert.equal(await readFile(join(accountHome, 'settings.json'), 'utf8'), '{"v":2}');
    assert.ok(m.copies.includes('settings.json'));
    assert.ok(!existsSync(join(accountHome, 'history.jsonl')));
});

test('seedGlobalConfig copies onboarding flags and mcpServers once, never oauthAccount', async () => {
    const { mainGlobal, accGlobal } = await fixture();
    await seedGlobalConfig(mainGlobal, accGlobal);
    assert.deepEqual(await readJson(accGlobal), { hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.332', mcpServers: { a: {} } });
    await writeJsonAtomic(accGlobal, { kept: 1 });
    await seedGlobalConfig(mainGlobal, accGlobal);
    assert.deepEqual(await readJson(accGlobal), { kept: 1 });
});

test('syncMcpServers replaces mcpServers only', async () => {
    const { mainGlobal, accGlobal } = await fixture();
    await writeJsonAtomic(accGlobal, { oauthAccount: { emailAddress: 'w@x' }, mcpServers: { old: {} } });
    await syncMcpServers(mainGlobal, accGlobal);
    assert.deepEqual(await readJson(accGlobal), { oauthAccount: { emailAddress: 'w@x' }, mcpServers: { a: {} } });
});

test('removeAccountFolder deletes the account but never what its links point to', async () => {
    const { root, mainHome, accountHome } = await fixture();
    await syncSharedSetup({ mainHome, accountHome, platform: process.platform });
    await writeFile(join(accountHome, 'own.txt'), 'mine');
    await symlink(join(mainHome, 'skills'), join(accountHome, 'extra'), process.platform === 'win32' ? 'junction' : 'dir');
    await removeAccountFolder(root, accountHome);
    assert.ok(!existsSync(accountHome));
    assert.equal(await readFile(join(mainHome, 'projects', 'p.txt'), 'utf8'), 'x');
    assert.ok(existsSync(join(mainHome, 'skills')));
    assert.equal(await readFile(join(mainHome, 'settings.json'), 'utf8'), '{"a":1}');
});

test('removeAccountFolder refuses a folder outside the accounts root', async () => {
    const { root, mainHome } = await fixture();
    await assert.rejects(removeAccountFolder(join(root, 'accounts'), mainHome), /outside/);
    assert.ok(existsSync(join(mainHome, 'projects', 'p.txt')));
});
