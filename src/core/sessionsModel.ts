// Works out where each running session is (this window, another window, the
// Claude app, or outside the editor) and builds the Sessions tab's content.
import { accountIcon } from './accountIcons';
import { formatAge } from './format';
import type { PastSession } from './pastSessions';
import type { RunningSession, SessionKind, SessionStatus } from './sessions';
import type { AccountView, WindowBeat } from './types';

export type SessionPlace =
    | { where: 'thisWindow' }
    | { where: 'otherWindow'; windowId: string; openTarget: string }
    | { where: 'app' }
    | { where: 'outside' };

/** A running session's status, or `finished` for a saved conversation that no longer runs. */
export type RowStatus = SessionStatus | 'finished';

export interface SessionRow {
    sessionId: string;
    /** 0 for a finished session. */
    pid: number;
    kind: SessionKind;
    status: RowStatus;
    title: string;
    subtitle: string;
    accountName: string;
    isMain: boolean;
    /** The drawing of the account's icon, for an added account that has one. */
    accountIcon?: string;
    whereText: string;
    ageText: string;
    canJump: boolean;
    note?: string;
}

export interface SessionGroup {
    status: RowStatus;
    heading: string;
    rows: SessionRow[];
}

export interface SessionsModel {
    /** How many sessions are running (the tab's badge). */
    count: number;
    groups: SessionGroup[];
    /** Finished sessions from the last 30 days, grouped by day, newest first. */
    past: SessionGroup[];
}

export const NOTE_APP = 'This session runs in the Claude app.';
export const NOTE_OUTSIDE_TERMINAL = 'This session runs in a terminal outside the editor.';
export const NOTE_UNREACHABLE_WINDOW = "This session runs in a window that can't be reached. Reload that window, then try again.";

export const NOTE_PAST_APP = 'This conversation was in the Claude app. Reopen it there.';
export const notePastAccount = (account: string) => `This conversation belongs to ${account}. Switch this window to ${account} to reopen it.`;
export const notePastFolder = (folder: string) => `This conversation is from the ${folder} folder. Open that folder to reopen it.`;

const NAME_LIMIT = 60;
const GROUPS: { status: SessionStatus; heading: string }[] = [
    { status: 'waiting', heading: 'Waiting for you' },
    { status: 'working', heading: 'Working' },
    { status: 'idle', heading: 'Idle' },
];

function norm(p: string, platform: NodeJS.Platform): string {
    if (platform === 'win32') {
        return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    }
    return p.replace(/\/+$/, '');
}

export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
    return norm(a, platform) === norm(b, platform);
}

/** True when `child` is `folder` itself or somewhere inside it. */
export function isUnder(child: string, folder: string, platform: NodeJS.Platform = process.platform): boolean {
    const c = norm(child, platform);
    const f = norm(folder, platform);
    const sep = platform === 'win32' ? '\\' : '/';
    return c === f || c.startsWith(f + sep);
}

export function locate(s: RunningSession, liveWindows: WindowBeat[], thisWindowId: string, platform: NodeJS.Platform = process.platform): SessionPlace {
    if (s.kind === 'app') {
        return { where: 'app' };
    }
    let best: { window: WindowBeat; length: number } | undefined;
    for (const w of liveWindows) {
        for (const folder of w.folders ?? []) {
            if (isUnder(s.cwd, folder, platform) && (!best || folder.length > best.length)) {
                best = { window: w, length: folder.length };
            }
        }
    }
    if (!best) {
        return { where: 'outside' };
    }
    if (best.window.windowId === thisWindowId) {
        return { where: 'thisWindow' };
    }
    // Only the window's own openTarget is safe to open: falling back to one of its folders
    // would open a NEW window for an unsaved multi-folder workspace.
    const openTarget = best.window.openTarget;
    return openTarget ? { where: 'otherWindow', windowId: best.window.windowId, openTarget } : { where: 'outside' };
}

function lastSegment(p: string): string {
    const parts = p.split(/[\\/]+/).filter(Boolean);
    return parts[parts.length - 1] ?? p;
}

function cut(text: string): string {
    return text.length > NAME_LIMIT ? text.slice(0, NAME_LIMIT - 1) + '…' : text;
}

function where(kind: SessionKind, place: SessionPlace): { whereText: string; canJump: boolean; note?: string } {
    const what = kind === 'ide' ? 'Claude tab' : 'terminal';
    switch (place.where) {
        case 'thisWindow':
            return { whereText: `${what} · this window`, canJump: true };
        case 'otherWindow':
            return { whereText: `${what} · other window`, canJump: true };
        case 'app':
            return { whereText: 'Claude app', canJump: false, note: NOTE_APP };
        default:
            return { whereText: 'outside the editor', canJump: false, note: kind === 'ide' ? NOTE_UNREACHABLE_WINDOW : NOTE_OUTSIDE_TERMINAL };
    }
}

