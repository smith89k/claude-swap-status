// Works with Claude Away's take over. When Claude Away takes a conversation over, this window
// (if it is the one holding that folder) closes the conversation's Claude tab neatly, as if the
// user closed it, so no "process exited" error shows. When Claude Away hands the conversation
// back, it opens it again in a fresh tab, with everything said from the phone in it.
// Requests come as small files in <accounts root>/handoff/ (see core/handoff.ts).
import * as vscode from 'vscode';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pickTab, type TabInfo, type TabSnapshot } from '../core/claudeTabs';
import {
    bestWindowFor,
    claimRequest,
    finishClaim,
    handoffDir,
    isFresh,
    peekRequest,
    pendingRequests,
    sweep,
    type HandoffOutcome,
    type HandoffRequest,
} from '../core/handoff';
import { listSessions, type RunningSession, type SessionSource } from '../core/sessions';
import type { WindowBeat } from '../core/types';
import { isPidAlive } from '../core/windows';

/** Wait after asking Claude to show a conversation, so its tab has come forward. */
export const SETTLE_MS = 300;
/** Opening waits this long for Claude Away's copy to end. */
export const FREE_WAIT_MS = 30_000;
export const FREE_POLL_MS = 500;
export const POLL_MS = 1_000;

const OPEN = 'claude-vscode.editor.open';
const CLAUDE_VIEW = /claudeVSCodePanel$/;

export interface HandoffDeps {
    root: string;
    thisWindowId: string;
    thisAccountKey: () => string;
    sources: () => Promise<SessionSource[]>;
    liveWindows: () => Promise<WindowBeat[]>;
    /** Conversation titles by session id (what Claude names their tabs after). */
    titles: () => Promise<Map<string, string>>;
    log: { warn(line: string): void };
    platform?: NodeJS.Platform;
    now?: () => number;
    isAlive?: (pid: number) => boolean;
    sleep?: (ms: number) => Promise<void>;
}

export class HandoffController implements vscode.Disposable {
    private readonly platform: NodeJS.Platform;
    private readonly now: () => number;
    private readonly isAlive: (pid: number) => boolean;
    private readonly sleep: (ms: number) => Promise<void>;
    private busy = false;
    private timer: NodeJS.Timeout | undefined;
    private watcher: FSWatcher | undefined;

    constructor(private readonly d: HandoffDeps) {
        this.platform = d.platform ?? process.platform;
        this.now = d.now ?? Date.now;
        this.isAlive = d.isAlive ?? isPidAlive;
        this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    }

    start(): void {
        const run = () => void this.handleAll();
        void mkdir(handoffDir(this.d.root), { recursive: true }).then(() => {
            try {
                this.watcher = watch(handoffDir(this.d.root), run);
            } catch (e: any) {
                this.d.log.warn(`handoff watcher: ${e?.code ?? 'error'}`);
            }
        }).catch(() => undefined);
        this.timer = setInterval(run, POLL_MS);
    }

    /** One pass over the waiting requests. Only one pass runs at a time. */
    async handleAll(): Promise<void> {
        if (this.busy) {
            return;
        }
        this.busy = true;
        try {
            await sweep(this.d.root, this.now(), this.platform);
            const ids = await pendingRequests(this.d.root);
            if (!ids.length) {
                return;
            }
            const windows = await this.d.liveWindows();
            for (const id of ids) {
                const req = await peekRequest(this.d.root, id, this.platform);
                if (!req || !isFresh(req, this.now()) || req.accountKey !== this.d.thisAccountKey()) {
                    continue;
                }
                if (bestWindowFor(req.cwd, req.accountKey, windows, this.platform)?.windowId !== this.d.thisWindowId) {
                    continue; // another window holds that folder
                }
                const claimed = await claimRequest(this.d.root, id, this.d.thisWindowId, this.platform);
                if (claimed) {
                    await this.act(claimed);
                }
            }
        } catch (e: any) {
            this.d.log.warn(`handoff: ${e?.code ?? e?.name ?? 'error'}`);
        } finally {
            this.busy = false;
        }
    }

