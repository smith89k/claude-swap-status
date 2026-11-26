// Which windows are open and which account each one uses, plus "is this account in use".
import { readdir, stat, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import { readJson, writeJsonAtomic } from './fsjson';
import type { WindowBeat } from './types';

export const HEARTBEAT_STALE_MS = 90_000;
const REFRESH_LOCK_FRESH_MS = 60_000;

export function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e: any) {
        return e?.code === 'EPERM';
    }
}

export class WindowRegistry {
    private readonly dir: string;

    constructor(
        root: string,
        private readonly now: () => number = Date.now,
        private readonly isAlive: (pid: number) => boolean = isPidAlive,
    ) {
        this.dir = path.join(root, 'windows');
    }

    async beat(b: Omit<WindowBeat, 'updatedAt'>): Promise<void> {
        const beat: WindowBeat = { ...b, updatedAt: this.now() };
        await writeJsonAtomic(this.fileFor(b.windowId), beat);
    }

    async remove(windowId: string): Promise<void> {
        await unlink(this.fileFor(windowId)).catch(() => undefined);
    }

    /** Beats that are recent and whose process is still running. Dead ones are cleaned up. */
    async live(): Promise<WindowBeat[]> {
        let names: string[];
        try {
            names = await readdir(this.dir);
        } catch {
            return [];
        }
        const out: WindowBeat[] = [];
        for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
            const file = path.join(this.dir, name);
            let beat: WindowBeat | undefined;
            try {
                beat = await readJson<WindowBeat>(file);
            } catch {
                beat = undefined;
            }
            const fresh = !!beat && typeof beat.updatedAt === 'number' && this.now() - beat.updatedAt <= HEARTBEAT_STALE_MS;
            if (beat && fresh && this.isAlive(beat.pid)) {
                out.push(beat);
            } else {
                await unlink(file).catch(() => undefined);
            }
        }
        return out;
    }

    private fileFor(windowId: string): string {
        return path.join(this.dir, `${windowId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
    }
}

/**
 * An account is in use when an open window uses it, a running Claude session lives in
 * its folder, or Claude is renewing its login right now. Renewing an in-use login could
 * sign that user out, so the poller never renews one.
 */
export async function isAccountInUse(a: {
    accountKey: string;
    configHome: string;
    liveWindows: WindowBeat[];
    isAlive?: (pid: number) => boolean;
    now?: () => number;
}): Promise<boolean> {
    const isAlive = a.isAlive ?? isPidAlive;
    const now = a.now ?? Date.now;
    if (a.liveWindows.some((w) => w.accountKey === a.accountKey)) {
        return true;
    }
    const sessionsDir = path.join(a.configHome, 'sessions');
    let names: string[] = [];
    try {
        names = await readdir(sessionsDir);
    } catch {
        names = [];
    }
    for (const name of names.filter((n) => n.endsWith('.json'))) {
        try {
            const s = await readJson<{ pid?: unknown }>(path.join(sessionsDir, name));
            if (typeof s?.pid === 'number' && isAlive(s.pid)) {
                return true;
            }
        } catch {
            // Unreadable session file: ignore it.
        }
    }
    try {
        const st = await stat(path.join(a.configHome, '.oauth_refresh.lock'));
        if (now() - st.mtimeMs <= REFRESH_LOCK_FRESH_MS) {
            return true;
        }
    } catch {
        // No lock.
    }
    return false;
}
