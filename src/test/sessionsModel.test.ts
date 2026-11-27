import test from 'node:test';
import assert from 'node:assert/strict';
import { samePath, isUnder, locate, toSessionsModel, toPastGroups, NOTE_PAST_APP, type PastContext } from '../core/sessionsModel';
import type { PastSession } from '../core/pastSessions';
import type { RunningSession } from '../core/sessions';
import type { WindowBeat } from '../core/types';

const W = (id: string, folders: string[], openTarget?: string): WindowBeat => ({ windowId: id, accountKey: 'main', workspaceName: id, pid: 1, updatedAt: 0, folders, openTarget: openTarget ?? folders[0] });
const S = (p: Partial<RunningSession>): RunningSession => ({ pid: 5, sessionId: 'x', cwd: 'C:\\p\\a', name: 'n', kind: 'ide', status: 'idle', since: 0, accountKey: 'main', ...p });

test('paths match across case, slash style and trailing slash on Windows', () => {
    assert.equal(samePath('C:\\X\\Proj', 'c:/x/proj/', 'win32'), true);
    assert.equal(samePath('/x/Proj', '/x/proj', 'linux'), false);
    assert.equal(isUnder('C:\\p\\a\\src', 'c:/p/a', 'win32'), true);
    assert.equal(isUnder('C:\\p\\ab', 'C:\\p\\a', 'win32'), false);
});

test('locates this window, another window, the app, and outside', () => {
    const wins = [W('me', ['C:\\p\\a']), W('other', ['C:\\p\\b'])];
    assert.deepEqual(locate(S({}), wins, 'me', 'win32'), { where: 'thisWindow' });
    assert.deepEqual(locate(S({ cwd: 'c:/p/b' }), wins, 'me', 'win32'), { where: 'otherWindow', windowId: 'other', openTarget: 'C:\\p\\b' });
    assert.deepEqual(locate(S({ kind: 'app' }), wins, 'me', 'win32'), { where: 'app' });
    assert.deepEqual(locate(S({ cwd: 'D:\\z', kind: 'terminal' }), wins, 'me', 'win32'), { where: 'outside' });
});

test('a subfolder session belongs to the window that has its parent folder open', () => {
    const wins = [W('other', ['C:\\p\\b'], 'C:\\ws\\b.code-workspace')];
    assert.deepEqual(locate(S({ cwd: 'C:\\p\\b\\src', kind: 'terminal' }), wins, 'me', 'win32'), { where: 'otherWindow', windowId: 'other', openTarget: 'C:\\ws\\b.code-workspace' });
});

test('the longest matching folder wins, and an old heartbeat without folders never matches', () => {
    const old: WindowBeat = { windowId: 'old', accountKey: 'main', workspaceName: 'old', pid: 1, updatedAt: 0 };
    const wins = [W('outer', ['C:\\p']), W('inner', ['C:\\p\\b']), old];
    assert.equal((locate(S({ cwd: 'C:\\p\\b\\x' }), wins, 'me', 'win32') as any).windowId, 'inner');
    assert.deepEqual(locate(S({ cwd: 'C:\\q' }), [old], 'me', 'win32'), { where: 'outside' });
});

test('groups waiting, working, idle in that order, newest first, with labels and crown', () => {
    const views = [{ key: 'main', number: 1, label: 'personal', isMain: true } as any, { key: 'a1', number: 2, label: 'work', isMain: false } as any];
    const m = toSessionsModel([
        S({ sessionId: 'i', status: 'idle', since: 1000 }),
        S({ sessionId: 'w2', status: 'waiting', since: 9000, accountKey: 'a1' }),
        S({ sessionId: 'w1', status: 'waiting', since: 5000, name: 'x'.repeat(80) }),
        S({ sessionId: 'k', status: 'working', since: 2000, kind: 'app' }),
    ], [W('me', ['C:\\p\\a'])], views, 'me', 65_000, 'win32');
    assert.equal(m.count, 4);
    assert.deepEqual(m.groups.map((g) => [g.heading, g.rows.map((r) => r.sessionId)]), [['Waiting for you', ['w2', 'w1']], ['Working', ['k']], ['Idle', ['i']]]);
    const w1 = m.groups[0].rows[1];
    assert.deepEqual([w1.title, w1.subtitle.length, w1.subtitle.endsWith('…'), w1.accountName, w1.isMain, w1.canJump, w1.ageText, w1.whereText], ['a', 60, true, 'personal', true, true, '1m', 'Claude tab · this window']);
    assert.equal(m.groups[0].rows[0].accountName, 'work');
    const k = m.groups[1].rows[0];
    assert.deepEqual([k.canJump, k.note, k.whereText], [false, 'This session runs in the Claude app.', 'Claude app']);
});

