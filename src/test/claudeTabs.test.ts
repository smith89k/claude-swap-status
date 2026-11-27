import test from 'node:test';
import assert from 'node:assert/strict';
import { labelMatches, pickTab, tabLabelFor, type TabInfo, type TabSnapshot } from '../core/claudeTabs';

const claude = (key: string, label: string): TabInfo => ({ key, label, isClaude: true });
const file = (key: string, label: string): TabInfo => ({ key, label, isClaude: false });
const snap = (tabs: TabInfo[], activeKey?: string): TabSnapshot => ({ tabs, activeKey });

test("tab labels follow Claude's rule", () => {
    assert.equal(tabLabelFor(undefined), 'Claude Code');
    assert.equal(tabLabelFor(''), 'Claude Code');
    const thirty = 'abcdefghijklmnopqrstuvwxyz1234';
    assert.equal(tabLabelFor(thirty), thirty.slice(0, 24) + '…');
    assert.equal(tabLabelFor('exactly twenty-five chars'), 'exactly twenty-five chars', '25 characters stay whole');
    assert.ok(labelMatches('Fix the menu bar paddin…', 'Fix the menu bar padding on phones'));
    assert.ok(!labelMatches('Fix the menu bar paddin…', 'Fix the menu bar paddin'), 'a title that is only the prefix is not it');
    assert.ok(labelMatches('Short', ' Short '));
    assert.ok(labelMatches(tabLabelFor('Redesign the   output style'), 'Redesign the output style'), 'spaces are collapsed');
    assert.ok(!labelMatches('Short', 'Shorter'));
    assert.ok(!labelMatches('', ''), 'empty never matches');
    assert.ok(!labelMatches('Claude Code', undefined), 'no title, no match');
});

test('a new tab made by the command is reported as new', () => {
    const before = snap([file('1:0:a.ts', 'a.ts'), claude('1:1:Other', 'Other')], '1:1:Other');
    const after = snap([file('1:0:a.ts', 'a.ts'), claude('1:1:Other', 'Other'), claude('1:2:Fix menu', 'Fix menu')], '1:2:Fix menu');
    assert.deepEqual(pickTab(before, after, 'Fix menu', []), { kind: 'new', key: '1:2:Fix menu' });
});

test("a tab brought forward is the conversation's tab", () => {
    const tabs = [file('1:0:a.ts', 'a.ts'), claude('1:1:Fix menu', 'Fix menu'), claude('2:0:Other', 'Other')];
    assert.deepEqual(pickTab(snap(tabs, '1:0:a.ts'), snap(tabs, '1:1:Fix menu'), 'some other title', []), { kind: 'existing', key: '1:1:Fix menu' });
    assert.deepEqual(pickTab(snap(tabs), snap(tabs, '1:1:Fix menu'), undefined, []), { kind: 'existing', key: '1:1:Fix menu' }, 'no active tab before');
});

test('an already active tab counts only when its label matches the title', () => {
    const tabs = [claude('1:0:Fix the menu bar padding…', 'Fix the menu bar padding…')];
    const s = snap(tabs, '1:0:Fix the menu bar padding…');
    assert.deepEqual(pickTab(s, s, 'Fix the menu bar padding on phones', []), { kind: 'existing', key: '1:0:Fix the menu bar padding…' });
    assert.deepEqual(pickTab(s, s, 'Weekly report', []), { kind: 'none' });
    assert.deepEqual(pickTab(s, s, undefined, []), { kind: 'none' }, 'unknown title: never guess');
});

test('two conversations with matching titles: never guess', () => {
    const tabs = [claude('1:0:Fix menu', 'Fix menu')];
    const s = snap(tabs, '1:0:Fix menu');
    assert.deepEqual(pickTab(s, s, 'Fix menu', ['Fix menu']), { kind: 'none' });
});

test('the conversation in the sidebar: nothing changes, so nothing is closed', () => {
    const tabs = [file('1:0:a.ts', 'a.ts'), claude('1:1:Other', 'Other')];
    assert.deepEqual(pickTab(snap(tabs, '1:0:a.ts'), snap(tabs, '1:0:a.ts'), 'Fix menu', []), { kind: 'none' });
    assert.deepEqual(pickTab(snap(tabs, '1:1:Other'), snap(tabs, '1:1:Other'), 'Fix menu', []), { kind: 'none' }, 'another conversation stays open');
});
