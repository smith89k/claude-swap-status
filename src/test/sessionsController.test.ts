import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionsController } from '../vscode/sessions';
import { takeJumpRequest, writeJumpRequest } from '../core/jumpRequests';
import type { ProcRunner } from '../core/processTree';
import type { WindowBeat } from '../core/types';
import { fake, terminals } from './fakes/vscode';

const W = (id: string, folders: string[], openTarget?: string): WindowBeat => ({ windowId: id, accountKey: 'main', workspaceName: id, pid: process.pid, updatedAt: Date.now(), folders, openTarget: openTarget ?? folders[0] });

async function controller(sessions: { sessionId: string; cwd: string; entrypoint: string; pid?: number }[], live: WindowBeat[], run?: ProcRunner) {
    fake.reset();
    terminals.length = 0;
    const root = await mkdtemp(join(tmpdir(), 'cs-sc-'));
    const home = join(root, 'main');
    await mkdir(join(home, 'sessions'), { recursive: true });
    for (const s of sessions) {
        const pid = s.pid ?? process.pid;
        await writeFile(join(home, 'sessions', `${s.sessionId}.json`), JSON.stringify({ pid, sessionId: s.sessionId, cwd: s.cwd, entrypoint: s.entrypoint, status: 'idle', startedAt: 0 }));
    }
    const c = new SessionsController({
        root,
        thisWindowId: 'me',
        sources: async () => [{ accountKey: 'main', configHome: home }],
        liveWindows: async () => live,
        accounts: () => [],
        log: { warn: () => undefined },
        platform: 'win32',
        isAlive: () => true,
        run,
    });
    return { c, root };
}

test('a session in another window writes the request and brings that window forward', async () => {
    const { c, root } = await controller([{ sessionId: 's2', cwd: 'C:\\p\\b', entrypoint: 'claude-vscode' }], [W('me', ['C:\\p\\a']), W('other', ['C:\\p\\b'], 'C:\\ws\\b.code-workspace')]);
    assert.equal(await c.jump('s2'), 'forwarded');
    assert.equal((await takeJumpRequest(root, 'other', Date.now()))?.sessionId, 's2');
    const open = fake.commands.find((x) => x.id === 'vscode.openFolder')!;
    assert.equal((open.args[0] as any).fsPath, 'C:\\ws\\b.code-workspace');
    assert.deepEqual(open.args[1], { forceNewWindow: true });
});

test('a closed target window gets a message, never openFolder', async () => {
    const live = [W('me', ['C:\\p\\a']), W('other', ['C:\\p\\b'])];
    const { c } = await controller([{ sessionId: 's2', cwd: 'C:\\p\\b', entrypoint: 'claude-vscode' }], live);
    await c.refresh();
    live.splice(1, 1); // window "other" closes after the list was drawn
    assert.equal(await c.jump('s2'), 'gone');
    assert.ok(!fake.commands.some((x) => x.id === 'vscode.openFolder'));
    assert.ok(fake.messages.some((m) => m.text === 'That window just closed.'));
});

test('a session in this window opens its Claude tab', async () => {
    const { c } = await controller([{ sessionId: 's1', cwd: 'C:\\p\\a', entrypoint: 'claude-vscode' }], [W('me', ['C:\\p\\a'])]);
    assert.equal(await c.jump('s1'), 'opened');
    assert.deepEqual(fake.commands.find((x) => x.id === 'claude-vscode.editor.open')?.args, ['s1']);
});

test('a request addressed to this window opens the Claude tab here', async () => {
    const { c, root } = await controller([], [W('me', ['C:\\p\\a'])]);
    await writeJumpRequest(root, 'me', { sessionId: 's9', pid: 1, kind: 'ide', at: Date.now() });
    await c.handleRequest();
    assert.deepEqual(fake.commands.find((x) => x.id === 'claude-vscode.editor.open')?.args, ['s9']);
});

test('a Claude app session only shows a note', async () => {
    const { c } = await controller([{ sessionId: 's3', cwd: 'C:\\x', entrypoint: 'claude-desktop' }], [W('me', ['C:\\p\\a'])]);
    assert.equal(await c.jump('s3'), 'noted');
    assert.ok(fake.messages.some((m) => m.text === 'This session runs in the Claude app.'));
    assert.ok(!fake.commands.some((x) => x.id === 'vscode.openFolder'));
});

test('a terminal session in this window shows the terminal whose shell started it', async () => {
    const parent: Record<string, string> = { 555: '700', 700: '901' };
    const run: ProcRunner = async (_cmd, args) => {
        const pid = (args.join(' ').match(/ProcessId=(\d+)/) ?? [])[1] ?? '';
        return parent[pid] ?? '';
    };
    const { c } = await controller([{ sessionId: 's4', cwd: 'C:\\p\\a', entrypoint: 'cli', pid: 555 }], [W('me', ['C:\\p\\a'])], run);
    const shown: number[] = [];
    terminals.push({ processId: Promise.resolve(900), show: () => shown.push(900) }, { processId: Promise.resolve(901), show: () => shown.push(901) });
    assert.equal(await c.jump('s4'), 'opened');
    assert.deepEqual(shown, [901]);
});

test('an unknown session is reported as missing', async () => {
    const { c } = await controller([], [W('me', ['C:\\p\\a'])]);
    assert.equal(await c.jump('nope'), 'missing');
});