    private async act(req: HandoffRequest): Promise<void> {
        let result: HandoffOutcome;
        try {
            result = req.action === 'close' ? await this.close(req) : await this.open(req);
        } catch (e: any) {
            this.d.log.warn(`handoff ${req.action}: ${e?.code ?? e?.name ?? 'error'}`);
            result = 'not-here'; // Claude Away then does it the old way
        }
        await finishClaim(this.d.root, req.sessionId, this.d.thisWindowId, { v: 1, action: req.action, result, windowId: this.d.thisWindowId, at: this.now() });
    }

    /** Close the conversation's tab, but only while its Claude is idle: never in the middle of a task. */
    private async close(req: HandoffRequest): Promise<HandoffOutcome> {
        const sessions = await this.running();
        const s = sessions.find((x) => x.sessionId === req.sessionId && x.kind === 'ide' && x.pid === req.pid);
        if (!s || s.status !== 'idle') {
            return 'not-here';
        }
        const pick = await this.show(req.sessionId, sessions);
        if (pick.kind === 'none') {
            return 'not-here';
        }
        await this.closeTab(pick.key); // a new tab means it wasn't here: close the one just made
        return pick.kind === 'existing' ? 'closed' : 'not-here';
    }

    /** Open the conversation again once Claude Away's copy has ended, replacing a dead tab if one is left. */
    private async open(req: HandoffRequest): Promise<HandoffOutcome> {
        let sessions = await this.running();
        for (let i = 0; i < FREE_WAIT_MS / FREE_POLL_MS; i++) {
            const holders = sessions.filter((x) => x.sessionId === req.sessionId);
            if (holders.some((x) => x.kind === 'ide')) {
                return 'already-open'; // the user opened it in the editor meanwhile
            }
            if (!holders.length) {
                break;
            }
            await this.sleep(FREE_POLL_MS);
            sessions = await this.running();
        }
        const pick = await this.show(req.sessionId, sessions);
        if (pick.kind === 'existing') {
            // Nothing runs the conversation, so a tab that was already there is the dead one.
            await this.closeTab(pick.key);
            await this.sleep(SETTLE_MS);
            await vscode.commands.executeCommand(OPEN, req.sessionId);
        }
        return 'opened';
    }

    /** Asks Claude to show the conversation, and works out which tab that brought forward. */
    private async show(sessionId: string, sessions: RunningSession[]) {
        const titles = await this.d.titles();
        const others = sessions.filter((x) => x.sessionId !== sessionId).map((x) => titles.get(x.sessionId)).filter((t): t is string => !!t);
        const before = this.snapshot();
        await vscode.commands.executeCommand(OPEN, sessionId);
        await this.sleep(SETTLE_MS);
        return pickTab(before, this.snapshot(), titles.get(sessionId), others);
    }

    private running(): Promise<RunningSession[]> {
        return this.d.sources().then((s) => listSessions(s, this.isAlive));
    }

    private tabs(): { info: TabInfo; tab: vscode.Tab; active: boolean }[] {
        const out: { info: TabInfo; tab: vscode.Tab; active: boolean }[] = [];
        for (const g of vscode.window.tabGroups.all) {
            g.tabs.forEach((tab, i) => {
                const isClaude = tab.input instanceof vscode.TabInputWebview && CLAUDE_VIEW.test(tab.input.viewType);
                out.push({ info: { key: `${g.viewColumn}:${i}:${tab.label}`, label: tab.label, isClaude }, tab, active: g.isActive && tab.isActive });
            });
        }
        return out;
    }

    private snapshot(): TabSnapshot {
        const all = this.tabs();
        return { tabs: all.map((t) => t.info), activeKey: all.find((t) => t.active)?.info.key };
    }

    private async closeTab(key: string): Promise<void> {
        const t = this.tabs().find((x) => x.info.key === key);
        if (t) {
            await vscode.window.tabGroups.close(t.tab);
        }
    }

    dispose(): void {
        if (this.timer) {
            clearInterval(this.timer);
        }
        this.watcher?.close();
    }
}
