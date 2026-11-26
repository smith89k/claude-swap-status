// What the side panel shows, worked out from the account snapshot. The panel's
// script only draws this; every decision about text and actions is made here.
import { formatAge, formatResetIn, pickUsage, usageLevel, type UsageLevel } from './format';
import type { AccountView, UsageWindow } from './types';

export const CHROME_HINT = 'Claude in Chrome works only in windows that use the same account as the Chrome extension.';

export const MAIN_REMOVE_NOTE = "This is your main account (the crown): your normal Claude login. It can't be deleted because its folder holds your settings and chat history.";

const FIVE_HOURS_MS = 5 * 3_600_000;
const SEVEN_DAYS_MS = 7 * 24 * 3_600_000;

export interface PanelMeter {
    label: '5h' | '7d';
    pct: number;
    pctText: string;
    resetText?: string;
    level: UsageLevel;
    /** How much of the time window has passed, 0..1, when the reset time is known. */
    pace?: number;
    title: string;
}

export type PanelAction = 'use' | 'signIn' | 'signInAgain' | 'rename' | 'remove';
export type PanelState = 'ok' | 'stale' | 'checking' | 'notSignedIn' | 'relogin' | 'problem';

export interface PanelAccount {
    key: string;
    name: string;
    email?: string;
    plan?: string;
    detail: string;
    isMain: boolean;
    isThisWindow: boolean;
    state: PanelState;
    note?: string;
    meters: PanelMeter[];
    actions: PanelAction[];
    /** False for Claude 1: it is Claude's own folder, so the delete icon is shown greyed out. */
    canRemove: boolean;
    /** Why it can't be removed, shown on the greyed-out delete icon. */
    removeNote?: string;
}

export interface PanelModel {
    current?: PanelAccount;
    others: PanelAccount[];
    hasExtraAccounts: boolean;
    /** A short note under the accounts, when there is something worth knowing. */
    hint?: string;
}

function meter(label: '5h' | '7d', w: UsageWindow, now: number): PanelMeter {
    const windowMs = label === '5h' ? FIVE_HOURS_MS : SEVEN_DAYS_MS;
    const pct = Math.max(0, Math.min(100, w.pct));
    const m: PanelMeter = {
        label,
        pct,
        pctText: `${Math.round(w.pct)}%`,
        level: usageLevel(label === '5h' ? { fiveHour: w } : { sevenDay: w }),
        title: `${Math.round(w.pct)}% of the ${label === '5h' ? '5-hour' : 'weekly'} limit used.`,
    };
    const resetIn = formatResetIn(w.resetsAt, now);
    if (resetIn) {
        m.resetText = resetIn;
        const left = new Date(w.resetsAt!).getTime() - now;
        m.pace = Math.round(Math.max(0, Math.min(1, 1 - left / windowMs)) * 1000) / 1000;
        m.title += ` ${Math.round(m.pace * 100)}% of the time has passed. Resets in ${resetIn}.`;
    }
    return m;
}

function detailFor(v: AccountView): string {
    if (v.isThisWindow) {
        const others = v.usedBy.length > 1 ? v.usedBy : [];
        return others.length ? `Also open in ${others.join(', ')}` : '';
    }
    return v.usedBy.length ? `Open in ${v.usedBy.join(', ')}` : 'Not open in any window';
}

function toAccount(v: AccountView, now: number): PanelAccount {
    const status = v.entry?.status;
    const found = pickUsage(v.entry, now);
    const meters: PanelMeter[] = [];
    if (found?.usage.fiveHour) {
        meters.push(meter('5h', found.usage.fiveHour, now));
    }
    if (found?.usage.sevenDay) {
        meters.push(meter('7d', found.usage.sevenDay, now));
    }

    let state: PanelState = 'ok';
    let note: string | undefined;
    if (!v.signedIn) {
        state = 'notSignedIn';
        note = 'Not signed in yet';
    } else if (status === 'relogin_required' || status === 'no_credentials') {
        state = 'relogin';
        note = 'Sign-in expired';
    } else if (found?.stale) {
        state = 'stale';
        note = `Last known, ${formatAge(found.ageSeconds)} ago`;
    } else if (!v.entry) {
        state = 'checking';
        note = 'Checking usage…';
    } else if (!found) {
        state = 'problem';
        note = status === 'rate_limited' ? 'Checked too often, trying again soon'
            : status === 'token_expired' ? 'Waiting for Claude to renew the login'
                : 'Usage unavailable right now';
    }

    const actions: PanelAction[] = [];
    if (state === 'notSignedIn') {
        actions.push('signIn');
    } else if (state === 'relogin') {
        actions.push('signInAgain');
    } else if (!v.isThisWindow) {
        actions.push('use');
    }
    if (v.signedIn || v.isMain) {
        actions.push('rename');
    }
    actions.push('remove');

    const a: PanelAccount = {
        key: v.key,
        name: v.label,
        detail: detailFor(v),
        isMain: v.isMain,
        isThisWindow: v.isThisWindow,
        state,
        meters,
        actions,
        canRemove: !v.isMain,
    };
    if (v.isMain) {
        a.removeNote = MAIN_REMOVE_NOTE;
    }
    if (v.email) {
        a.email = v.email;
    }
    const plan = v.entry?.plan;
    if (plan) {
        a.plan = plan.charAt(0).toUpperCase() + plan.slice(1);
    }
    if (note) {
        a.note = note;
    }
    return a;
}

export function toPanelModel(views: AccountView[], now: number): PanelModel {
    const accounts = views.map((v) => toAccount(v, now));
    const hasExtraAccounts = views.some((v) => !v.isMain);
    const model: PanelModel = {
        current: accounts.find((a) => a.isThisWindow),
        others: accounts.filter((a) => !a.isThisWindow),
        hasExtraAccounts,
    };
    if (hasExtraAccounts) {
        // The Chrome extension is signed in to one account, so windows on other accounts can't use it.
        model.hint = CHROME_HINT;
    }
    return model;
}
