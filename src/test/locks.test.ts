import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readJson, writeJsonAtomic, CorruptJsonError } from '../core/fsjson';
import { acquireLock, withCredentialLocks, withConfigLock, LockTimeoutError } from '../core/locks';
import { credentialLockPaths, configLockPath } from '../core/paths';

const tmp = () => mkdtemp(join(tmpdir(), 'cs-locks-'));

test('writeJsonAtomic round-trips and leaves no temp files', async () => {
    const d = await tmp();
    const f = join(d, 'sub', 'a.json');
    await writeJsonAtomic(f, { a: 1 });
    assert.deepEqual(await readJson(f), { a: 1 });
    assert.deepEqual(await readdir(join(d, 'sub')), ['a.json']);
});

test('readJson: missing is undefined, bad JSON throws CorruptJsonError', async () => {
    const d = await tmp();
    assert.equal(await readJson(join(d, 'none.json')), undefined);
    await writeFile(join(d, 'bad.json'), '{nope');
    await assert.rejects(readJson(join(d, 'bad.json')), CorruptJsonError);
});

test('acquire creates the lock dir, release removes it', async () => {
    const lp = join(await tmp(), 'x.lock');
    const release = await acquireLock(lp, { staleMs: 60_000 });
    assert.ok(existsSync(lp));
    await release();
    assert.ok(!existsSync(lp));
});

test('a held lock makes a second acquire time out', async () => {
    const lp = join(await tmp(), 'x.lock');
    const release = await acquireLock(lp, { staleMs: 60_000 });
    await assert.rejects(acquireLock(lp, { staleMs: 60_000, waitMs: 300 }), LockTimeoutError);
    await release();
});

test('a stale lock is taken over', async () => {
    const lp = join(await tmp(), 'x.lock');
    await mkdir(lp);
    const old = (Date.now() - 61_000) / 1000;
    await utimes(lp, old, old);
    const release = await acquireLock(lp, { staleMs: 60_000, waitMs: 300 });
    await release();
});

test('the holder keeps touching the lock', async () => {
    const lp = join(await tmp(), 'x.lock');
    const release = await acquireLock(lp, { staleMs: 60_000, touchMs: 50 });
    const past = (Date.now() - 30_000) / 1000;
    await utimes(lp, past, past);
    await delay(250);
    assert.ok((await stat(lp)).mtimeMs > past * 1000 + 1000);
    await release();
});

test('withCredentialLocks holds both locks and always releases', async () => {
    const home = join(await tmp(), 'acc');
    await mkdir(home);
    const [a, b] = credentialLockPaths(home);
    await withCredentialLocks(home, async () => {
        assert.ok(existsSync(a) && existsSync(b));
    });
    assert.ok(!existsSync(a) && !existsSync(b));
    await assert.rejects(withCredentialLocks(home, async () => { throw new Error('boom'); }), /boom/);
    assert.ok(!existsSync(a) && !existsSync(b));
});

test('withConfigLock holds the config lock next to the file', async () => {
    const f = join(await tmp(), '.claude.json');
    await withConfigLock(f, async () => {
        assert.ok(existsSync(configLockPath(f)));
    });
    assert.ok(!existsSync(configLockPath(f)));
});
