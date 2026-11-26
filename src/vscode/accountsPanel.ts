// The Claude Accounts side panel (a webview in the Primary Side Bar).
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { toPanelModel } from '../core/panelModel';
import type { AccountsController } from './controller';

const ACTION_COMMANDS: Record<string, string> = {
    use: 'claudeSwap.useInThisWindow',
    signIn: 'claudeSwap.signInAgain',
    signInAgain: 'claudeSwap.signInAgain',
    rename: 'claudeSwap.renameAccount',
    remove: 'claudeSwap.removeAccount',
    add: 'claudeSwap.addAccount',
    refresh: 'claudeSwap.refreshStatus',
};

export class AccountsPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    static readonly viewType = 'claudeSwap.accounts';
    private view: vscode.WebviewView | undefined;
    private readonly subscription: vscode.Disposable;

    constructor(private readonly extensionUri: vscode.Uri, private readonly controller: AccountsController) {
        this.subscription = controller.onDidChange(() => this.post());
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        const media = vscode.Uri.joinPath(this.extensionUri, 'media');
        view.webview.options = { enableScripts: true, localResourceRoots: [media] };
        view.webview.html = this.html(view.webview, media);
        view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
        view.onDidChangeVisibility(() => {
            if (view.visible) {
                this.post();
            }
        });
        view.onDidDispose(() => {
            this.view = undefined;
        });
    }

    private post(): void {
        if (!this.view || !this.controller.loaded) {
            return;
        }
        void this.view.webview.postMessage({ type: 'state', model: toPanelModel(this.controller.views, Date.now()) });
    }

    private onMessage(msg: unknown): void {
        if (!msg || typeof msg !== 'object') {
            return;
        }
        const m = msg as { type?: unknown; action?: unknown; key?: unknown };
        if (m.type === 'ready') {
            this.post();
            return;
        }
        if (m.type !== 'action' || typeof m.action !== 'string' || !(m.action in ACTION_COMMANDS)) {
            return;
        }
        const key = typeof m.key === 'string' ? m.key : undefined;
        void vscode.commands.executeCommand(ACTION_COMMANDS[m.action], key);
    }

    private html(webview: vscode.Webview, media: vscode.Uri): string {
        const nonce = randomBytes(16).toString('base64');
        const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.css'));
        const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.js'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>Claude Accounts</title>
</head>
<body>
<main id="app"><p class="loading">Checking your Claude accounts…</p></main>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
    }

    dispose(): void {
        this.subscription.dispose();
    }
}
