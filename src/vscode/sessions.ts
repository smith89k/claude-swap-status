// The Sessions tab's engine: keeps the list of running (and recently finished) Claude
// sessions fresh while the panel is visible, and jumps to a session, in this window or
// another one, or reopens a finished one here.
import * as vscode from 'vscode';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { takeJumpRequest, writeJumpRequest } from '../core/jumpRequests';
import { ancestors, type ProcRunner } from '../core/processTree';
import { PastSessionReader, type PastSession } from '../core/pastSessions';
import { listSessions, type RunningSession, type SessionSource } from '../core/sessions';
import { locate, toPastGroups, toSessionsModel, type SessionsModel } from '../core/sessionsModel';
import type { AccountView, WindowBeat } from '../core/types';
import { isPidAlive } from '../core/windows';

const VISIBLE_POLL_MS = 3_000;
const PAST_POLL_MS = 30_000;
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
    /** The folders open in this window. Defaults to the ones in this window's heartbeat. */
    thisFolders?: () => string[];
}

export class SessionsController implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<SessionsModel>();
    readonly onDidChange = this.emitter.event;
    model: SessionsModel = { count: 0, groups: [], past: [] };
    sessions: RunningSession[] = [];
    past: PastSession[] = [];

    private readonly platform: NodeJS.Platform;
    private readonly now: () => number;
    private pollTimer: NodeJS.Timeout | undefined;
    private requestTimer: NodeJS.Timeout | undefined;
    private watcher: FSWatcher | undefined;
    private windows: WindowBeat[] = [];
    private readonly pastReader = new PastSessionReader();
    private pastAt: number | undefined;

    constructor(private readonly d: SessionsDeps) {
        this.platform = d.platform ?? process.platform;
        this.now = d.now ?? Date.now;
    }

    /** Re-reads running sessions; finished ones too when 30 seconds have passed, or right away with `forcePast`. */
    async refresh(forcePast = false): Promise<void> {
        if (forcePast) {
            this.pastAt = undefined;
        }
        const sources = await this.d.sources();
        this.sessions = await listSessions(sources, this.d.isAlive ?? isPidAlive);
        this.windows = [...(await this.d.liveWindows())]; // a snapshot of what the list was drawn from
        const now = this.now();
        // Finished sessions change slowly and take longer to read: at most every 30 seconds.
        if (this.pastAt === undefined || now - this.pastAt >= PAST_POLL_MS) {
            this.pastAt = now;
            try {
                this.past = await this.pastReader.list(sources, now);
            } catch (e: any) {
                this.d.log.warn(`past sessions: ${e?.code ?? e?.name ?? 'error'}`);
            }
        }
        const accounts = this.d.accounts();
        this.model = {
            ...toSessionsModel(this.sessions, this.windows, accounts, this.d.thisWindowId, now, this.platform),
            past: toPastGroups(this.past, {
                runningIds: new Set(this.sessions.map((x) => x.sessionId)),
                accounts,
                thisAccountKey: accounts.find((v) => v.isThisWindow)?.key,
                thisFolders: this.thisFolders(),
                now,
                platform: this.platform,
            }),
        };
        this.emitter.fire(this.model);
    }

    private thisFolders(): string[] {
        return this.d.thisFolders?.() ?? this.windows.find((w) => w.windowId === this.d.thisWindowId)?.folders ?? [];
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
            return this.reopen(sessionId);
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

    /** A finished session: reopen it in a Claude tab here, or say why it can't be. */
    private async reopen(sessionId: string): Promise<JumpResult> {
        const row = this.model.past.flatMap((g) => g.rows).find((r) => r.sessionId === sessionId);
        if (!row) {
            return 'missing';
        }
        if (!row.canJump) {
            if (row.note) {
                void vscode.window.showInformationMessage(row.note);
            }
            return 'noted';
        }
        try {
            await vscode.commands.executeCommand('claude-vscode.editor.open', sessionId);
        } catch {
            void vscode.window.showWarningMessage("Couldn't reopen that Claude conversation here.");
        }
        return 'opened';
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
