// Text helpers for showing usage: bars, countdowns, labels and colour levels.
import type { Usage, UsageEntry, UsageWindow } from './types';

export function progressBar(pct: number): string {
    const totalBars = 5;
    const filled = Math.max(0, Math.min(totalBars, Math.round((pct / 100) * totalBars)));
    return '█'.repeat(filled) + '░'.repeat(totalBars - filled);
}

// Compact time-until-reset, e.g. "1d23h", "4h26m", "4m" (a zero second unit is dropped: "4d", "3h").
export function formatResetIn(resetsAt: string | undefined, now: number = Date.now()): string | null {
    if (!resetsAt) {
        return null;
    }
    const ms = new Date(resetsAt).getTime() - now;
    if (isNaN(ms)) {
        return null;
    }
    const minutes = Math.max(0, Math.floor(ms / 60000));
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    const mins = minutes % 60;
    if (days > 0) {
        return `${days}d${hours > 0 ? `${hours}h` : ''}`;
    }
    if (hours > 0) {
        return `${hours}h${mins > 0 ? `${mins}m` : ''}`;
    }
    return `${mins}m`;
}

export function formatWindow(w: UsageWindow, now: number = Date.now()): string {
    const resetIn = formatResetIn(w.resetsAt, now);
    return `${progressBar(w.pct)} ${Math.round(w.pct)}%${resetIn ? ` R:${resetIn}` : ''}`;
}

export function formatResetDetail(label: string, w: UsageWindow | undefined, now: number = Date.now()): string {
    if (!w || !w.resetsAt) {
        return `${label}: no reset scheduled`;
    }
    const date = new Date(w.resetsAt);
    const clock = isNaN(date.getTime()) ? '' : ` at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const resetIn = formatResetIn(w.resetsAt, now);
    return `${label} resets${clock}${resetIn ? ` (in ${resetIn})` : ''}`;
}

const STATUS_LABELS: Record<string, string> = {
    ok: 'ok',
    token_expired: 'token expired',
    relogin_required: 're-login needed',
    no_credentials: 'not signed in',
    rate_limited: 'rate limited',
    unavailable: 'unavailable',
};

export function statusLabel(status?: string): string {
    return (status && STATUS_LABELS[status]) || status || 'unknown';
}

// token_expired and rate_limited fix themselves, so only warn for states the user has to act on.
export function needsAttention(status?: string): boolean {
    return !!status && status !== 'ok' && status !== 'token_expired' && status !== 'rate_limited';
}

export function formatAge(seconds?: number): string {
    if (seconds === undefined) {
        return 'a while';
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1) {
        return 'under a minute';
    }
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h${minutes % 60 > 0 ? `${minutes % 60}m` : ''}` : `${Math.floor(hours / 24)}d`;
}

export type UsageLevel = 'normal' | 'warning' | 'error';

/** 70% or more warns, 85% or more is an error; the higher of the two windows decides. */
export function usageLevel(usage?: Usage): UsageLevel {
    const top = Math.max(usage?.fiveHour?.pct ?? 0, usage?.sevenDay?.pct ?? 0);
    if (top >= 85) {
        return 'error';
    }
    if (top >= 70) {
        return 'warning';
    }
    return 'normal';
}

/** Fresh usage when there is some, otherwise the last good measurement marked as stale. */
export function pickUsage(entry: UsageEntry | undefined, now: number): { usage: Usage; stale: boolean; ageSeconds?: number } | null {
    if (entry?.status === 'ok' && entry.usage) {
        return { usage: entry.usage, stale: false, ageSeconds: ageOf(entry.fetchedAt, now) };
    }
    if (entry?.lastGood) {
        return { usage: entry.lastGood, stale: true, ageSeconds: ageOf(entry.lastGoodAt, now) };
    }
    return null;
}

function ageOf(at: number | undefined, now: number): number | undefined {
    return at === undefined ? undefined : Math.max(0, Math.round((now - at) / 1000));
}
