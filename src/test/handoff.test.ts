import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    CLAIM_MAX_AGE_MS,
    anyCapableWindowSync,
    bestWindowFor,
    capableWindowFor,
    claimRequest,
    finishClaim,
    handoffDir,
    isFresh,
    parseRequest,
    peekRequest,
    pendingRequests,
    readResult,
    sweep,
    writeRequest,
    writeRequestSync,
    type HandoffRequest,
    type HandoffResult,
} from '../core/handoff';
import type { WindowBeat } from '../core/types';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const AT = 1_795_796_745_786;
const close: HandoffRequest = { v: 1, action: 'close', sessionId: ID, cwd: 'e:\\_httdocs\\claude-away', accountKey: 'main', pid: 55492, at: AT };
const open: HandoffRequest = { v: 1, action: 'open', sessionId: ID, cwd: 'e:\\_httdocs\\claude-away', accountKey: 'main', at: AT };
const tempRoot = () => mkdtemp(join(tmpdir(), 'cs-ho-'));

test('a valid request round-trips; bad ones are rejected', async () => {
    const root = await tempRoot();
    await writeRequest(root, close);
    assert.deepEqual(await peekRequest(root, ID, 'win32'), close);
    writeRequestSync(root, open);
    assert.deepEqual(await peekRequest(root, ID, 'win32'), open, 'a newer request replaces the older one');
    for (const bad of [
        { ...close, v: 2 },
        { ...close, action: 'kill' },
        { ...close, sessionId: 'abc' },
        { ...close, cwd: 'relative\\x' },
        { ...close, pid: undefined },
        { ...close, accountKey: undefined },
        { ...close, at: 'soon' },
        null,
        'close',
    ]) {
        assert.equal(parseRequest(bad, 'win32'), undefined, JSON.stringify(bad));
    }
});

test('freshness: close 30 s, open 5 min, and nothing from the future', () => {
    assert.equal(isFresh(close, AT + 30_000), true);
    assert.equal(isFresh(close, AT + 30_001), false);
    assert.equal(isFresh(open, AT + 300_000), true);
    assert.equal(isFresh(open, AT + 300_001), false);
    assert.equal(isFresh(close, AT - 120_000), false, 'a clock that jumped back never keeps a request alive');
});

test('only one window can claim a request', async () => {
    const root = await tempRoot();
    await writeRequest(root, close);
    assert.deepEqual(await pendingRequests(root), [ID]);
    assert.deepEqual(await claimRequest(root, ID, 'w1', 'win32'), close);
    assert.equal(await claimRequest(root, ID, 'w2', 'win32'), undefined);
    const result: HandoffResult = { v: 1, action: 'close', result: 'closed', windowId: 'w1', at: AT + 900 };
    await finishClaim(root, ID, 'w1', result);
    assert.deepEqual(await readResult(root, ID), result);
    assert.deepEqual(await pendingRequests(root), []);
    assert.deepEqual((await readdir(handoffDir(root))).sort(), [`${ID}.result.json`], 'the claim is gone');
});

test('a broken request is never acted on: claiming it gives nothing and removes it', async () => {
    const root = await tempRoot();
    await mkdir(handoffDir(root), { recursive: true });
    await writeFile(join(handoffDir(root), `${ID}.json`), '{"v":1,"action":"close"');
    assert.equal(await claimRequest(root, ID, 'w1', 'win32'), undefined);
    assert.deepEqual(await readdir(handoffDir(root)), []);
});

test('the temp file of an atomic write is never listed as a request', async () => {
    const root = await tempRoot();
    await mkdir(handoffDir(root), { recursive: true });
    await writeFile(join(handoffDir(root), `${ID}.json.123.ab.tmp`), JSON.stringify(close));
    await writeFile(join(handoffDir(root), `${ID}.result.json`), '{}');
    assert.deepEqual(await pendingRequests(root), []);
});

