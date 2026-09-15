import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let statusBarItem: vscode.StatusBarItem;
let pollIntervalTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
    // Create the status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'claudeSwap.switchAccount';
    context.subscriptions.push(statusBarItem);

    // Register Commands
    context.subscriptions.push(vscode.commands.registerCommand('claudeSwap.switchAccount', switchAccount));
    context.subscriptions.push(vscode.commands.registerCommand('claudeSwap.addAccount', addAccount));
    context.subscriptions.push(vscode.commands.registerCommand('claudeSwap.refreshStatus', refreshStatusAndBar));

    // Listen for config changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('claudeSwap.pollIntervalMinutes') || e.affectsConfiguration('claudeSwap.cswapExecutablePath')) {
            setupPolling();
        }
    }));

    // Start polling and initial fetch
    setupPolling();
}

function getCswapCommand(): string {
    const config = vscode.workspace.getConfiguration('claudeSwap');
    return config.get<string>('cswapExecutablePath') || 'cswap';
}

function setupPolling() {
    if (pollIntervalTimer) {
        clearInterval(pollIntervalTimer);
        pollIntervalTimer = undefined;
    }

    const config = vscode.workspace.getConfiguration('claudeSwap');
    const minutes = config.get<number>('pollIntervalMinutes') || 5;

    // Do an immediate refresh
    refreshStatusAndBar();

    // Set up the interval
    pollIntervalTimer = setInterval(() => {
        refreshStatusAndBar();
    }, minutes * 60 * 1000);
}

async function fetchCswapData(): Promise<any> {
    const cmd = getCswapCommand();
    try {
        const { stdout } = await execAsync(`${cmd} list --json`);
        const data = JSON.parse(stdout);
        return data;
    } catch (error) {
        console.error('Error executing cswap:', error);
        return null;
    }
}

async function refreshStatusAndBar() {
    const data = await fetchCswapData();
    if (!data || !data.accounts) {
        statusBarItem.text = `$(account) Claude: cswap error`;
        statusBarItem.tooltip = `Failed to read from cswap. Make sure claude-swap is installed and in your PATH.`;
        statusBarItem.show();
        return;
    }

    const activeNum = data.activeAccountNumber;
    const activeAccount = data.accounts.find((a: any) => a.number === activeNum);

    if (activeAccount) {
        // Format: $(account) Claude <num> : <alias> | 5h: 25% | 7d: 16%
        const num = activeAccount.number;
        const nameLabel = activeAccount.alias ? activeAccount.alias : activeAccount.email;
        
        let fiveHourStr = 'N/A';
        let sevenDayStr = 'N/A';
        
        if (activeAccount.usageStatus === 'ok' && activeAccount.usage) {
            if (activeAccount.usage.fiveHour) {
                fiveHourStr = `${Math.round(activeAccount.usage.fiveHour.pct)}%`;
            }
            if (activeAccount.usage.sevenDay) {
                sevenDayStr = `${Math.round(activeAccount.usage.sevenDay.pct)}%`;
            }
        } else if (activeAccount.usageStatus) {
            fiveHourStr = activeAccount.usageStatus;
            sevenDayStr = activeAccount.usageStatus;
        }

        statusBarItem.text = `$(account) Claude ${num} : ${nameLabel} | 5h: ${fiveHourStr} | 7d: ${sevenDayStr}`;
        statusBarItem.tooltip = `Active Claude Code Account\nEmail: ${activeAccount.email}\nStatus: ${activeAccount.usageStatus}\nClick to switch accounts.`;
    } else {
        statusBarItem.text = `$(account) Claude: No Active Account`;
        statusBarItem.tooltip = `No active account selected in cswap. Click to switch or add an account.`;
    }

    statusBarItem.show();
}

async function switchAccount() {
    const data = await fetchCswapData();
    if (!data || !data.accounts || data.accounts.length === 0) {
        vscode.window.showErrorMessage("No Claude accounts found. Please add an account first.");
        return;
    }

    const activeNum = data.activeAccountNumber;

    const quickPickItems: (vscode.QuickPickItem & { accountNum: number })[] = data.accounts.map((acc: any) => {
        const isActive = acc.number === activeNum;
        let desc = acc.email;
        if (acc.usageStatus === 'ok' && acc.usage) {
            const fPct = acc.usage.fiveHour ? Math.round(acc.usage.fiveHour.pct) : '?';
            const sPct = acc.usage.sevenDay ? Math.round(acc.usage.sevenDay.pct) : '?';
            desc += ` (5h: ${fPct}%, 7d: ${sPct}%)`;
        } else {
            desc += ` (${acc.usageStatus})`;
        }

        return {
            label: `${isActive ? '$(check) ' : ''}Account ${acc.number}${acc.alias ? ` (${acc.alias})` : ''}`,
            description: desc,
            accountNum: acc.number
        };
    });

    quickPickItems.push({
        label: `$(add) Add New Account...`,
        description: `Log into a new Claude Code account`,
        accountNum: -1
    });

    const selected = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: 'Select a Claude account to switch to'
    });

    if (selected) {
        if (selected.accountNum === -1) {
            // Add new account
            vscode.commands.executeCommand('claudeSwap.addAccount');
        } else if (selected.accountNum !== activeNum) {
            // Switch account
            const cmd = getCswapCommand();
            try {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Switching to Account ${selected.accountNum}...`,
                    cancellable: false
                }, async () => {
                    await execAsync(`${cmd} switch ${selected.accountNum}`);
                });
                vscode.window.showInformationMessage(`Successfully switched to Claude Account ${selected.accountNum}.`);
                refreshStatusAndBar();
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to switch account: ${error.message}`);
            }
        }
    }
}

function addAccount() {
    const term = vscode.window.createTerminal('Claude Swap');
    const cmd = getCswapCommand();
    term.show();
    term.sendText(`${cmd} add`);
}

export function deactivate() {
    if (pollIntervalTimer) {
        clearInterval(pollIntervalTimer);
    }
}
