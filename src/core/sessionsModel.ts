// Works out where each running session is (this window, another window, the
// Claude app, or outside the editor) and builds the Sessions tab's content.
import { formatAge } from './format';
import type { RunningSession, SessionKind, SessionStatus } from './sessions';
import type { AccountView, WindowBeat } from './types';

export type SessionPlace =
    | { where: 'thisWindow' }
    | { where: 'otherWindow'; windowId: string; openTarget: string }
    | { where: 'app' }
    | { where: 'outside' };

export interface SessionRow {
    sessionId: string;
    pid: number;
    kind: SessionKind;
    status: SessionStatus;
    title: string;
    subtitle: string;
    accountName: string;
    isMain: boolean;
    whereText: string;
    ageText: string;
    canJump: boolean;
    note?: string;
}

export interface SessionGroup {
    status: SessionStatus;
    heading: string;
    rows: SessionRow[];
}

export interface SessionsModel {
    count: number;
    groups: SessionGroup[];
}

export const NOTE_APP = 'This session runs in the Claude app.';
export const NOTE_OUTSIDE_TERMINAL = 'This session runs in a terminal outside the editor.';
export const NOTE_UNREACHABLE_WINDOW = "This session runs in a window that can't be reached. Reload that window, then try again.";

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
    const openTarget = best.window.openTarget ?? best.window.folders?.[0];
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
                return row;
            });
        if (rows.length) {
            groups.push({ status: g.status, heading: g.heading, rows });
        }
    }
    return { count: sessions.length, groups };
}
