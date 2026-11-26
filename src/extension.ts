import * as vscode from 'vscode';
import { accountsRoot } from './core/paths';
import { Registry } from './core/registry';
import type { AccountView } from './core/types';
import { AccountsPanelProvider } from './vscode/accountsPanel';
import { registerCommands } from './vscode/commands';
import { AccountsController } from './vscode/controller';
import { StatusBar } from './vscode/statusBar';
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
    const panel = new AccountsPanelProvider(context.extensionUri, c);
    context.subscriptions.push(
        c,
        statusBar,
        panel,
        c.onDidChange((views) => statusBar.update(views)),
        vscode.window.registerWebviewViewProvider(AccountsPanelProvider.viewType, panel),
        vscode.commands.registerCommand('claudeSwap.refreshStatus', () => c.refresh(true)),
    );
    registerCommands(context, c);

    c.start();

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
