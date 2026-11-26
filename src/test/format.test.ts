import test from 'node:test';
import assert from 'node:assert/strict';
import { progressBar, formatResetIn, formatWindow, formatResetDetail, statusLabel, needsAttention, formatAge, usageLevel, pickUsage } from '../core/format';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const M = 60_000, H = 60 * M, D = 24 * H;
const at = (ms: number) => new Date(NOW + ms).toISOString();

test('progressBar rounds to five cells and clamps', () => {
    assert.equal(progressBar(25), '█░░░░');
    assert.equal(progressBar(0), '░░░░░');
    assert.equal(progressBar(140), '█████');
});

test('formatResetIn shows two units and drops a zero second unit', () => {
    assert.equal(formatResetIn(at(3 * H + 12 * M), NOW), '3h12m');
    assert.equal(formatResetIn(at(D + 4 * H), NOW), '1d4h');
    assert.equal(formatResetIn(at(4 * D), NOW), '4d');
    assert.equal(formatResetIn(at(45 * M), NOW), '45m');
    assert.equal(formatResetIn(at(-5 * M), NOW), '0m');
    assert.equal(formatResetIn(undefined, NOW), null);
    assert.equal(formatResetIn('not a date', NOW), null);
});

test('formatWindow and formatResetDetail', () => {
    assert.equal(formatWindow({ pct: 25.4, resetsAt: at(3 * H + 12 * M) }, NOW), '█░░░░ 25% R:3h12m');
    assert.equal(formatWindow({ pct: 25.4 }, NOW), '█░░░░ 25%');
    assert.equal(formatResetDetail('5h', undefined, NOW), '5h: no reset scheduled');
});

test('usageLevel uses the higher window: 70 warns, 85 is an error', () => {
    assert.equal(usageLevel(undefined), 'normal');
    assert.equal(usageLevel({ fiveHour: { pct: 69.9 } }), 'normal');
    assert.equal(usageLevel({ fiveHour: { pct: 70 } }), 'warning');
    assert.equal(usageLevel({ sevenDay: { pct: 85 } }), 'error');
    assert.equal(usageLevel({ fiveHour: { pct: 10 }, sevenDay: { pct: 86 } }), 'error');
});

test('status labels and which statuses need attention', () => {
    assert.equal(statusLabel('relogin_required'), 're-login needed');
    assert.equal(statusLabel('rate_limited'), 'rate limited');
    assert.equal(statusLabel('no_credentials'), 'not signed in');
    assert.equal(statusLabel('weird'), 'weird');
    assert.equal(statusLabel(undefined), 'unknown');
    assert.equal(needsAttention('ok'), false);
    assert.equal(needsAttention('token_expired'), false);
    assert.equal(needsAttention('rate_limited'), false);
    assert.equal(needsAttention('relogin_required'), true);
    assert.equal(needsAttention('no_credentials'), true);
});

test('formatAge', () => {
    assert.equal(formatAge(undefined), 'a while');
    assert.equal(formatAge(30), 'under a minute');
    assert.equal(formatAge(600), '10m');
    assert.equal(formatAge(3900), '1h5m');
    assert.equal(formatAge(7200), '2h');
    assert.equal(formatAge(90_000), '1d');
});

test('pickUsage prefers fresh usage, else last known with its age', () => {
    const u = { fiveHour: { pct: 1 } }, old = { fiveHour: { pct: 2 } };
    assert.deepEqual(pickUsage({ status: 'ok', usage: u, fetchedAt: NOW - 10_000 }, NOW), { usage: u, stale: false, ageSeconds: 10 });
    assert.deepEqual(pickUsage({ status: 'token_expired', lastGood: old, lastGoodAt: NOW - 120_000 }, NOW), { usage: old, stale: true, ageSeconds: 120 });
    assert.equal(pickUsage({ status: 'no_credentials' }, NOW), null);
    assert.equal(pickUsage(undefined, NOW), null);
});
