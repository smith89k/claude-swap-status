// The status bar item: this window's account and its usage.
import * as vscode from 'vscode';
import { formatAge, formatResetDetail, formatWindow, needsAttention, pickUsage, statusLabel, usageLevel } from '../core/format';
import { accountIcon } from '../core/accountIcons';
import type { AccountView } from '../core/types';

/** The main account wears a crown; other accounts wear their chosen icon, or the usual person icon. */
function icon(view: AccountView): string {
    if (view.isMain) {
        return '👑';
    }
    const chosen = accountIcon(view.icon);
    return chosen ? `$(${chosen.codicon})` : '$(account)';
}

export class StatusBar implements vscode.Disposable {
    private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

    constructor() {
        this.item.command = 'claudeSwap.switchAccount';
        this.item.text = '$(sync~spin) Claude: checking…';
        this.item.tooltip = 'Checking your Claude accounts…';
        this.item.show();
    }

    update(views: AccountView[]): void {
        const view = views.find((v) => v.isThisWindow);
        this.item.backgroundColor = undefined;
        if (!view) {
            this.item.text = '$(account) Claude';
            this.item.tooltip = 'Click to switch accounts.';
            return;
        }

        if (!view.signedIn) {
            this.item.text = `${icon(view)} ${view.label} | not signed in`;
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.item.tooltip = view.isMain
                ? 'Your main account (👑) is not signed in. Sign in from the Claude panel.\nClick to switch accounts.'
                : 'This account is not signed in yet. Sign in from the Claude panel.\nClick to switch accounts.';
            return;
        }

        const now = Date.now();
        const status = view.entry?.status;
        const found = pickUsage(view.entry, now);
        let five = 'N/A';
        let seven = 'N/A';
        const lines = [view.isMain ? 'Main Claude account (👑) for this window' : 'Claude account for this window'];
        if (view.email) {
            lines.push(`Email: ${view.email}`);
        }
        if (view.orgName) {
            lines.push(`Organisation: ${view.orgName}`);
        }
        if (view.entry?.plan) {
            lines.push(`Plan: ${view.entry.plan}`);
        }
        lines.push(`Status: ${statusLabel(status)}`);

        if (found) {
            const u = found.usage;
            if (u.fiveHour) {
                five = formatWindow(u.fiveHour, now);
            }
            if (u.sevenDay) {
                seven = formatWindow(u.sevenDay, now);
            }
            lines.push(formatResetDetail('5h', u.fiveHour, now), formatResetDetail('7d', u.sevenDay, now));
            if (found.stale) {
                lines.push(`Showing last known usage from ${formatAge(found.ageSeconds)} ago.`);
            }
            const level = usageLevel(u);
            if (level === 'error') {
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            } else if (level === 'warning') {
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            }
        } else if (!view.entry) {
            five = seven = 'checking…';
        } else {
            five = seven = statusLabel(status);
        }
        if (!this.item.backgroundColor && needsAttention(status)) {
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        lines.push('Click to switch accounts.');

        this.item.text = `${icon(view)} ${view.label} | 5h: ${five} | 7d: ${seven}${found?.stale ? ' $(history)' : ''}`;
        this.item.tooltip = lines.join('\n');
    }

    dispose(): void {
        this.item.dispose();
    }
}
