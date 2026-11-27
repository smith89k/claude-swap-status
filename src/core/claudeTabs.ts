// Finding a conversation's Claude tab. The Claude extension has no "close this conversation"
// command and doesn't say which tab holds which conversation, so the window asks it to show
// the conversation (`claude-vscode.editor.open`) and compares the tabs before and after.
// The tab label rules below mirror the Claude extension's own.

export interface TabInfo {
    /** Stable for the moment of one comparison: group column, position and label. */
    key: string;
    label: string;
    isClaude: boolean;
}

export interface TabSnapshot {
    tabs: TabInfo[];
    activeKey?: string;
}

/** Claude's tab label for a conversation title: "Claude Code" without one, cut to 24 characters plus "…" past 25. */
export function tabLabelFor(title: string | undefined): string {
    if (!title) {
        return 'Claude Code';
    }
    return title.length > 25 ? title.substring(0, 24) + '…' : title;
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** True when a tab label shows this title (a cut label matches the titles it is the start of). */
export function labelMatches(label: string, title: string | undefined): boolean {
    const l = tidy(label);
    const t = tidy(title ?? '');
    if (!l || !t) {
        return false;
    }
    if (l.endsWith('…')) {
        const start = l.slice(0, -1);
        return start !== '' && t !== start && t.startsWith(start);
    }
    return l === t;
}

export type TabPick = { kind: 'new'; key: string } | { kind: 'existing'; key: string } | { kind: 'none' };

/**
 * What showing the conversation did. `new`: it wasn't in a tab here, so a new one was made.
 * `existing`: its tab came forward (or was already in front and its label shows the title,
 * with no other running conversation of the same title). `none`: nothing to act on.
 */
export function pickTab(before: TabSnapshot, after: TabSnapshot, title: string | undefined, otherTitles: string[]): TabPick {
    const active = after.tabs.find((t) => t.key === after.activeKey);
    if (!active?.isClaude) {
        return { kind: 'none' };
    }
    const count = (s: TabSnapshot) => s.tabs.filter((t) => t.isClaude).length;
    if (count(after) > count(before)) {
        return { kind: 'new', key: active.key };
    }
    if (active.key !== before.activeKey) {
        return { kind: 'existing', key: active.key };
    }
    if (labelMatches(active.label, title) && !otherTitles.some((o) => labelMatches(active.label, o))) {
        return { kind: 'existing', key: active.key };
    }
    return { kind: 'none' };
}
