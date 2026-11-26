// The Sessions tab's engine: keeps the list of running Claude sessions fresh while
// the panel is visible, and jumps to a session, in this window or another one.
import * as vscode from 'vscode';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { takeJumpRequest, writeJumpRequest } from '../core/jumpRequests';
import { ancestors, type ProcRunner } from '../core/processTree';
import { listSessions, type RunningSession, type SessionSource } from '../core/sessions';
import { locate, toSessionsModel, type SessionsModel } from '../core/sessionsModel';
import type { AccountView, WindowBeat } from '../core/types';
import { isPidAlive } from '../core/windows';

const VISIBLE_POLL_MS = 3_000;
const REQUEST_POLL_MS = 2_000;
const TERMINAL_LEVELS = 3;

export type JumpResult = 'opened' | 'forwarded' | 'noted' | 'gone' | 'missing';

export interface SessionsDeps {
    root: string;
    thisWindowId: string;
    sources: () => Promise<SessionSource[]>;
    liveWindows: () => Promise<WindowBeat[]>;
    accounts: () => AccountView[];
    log: { warn(line: string): void };
    platform?: NodeJS.Platform;
    now?: () => number;
    run?: ProcRunner;
    isAlive?: (pid: number) => boolean;
}

export class SessionsController implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<SessionsModel>();
    readonly onDidChange = this.emitter.event;
    model: SessionsModel = { count: 0, groups: [] };
    sessions: RunningSession[] = [];

    private readonly platform: NodeJS.Platform;
    private readonly now: () => number;
    private pollTimer: NodeJS.Timeout | undefined;
    private requestTimer: NodeJS.Timeout | undefined;
    private watcher: FSWatcher | undefined;
    private windows: WindowBeat[] = [];

    constructor(private readonly d: SessionsDeps) {
        this.platform = d.platform ?? process.platform;
        this.now = d.now ?? Date.now;
    }

    async refresh(): Promise<void> {
        this.sessions = await listSessions(await this.d.sources(), this.d.isAlive ?? isPidAlive);
        this.windows = [...(await this.d.liveWindows())]; // a snapshot of what the list was drawn from
        this.model = toSessionsModel(this.sessions, this.windows, this.d.accounts(), this.d.thisWindowId, this.now(), this.platform);
        this.emitter.fire(this.model);
    }

    /** Re-read every 3 seconds while the panel is visible; stop while it is hidden. */
    setVisible(visible: boolean): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        if (visible) {
            void this.refresh().catch((e) => this.d.log.warn(`sessions refresh: ${e?.name ?? 'error'}`));
            this.pollTimer = setInterval(() => {
                void this.refresh().catch((e) => this.d.log.warn(`sessions refresh: ${e?.name ?? 'error'}`));
            }, VISIBLE_POLL_MS);
        }
    }

    async jump(sessionId: string): Promise<JumpResult> {
        let s = this.sessions.find((x) => x.sessionId === sessionId);
        if (!s) {
            await this.refresh();
            s = this.sessions.find((x) => x.sessionId === sessionId);
        }
        if (!s) {
            return 'missing';
        }
        // Place the session using the windows the list was drawn from, then ask again at
        // click time whether the target window is still open: it may have just closed.
        const live = await this.d.liveWindows();
        const place = locate(s, this.windows.length ? this.windows : live, this.d.thisWindowId, this.platform);

        if (place.where === 'thisWindow') {
            await this.showHere(s.sessionId, s.pid, s.kind);
            return 'opened';
        }
        if (place.where === 'otherWindow') {
            if (!live.some((w) => w.windowId === place.windowId)) {
                void vscode.window.showInformationMessage('That window just closed.');
                return 'gone';
            }
            await writeJumpRequest(this.d.root, place.windowId, { sessionId: s.sessionId, pid: s.pid, kind: s.kind, at: this.now() });
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(place.openTarget), { forceNewWindow: true });
            return 'forwarded';
        }
        const row = this.model.groups.flatMap((g) => g.rows).find((r) => r.sessionId === sessionId)
            ?? toSessionsModel([s], live, this.d.accounts(), this.d.thisWindowId, this.now(), this.platform).groups[0]?.rows[0];
        if (row?.note) {
            void vscode.window.showInformationMessage(row.note);
        }
        return 'noted';
    }

    /** Picks up a request another window left for this one, and acts on it. */
    async handleRequest(): Promise<void> {
        const req = await takeJumpRequest(this.d.root, this.d.thisWindowId, this.now());
        if (req) {
            await this.showHere(req.sessionId, req.pid, req.kind);
        }
    }

    startWatching(): void {
        const dir = path.join(this.d.root, 'requests');
        void mkdir(dir, { recursive: true }).then(() => {
            try {
                this.watcher = watch(dir, () => void this.handleRequest().catch(() => undefined));
            } catch (e: any) {
                this.d.log.warn(`request watcher: ${e?.code ?? 'error'}`);
            }
        }).catch(() => undefined);
        this.requestTimer = setInterval(() => void this.handleRequest().catch(() => undefined), REQUEST_POLL_MS);
    }

    private async showHere(sessionId: string, pid: number, kind: RunningSession['kind']): Promise<void> {
        if (kind === 'ide') {
            try {
                await vscode.commands.executeCommand('claude-vscode.editor.open', sessionId);
            } catch {
                void vscode.window.showWarningMessage("Couldn't open that Claude session here.");
            }
            return;
        }
        if (kind === 'terminal') {
            const family = await ancestors(pid, TERMINAL_LEVELS, this.platform, this.d.run);
            for (const t of vscode.window.terminals) {
                const shell = await t.processId;
                if (shell !== undefined && family.includes(shell)) {
                    t.show();
                    return;
                }
            }
        }
    }

    dispose(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }
        if (this.requestTimer) {
            clearInterval(this.requestTimer);
        }
        this.watcher?.close();
        this.emitter.dispose();
    }
}
