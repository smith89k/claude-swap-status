// The two HTTP calls this extension makes. Both are unofficial Claude endpoints,
// so every URL, header and the client id live here and nowhere else.
import type { OAuthCredential, Usage, UsageWindow } from './types';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
export const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const BETA_HEADER = 'oauth-2025-04-20';
const USER_AGENT = 'claude-swap-status';
const TIMEOUT_MS = 5_000;

export type FetchLike = (url: string, init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}) => Promise<{ status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;

export type UsageResult =
    | { ok: true; usage: Usage }
    | { ok: false; kind: 'unauthorized' | 'rate_limited' | 'network' | 'bad_response'; retryAfterMs?: number };

export type RefreshResult =
    | { ok: true; cred: OAuthCredential }
    | { ok: false; kind: 'invalid_grant' | 'no_refresh_token' | 'network' | 'bad_response' };

const defaultFetch: FetchLike = (url, init) => (globalThis as any).fetch(url, init);

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        return await fn(controller.signal);
    } finally {
        clearTimeout(timer);
    }
}

function toWindow(raw: any): UsageWindow | undefined {
    if (!raw || typeof raw.utilization !== 'number') {
        return undefined;
    }
    const w: UsageWindow = { pct: raw.utilization };
    if (typeof raw.resets_at === 'string' && raw.resets_at) {
        w.resetsAt = raw.resets_at;
    }
    return w;
}

export async function fetchUsage(accessToken: string, fetchImpl: FetchLike = defaultFetch): Promise<UsageResult> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
        res = await withTimeout((signal) => fetchImpl(USAGE_URL, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'anthropic-beta': BETA_HEADER, 'User-Agent': USER_AGENT },
            signal,
        }));
    } catch {
        return { ok: false, kind: 'network' };
    }
    if (res.status === 401 || res.status === 403) {
        return { ok: false, kind: 'unauthorized' };
    }
    if (res.status === 429) {
        const raw = res.headers.get('retry-after');
        const seconds = raw === null || raw.trim() === '' ? NaN : Number(raw);
        return Number.isFinite(seconds) && seconds >= 0
            ? { ok: false, kind: 'rate_limited', retryAfterMs: seconds * 1000 }
            : { ok: false, kind: 'rate_limited' };
    }
    if (res.status !== 200) {
        return { ok: false, kind: 'bad_response' };
    }
    let data: any;
    try {
        data = await res.json();
    } catch {
        return { ok: false, kind: 'bad_response' };
    }
    if (!data || typeof data !== 'object') {
        return { ok: false, kind: 'bad_response' };
    }
    const usage: Usage = {};
    const fiveHour = toWindow(data.five_hour);
    const sevenDay = toWindow(data.seven_day);
    if (fiveHour) {
        usage.fiveHour = fiveHour;
    }
    if (sevenDay) {
        usage.sevenDay = sevenDay;
    }
    return { ok: true, usage };
}

export async function refreshAccessToken(cred: OAuthCredential, fetchImpl: FetchLike = defaultFetch, now: number = Date.now()): Promise<RefreshResult> {
    if (!cred.refreshToken) {
        return { ok: false, kind: 'no_refresh_token' };
    }
    let res: Awaited<ReturnType<FetchLike>>;
    try {
        res = await withTimeout((signal) => fetchImpl(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
            body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: cred.refreshToken, client_id: CLIENT_ID }),
            signal,
        }));
    } catch {
        return { ok: false, kind: 'network' };
    }
    let data: any;
    try {
        data = await res.json();
    } catch {
        data = undefined;
    }
    if (res.status !== 200) {
        if ((res.status === 400 || res.status === 401) && data?.error === 'invalid_grant') {
            return { ok: false, kind: 'invalid_grant' };
        }
        return { ok: false, kind: 'bad_response' };
    }
    if (!data || typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
        return { ok: false, kind: 'bad_response' };
    }
    const next: OAuthCredential = { ...cred, accessToken: data.access_token, expiresAt: now + data.expires_in * 1000 };
    if (typeof data.refresh_token === 'string' && data.refresh_token) {
        next.refreshToken = data.refresh_token;
    }
    if (typeof data.scope === 'string' && data.scope) {
        next.scopes = data.scope.split(/\s+/).filter(Boolean);
    }
    return { ok: true, cred: next };
}
