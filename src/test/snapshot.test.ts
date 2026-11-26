import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot } from '../core/snapshot';

test('accounts start as Claude 1 (main), Claude 2, Claude 3…; a rename replaces the whole name', () => {
    const views = buildSnapshot({
        accounts: [
            { id: 'a1', folder: '/r/a1', email: 'w@x.com', alias: 'work', createdAt: 't', number: 2 },
            { id: 'a2', folder: '/r/a2', createdAt: 't', number: 3 },
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
    assert.deepEqual(views.map((v) => [v.key, v.number, v.label, v.isMain, v.isThisWindow, v.signedIn, v.usedBy, v.openWindows]), [
        ['a1', 2, 'work', false, true, true, ['proj-a'], 2],
        ['a2', 3, 'Claude 3', false, false, false, [], 0],
        ['main', 1, 'Claude 1', true, false, true, ['proj-c'], 1],
    ]);
    assert.equal(views[0].entry?.usage?.fiveHour?.pct, 40);
    assert.equal(views[2].email, 'me@x.com');
});

test('the main account can be renamed too; accounts saved without a number still get one', () => {
    const v = buildSnapshot({
        accounts: [{ id: 'a1', folder: '/r', email: 'w@x.com', createdAt: 't' }],
        mainAlias: 'personal',
        liveWindows: [],
        usage: {},
        thisWindowKey: 'main',
    });
    assert.equal(v[0].label, 'Claude 2');
    assert.equal(v[1].label, 'personal');
    assert.equal(v[1].signedIn, false);
    assert.equal(v[1].isThisWindow, true);
});
