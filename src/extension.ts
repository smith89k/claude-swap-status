import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let statusBarItem: vscode.StatusBarItem;
let pollIntervalTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
    // Create the status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
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

function getProgressBar(pct: number): string {
    const totalBars = 5;
    const filled = Math.max(0, Math.min(totalBars, Math.round((pct / 100) * totalBars)));
    return '█'.repeat(filled) + '░'.repeat(totalBars - filled);
}

// Compact time-until-reset, e.g. "1d23h", "4h26m", "4m" (a zero second unit is dropped: "4d", "3h").
// Computed from resetsAt so it stays current between polls.
function formatResetIn(resetsAt?: string): string | null {
    if (!resetsAt) {
        return null;
    }
    const ms = new Date(resetsAt).getTime() - Date.now();
    if (isNaN(ms)) {
        return null;
    }
    const minutes = Math.max(0, Math.floor(ms / 60000));
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    const mins = minutes % 60;
    if (days > 0) {
        return `${days}d${hours > 0 ? `${hours}h` : ''}`;
    }
    if (hours > 0) {
        return `${hours}h${mins > 0 ? `${mins}m` : ''}`;
    }
    return `${mins}m`;
}

function formatWindow(window: any): string {
    const resetIn = formatResetIn(window.resetsAt);
    return `${getProgressBar(window.pct)} ${Math.round(window.pct)}%${resetIn ? ` R:${resetIn}` : ''}`;
}

function formatResetDetail(label: string, window: any): string {
    if (!window || !window.resetsAt) {
        return `${label}: no reset scheduled`;
    }
    const when = window.clock ? ` at ${window.clock}` : '';
    const resetIn = formatResetIn(window.resetsAt);
    return `${label} resets${when}${resetIn ? ` (in ${resetIn})` : ''}`;
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
    const minutes = Math.max(0.5, config.get<number>('pollIntervalMinutes') || 1);

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
    
    // Reset background color by default
    statusBarItem.backgroundColor = undefined;

    if (!data || !data.accounts) {
        statusBarItem.text = `$(account) Claude: cswap error`;
        statusBarItem.tooltip = `Failed to read from cswap. Make sure claude-swap is installed and in your PATH.`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        statusBarItem.show();
        return;
    }

    const activeNum = data.activeAccountNumber;
    const activeAccount = data.accounts.find((a: any) => a.number === activeNum);

    if (activeAccount) {
        // Format: $(account) Claude <num>: <alias> | 5h: █░░░░ 25% R:3h | 7d: █░░░░ 16% R:1d
        const num = activeAccount.number;
        const nameLabel = activeAccount.alias ? activeAccount.alias : activeAccount.email;
        
        let fiveHourStr = 'N/A';
        let sevenDayStr = 'N/A';
        
        let resetLines = '';

        if (activeAccount.usageStatus === 'ok' && activeAccount.usage) {
            resetLines = `\n${formatResetDetail('5h', activeAccount.usage.fiveHour)}\n${formatResetDetail('7d', activeAccount.usage.sevenDay)}`;

            if (activeAccount.usage.fiveHour) {
                const pct = activeAccount.usage.fiveHour.pct;
                fiveHourStr = formatWindow(activeAccount.usage.fiveHour);
                
                if (pct >= 85) {
                    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                } else if (pct >= 70) {
                    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                }
            }
            if (activeAccount.usage.sevenDay) {
                const pct = activeAccount.usage.sevenDay.pct;
                sevenDayStr = formatWindow(activeAccount.usage.sevenDay);
                
                if (pct >= 85) {
                    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                } else if (pct >= 70 && statusBarItem.backgroundColor === undefined) {
                    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                }
            }
        } else if (activeAccount.usageStatus) {
            fiveHourStr = activeAccount.usageStatus;
            sevenDayStr = activeAccount.usageStatus;
            
            if (activeAccount.usageStatus !== 'ok') {
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            }
        }

        statusBarItem.text = `$(account) Claude ${num}: ${nameLabel} | 5h: ${fiveHourStr} | 7d: ${sevenDayStr}`;
        statusBarItem.tooltip = `Active Claude Code Account\nEmail: ${activeAccount.email}\nStatus: ${activeAccount.usageStatus}${resetLines}\nClick to switch accounts.`;
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
            const fPctStr = acc.usage.fiveHour ? formatWindow(acc.usage.fiveHour) : '?';
            const sPctStr = acc.usage.sevenDay ? formatWindow(acc.usage.sevenDay) : '?';
            
            desc += ` (5h: ${fPctStr}, 7d: ${sPctStr})`;
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
