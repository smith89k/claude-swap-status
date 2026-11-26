// Shared data shapes used across the extension. No logic here.

/** Key used for the main (default) Claude login, next to account ids. */
export const MAIN_KEY = 'main';

export interface OAuthCredential {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
    subscriptionType?: string;
    [key: string]: unknown;
}

export interface CredentialFile {
    claudeAiOauth?: OAuthCredential;
    [key: string]: unknown;
}

/** Where a Claude login lives: its config folder, and the raw CLAUDE_CONFIG_DIR value that names it. */
export interface ConfigTarget {
    configHome: string;
    configDirEnv: string | undefined;
}

export interface UsageWindow {
    pct: number;
    resetsAt?: string;
}

export interface Usage {
    fiveHour?: UsageWindow;
    sevenDay?: UsageWindow;
}

export type UsageStatus = 'ok' | 'token_expired' | 'relogin_required' | 'no_credentials' | 'rate_limited' | 'unavailable';

export interface UsageEntry {
    status: UsageStatus;
    usage?: Usage;
    fetchedAt?: number;
    lastGood?: Usage;
    lastGoodAt?: number;
    backoffUntil?: number;
    plan?: string;
}

export interface Account {
    id: string;
    folder: string;
    email?: string;
    orgUuid?: string;
    orgName?: string;
    alias?: string;
    /** Shown as "Claude <number>". Claude 1 is the main login, so added accounts start at 2. */
    number?: number;
    createdAt: string;
}

export interface Identity {
    email: string;
    orgUuid?: string;
    orgName?: string;
}

export interface WindowBeat {
    windowId: string;
    accountKey: string;
    workspaceName: string;
    pid: number;
    updatedAt: number;
}

export interface AccountView {
    key: string;
    /** 1 for the main login, 2 and up for added accounts. */
    number: number;
    label: string;
    email?: string;
    orgName?: string;
    isMain: boolean;
    isThisWindow: boolean;
    signedIn: boolean;
    usedBy: string[];
    /** How many open windows use this account right now. */
    openWindows: number;
    entry?: UsageEntry;
}