test('rows that cannot jump explain where they are', () => {
    const m = toSessionsModel([
        S({ sessionId: 't', kind: 'terminal', cwd: 'D:\\z' }),
        S({ sessionId: 'v', kind: 'ide', cwd: 'D:\\z' }),
        S({ sessionId: 'o', kind: 'terminal', cwd: 'C:\\p\\b' }),
    ], [W('me', ['C:\\p\\a']), W('other', ['C:\\p\\b'])], [], 'me', 0, 'win32');
    const by = Object.fromEntries(m.groups[0].rows.map((r) => [r.sessionId, r]));
    assert.equal(by.t.note, 'This session runs in a terminal outside the editor.');
    assert.equal(by.v.note, "This session runs in a window that can't be reached. Reload that window, then try again.");
    assert.deepEqual([by.o.canJump, by.o.whereText, by.o.accountName], [true, 'terminal · other window', 'main']);
});

test('a window with no safe thing to open (unsaved multi-folder workspace) is never a jump target', () => {
    const unsaved: WindowBeat = { windowId: 'other', accountKey: 'main', workspaceName: 'Untitled (Workspace)', pid: 1, updatedAt: 0, folders: ['C:\\p\\b', 'C:\\p\\c'] };
    assert.deepEqual(locate(S({ cwd: 'C:\\p\\b' }), [unsaved], 'me', 'win32'), { where: 'outside' });
});

test('a running session shows its conversation title, with its folder underneath, like finished ones', () => {
    const m = toSessionsModel([
        S({ sessionId: 'a', name: 'claude-away-36', since: 2 }),
        S({ sessionId: 'b', name: 'site-2', since: 1 }),
    ], [W('me', ['C:\p\a'])], [], 'me', 0, 'win32', new Map([['a', 'Build by the plan']]));
    const [a, b] = m.groups[0].rows;
    assert.deepEqual([a.title, a.subtitle], ['Build by the plan', 'a']);
    assert.deepEqual([b.title, b.subtitle], ['a', 'site-2'], 'no known title: as before');
});

test('nothing running gives an empty model', () => {
    assert.deepEqual(toSessionsModel([], [], [], 'me', 0), { count: 0, groups: [], past: [] });
});

const P = (p: Partial<PastSession>): PastSession => ({ sessionId: 'p', cwd: 'C:\\p\\a', title: 'Fix login', kind: 'ide', lastActive: 0, accountKey: 'main', ...p });
const views = [{ key: 'main', number: 1, label: 'personal', isMain: true } as any, { key: 'a1', number: 2, label: 'work', isMain: false } as any];

function ctx(now: number, extra: Partial<PastContext> = {}): PastContext {
    return { runningIds: new Set(), accounts: views, thisAccountKey: 'main', thisFolders: ['C:\\p\\a'], now, platform: 'win32', ...extra };
}

