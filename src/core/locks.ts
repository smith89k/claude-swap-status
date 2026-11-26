// Directory locks compatible with the npm "proper-lockfile" package that Claude
// Code uses: the lock is a directory, mkdir is the mutex, a holder touches the
// directory's mtime while it holds it, and an old enough lock counts as stale.
import { mkdir, rmdir, stat, utimes } from 'node:fs/promises';
import * as path from 'node:path';
import { configLockPath, credentialLockPaths } from './paths';

export const CREDENTIAL_STALE_MS = 60_000;
export const CONFIG_STALE_MS = 10_000;
export const TOUCH_MS = 3_000;
export const WAIT_MS = 9_000;

export interface LockOptions {
    staleMs: number;
    touchMs?: number;
    waitMs?: number;
}

export class LockTimeoutError extends Error {
    constructor(lockPath: string) {
        super(`Timed out waiting for lock ${path.basename(lockPath)}`);
        this.name = 'LockTimeoutError';
    }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Takes the lock and returns a function that releases it. */
export async function acquireLock(lockPath: string, opts: LockOptions): Promise<() => Promise<void>> {
    const deadline = Date.now() + (opts.waitMs ?? WAIT_MS);
    await mkdir(path.dirname(lockPath), { recursive: true });
    for (;;) {
        try {
            await mkdir(lockPath);
            break;
        } catch (e: any) {
            if (e?.code !== 'EEXIST') {
                throw e;
            }
        }
        let stale = false;
        try {
            const st = await stat(lockPath);
            stale = Date.now() - st.mtimeMs > opts.staleMs;
        } catch (e: any) {
            if (e?.code === 'ENOENT') {
                continue; // Released between our mkdir and stat: try again now.
            }
            throw e;
        }
        if (stale) {
            await rmdir(lockPath).catch(() => undefined);
            continue;
        }
        if (Date.now() >= deadline) {
            throw new LockTimeoutError(lockPath);
        }
        await sleep(100 + Math.random() * 150);
    }

    const timer = setInterval(() => {
        const now = new Date();
        utimes(lockPath, now, now).catch(() => undefined);
    }, opts.touchMs ?? TOUCH_MS);
    timer.unref();

    let released = false;
    return async () => {
        if (released) {
            return;
        }
        released = true;
        clearInterval(timer);
        await rmdir(lockPath).catch((e: any) => {
            if (e?.code !== 'ENOENT') {
                throw e;
            }
        });
    };
}

export async function withLock<T>(lockPath: string, opts: LockOptions, fn: () => Promise<T>): Promise<T> {
    const release = await acquireLock(lockPath, opts);
    try {
        return await fn();
    } finally {
        await release();
    }
}

/** Claude's two credential-refresh locks, taken in Claude's order and released in reverse. */
export async function withCredentialLocks<T>(home: string, fn: () => Promise<T>): Promise<T> {
    const [primary, legacy] = credentialLockPaths(home);
    return withLock(primary, { staleMs: CREDENTIAL_STALE_MS }, () =>
        withLock(legacy, { staleMs: CREDENTIAL_STALE_MS }, fn));
}

/** Claude's lock for writes to its global config file. */
export async function withConfigLock<T>(globalConfig: string, fn: () => Promise<T>): Promise<T> {
    return withLock(configLockPath(globalConfig), { staleMs: CONFIG_STALE_MS }, fn);
}
