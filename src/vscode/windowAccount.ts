// Runs first on activation: decides this window's Claude account and exports its
// folder as CLAUDE_CONFIG_DIR, before the Claude Code extension starts in this window.
import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { syncMcpServers, syncSharedSetup } from '../core/share';
import { configHome, globalConfigPath } from '../core/paths';
import type { Registry } from '../core/registry';
import { MAIN_KEY } from '../core/types';
import { findConfigDirOverride, resolveWindowEnv, WINDOW_ACCOUNT_KEY } from '../core/windowEnv';

const CLAUDE_EXTENSION_ID = 'anthropic.claude-code';
const RELOAD_PROMPT_KEY = 'claudeSwap.lastReloadPrompt';
const RELOAD_PROMPT_GAP_MS = 120_000;

export async function applyWindowAccount(
    context: vscode.ExtensionContext,
    originalConfigDir: string | undefined,
    registry: Registry,
    log: vscode.LogOutputChannel,
): Promise<{ key: string; configDir: string | undefined }> {
    const choice = context.workspaceState.get<string>(WINDOW_ACCOUNT_KEY);
    const resolved = resolveWindowEnv({ choice, accounts: await registry.list(), folderExists: existsSync, originalConfigDir });

    if (resolved.warning) {
        await context.workspaceState.update(WINDOW_ACCOUNT_KEY, MAIN_KEY);
        void vscode.window.showWarningMessage(resolved.warning);
    }

    if (resolved.key !== MAIN_KEY && resolved.configDir) {
        try {
            await syncSharedSetup({ mainHome: configHome(originalConfigDir), accountHome: resolved.configDir, platform: process.platform });
            await syncMcpServers(globalConfigPath(originalConfigDir), globalConfigPath(resolved.configDir));
        } catch (e: any) {
            // Sharing your setup is a nice-to-have; the account itself still works.
            log.warn(`Could not share your Claude setup with this account: ${e?.code ?? e?.name ?? 'error'}`);
        }
    }

    const terminalEnv = context.environmentVariableCollection;
    if (resolved.configDir) {
        process.env.CLAUDE_CONFIG_DIR = resolved.configDir;
        terminalEnv.replace('CLAUDE_CONFIG_DIR', resolved.configDir);
    } else {
        delete process.env.CLAUDE_CONFIG_DIR;
        terminalEnv.delete('CLAUDE_CONFIG_DIR');
    }
    terminalEnv.description = "Gives Claude in this window's terminals the same account as this window.";

    const claudeSettings = vscode.workspace.getConfiguration('claudeCode').get('environmentVariables');
    if (findConfigDirOverride(claudeSettings)) {
        void vscode.window.showWarningMessage(
            "Your Claude settings set CLAUDE_CONFIG_DIR for every window, so each window can't have its own account. Remove it from claudeCode.environmentVariables.",
            'Open Settings',
        ).then((pick) => {
            if (pick) {
                void vscode.commands.executeCommand('workbench.action.openSettings', 'claudeCode.environmentVariables');
            }
        });
    }

    const claude = vscode.extensions.getExtension(CLAUDE_EXTENSION_ID);
    if (claude?.isActive && resolved.configDir !== originalConfigDir) {
        const last = context.workspaceState.get<number>(RELOAD_PROMPT_KEY) ?? 0;
        if (Date.now() - last > RELOAD_PROMPT_GAP_MS) {
            await context.workspaceState.update(RELOAD_PROMPT_KEY, Date.now());
            void vscode.window.showInformationMessage("Reload this window so Claude uses this window's account.", 'Reload').then((pick) => {
                if (pick) {
                    void vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        }
    }

    return { key: resolved.key, configDir: resolved.configDir };
}