test('finished sessions are grouped by day, newest first, and running ones are left out', () => {
    const now = new Date(2026, 10, 27, 15, 0).getTime();
    const at = (d: number, h: number) => new Date(2026, 10, 27 - d, h, 0).getTime();
    const groups = toPastGroups([
        P({ sessionId: 'today-early', lastActive: at(0, 1) }),
        P({ sessionId: 'today-late', lastActive: at(0, 14) }),
        P({ sessionId: 'yesterday', lastActive: at(1, 23) }),
        P({ sessionId: 'week', lastActive: at(6, 9) }),
        P({ sessionId: 'older', lastActive: at(7, 23) }),
        P({ sessionId: 'running', lastActive: at(0, 14) }),
    ], ctx(now, { runningIds: new Set(['running']) }));
    assert.deepEqual(groups.map((g) => [g.heading, g.rows.map((r) => r.sessionId)]), [
        ['Today', ['today-late', 'today-early']],
        ['Yesterday', ['yesterday']],
        ['Earlier this week', ['week']],
        ['Older', ['older']],
    ]);
    const r = groups[0].rows[0];
    assert.deepEqual([r.status, r.title, r.subtitle, r.whereText, r.ageText, r.accountName, r.isMain, r.canJump, r.note], ['finished', 'Fix login', 'a', 'Claude tab', '1h ago', 'personal', true, true, undefined]);
});

test("a finished session can only reopen here with this window's account and folder", () => {
    const groups = toPastGroups([
        P({ sessionId: 'app', kind: 'app', lastActive: 4 }),
        P({ sessionId: 'acc', accountKey: 'a1', lastActive: 3 }),
        P({ sessionId: 'sub', cwd: 'C:\\p\\a\\src', kind: 'terminal', lastActive: 2 }),
        P({ sessionId: 'ok', cwd: 'c:/P/A/', title: 'A', lastActive: 1 }),
    ], ctx(10));
    const by = Object.fromEntries(groups.flatMap((g) => g.rows).map((r) => [r.sessionId, r]));
    assert.equal(by.app.note, NOTE_PAST_APP);
    assert.equal(by.acc.note, 'This conversation belongs to work. Switch this window to work to reopen it.');
    assert.equal(by.sub.note, 'This conversation is from the src folder. Open that folder to reopen it.');
    assert.deepEqual([by.ok.canJump, by.ok.note, by.ok.subtitle], [true, undefined, '']);
    assert.ok([by.app, by.acc, by.sub].every((r) => !r.canJump));
});

test('a conversation in a history folder shared by several accounts is listed once, as this window\'s account when it is one of them', () => {
    const twice = [P({ sessionId: 'x', accountKey: 'main', lastActive: 2 }), P({ sessionId: 'x', accountKey: 'a1', lastActive: 2 }), P({ sessionId: 'y', lastActive: 1 })];
    const here = toPastGroups(twice, ctx(10, { thisAccountKey: 'a1' })).flatMap((g) => g.rows);
    assert.deepEqual(here.map((r) => [r.sessionId, r.accountName]), [['x', 'work'], ['y', 'personal']]);
    assert.equal(here[0].canJump, true, 'it reopens here');
    const other = toPastGroups(twice, ctx(10, { thisAccountKey: 'a9' })).flatMap((g) => g.rows);
    assert.deepEqual(other.map((r) => [r.sessionId, r.accountName]), [['x', 'personal'], ['y', 'personal']], 'otherwise the first account in the list');
});

test('session rows carry an added account\'s icon, never the main account\'s', () => {
    const accounts = [{ key: 'main', label: 'personal', isMain: true, icon: 'star' } as any, { key: 'a1', label: 'work', isMain: false, icon: 'gem' } as any];
    const m = toSessionsModel([S({ sessionId: 'x1', accountKey: 'a1' }), S({ sessionId: 'x2', accountKey: 'main' })], [], accounts, 'me', 0, 'win32');
    const by = Object.fromEntries(m.groups.flatMap((g) => g.rows).map((r) => [r.sessionId, r]));
    assert.match(by.x1.accountIcon ?? '', /^<svg /);
    assert.equal(by.x2.accountIcon, undefined);
    const past = toPastGroups([P({ sessionId: 'p1', accountKey: 'a1' })], ctx(10, { accounts }));
    assert.match(past[0].rows[0].accountIcon ?? '', /^<svg /);
});
