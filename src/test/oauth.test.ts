import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchUsage, refreshAccessToken, USAGE_URL, TOKEN_URL, type FetchLike } from '../core/oauth';

function fake(status: number, body: unknown, headers: Record<string, string> = {}) {
    const calls: { url: string; init: any }[] = [];
    const fn: FetchLike = async (url, init) => {
        calls.push({ url, init });
        return { status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => body };
    };
    return { fn, calls };
}
const throwing: FetchLike = async () => { throw new Error('ECONNRESET'); };

test('fetchUsage sends bearer and beta headers and normalises windows', async () => {
    const { fn, calls } = fake(200, { five_hour: { utilization: 25, resets_at: '2026-11-26T15:00:00Z' }, seven_day: { utilization: 16, resets_at: null } });
    assert.deepEqual(await fetchUsage('tok', fn), { ok: true, usage: { fiveHour: { pct: 25, resetsAt: '2026-11-26T15:00:00Z' }, sevenDay: { pct: 16 } } });
    assert.equal(calls[0].url, USAGE_URL);
    assert.equal(calls[0].init.headers['Authorization'], 'Bearer tok');
    assert.equal(calls[0].init.headers['anthropic-beta'], 'oauth-2025-04-20');
});

test('fetchUsage maps failures', async () => {
    assert.deepEqual(await fetchUsage('t', fake(429, {}, { 'retry-after': '120' }).fn), { ok: false, kind: 'rate_limited', retryAfterMs: 120_000 });
    assert.deepEqual(await fetchUsage('t', fake(429, {}).fn), { ok: false, kind: 'rate_limited' });
    assert.deepEqual(await fetchUsage('t', fake(401, {}).fn), { ok: false, kind: 'unauthorized' });
    assert.deepEqual(await fetchUsage('t', fake(500, {}).fn), { ok: false, kind: 'bad_response' });
    assert.deepEqual(await fetchUsage('t', throwing), { ok: false, kind: 'network' });
});

test('refreshAccessToken posts the grant and rotates tokens', async () => {
    const { fn, calls } = fake(200, { access_token: 'A2', refresh_token: 'R2', expires_in: 3600, scope: 'user:inference user:profile' });
    const r = await refreshAccessToken({ accessToken: 'A1', refreshToken: 'R1', expiresAt: 0, subscriptionType: 'max' }, fn, 1_000);
    assert.deepEqual(r, { ok: true, cred: { accessToken: 'A2', refreshToken: 'R2', expiresAt: 3_601_000, subscriptionType: 'max', scopes: ['user:inference', 'user:profile'] } });
    assert.equal(calls[0].url, TOKEN_URL);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].init.body), { grant_type: 'refresh_token', refresh_token: 'R1', client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e' });
});

test('refreshAccessToken keeps the old refresh token when none comes back', async () => {
    const r = await refreshAccessToken({ accessToken: 'A1', refreshToken: 'R1' }, fake(200, { access_token: 'A2', expires_in: 60 }).fn, 0);
    assert.equal(r.ok && r.cred.refreshToken, 'R1');
});

test('refresh failures carry no token text', async () => {
    const r = await refreshAccessToken({ accessToken: 'A1', refreshToken: 'R1' }, fake(400, { error: 'invalid_grant' }).fn, 0);
    assert.deepEqual(r, { ok: false, kind: 'invalid_grant' });
    const none = fake(200, {});
    assert.deepEqual(await refreshAccessToken({ accessToken: 'A1' }, none.fn, 0), { ok: false, kind: 'no_refresh_token' });
    assert.equal(none.calls.length, 0);
    assert.deepEqual(await refreshAccessToken({ accessToken: 'A1', refreshToken: 'R1' }, throwing, 0), { ok: false, kind: 'network' });
});
