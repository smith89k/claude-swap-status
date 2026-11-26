// Deleting the account this window uses happens in two steps: the window switches to
// Claude 1 and reloads, then this finishes the delete once nothing uses the account.
import * as vscode from 'vscode';
import type { RemoveResult } from '../core/removeAccount';

export const PENDING_REMOVE_KEY = 'claudeSwap.pendingRemove';

export interface PendingRemove {
    id: string;
    label: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function finishPendingRemoval(
    state: vscode.Memento,
    run: (id: string) => Promise<RemoveResult>,
    opts: { tries: number; delayMs: number } = { tries: 6, delayMs: 2_000 },
): Promise<void> {
    const pending = state.get<PendingRemove>(PENDING_REMOVE_KEY);
    if (!pending || typeof pending.id !== 'string') {
        return;
    }
    // Clear it first, so a failure here can never repeat on every start.
    await state.update(PENDING_REMOVE_KEY, undefined);

    for (let i = 0; i < opts.tries; i++) {
        const r = await run(pending.id);
        if (r === 'removed') {
            void vscode.window.showInformationMessage(`Deleted "${pending.label}".`);
            return;
        }
        if (r === 'missing') {
            return;
        }
        if (i < opts.tries - 1) {
            await sleep(opts.delayMs);
        }
    }
    void vscode.window.showWarningMessage(
        `Couldn't delete "${pending.label}" yet because Claude is still using it. Try again from the Claude Accounts panel in a moment.`,
    );
}
