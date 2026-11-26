// Usage numbers: a cache shared by all windows, and the decision of what to do
// on each poll (use the cache, fetch, renew an idle login, or keep last known).
import * as path from 'node:path';
import type { CredentialStore } from './credentials';
import { CorruptJsonError, readJson, writeJsonAtomic } from './fsjson';
import { withLock } from './locks';
import type { RefreshResult, UsageResult } from './oauth';
import type { ConfigTarget, OAuthCredential, UsageEntry } from './types';

export const EXPIRY_SKEW_MS = 60_000;
export const DEFAULT_BACKOFF_MS = 300_000;

export class UsageCache {
    private readonly file: string;
    private readonly lockPath: string;

    constructor(root: string) {
        this.file = path.join(root, 'usage.json');
        this.lockPath = path.join(root, 'usage.json.lock');
    }

    async read(): Promise<Record<string, UsageEntry>> {
        try {
            const data = await readJson<Record<string, UsageEntry>>(this.file);
            return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        } catch (e) {
            if (e instanceof CorruptJsonError) {
                return {};
            }
            throw e;
        }
    }

    async get(key: string): Promise<UsageEntry | undefined> {
        return (await this.read())[key];
    }

    async put(key: string, e: UsageEntry): Promise<void> {
        await this.mutate((all) => { all[key] = e; });
    }

    async remove(key: string): Promise<void> {
        await this.mutate((all) => { delete all[key]; });
    }

    private async mutate(change: (all: Record<string, UsageEntry>) => void): Promise<void> {
        await withLock(this.lockPath, { staleMs: 10_000 }, async () => {
            const all = await this.read();
            change(all);
            await writeJsonAtomic(this.file, all);
        });
    }
}

export interface PollDeps {
    cache: UsageCache;
    credentials: CredentialStore;
    fetchUsage(token: string): Promise<UsageResult>;
    refresh(cred: OAuthCredential): Promise<RefreshResult>;
    inUse(): Promise<boolean>;
    withCredentialLocks<T>(configHome: string, fn: () => Promise<T>): Promise<T>;
    withFetchLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
    now(): number;
}

function keepLast(prev: UsageEntry | undefined): Partial<UsageEntry> {
    const out: Partial<UsageEntry> = {};
    if (prev?.lastGood !== undefined) {
        out.lastGood = prev.lastGood;
    }
    if (prev?.lastGoodAt !== undefined) {
        out.lastGoodAt = prev.lastGoodAt;
    }
    return out;
}

function withPlan(entry: UsageEntry, plan: string | undefined): UsageEntry {
    return plan ? { ...entry, plan } : entry;
}

/** Cached entry when it is still fresh or backing off; undefined when a new check is due. */
function stillGood(prev: UsageEntry | undefined, now: number, intervalMs: number): UsageEntry | undefined {
    if (!prev) {
        return undefined;
    }
    if (prev.backoffUntil !== undefined && prev.backoffUntil > now) {
        return prev;
    }
    if (prev.fetchedAt !== undefined && now - prev.fetchedAt < intervalMs) {
        return prev;
    }
    return undefined;
}

function isExpired(cred: OAuthCredential, now: number): boolean {
    return cred.expiresAt === undefined || cred.expiresAt - EXPIRY_SKEW_MS <= now;
}

export async function pollAccount(key: string, target: ConfigTarget, intervalMs: number, deps: PollDeps): Promise<UsageEntry> {
    const now = deps.now();
    const cached = stillGood(await deps.cache.get(key), now, intervalMs);
    if (cached) {
        return cached;
    }
    return deps.withFetchLock(key, async () => {
        const prev = await deps.cache.get(key);
        const again = stillGood(prev, now, intervalMs);
        if (again) {
            return again; // Another window checked while we waited for the lock.
        }
        const entry = await check(prev, target, now, deps);
        await deps.cache.put(key, entry);
        return entry;
    });
}

async function check(prev: UsageEntry | undefined, target: ConfigTarget, now: number, deps: PollDeps): Promise<UsageEntry> {
    const file = await deps.credentials.read(target);
    let cred = file?.claudeAiOauth;
    if (!cred?.accessToken) {
        return { ...keepLast(prev), status: 'no_credentials', fetchedAt: now };
    }
    const plan = cred.subscriptionType;

    if (isExpired(cred, now)) {
        if (await deps.inUse()) {
            // Someone is using this login, so Claude renews it. Renewing here could sign them out.
            return withPlan({ ...keepLast(prev), status: 'token_expired', fetchedAt: now }, plan);
        }
        const renewed = await deps.withCredentialLocks(target.configHome, async (): Promise<{ cred: OAuthCredential } | { entry: UsageEntry }> => {
            const latest = await deps.credentials.read(target);
            const latestCred = latest?.claudeAiOauth;
            if (latestCred?.accessToken && !isExpired(latestCred, now)) {
                return { cred: latestCred }; // Someone renewed it while we waited.
            }
            const r = await deps.refresh(latestCred ?? cred!);
            if (r.ok) {
                await deps.credentials.write(target, { ...(latest ?? file), claudeAiOauth: r.cred });
                return { cred: r.cred };
            }
            const status = r.kind === 'invalid_grant' || r.kind === 'no_refresh_token' ? 'relogin_required' : 'unavailable';
            return { entry: withPlan({ ...keepLast(prev), status, fetchedAt: now }, plan) };
        });
        if ('entry' in renewed) {
            return renewed.entry;
        }
        cred = renewed.cred;
    }

    const r = await deps.fetchUsage(cred.accessToken);
    if (r.ok) {
        return withPlan({ status: 'ok', usage: r.usage, fetchedAt: now, lastGood: r.usage, lastGoodAt: now }, plan);
    }
    if (r.kind === 'unauthorized') {
        return withPlan({ ...keepLast(prev), status: 'token_expired', fetchedAt: now }, plan);
    }
    if (r.kind === 'rate_limited') {
        return withPlan({ ...keepLast(prev), status: 'rate_limited', fetchedAt: now, backoffUntil: now + (r.retryAfterMs ?? DEFAULT_BACKOFF_MS) }, plan);
    }
    return withPlan({ ...keepLast(prev), status: 'unavailable', fetchedAt: now }, plan);
}