export function toSessionsModel(
    sessions: RunningSession[],
    liveWindows: WindowBeat[],
    accounts: AccountView[],
    thisWindowId: string,
    now: number,
    platform: NodeJS.Platform = process.platform,
): SessionsModel {
    const groups: SessionGroup[] = [];
    for (const g of GROUPS) {
        const rows = sessions
            .filter((s) => s.status === g.status)
            .sort((a, b) => a.since - b.since)
            .map((s): SessionRow => {
                const title = lastSegment(s.cwd);
                const account = accounts.find((v) => v.key === s.accountKey);
                const w = where(s.kind, locate(s, liveWindows, thisWindowId, platform));
                const row: SessionRow = {
                    sessionId: s.sessionId,
                    pid: s.pid,
                    kind: s.kind,
                    status: s.status,
                    title,
                    subtitle: s.name === title ? '' : cut(s.name),
                    accountName: account?.label ?? s.accountKey,
                    isMain: account?.isMain ?? false,
                    whereText: w.whereText,
                    ageText: formatAge(Math.max(0, Math.round((now - s.since) / 1000))),
                    canJump: w.canJump,
                };
                if (w.note) {
                    row.note = w.note;
                }
                withIcon(row, account);
                return row;
            });
        if (rows.length) {
            groups.push({ status: g.status, heading: g.heading, rows });
        }
    }
    return { count: sessions.length, groups, past: [] };
}

function withIcon(row: SessionRow, account: AccountView | undefined): void {
    const icon = account && !account.isMain ? accountIcon(account.icon) : undefined;
    if (icon) {
        row.accountIcon = icon.svg;
    }
}

const DAY_GROUPS = ['Today', 'Yesterday', 'Earlier this week', 'Older'];

function dayGroup(at: number, now: number): number {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const start = midnight.getTime();
    if (at >= start) {
        return 0;
    }
    const days = Math.ceil((start - at) / (24 * 60 * 60 * 1000));
    return days <= 1 ? 1 : days <= 6 ? 2 : 3;
}

export interface PastContext {
    /** The ids of sessions that are running: those are listed above, not here. */
    runningIds: Set<string>;
    accounts: AccountView[];
    /** The account this window uses. */
    thisAccountKey: string | undefined;
    /** The folders open in this window. */
    thisFolders: string[];
    now: number;
    platform?: NodeJS.Platform;
}

/** Whether a finished conversation can be reopened in this window, and if not, why. */
export function canReopen(p: PastSession, accountName: string, ctx: PastContext): { canJump: boolean; note?: string } {
    const platform = ctx.platform ?? process.platform;
    if (p.kind === 'app') {
        return { canJump: false, note: NOTE_PAST_APP };
    }
    if (p.accountKey !== ctx.thisAccountKey) {
        return { canJump: false, note: notePastAccount(accountName) };
    }
    // Claude resumes a conversation in the window's own folder, so it must be one of them.
    if (!ctx.thisFolders.some((f) => samePath(p.cwd, f, platform))) {
        return { canJump: false, note: notePastFolder(lastSegment(p.cwd)) };
    }
    return { canJump: true };
}

export function toPastGroups(past: PastSession[], ctx: PastContext): SessionGroup[] {
    const buckets: SessionRow[][] = DAY_GROUPS.map(() => []);
    const sorted = past.filter((p) => !ctx.runningIds.has(p.sessionId)).sort((a, b) => b.lastActive - a.lastActive);
    for (const p of sorted) {
        const account = ctx.accounts.find((v) => v.key === p.accountKey);
        const accountName = account?.label ?? p.accountKey;
        const folder = lastSegment(p.cwd);
        const r = canReopen(p, accountName, ctx);
        const row: SessionRow = {
            sessionId: p.sessionId,
            pid: 0,
            kind: p.kind,
            status: 'finished',
            title: cut(p.title),
            subtitle: p.title === folder ? '' : folder,
            accountName,
            isMain: account?.isMain ?? false,
            whereText: p.kind === 'app' ? 'Claude app' : p.kind === 'ide' ? 'Claude tab' : 'terminal',
            ageText: formatAge(Math.max(0, Math.round((ctx.now - p.lastActive) / 1000))) + ' ago',
            canJump: r.canJump,
        };
        if (r.note) {
            row.note = r.note;
        }
        withIcon(row, account);
        buckets[dayGroup(p.lastActive, ctx.now)].push(row);
    }
    return DAY_GROUPS.map((heading, i) => ({ status: 'finished' as const, heading, rows: buckets[i] })).filter((g) => g.rows.length);
}
