import test from 'node:test';
import assert from 'node:assert/strict';
import { StatusBar } from '../vscode/statusBar';
import { statusItems } from './fakes/vscode';
import type { AccountView } from '../core/types';

const base: AccountView = { key: 'a1', number: 2, label: 'work', isMain: false, isThisWindow: true, signedIn: true, usedBy: [], openWindows: 1 };

test('the status bar starts with the account name, like "work | 5h: …"', () => {
    const bar = new StatusBar();
    const item = statusItems[statusItems.length - 1];
    bar.update([{ ...base, entry: { status: 'ok', fetchedAt: Date.now(), usage: { fiveHour: { pct: 25 }, sevenDay: { pct: 16 } } } }]);
    assert.equal(item.text, '$(account) work | 5h: █░░░░ 25% | 7d: █░░░░ 16%');
});

test('the main account wears the crown in the status bar', () => {
    const bar = new StatusBar();
    const item = statusItems[statusItems.length - 1];
    bar.update([{ ...base, key: 'main', number: 1, label: 'personal', isMain: true, signedIn: false }]);
    assert.equal(item.text, '👑 personal | not signed in');
});
