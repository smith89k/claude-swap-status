import * as vscode from 'vscode';
import { accountsRoot } from './core/paths';
import { Registry } from './core/registry';
import { AccountsController } from './vscode/controller';
import { StatusBar } from './vscode/statusBar';
import { applyWindowAccount } from './vscode/windowAccount';

// What the editor was started with, before this extension changes anything.
const ORIGINAL_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || undefined;

let controller: AccountsController | undefined;

export async function activate(context: vscode.ExtensionContext) {
    const log = vscode.window.createOutputChannel('Claude Swap Status', { log: true });
    context.subscriptions.push(log);

    const root = accountsRoot();
    const registry = new Registry(root);
    const applied = await applyWindowAccount(context, ORIGINAL_CONFIG_DIR, registry, log);

    controller = new AccountsController(root, registry, applied.key, ORIGINAL_CONFIG_DIR, log);
    const statusBar = new StatusBar();
    context.subscriptions.push(controller, statusBar, controller.onDidChange((views) => statusBar.update(views)));

    context.subscriptions.push(vscode.commands.registerCommand('claudeSwap.refreshStatus', () => controller?.refresh(true)));

    controller.start();
}

export async function deactivate() {
    await controller?.shutdown();
    controller = undefined;
}
