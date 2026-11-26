import * as vscode from 'vscode';
import { accountsRoot, configHome } from './core/paths';
import { Registry } from './core/registry';
import { MAIN_KEY, type AccountView } from './core/types';
import { AccountsPanelProvider } from './vscode/accountsPanel';
import { registerCommands } from './vscode/commands';
import { AccountsController } from './vscode/controller';
import { StatusBar } from './vscode/statusBar';
import { finishPendingRemoval } from './vscode/pendingRemoval';
import { SessionsController } from './vscode/sessions';
import { applyWindowAccount } from './vscode/windowAccount';

// What the editor was started with, before this extension changes anything.
const ORIGINAL_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || undefined;

let controller: AccountsController | undefined;

/** Small read-only API, also used by the launch tests. */
export interface ClaudeSwapApi {
    thisWindowKey(): string;
    views(): AccountView[];
    refresh(): Promise<void>;
}

export async function activate(context: vscode.ExtensionContext): Promise<ClaudeSwapApi> {
    const log = vscode.window.createOutputChannel('Claude Swap Status', { log: true });
    context.subscriptions.push(log);

    const root = accountsRoot();
    const registry = new Registry(root);
    const applied = await applyWindowAccount(context, ORIGINAL_CONFIG_DIR, registry, log);

    const c = new AccountsController(root, registry, applied.key, ORIGINAL_CONFIG_DIR, log);
    controller = c;
    const statusBar = new StatusBar();
    context.subscriptions.push(
        c,
        statusBar,
        c.onDidChange((views) => statusBar.update(views)),
        vscode.commands.registerCommand('claudeSwap.refreshStatus', () => c.refresh(true)),
    );
    registerCommands(context, c);

    // Sessions tab: every running Claude session on this PC, and jumping to it.
    const sessions = new SessionsController({
        root,
        thisWindowId: c.windowId,
        sources: async () => [
            { accountKey: MAIN_KEY, configHome: configHome(ORIGINAL_CONFIG_DIR) },
            ...(await registry.list()).map((a) => ({ accountKey: a.id, configHome: a.folder })),
        ],
        liveWindows: () => c.windows.live(),
        accounts: () => c.views,
        log,
    });
    context.subscriptions.push(
        sessions,
        vscode.commands.registerCommand('claudeSwap.jumpToSession', async (sessionId?: string) => {
            if (!sessionId) {
                await sessions.refresh();
                const pick = await vscode.window.showQuickPick(
                    sessions.model.groups.flatMap((g) => g.rows.map((r) => ({
                        label: `${r.isMain ? '👑 ' : ''}${r.title}`,
                        description: `${g.heading} · ${r.accountName}`,
                        detail: [r.subtitle, r.whereText].filter(Boolean).join(' · '),
                        sessionId: r.sessionId,
                    }))),
                    { placeHolder: sessions.model.count ? 'Jump to a running Claude session' : 'No Claude sessions are running right now.' },
                );
                sessionId = pick?.sessionId;
            }
            if (sessionId) {
                await sessions.jump(sessionId);
            }
        }),
    );
    sessions.startWatching();

    const panel = new AccountsPanelProvider(context.extensionUri, c, sessions);
    context.subscriptions.push(panel, vscode.window.registerWebviewViewProvider(AccountsPanelProvider.viewType, panel));

    c.start();
    // If this window was switched to Claude 1 to delete its old account, finish that now.
    void finishPendingRemoval(context.workspaceState, (id) => c.removeAccount(id)).then(() => c.refresh(true));

    return {
        thisWindowKey: () => c.thisWindowKey,
        views: () => c.views,
        refresh: () => c.refresh(true),
    };
}

export async function deactivate() {
    await controller?.shutdown();
    controller = undefined;
}
