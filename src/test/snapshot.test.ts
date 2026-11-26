import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot } from '../core/snapshot';

test('accounts in order, main last, with usedBy and this-window marks', () => {
    const views = buildSnapshot({
        accounts: [
            { id: 'a1', folder: '/r/a1', email: 'w@x.com', alias: 'work', createdAt: 't' },
            { id: 'a2', folder: '/r/a2', createdAt: 't' },
        ],
        mainIdentity: { email: 'me@x.com' },
        liveWindows: [
            { windowId: 'w1', accountKey: 'a1', workspaceName: 'proj-a', pid: 1, updatedAt: 0 },
            { windowId: 'w2', accountKey: 'a1', workspaceName: 'proj-a', pid: 2, updatedAt: 0 },
            { windowId: 'w3', accountKey: 'main', workspaceName: 'proj-c', pid: 3, updatedAt: 0 },
        ],
        usage: { a1: { status: 'ok', usage: { fiveHour: { pct: 40 } } } },
        thisWindowKey: 'a1',
    });
    assert.deepEqual(views.map((v) => [v.key, v.label, v.isMain, v.isThisWindow, v.signedIn, v.usedBy]), [
        ['a1', 'work', false, true, true, ['proj-a']],
        ['a2', 'New account (not signed in)', false, false, false, []],
        ['main', 'Main login', true, false, true, ['proj-c']],
    ]);
    assert.equal(views[0].entry?.usage?.fiveHour?.pct, 40);
    assert.equal(views[2].email, 'me@x.com');
});

test('label falls back to email; main without identity is not signed in', () => {
    const v = buildSnapshot({ accounts: [{ id: 'a1', folder: '/r', email: 'w@x.com', createdAt: 't' }], liveWindows: [], usage: {}, thisWindowKey: 'main' });
    assert.equal(v[0].label, 'w@x.com');
    assert.equal(v[1].signedIn, false);
    assert.equal(v[1].isThisWindow, true);
});
