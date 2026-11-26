import test from 'node:test';
import assert from 'node:assert/strict';
import { toPanelModel } from '../core/panelModel';
import type { AccountView } from '../core/types';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const H = 3_600_000;
const at = (ms: number) => new Date(NOW + ms).toISOString();

function view(p: Partial<AccountView> & { key: string }): AccountView {
    return { label: p.key, isMain: false, isThisWindow: false, signedIn: true, usedBy: [], ...p };
}

test('this window comes first as current, the rest are others in order', () => {
    const m = toPanelModel([
        view({ key: 'a1', label: 'work' }),
        view({ key: 'a2', label: 'personal', isThisWindow: true, usedBy: ['proj-b'] }),
        view({ key: 'main', label: 'Main login', isMain: true }),
    ], NOW);
    assert.equal(m.current?.key, 'a2');
    assert.deepEqual(m.others.map((a) => a.key), ['a1', 'main']);
    assert.equal(m.hasExtraAccounts, true);
});

test('the Claude in Chrome hint shows only once there are extra accounts', () => {
    const only = toPanelModel([view({ key: 'main', label: 'Main login', isMain: true, isThisWindow: true })], NOW);
    assert.equal(only.hint, undefined);
    const more = toPanelModel([view({ key: 'a1' }), view({ key: 'main', label: 'Main login', isMain: true, isThisWindow: true })], NOW);
    assert.equal(more.hint, 'Claude in Chrome works only in windows that use the same account as the Chrome extension.');
});

test('hasExtraAccounts is false with only the main login', () => {
    const m = toPanelModel([view({ key: 'main', label: 'Main login', isMain: true, isThisWindow: true })], NOW);
    assert.equal(m.hasExtraAccounts, false);
    assert.deepEqual(m.others, []);
});

test('meters carry percent, reset countdown, level and how much of the window has passed', () => {
    const m = toPanelModel([view({
        key: 'a1', isThisWindow: true,
        entry: { status: 'ok', fetchedAt: NOW, usage: { fiveHour: { pct: 72.4, resetsAt: at(2 * H) }, sevenDay: { pct: 18, resetsAt: at(84 * H) } } },
    })], NOW);
    const [five, seven] = m.current!.meters;
    assert.deepEqual([five.label, five.pctText, five.resetText, five.level], ['5h', '72%', '2h', 'warning']);
    assert.equal(five.pace, 0.6); // 3 of 5 hours gone
    assert.deepEqual([seven.label, seven.pctText, seven.resetText, seven.level], ['7d', '18%', '3d12h', 'normal']);
    assert.equal(seven.pace, 0.5); // 3.5 of 7 days gone
    assert.equal(m.current!.state, 'ok');
    assert.match(five.title, /72% of the 5-hour limit used/);
});

test('stale usage is marked with its age, and missing usage is checking', () => {
    const m = toPanelModel([
        view({ key: 'a1', entry: { status: 'token_expired', lastGood: { fiveHour: { pct: 10 } }, lastGoodAt: NOW - 2 * H } }),
        view({ key: 'a2' }),
    ], NOW);
    assert.equal(m.others[0].state, 'stale');
    assert.equal(m.others[0].note, 'Last known, 2h ago');
    assert.equal(m.others[0].meters.length, 1);
    assert.equal(m.others[1].state, 'checking');
    assert.equal(m.others[1].note, 'Checking usage…');
});

test('where each account is open', () => {
    const m = toPanelModel([
        view({ key: 'a1', isThisWindow: true, usedBy: ['proj-a', 'proj-z'] }),
        view({ key: 'a2', usedBy: ['blog'] }),
        view({ key: 'a3' }),
    ], NOW);
    assert.equal(m.current!.detail, 'Also open in proj-a, proj-z');
    assert.equal(m.others[0].detail, 'Open in blog');
    assert.equal(m.others[1].detail, 'Not open in any window');
});

test('actions depend on sign-in state and on main vs added', () => {
    const m = toPanelModel([
        view({ key: 'cur', isThisWindow: true }),
        view({ key: 'ok' }),
        view({ key: 'new', signedIn: false, label: 'New account (not signed in)' }),
        view({ key: 'old', entry: { status: 'relogin_required' } }),
        view({ key: 'main', isMain: true, label: 'Main login' }),
    ], NOW);
    assert.deepEqual(m.current!.actions, ['rename', 'remove']);
    const by = Object.fromEntries(m.others.map((a) => [a.key, a]));
    assert.deepEqual(by.ok.actions, ['use', 'rename', 'remove']);
    assert.deepEqual(by.new.actions, ['signIn', 'remove']);
    assert.equal(by.new.name, 'New account');
    assert.equal(by.new.state, 'notSignedIn');
    assert.equal(by.new.note, 'Not signed in yet');
    assert.deepEqual(by.old.actions, ['signInAgain', 'rename', 'remove']);
    assert.equal(by.old.state, 'relogin');
    assert.equal(by.old.note, 'Sign-in expired');
    assert.deepEqual(by.main.actions, ['use']);
});

test('plan is shown capitalised, problems get a readable note', () => {
    const m = toPanelModel([
        view({ key: 'a1', entry: { status: 'ok', fetchedAt: NOW, plan: 'max', usage: {} } }),
        view({ key: 'a2', entry: { status: 'unavailable' } }),
    ], NOW);
    assert.equal(m.others[0].plan, 'Max');
    assert.equal(m.others[1].state, 'problem');
    assert.equal(m.others[1].note, 'Usage unavailable right now');
});
