import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PastSessionReader, parseTranscript } from '../core/pastSessions';

const J = (o: unknown) => JSON.stringify(o);
const user = (text: unknown, extra: object = {}) => J({ type: 'user', message: { role: 'user', content: text }, ...extra });
const DAY = 24 * 60 * 60 * 1000;

async function home(files: Record<string, { lines: string[]; ageDays?: number }>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'cs-past-'));
    for (const [rel, f] of Object.entries(files)) {
        const file = join(dir, 'projects', rel);
        await mkdir(join(file, '..'), { recursive: true });
        await writeFile(file, f.lines.join('\n') + '\n');
        const t = new Date(Date.now() - (f.ageDays ?? 0) * DAY);
        await utimes(file, t, t);
    }
    return dir;
}

test('title: a rename beats the AI title, which beats the first message', () => {
    const head = [J({ type: 'session-owner' }), J({ cwd: 'C:\\p\\a', entrypoint: 'claude-vscode' }), user('<command-name>/x</command-name>'), user('hi', { isMeta: true }), user([{ type: 'text', text: 'Fix the login\nmore' }])].join('\n');
    assert.deepEqual(parseTranscript(head, '', true, true), { cwd: 'C:\\p\\a', entrypoint: 'claude-vscode', firstPrompt: 'Fix the login' });
    const tail = ['partial line', J({ type: 'ai-title', aiTitle: 'Old' }), J({ type: 'ai-title', aiTitle: 'New' }), J({ type: 'custom-title', customTitle: 'Mine' })].join('\n');
    const got = parseTranscript(head + '\n', tail, false, false);
    assert.equal(got.aiTitle, 'New');
    assert.equal(got.customTitle, 'Mine');
});

test('long first messages are cut, broken lines are skipped', () => {
    const got = parseTranscript(['{"cwd":', J({ cwd: '/x' }), user('a'.repeat(80))].join('\n'), '', true, true);
    assert.equal(got.cwd, '/x');
    assert.equal(got.firstPrompt, 'a'.repeat(59) + '…');
});

test('lists the last 30 days from every account, skipping sub-agent logs and files without a folder', async () => {
    const main = await home({
        'C--p-a/s1.jsonl': { lines: [J({ cwd: 'C:\\p\\a', entrypoint: 'claude-vscode' }), user('hello'), J({ type: 'ai-title', aiTitle: 'Banner work' })], ageDays: 1 },
        'C--p-a/s2.jsonl': { lines: [J({ cwd: 'C:\\p\\a', entrypoint: 'cli' })], ageDays: 40 },
        'C--p-a/s1/subagents/agent-1.jsonl': { lines: [J({ cwd: 'C:\\p\\a' })] },
        'C--p-a/s3.jsonl': { lines: [J({ type: 'summary' })] },
        'C--p-a/notes.txt': { lines: ['x'] },
    });
    const acc = await home({ 'D--q/s4.jsonl': { lines: [J({ cwd: 'D:\\q', entrypoint: 'claude-desktop' })], ageDays: 2 } });
    const got = await new PastSessionReader().list([{ accountKey: 'main', configHome: main }, { accountKey: 'a1', configHome: acc }], Date.now());
    const by = Object.fromEntries(got.map((s) => [s.sessionId, s]));
    assert.deepEqual(Object.keys(by).sort(), ['s1', 's4']);
    assert.deepEqual([by.s1.title, by.s1.kind, by.s1.cwd, by.s1.accountKey], ['Banner work', 'ide', 'C:\\p\\a', 'main']);
    assert.deepEqual([by.s4.title, by.s4.kind, by.s4.accountKey], ['q', 'app', 'a1']);
});

test('reads the end of a big file for the title, and only re-reads files that changed', async () => {
    const filler = J({ type: 'assistant', text: 'x'.repeat(1000) });
    const lines = [J({ cwd: '/big', entrypoint: 'cli' }), user('start'), ...Array(300).fill(filler), J({ type: 'ai-title', aiTitle: 'At the end' })];
    const dir = await home({ 'big/b1.jsonl': { lines }, 'big/b2.jsonl': { lines: [J({ cwd: '/big' }), user('small one')] } });
    const reader = new PastSessionReader();
    const src = [{ accountKey: 'main', configHome: dir }];
    const first = await reader.list(src, Date.now());
    assert.equal(first.find((s) => s.sessionId === 'b1')?.title, 'At the end');
    assert.equal(first.find((s) => s.sessionId === 'b2')?.title, 'small one');
    assert.equal(reader.lastReads, 2);
    await reader.list(src, Date.now());
    assert.equal(reader.lastReads, 0);
    await writeFile(join(dir, 'projects', 'big', 'b2.jsonl'), [J({ cwd: '/big' }), J({ type: 'custom-title', customTitle: 'Renamed' })].join('\n'));
    const again = await reader.list(src, Date.now());
    assert.equal(reader.lastReads, 1);
    assert.equal(again.find((s) => s.sessionId === 'b2')?.title, 'Renamed');
});

test('a missing projects folder is just empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-past-'));
    assert.deepEqual(await new PastSessionReader().list([{ accountKey: 'main', configHome: dir }], Date.now()), []);
});
