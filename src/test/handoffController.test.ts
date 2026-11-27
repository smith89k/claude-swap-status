import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HandoffController } from '../vscode/handoff';
import { pendingRequests, readResult, writeRequest, type HandoffRequest } from '../core/handoff';
import { tabLabelFor } from '../core/claudeTabs';
import type { WindowBeat } from '../core/types';
import { activateTab, addClaudeTab, fake, setTabs, tabState, terminals } from './fakes/vscode';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CWD = 'C:\\p\\a\\site';
const OPEN = 'claude-vscode.editor.open';
const W = (id: string, folders: string[]): WindowBeat => ({ windowId: id, accountKey: 'main', workspaceName: id, pid: process.pid, updatedAt: Date.now(), folders, handoff: 1 });

interface Setup {
    sessions?: { entrypoint: string; status?: string; pid?: number }[];
    title?: string;
    /** The conversation already has a Claude tab here with this label. */
    tabLabel?: string;
    sleep?: (ms: number) => Promise<void>;
}

async function setup(o: Setup = {}) {
    fake.reset();
    const root = await mkdtemp(join(tmpdir(), 'cs-hc-'));
    const home = join(root, 'main');
    await mkdir(join(home, 'sessions'), { recursive: true });
    const files: string[] = [];
    for (const [i, s] of (o.sessions ?? []).entries()) {
        const file = join(home, 'sessions', `${i}.json`);
        files.push(file);
        await writeFile(file, JSON.stringify({ pid: s.pid ?? 77, sessionId: ID, cwd: CWD, entrypoint: s.entrypoint, status: s.status ?? 'idle', startedAt: 0 }));
    }
    const title = o.title ?? 'Fix menu';
    setTabs([{ tabs: [{ label: 'a.ts', active: true }, ...(o.tabLabel ? [{ label: o.tabLabel, claude: true }] : [])] }]);
    // The Claude extension: show the conversation's tab if it has one here, otherwise open a new one.
    fake.onCommand = (id, args) => {
        if (id !== OPEN || args[0] !== ID) {
            return;
        }
        const existing = tabState.groups.flatMap((g) => g.tabs).find((t) => t.label === tabLabelFor(title) && (t.input as any).viewType);
        if (existing) {
            activateTab(existing);
        } else {
            addClaudeTab(tabLabelFor(title));
        }
    };
    const c = new HandoffController({
        root,
        thisWindowId: 'me',
        thisAccountKey: () => 'main',
        sources: async () => [{ accountKey: 'main', configHome: home }],
        liveWindows: async () => [W('me', ['C:\\p\\a']), W('other', ['C:\\q'])],
        titles: async () => new Map([[ID, title]]),
        log: { warn: () => undefined },
        platform: 'win32',
        isAlive: () => true,
        sleep: o.sleep ?? (async () => undefined),
    });
    const ask = (req: Partial<HandoffRequest> & Pick<HandoffRequest, 'action'>) =>
        writeRequest(root, { v: 1, sessionId: ID, cwd: CWD, accountKey: 'main', at: Date.now(), ...(req.action === 'close' ? { pid: 77 } : {}), ...req } as HandoffRequest);
    const opens = () => fake.commands.filter((x) => x.id === OPEN).length;
    return { c, root, files, ask, opens };
}

test("close: the conversation's tab comes forward and is closed", async () => {
    const { c, root, ask } = await setup({ sessions: [{ entrypoint: 'claude-vscode' }], tabLabel: 'Fix menu' });
    await ask({ action: 'close' });
    await c.handleAll();
    assert.deepEqual(tabState.closed, ['Fix menu']);
    assert.equal((await readResult(root, ID))?.result, 'closed');
    assert.deepEqual(await pendingRequests(root), []);
    assert.equal(existsSync(join(root, 'handoff', `${ID}.me.claim`)), false);
});

test('close: not in a tab here, so the new waiting tab is closed and the answer is not-here', async () => {
    const { c, root, ask } = await setup({ sessions: [{ entrypoint: 'claude-vscode' }] });
    await ask({ action: 'close' });
    await c.handleAll();
    assert.deepEqual(tabState.closed, ['Fix menu'], 'the tab the command just made');
    assert.equal((await readResult(root, ID))?.result, 'not-here');
});

test('close: a working Claude is never closed', async () => {
    const { c, root, ask, opens } = await setup({ sessions: [{ entrypoint: 'claude-vscode', status: 'busy' }], tabLabel: 'Fix menu' });
    await ask({ action: 'close' });
    await c.handleAll();
    assert.deepEqual(tabState.closed, []);
    assert.equal(opens(), 0);
    assert.equal((await readResult(root, ID))?.result, 'not-here');
});

test('close: the request must name the Claude that runs the tab', async () => {
    const { c, root, ask } = await setup({ sessions: [{ entrypoint: 'claude-vscode', pid: 78 }], tabLabel: 'Fix menu' });
    await ask({ action: 'close' }); // asks for pid 77
    await c.handleAll();
    assert.deepEqual(tabState.closed, []);
    assert.equal((await readResult(root, ID))?.result, 'not-here');
});

