import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSessions } from '../core/sessions';

async function home(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'cs-sess-'));
    await mkdir(join(dir, 'sessions'));
    for (const [name, text] of Object.entries(files)) {
        await writeFile(join(dir, 'sessions', name), text);
    }
    return dir;
}

test('reads sessions from every account folder and maps kind, status and age', async () => {
    const main = await home({
        '10.json': JSON.stringify({ pid: 10, sessionId: 's1', cwd: 'C:\\p\\a', name: 'a-1', entrypoint: 'claude-vscode', status: 'waiting', statusUpdatedAt: 500, updatedAt: 400, startedAt: 300 }),
        '30.json': JSON.stringify({ pid: 30, sessionId: 's3', cwd: '/x', name: 'n', entrypoint: 'claude-desktop', status: 'odd', startedAt: 900 }),
    });
    const acc = await home({
        '20.json': JSON.stringify({ pid: 20, sessionId: 's2', cwd: '/p/b', name: '', entrypoint: 'cli', status: 'shell', updatedAt: 700, startedAt: 600 }),
    });
    const got = await listSessions([{ accountKey: 'main', configHome: main }, { accountKey: 'a1', configHome: acc }], () => true);
    const by = Object.fromEntries(got.map((s) => [s.sessionId, s]));
    assert.deepEqual(by.s1, { pid: 10, sessionId: 's1', cwd: 'C:\\p\\a', name: 'a-1', kind: 'ide', status: 'waiting', since: 500, accountKey: 'main' });
    assert.deepEqual([by.s2.kind, by.s2.status, by.s2.since, by.s2.name, by.s2.accountKey], ['terminal', 'working', 700, 'b', 'a1']);
    assert.deepEqual([by.s3.kind, by.s3.status, by.s3.since], ['app', 'idle', 900]);
});

test('dead pids, key files and broken files are skipped', async () => {
    const dir = await home({
        '10.json': JSON.stringify({ pid: 10, sessionId: 's', cwd: '/a' }),
        '11.abcdef.key': 'secret',
        '12.json': '{"pid":',
        '13.json': JSON.stringify({ pid: 13, cwd: '/a' }),
    });
    assert.deepEqual(await listSessions([{ accountKey: 'main', configHome: dir }], (p) => p !== 10), []);
});

test('a missing sessions folder is just empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-sess-'));
    assert.deepEqual(await listSessions([{ accountKey: 'a9', configHome: join(dir, 'nope') }]), []);
});
