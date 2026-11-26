import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestPath, takeJumpRequest, writeJumpRequest } from '../core/jumpRequests';
import { ancestors, parentPid, type ProcRunner } from '../core/processTree';

const tmp = () => mkdtemp(join(tmpdir(), 'cs-jump-'));

test('a request is written for one window and taken once', async () => {
    const root = await tmp();
    await writeJumpRequest(root, 'w1', { sessionId: 's', pid: 5, kind: 'ide', at: 1000 });
    assert.equal(await takeJumpRequest(root, 'w2', 1000), undefined);
    assert.deepEqual(await takeJumpRequest(root, 'w1', 2000), { sessionId: 's', pid: 5, kind: 'ide', at: 1000 });
    assert.equal(await takeJumpRequest(root, 'w1', 2000), undefined);
});

test('an old request is dropped and deleted', async () => {
    const root = await tmp();
    await writeJumpRequest(root, 'w1', { sessionId: 's', pid: 5, kind: 'ide', at: 0 });
    assert.equal(await takeJumpRequest(root, 'w1', 31_000), undefined);
    assert.ok(!existsSync(requestPath(root, 'w1')));
});

test('parentPid asks PowerShell on Windows and ps elsewhere', async () => {
    const calls: string[][] = [];
    const run: ProcRunner = async (cmd, args) => {
        calls.push([cmd, ...args]);
        return cmd === 'ps' ? '  4321\n' : '1234\r\n';
    };
    assert.equal(await parentPid(77, 'win32', run), 1234);
    assert.ok(calls[0][0] === 'powershell' && calls[0].join(' ').includes('ProcessId=77'));
    assert.equal(await parentPid(77, 'linux', run), 4321);
    assert.deepEqual(calls[1], ['ps', '-o', 'ppid=', '-p', '77']);
});

test('parentPid gives up on bad output or a bad pid', async () => {
    assert.equal(await parentPid(77, 'linux', async () => 'nope'), undefined);
    assert.equal(await parentPid(1.5, 'linux', async () => { throw new Error('never called'); }), undefined);
    assert.equal(await parentPid(77, 'linux', async () => { throw new Error('ps failed'); }), undefined);
});

test('ancestors walks up to the given number of levels', async () => {
    const parent: Record<number, string> = { 10: '20', 20: '30', 30: '0' };
    assert.deepEqual(await ancestors(10, 3, 'linux', async (_c, a) => parent[Number(a[a.length - 1])] ?? ''), [20, 30]);
    const loop: Record<number, string> = { 1: '2', 2: '1' };
    assert.deepEqual(await ancestors(1, 5, 'linux', async (_c, a) => loop[Number(a[a.length - 1])] ?? ''), [2]);
});