test('close: a request for another folder or account is left for another window', async () => {
    const { c, root, ask, opens } = await setup({ sessions: [{ entrypoint: 'claude-vscode' }], tabLabel: 'Fix menu' });
    await ask({ action: 'close', cwd: 'C:\\q\\b' });
    await c.handleAll();
    assert.deepEqual(await pendingRequests(root), [ID]);
    await ask({ action: 'close', accountKey: 'w' });
    await c.handleAll();
    assert.deepEqual(await pendingRequests(root), [ID]);
    assert.equal(opens(), 0);
    assert.deepEqual(tabState.closed, []);
});

test('an expired request is ignored and swept', async () => {
    const { c, root, ask, opens } = await setup({ sessions: [{ entrypoint: 'claude-vscode' }], tabLabel: 'Fix menu' });
    await ask({ action: 'close', at: Date.now() - 31_000 });
    await c.handleAll();
    assert.equal(opens(), 0);
    assert.deepEqual(await pendingRequests(root), []);
    assert.equal(await readResult(root, ID), undefined);
});

test('open: a fresh tab is opened once the conversation is free', async () => {
    const { c, root, ask, opens } = await setup();
    await ask({ action: 'open' });
    await c.handleAll();
    assert.equal(opens(), 1);
    assert.deepEqual(tabState.closed, []);
    assert.equal((await readResult(root, ID))?.result, 'opened');
});

test('open: a dead tab is replaced', async () => {
    const { c, root, ask, opens } = await setup({ tabLabel: 'Fix menu' });
    await ask({ action: 'open' });
    await c.handleAll();
    assert.deepEqual(tabState.closed, ['Fix menu'], 'the dead tab');
    assert.equal(opens(), 2, 'shown, then opened again in a fresh tab');
    assert.equal(tabState.groups[0].tabs.filter((t) => t.label === 'Fix menu').length, 1);
    assert.equal((await readResult(root, ID))?.result, 'opened');
});

test('open: already reopened by the user', async () => {
    const { c, root, ask, opens } = await setup({ sessions: [{ entrypoint: 'claude-vscode' }], tabLabel: 'Fix menu' });
    await ask({ action: 'open' });
    await c.handleAll();
    assert.equal(opens(), 0);
    assert.deepEqual(tabState.closed, []);
    assert.equal((await readResult(root, ID))?.result, 'already-open');
});

test('open in a terminal: the terminal it ran in runs claude --resume again', async () => {
    const { c, root, ask, opens } = await setup();
    terminals.length = 0;
    const sent: string[] = [];
    let shown = 0;
    terminals.push({ processId: Promise.resolve(700), show() {}, sendText: () => undefined });
    terminals.push({ processId: Promise.resolve(900), show: () => void shown++, sendText: (t) => void sent.push(t) });
    await ask({ action: 'open', kind: 'terminal', shells: [901, 900] });
    await c.handleAll();
    assert.deepEqual(sent, [`claude --resume ${ID}`]);
    assert.equal(shown, 1);
    assert.equal(opens(), 0, 'no Claude tab');
    assert.equal(terminals.length, 2, 'no new terminal');
    assert.equal((await readResult(root, ID))?.result, 'opened');
});

test('open in a terminal that is gone: a new terminal in the folder', async () => {
    const { c, root, ask } = await setup();
    terminals.length = 0;
    await ask({ action: 'open', kind: 'terminal', shells: [901] });
    await c.handleAll();
    assert.equal(terminals.length, 1);
    assert.deepEqual([terminals[0].name, terminals[0].cwd, terminals[0].sent], ['Claude', CWD, [`claude --resume ${ID}`]]);
    assert.equal((await readResult(root, ID))?.result, 'opened');
});

test('open in a terminal while the conversation still runs somewhere: left alone, never two copies', async () => {
    const { c, root, ask } = await setup({ sessions: [{ entrypoint: 'cli' }] });
    terminals.length = 0;
    await ask({ action: 'open', kind: 'terminal', shells: [901] });
    await c.handleAll();
    assert.equal(terminals.length, 0);
    assert.equal((await readResult(root, ID))?.result, 'already-open');
});

test("open: waits while Claude Away's own copy is still ending", async () => {
    let polls = 0;
    let files: string[] = [];
    const s = await setup({
        sessions: [{ entrypoint: 'sdk-ts', pid: 555 }],
        sleep: async () => {
            polls++;
            if (polls === 2) {
                await unlink(files[0]);
            }
        },
    });
    files = s.files;
    let goneAtOpen: boolean | undefined;
    const play = fake.onCommand!;
    fake.onCommand = (id, args) => {
        goneAtOpen ??= !existsSync(files[0]);
        return play(id, args);
    };
    await s.ask({ action: 'open' });
    await s.c.handleAll();
    assert.equal(goneAtOpen, true, 'opened only after the copy had ended');
    assert.equal(s.opens(), 1);
    assert.equal((await readResult(s.root, ID))?.result, 'opened');
});
