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
    label: string;
    email?: string;
    orgName?: string;
    isMain: boolean;
    isThisWindow: boolean;
    signedIn: boolean;
    usedBy: string[];
    entry?: UsageEntry;
}
