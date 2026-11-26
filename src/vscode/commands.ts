// Every command: switching, adding, renaming and removing accounts.
import * as vscode from 'vscode';
import { mkdir } from 'node:fs/promises';
import { formatWindow, pickUsage, statusLabel } from '../core/format';
import { accountFolder, configHome, globalConfigPath, newAccountId } from '../core/paths';
import { removeAccountFolder } from '../core/safeDelete';
import { seedGlobalConfig, syncSharedSetup } from '../core/share';
import { MAIN_KEY, type AccountView } from '../core/types';
import { WINDOW_ACCOUNT_KEY } from '../core/windowEnv';
import type { AccountsController } from './controller';

type AccountArg = AccountView | string | undefined;

export function registerCommands(context: vscode.ExtensionContext, c: AccountsController): void {
    const reg = (id: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

    const viewFor = (arg: AccountArg): AccountView | undefined => {
        const key = typeof arg === 'string' ? arg : arg?.key;
        return key ? c.views.find((v) => v.key === key) : undefined;
    };

    const usageSummary = (v: AccountView): string => {
        const found = pickUsage(v.entry, Date.now());
        if (!v.signedIn) {
            return 'not signed in';
        }
        if (!found) {
            return v.entry ? statusLabel(v.entry.status) : 'checking…';
        }
        const parts: string[] = [];
        if (found.usage.fiveHour) {
            parts.push(`5h: ${formatWindow(found.usage.fiveHour)}`);
        }
        if (found.usage.sevenDay) {
            parts.push(`7d: ${formatWindow(found.usage.sevenDay)}`);
        }
        return parts.join('   ') + (found.stale ? '   (last known)' : '');
    };

    const pickAccount = async (placeHolder: string, filter: (v: AccountView) => boolean = () => true): Promise<AccountView | undefined> => {
        const items = c.views.filter(filter).map((v) => ({
            label: `${v.isThisWindow ? '$(check) ' : ''}${v.label}`,
            description: v.email && v.email !== v.label ? v.email : undefined,
            detail: usageSummary(v),
            view: v,
        }));
        const pick = await vscode.window.showQuickPick(items, { placeHolder });
        return pick?.view;
    };

    const confirmReload = async (message: string): Promise<boolean> => {
        const config = vscode.workspace.getConfiguration('claudeSwap');
        if (!config.get<boolean>('confirmBeforeReload', true)) {
            return true;
        }
        const reload = 'Reload';
        const always = "Reload, don't ask again";
        const pick = await vscode.window.showInformationMessage(message, { modal: true }, reload, always);
        if (pick === always) {
            await config.update('confirmBeforeReload', false, vscode.ConfigurationTarget.Global);
        }
        return pick === reload || pick === always;
    };

    const switchTo = async (key: string, label: string): Promise<void> => {
        if (key === c.thisWindowKey) {
            return;
        }
        if (!(await confirmReload(`Use "${label}" in this window? The window will reload.`))) {
            return;
        }
        await context.workspaceState.update(WINDOW_ACCOUNT_KEY, key);
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    };

    reg('claudeSwap.switchAccount', async () => {
        type Item = vscode.QuickPickItem & { run: () => unknown };
        const items: Item[] = c.views.map((v) => ({
            label: `${v.isThisWindow ? '$(check) ' : ''}${v.label}`,
            description: v.email && v.email !== v.label ? v.email : undefined,
            detail: [usageSummary(v), v.usedBy.length ? `open in ${v.usedBy.join(', ')}` : ''].filter(Boolean).join('   ·   '),
            run: () => switchTo(v.key, v.label),
        }));
        items.push(
            { label: '', kind: vscode.QuickPickItemKind.Separator, run: () => undefined },
            { label: '$(add) Add account…', run: () => vscode.commands.executeCommand('claudeSwap.addAccount') },
            { label: '$(list-tree) Open accounts panel', run: () => vscode.commands.executeCommand('claudeSwap.openPanel') },
        );
        const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Pick the Claude account for this window' });
        await pick?.run();
    });

    reg('claudeSwap.useInThisWindow', async (arg?: AccountArg) => {
        const v = viewFor(arg) ?? (await pickAccount('Pick the Claude account for this window', (x) => !x.isThisWindow));
        if (v) {
            await switchTo(v.key, v.label);
        }
    });

    reg('claudeSwap.useMainLogin', async () => {
        await switchTo(MAIN_KEY, 'Main login');
    });

    reg('claudeSwap.addAccount', async () => {
        if (!(await confirmReload('Add a new Claude account? This window will reload and Claude will ask you to sign in.'))) {
            return;
        }
        const id = newAccountId();
        const folder = accountFolder(c.root, id);
        try {
            await mkdir(folder, { recursive: true });
            await seedGlobalConfig(globalConfigPath(c.originalConfigDir), globalConfigPath(folder));
            await syncSharedSetup({ mainHome: configHome(c.originalConfigDir), accountHome: folder, platform: process.platform });
            await c.registry.add({ id, folder });
        } catch (e: any) {
            c.log.error(`add account failed: ${e?.code ?? e?.name ?? 'error'}`);
            void vscode.window.showErrorMessage(`Could not add the account: ${e?.message ?? 'unknown error'}`);
            return;
        }
        await context.workspaceState.update(WINDOW_ACCOUNT_KEY, id);
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    });

    reg('claudeSwap.renameAccount', async (arg?: AccountArg) => {
        const v = viewFor(arg) ?? (await pickAccount('Pick an account to rename', (x) => !x.isMain));
        if (!v || v.isMain) {
            return;
        }
        const account = await c.registry.get(v.key);
        const value = await vscode.window.showInputBox({
            prompt: 'Short name for this account (leave empty to show the email)',
            value: account?.alias ?? '',
            validateInput: (s) => (s.length > 30 ? 'Keep it under 30 characters.' : undefined),
        });
        if (value === undefined) {
            return;
        }
        await c.registry.update(v.key, { alias: value.trim() });
        await c.refresh();
    });

    reg('claudeSwap.removeAccount', async (arg?: AccountArg) => {
        const v = viewFor(arg) ?? (await pickAccount('Pick an account to remove', (x) => !x.isMain));
        if (!v || v.isMain) {
            return;
        }
        if (v.usedBy.length) {
            void vscode.window.showWarningMessage(`"${v.label}" is open in: ${v.usedBy.join(', ')}. Switch those windows to another account first.`);
            return;
        }
        const pick = await vscode.window.showWarningMessage(`Remove "${v.label}"? You'll need to sign in again to use it later.`, { modal: true }, 'Remove');
        if (pick !== 'Remove') {
            return;
        }
        const account = await c.registry.get(v.key);
        if (!account) {
            return;
        }
        try {
            if (process.platform === 'darwin') {
                await c.credentials.remove(c.targetFor(account.id, account.folder)).catch((e: any) => c.log.warn(`keychain remove: ${e?.name ?? 'error'}`));
            }
            await removeAccountFolder(c.root, account.folder);
            await c.registry.remove(account.id);
            await c.cache.remove(account.id);
        } catch (e: any) {
            c.log.error(`remove account failed: ${e?.code ?? e?.name ?? 'error'}`);
            void vscode.window.showErrorMessage(`Could not remove the account: ${e?.message ?? 'unknown error'}`);
        }
        await c.refresh();
    });

    reg('claudeSwap.signInAgain', async (arg?: AccountArg) => {
        const v = viewFor(arg);
        if (v && !v.isThisWindow) {
            await switchTo(v.key, v.label);
            return;
        }
        const pick = await vscode.window.showInformationMessage('Type /login in the Claude panel to sign in again.', 'Open Terminal');
        if (pick) {
            const term = vscode.window.createTerminal({ name: 'Claude sign-in' });
            term.show();
            term.sendText('claude');
        }
    });

    reg('claudeSwap.openPanel', () => vscode.commands.executeCommand('workbench.view.extension.claudeSwap'));
}
