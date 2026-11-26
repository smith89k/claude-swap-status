// Keeps the account list fresh: writes this window's heartbeat, polls usage for
// every account, and hands the UI a new snapshot after each round.
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { createCredentialStore, readIdentity, type CredentialStore } from '../core/credentials';
import { withCredentialLocks, withLock } from '../core/locks';
import { fetchUsage, refreshAccessToken } from '../core/oauth';
import { configHome, globalConfigPath } from '../core/paths';
import type { Registry } from '../core/registry';
import { buildSnapshot } from '../core/snapshot';
import { MAIN_KEY, type Account, type AccountView, type ConfigTarget, type Identity } from '../core/types';
import { removeAccountNow, type RemoveResult } from '../core/removeAccount';
import { pollAccount, UsageCache } from '../core/usage';
import { isAccountInUse, WindowRegistry } from '../core/windows';

const HEARTBEAT_MS = 30_000;

export class AccountsController implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<AccountView[]>();
    readonly onDidChange = this.emitter.event;
    views: AccountView[] = [];
    loaded = false;

    readonly cache: UsageCache;
    readonly credentials: CredentialStore;
    readonly windows: WindowRegistry;
    readonly windowId = randomUUID();
    private pollTimer: NodeJS.Timeout | undefined;
    private beatTimer: NodeJS.Timeout | undefined;
    private queue: Promise<void> = Promise.resolve();
    private busy = false;
    private readonly seenSignedIn = new Map<string, boolean>();
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        readonly root: string,
        readonly registry: Registry,
        readonly thisWindowKey: string,
        readonly originalConfigDir: string | undefined,
        readonly log: vscode.LogOutputChannel,
    ) {
        this.cache = new UsageCache(root);
        this.credentials = createCredentialStore({ platform: process.platform });
        this.windows = new WindowRegistry(root);
    }

    start(): void {
        void this.beat();
        this.beatTimer = setInterval(() => void this.beat(), HEARTBEAT_MS);
        this.restartPolling();
        this.disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('claudeSwap.pollIntervalMinutes')) {
                this.restartPolling();
            }
        }));
    }

    /** Config target for an account key: its folder, or the main login's folder. */
    targetFor(key: string, folder?: string): ConfigTarget {
        if (key === MAIN_KEY || !folder) {
            return { configHome: configHome(this.originalConfigDir), configDirEnv: this.originalConfigDir };
        }
        return { configHome: folder, configDirEnv: folder };
    }

    refresh(force = false): Promise<void> {
        if (this.busy && !force) {
            return this.queue;
        }
        this.busy = true;
        this.queue = this.queue
            .then(() => this.doRefresh(force))
            .catch((e: any) => this.log.error(`refresh failed: ${e?.name ?? 'Error'}: ${e?.message ?? ''}`))
            .finally(() => { this.busy = false; });
        return this.queue;
    }

    private intervalMs(): number {
        const minutes = vscode.workspace.getConfiguration('claudeSwap').get<number>('pollIntervalMinutes') ?? 1;
        return Math.max(0.5, minutes) * 60_000;
    }

    private restartPolling(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }
        void this.refresh();
        this.pollTimer = setInterval(() => void this.refresh(), this.intervalMs());
    }

    private async beat(): Promise<void> {
        // Folders and the thing to open let other windows jump to sessions running here.
        const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
        const file = vscode.workspace.workspaceFile;
        const openTarget = file ? (file.scheme === 'file' ? file.fsPath : undefined) : folders[0];
        try {
            await this.windows.beat({
                windowId: this.windowId,
                accountKey: this.thisWindowKey,
                workspaceName: vscode.workspace.name ?? 'Untitled window',
                pid: process.pid,
                folders,
                ...(openTarget ? { openTarget } : {}),
            });
        } catch (e: any) {
            this.log.warn(`heartbeat failed: ${e?.code ?? e?.name ?? 'error'}`);
        }
    }

    private async doRefresh(force: boolean): Promise<void> {
        const accounts = await this.registry.list();
        const liveWindows = await this.windows.live();

        for (const a of accounts) {
            if (a.email) {
                continue;
            }
            const id = await readIdentity(globalConfigPath(a.folder));
            if (id) {
                const updated = await this.registry.update(a.id, { email: id.email, orgUuid: id.orgUuid, orgName: id.orgName });
                Object.assign(a, updated);
            }
        }
        const mainIdentity = await readIdentity(globalConfigPath(this.originalConfigDir));
        const mainAlias = await this.registry.getMainAlias();

        const intervalMs = force ? 0 : this.intervalMs();
        const jobs = [
            ...accounts.map((a) => ({ key: a.id, target: this.targetFor(a.id, a.folder) })),
            { key: MAIN_KEY, target: this.targetFor(MAIN_KEY) },
        ];
        await Promise.all(jobs.map(({ key, target }) =>
            pollAccount(key, target, intervalMs, {
                cache: this.cache,
                credentials: this.credentials,
                fetchUsage: (token) => fetchUsage(token),
                refresh: (cred) => refreshAccessToken(cred),
                inUse: () => isAccountInUse({ accountKey: key, configHome: target.configHome, liveWindows }),
                withCredentialLocks,
                withFetchLock: (k, fn) => withLock(path.join(this.root, 'locks', `fetch-${k}.lock`), { staleMs: 30_000 }, fn),
                now: Date.now,
            }).catch((e: any) => this.log.warn(`poll ${key}: ${e?.name ?? 'Error'}`)),
        ));

        const usage = await this.cache.read();
        this.views = buildSnapshot({ accounts, mainIdentity, mainAlias, liveWindows, usage, thisWindowKey: this.thisWindowKey });
        this.loaded = true;
        this.noticeSignIn(accounts, mainIdentity);
        this.emitter.fire(this.views);
    }

    /** When this window's account finishes signing in, say so once and check it isn't a duplicate. */
    private noticeSignIn(accounts: Account[], mainIdentity: Identity | undefined): void {
        const mine = this.views.find((v) => v.isThisWindow);
        if (!mine || mine.isMain) {
            return;
        }
        const before = this.seenSignedIn.get(mine.key);
        this.seenSignedIn.set(mine.key, mine.signedIn);
        if (before !== false || !mine.signedIn) {
            return;
        }
        const me = accounts.find((a) => a.id === mine.key);
        void vscode.window.showInformationMessage(`Signed in as ${mine.email}. Give this account a short name?`, 'Rename').then((pick) => {
            if (pick) {
                void vscode.commands.executeCommand('claudeSwap.renameAccount', mine.key);
            }
        });
        if (!me?.email) {
            return;
        }
        const same = (email?: string, org?: string) => email === me.email && (org ?? '') === (me.orgUuid ?? '');
        const twin = accounts.find((a) => a.id !== me.id && same(a.email, a.orgUuid));
        const twinLabel = twin
            ? this.views.find((v) => v.key === twin.id)?.label
            : same(mainIdentity?.email, mainIdentity?.orgUuid) ? this.views.find((v) => v.isMain)?.label : undefined;
        if (twinLabel) {
            void vscode.window.showWarningMessage(`"${mine.label}" is the same Claude account as "${twinLabel}". That works, but you may not need both.`);
        }
    }

    /** Deletes an added account if nothing is using it (no open window, no running Claude). */
    async removeAccount(id: string): Promise<RemoveResult> {
        const account = await this.registry.get(id);
        return removeAccountNow({
            root: this.root,
            registry: this.registry,
            cache: this.cache,
            credentials: this.credentials,
            platform: process.platform,
            id,
            inUse: async () => !!account && isAccountInUse({ accountKey: id, configHome: account.folder, liveWindows: await this.windows.live() }),
            log: (line) => this.log.warn(line),
        });
    }

    async shutdown(): Promise<void> {
        this.dispose();
        await this.windows.remove(this.windowId);
    }

    dispose(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }
        if (this.beatTimer) {
            clearInterval(this.beatTimer);
        }
        this.pollTimer = undefined;
        this.beatTimer = undefined;
        this.disposables.forEach((d) => d.dispose());
        this.disposables.length = 0;
        this.emitter.dispose();
    }
}
