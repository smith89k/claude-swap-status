import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WindowRegistry, isAccountInUse, isPidAlive } from '../core/windows';

const tmp = () => mkdtemp(join(tmpdir(), 'cs-win-'));

test('live() keeps fresh beats with live pids only', async () => {
    const root = await tmp();
    let now = 1_000_000;
    const alive = new Set([111, 222]);
    const reg = new WindowRegistry(root, () => now, (pid) => alive.has(pid));
    await reg.beat({ windowId: 'w1', accountKey: 'main', workspaceName: 'a', pid: 111 });
    await reg.beat({ windowId: 'w2', accountKey: 'ab', workspaceName: 'b', pid: 222 });
    await reg.beat({ windowId: 'w3', accountKey: 'ab', workspaceName: 'c', pid: 333 });
    now += 60_000;
    await reg.beat({ windowId: 'w2', accountKey: 'ab', workspaceName: 'b', pid: 222 });
    now += 40_000;
    assert.deepEqual((await reg.live()).map((b) => b.windowId), ['w2']);
});

test('remove() deletes a beat', async () => {
    const root = await tmp();
    const reg = new WindowRegistry(root);
    await reg.beat({ windowId: 'w1', accountKey: 'main', workspaceName: 'a', pid: process.pid });
    await reg.remove('w1');
    assert.ok(!existsSync(join(root, 'windows', 'w1.json')));
});

test('isPidAlive', () => {
    assert.equal(isPidAlive(process.pid), true);
    assert.equal(isPidAlive(2 ** 22 + 12345), false);
});

test('in use: a live window, a live Claude session, or a fresh refresh lock', async () => {
    const home = join(await tmp(), 'acc');
    await mkdir(join(home, 'sessions'), { recursive: true });
    const base = { accountKey: 'ab', configHome: home, liveWindows: [], isAlive: (p: number) => p === 4242 };
    assert.equal(await isAccountInUse(base), false);
    assert.equal(await isAccountInUse({ ...base, liveWindows: [{ windowId: 'w', accountKey: 'ab', workspaceName: 'x', pid: 1, updatedAt: 0 }] }), true);
    await writeFile(join(home, 'sessions', '4242.json'), JSON.stringify({ pid: 4242 }));
    assert.equal(await isAccountInUse(base), true);
    await rm(join(home, 'sessions', '4242.json'));
    await writeFile(join(home, 'sessions', '999.json'), JSON.stringify({ pid: 999 }));
    await writeFile(join(home, 'sessions', 'bad.json'), '{x');
    assert.equal(await isAccountInUse(base), false);
    await mkdir(join(home, '.oauth_refresh.lock'));
    assert.equal(await isAccountInUse(base), true);
});

test('in use: a missing config folder is simply not in use', async () => {
    const home = join(await tmp(), 'never-created');
    assert.equal(await isAccountInUse({ accountKey: 'ab', configHome: home, liveWindows: [] }), false);
});