test('sweep removes expired requests, old results and old claims, and keeps fresh ones', async () => {
    const root = await tempRoot();
    const dir = handoffDir(root);
    const now = AT + 10 * 60_000;
    const fresh = '11111111-2222-4333-8444-555555555555';
    const oldResult = '21111111-2222-4333-8444-555555555555';
    const newResult = '31111111-2222-4333-8444-555555555555';
    const oldClaim = '41111111-2222-4333-8444-555555555555';
    const newClaim = '51111111-2222-4333-8444-555555555555';
    await writeRequest(root, close); // made at AT: long expired by now
    await writeRequest(root, { ...open, sessionId: fresh, at: now - 1_000 });
    await writeFile(join(dir, `${oldResult}.result.json`), JSON.stringify({ v: 1, action: 'open', result: 'opened', windowId: 'w', at: now - 6 * 60_000 }));
    await writeFile(join(dir, `${newResult}.result.json`), JSON.stringify({ v: 1, action: 'open', result: 'opened', windowId: 'w', at: now - 60_000 }));
    await writeFile(join(dir, `${oldClaim}.w1.claim`), JSON.stringify(open));
    await writeFile(join(dir, `${newClaim}.w1.claim`), JSON.stringify(open));
    const old = new Date(now - CLAIM_MAX_AGE_MS - 1_000);
    await utimes(join(dir, `${oldClaim}.w1.claim`), old, old);
    const recent = new Date(now - 1_000);
    await utimes(join(dir, `${newClaim}.w1.claim`), recent, recent);
    await sweep(root, now, 'win32');
    assert.deepEqual((await readdir(dir)).sort(), [`${fresh}.json`, `${newClaim}.w1.claim`, `${newResult}.result.json`].sort());
});

const beat = (windowId: string, folders: string[], extra: Partial<WindowBeat> = {}): WindowBeat =>
    ({ windowId, accountKey: 'main', workspaceName: windowId, pid: 100, updatedAt: AT, folders, handoff: 1, ...extra });

test('the best window is the longest folder for the right account, among capable windows only', () => {
    const windows = [
        beat('A', ['C:\\p']),
        beat('B', ['C:\\p\\site']),
        beat('C', ['C:\\p\\site'], { accountKey: 'w' }),
        beat('D', ['C:\\p\\site\\sub'], { handoff: undefined }),
    ];
    assert.equal(bestWindowFor('c:\\P\\site\\x', 'main', windows, 'win32')?.windowId, 'B');
    assert.equal(bestWindowFor('C:/p/site/', 'main', windows, 'win32')?.windowId, 'B', 'slashes and a trailing separator still match');
    assert.equal(bestWindowFor('C:\\pear', 'main', windows, 'win32'), undefined, 'a folder name that only starts the same does not count');
    assert.equal(bestWindowFor('D:\\x', 'main', windows, 'win32'), undefined);
    assert.equal(bestWindowFor('C:\\p\\site', 'main', [beat('z2', ['C:\\p\\site']), beat('z1', ['C:\\p\\site'])], 'win32')?.windowId, 'z1', 'ties go to the smaller id');
});

test('capable windows need a fresh beat and a live pid', async () => {
    const root = await tempRoot();
    await mkdir(join(root, 'windows'));
    const now = AT + 1_000;
    const put = (b: WindowBeat) => writeFile(join(root, 'windows', `${b.windowId}.json`), JSON.stringify(b));
    const isAlive = (pid: number) => pid !== 999;
    await put(beat('stale', ['C:\\p'], { updatedAt: now - 91_000 }));
    await put(beat('dead', ['C:\\p'], { pid: 999 }));
    assert.equal(await capableWindowFor(root, 'C:\\p\\x', 'main', now, isAlive, 'win32'), undefined);
    assert.equal(anyCapableWindowSync(root, now, isAlive), false);
    await put(beat('old-version', ['C:\\p'], { handoff: undefined }));
    assert.equal(anyCapableWindowSync(root, now, isAlive), false, 'a window without handoff does not count');
    await put(beat('good', ['C:\\p']));
    assert.equal((await capableWindowFor(root, 'C:\\p\\x', 'main', now, isAlive, 'win32'))?.windowId, 'good');
    assert.equal(anyCapableWindowSync(root, now, isAlive), true);
    assert.equal(anyCapableWindowSync(await tempRoot(), now, isAlive), false, 'no windows folder at all');
});
