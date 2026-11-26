import test from 'node:test';
import assert from 'node:assert/strict';
import { samePath, isUnder, locate, toSessionsModel } from '../core/sessionsModel';
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

test('groups waiting, working, idle in that order, oldest first, with labels and crown', () => {
    const views = [{ key: 'main', number: 1, label: 'personal', isMain: true } as any, { key: 'a1', number: 2, label: 'work', isMain: false } as any];
    const m = toSessionsModel([
        S({ sessionId: 'i', status: 'idle', since: 1000 }),
        S({ sessionId: 'w2', status: 'waiting', since: 9000, accountKey: 'a1' }),
        S({ sessionId: 'w1', status: 'waiting', since: 5000, name: 'x'.repeat(80) }),
        S({ sessionId: 'k', status: 'working', since: 2000, kind: 'app' }),
    ], [W('me', ['C:\\p\\a'])], views, 'me', 65_000, 'win32');
    assert.equal(m.count, 4);
    assert.deepEqual(m.groups.map((g) => [g.heading, g.rows.map((r) => r.sessionId)]), [['Waiting for you', ['w1', 'w2']], ['Working', ['k']], ['Idle', ['i']]]);
    const w1 = m.groups[0].rows[0];
    assert.deepEqual([w1.title, w1.subtitle.length, w1.subtitle.endsWith('…'), w1.accountName, w1.isMain, w1.canJump, w1.ageText, w1.whereText], ['a', 60, true, 'personal', true, true, '1m', 'Claude tab · this window']);
    assert.equal(m.groups[0].rows[1].accountName, 'work');
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

test('nothing running gives an empty model', () => {
    assert.deepEqual(toSessionsModel([], [], [], 'me', 0), { count: 0, groups: [] });
});
