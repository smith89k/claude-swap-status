import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pollAccount, UsageCache, type PollDeps } from '../core/usage';
import { withLock } from '../core/locks';
import type { CredentialStore } from '../core/credentials';
import type { UsageResult, RefreshResult } from '../core/oauth';
import type { CredentialFile, UsageEntry } from '../core/types';

const tmp = () => mkdtemp(join(tmpdir(), 'cs-usage-'));

type Store = CredentialStore & { set(f: CredentialFile): void };

async function setup(o: {
    cred?: CredentialFile; inUse?: boolean; usage?: UsageResult; refresh?: RefreshResult;
    cache?: Record<string, UsageEntry>; onCredLock?: (store: Store) => void;
    realFetchLock?: boolean; fetchDelayMs?: number;
}) {
    const root = await tmp();
    let current: CredentialFile | undefined = o.cred ? structuredClone(o.cred) : undefined;
    const store: Store = {
        read: async () => (current ? structuredClone(current) : undefined),
        write: async (_t, v) => { current = structuredClone(v); },
        remove: async () => { current = undefined; },
        set: (f) => { current = structuredClone(f); },
    };
    const counts = { fetch: 0, refresh: 0, credLocks: 0 };
    let lastToken: string | undefined;
    const cache = new UsageCache(root);
    for (const [k, v] of Object.entries(o.cache ?? {})) {
        await cache.put(k, v);
    }
    const deps: PollDeps = {
        cache,
        credentials: store,
        now: () => 1_000_000,
        inUse: async () => !!o.inUse,
        withCredentialLocks: async (_home, fn) => {
            counts.credLocks++;
            o.onCredLock?.(store);
            return fn();
        },
        withFetchLock: o.realFetchLock
            ? (key, fn) => withLock(join(root, 'locks', `fetch-${key}.lock`), { staleMs: 30_000 }, fn)
            : (_key, fn) => fn(),
        fetchUsage: async (token) => {
            await delay(o.fetchDelayMs ?? 0);
            counts.fetch++;
            lastToken = token;
            return o.usage ?? { ok: true, usage: {} };
        },
        refresh: async () => {
            counts.refresh++;
            return o.refresh ?? { ok: false, kind: 'network' };
        },
    };
    return { deps, counts, store, lastFetchToken: () => lastToken, root };
}

const T = { configHome: '/acc', configDirEnv: '/acc' };
const valid = { claudeAiOauth: { accessToken: 'A', refreshToken: 'R', expiresAt: 1_000_000 + 3_600_000, subscriptionType: 'max' } };
const expired = { claudeAiOauth: { accessToken: 'A', refreshToken: 'R', expiresAt: 1_000_000 + 30_000 } }; // inside the 60 s skew
const U = { fiveHour: { pct: 40 } };

test('a fresh cache entry is returned without any network call', async () => {
    const s = await setup({ cred: valid, cache: { k: { status: 'ok', usage: U, fetchedAt: 1_000_000 - 10_000 } } });
    assert.deepEqual((await pollAccount('k', T, 60_000, s.deps)).usage, U);
    assert.equal(s.counts.fetch, 0);
});

test('a valid token fetches usage and records last good and plan', async () => {
    const s = await setup({ cred: valid, usage: { ok: true, usage: U } });
    const e = await pollAccount('k', T, 60_000, s.deps);
    assert.deepEqual(e, { status: 'ok', usage: U, fetchedAt: 1_000_000, lastGood: U, lastGoodAt: 1_000_000, plan: 'max' });
    assert.deepEqual(await s.deps.cache.get('k'), e);
});

test('expired while in use keeps last good and never renews', async () => {
    const s = await setup({ cred: expired, inUse: true, cache: { k: { status: 'ok', lastGood: U, lastGoodAt: 1, fetchedAt: 0 } } });
    const e = await pollAccount('k', T, 60_000, s.deps);
    assert.equal(e.status, 'token_expired');
    assert.deepEqual(e.lastGood, U);
    assert.equal(s.counts.refresh, 0);
    assert.equal(s.counts.fetch, 0);
});

test('expired while idle renews under Claude locks, saves, then fetches', async () => {
    const s = await setup({ cred: expired, inUse: false, refresh: { ok: true, cred: { accessToken: 'A2', refreshToken: 'R2', expiresAt: 9e12 } }, usage: { ok: true, usage: U } });
    const e = await pollAccount('k', T, 60_000, s.deps);
    assert.equal(e.status, 'ok');
    assert.equal(s.counts.credLocks, 1);
    assert.equal(s.counts.refresh, 1);
    assert.equal((await s.store.read(T))!.claudeAiOauth!.accessToken, 'A2');
    assert.equal(s.lastFetchToken(), 'A2');
});

test('renewal re-reads first and skips refresh if someone already renewed', async () => {
    const s = await setup({ cred: expired, inUse: false, usage: { ok: true, usage: U }, onCredLock: (store) => store.set(valid) });
    await pollAccount('k', T, 60_000, s.deps);
    assert.equal(s.counts.refresh, 0);
    assert.equal(s.counts.fetch, 1);
});

test('invalid_grant marks relogin_required', async () => {
    const s = await setup({ cred: expired, inUse: false, refresh: { ok: false, kind: 'invalid_grant' } });
    assert.equal((await pollAccount('k', T, 60_000, s.deps)).status, 'relogin_required');
});

test('429 stores a back-off that later polls respect', async () => {
    const s = await setup({ cred: valid, usage: { ok: false, kind: 'rate_limited' } });
    const e = await pollAccount('k', T, 0, s.deps);
    assert.equal(e.status, 'rate_limited');
    assert.equal(e.backoffUntil, 1_000_000 + 300_000);
    await pollAccount('k', T, 0, s.deps);
    assert.equal(s.counts.fetch, 1);
});

test('missing expiresAt counts as expired', async () => {
    const s = await setup({ cred: { claudeAiOauth: { accessToken: 'A', refreshToken: 'R' } }, inUse: true });
    assert.equal((await pollAccount('k', T, 60_000, s.deps)).status, 'token_expired');
});

test('no credentials gives no_credentials', async () => {
    const s = await setup({});
    assert.equal((await pollAccount('k', T, 60_000, s.deps)).status, 'no_credentials');
});

test('corrupt usage cache reads as empty', async () => {
    const root = await tmp();
    await writeFile(join(root, 'usage.json'), '{x');
    assert.deepEqual(await new UsageCache(root).read(), {});
});

test('cache remove drops one key', async () => {
    const root = await tmp();
    const cache = new UsageCache(root);
    await cache.put('a', { status: 'ok' });
    await cache.put('b', { status: 'ok' });
    await cache.remove('a');
    assert.deepEqual(Object.keys(await cache.read()), ['b']);
});

test('two windows polling at once fetch only once', async () => {
    const s = await setup({ cred: valid, usage: { ok: true, usage: U }, realFetchLock: true, fetchDelayMs: 100 });
    await Promise.all([pollAccount('k', T, 60_000, s.deps), pollAccount('k', T, 60_000, s.deps)]);
    assert.equal(s.counts.fetch, 1);
});
