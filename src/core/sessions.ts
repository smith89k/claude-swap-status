// Reads the small status file every running Claude session writes in
// <config folder>/sessions/<pid>.json. Read only: nothing here writes there.
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { readJson } from './fsjson';
import { isPidAlive } from './windows';

export type SessionKind = 'ide' | 'terminal' | 'app';
export type SessionStatus = 'waiting' | 'working' | 'idle';

export interface RunningSession {
    pid: number;
    sessionId: string;
    cwd: string;
    name: string;
    kind: SessionKind;
    status: SessionStatus;
    /** When the session entered its current status (ms). */
    since: number;
    /** "main" or the account id whose config folder the session lives in. */
    accountKey: string;
}

export interface SessionSource {
    accountKey: string;
    configHome: string;
}

function kindOf(entrypoint: unknown): SessionKind {
    if (entrypoint === 'claude-vscode') {
        return 'ide';
    }
    if (entrypoint === 'claude-desktop') {
        return 'app';
    }
    return 'terminal';
}

function statusOf(status: unknown): SessionStatus {
    if (status === 'waiting') {
        return 'waiting';
    }
    if (status === 'busy' || status === 'shell') {
        return 'working';
    }
    return 'idle';
}

function lastSegment(p: string): string {
    const parts = p.split(/[\\/]+/).filter(Boolean);
    return parts[parts.length - 1] ?? p;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export async function listSessions(sources: SessionSource[], isAlive: (pid: number) => boolean = isPidAlive): Promise<RunningSession[]> {
    const out: RunningSession[] = [];
    for (const src of sources) {
        const dir = path.join(src.configHome, 'sessions');
        let names: string[];
        try {
            names = await readdir(dir);
        } catch {
            continue;
        }
        for (const name of names) {
            if (!name.endsWith('.json')) {
                continue;
            }
            let raw: any;
            try {
                raw = await readJson<any>(path.join(dir, name));
            } catch {
                continue; // Being written right now, or broken: skip it.
            }
            if (!raw || typeof raw.pid !== 'number' || typeof raw.sessionId !== 'string' || typeof raw.cwd !== 'string') {
                continue;
            }
            if (!isAlive(raw.pid)) {
                continue;
            }
            out.push({
                pid: raw.pid,
                sessionId: raw.sessionId,
                cwd: raw.cwd,
                name: typeof raw.name === 'string' && raw.name ? raw.name : lastSegment(raw.cwd),
                kind: kindOf(raw.entrypoint),
                status: statusOf(raw.status),
                since: num(raw.statusUpdatedAt) ?? num(raw.updatedAt) ?? num(raw.startedAt) ?? 0,
                accountKey: src.accountKey,
            });
        }
    }
    return out;
}
