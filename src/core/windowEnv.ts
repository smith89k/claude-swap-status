// Decides which Claude config folder a window exports as CLAUDE_CONFIG_DIR.
import { MAIN_KEY, type Account } from './types';

/** workspaceState key holding "main" or an account id for this window. */
export const WINDOW_ACCOUNT_KEY = 'claudeSwap.windowAccount';

export const ACCOUNT_GONE_WARNING = 'The Claude account this window used is gone, so this window is back on your main login.';

export function resolveWindowEnv(i: {
    choice: string | undefined;
    accounts: Account[];
    folderExists: (p: string) => boolean;
    originalConfigDir: string | undefined;
}): { key: string; configDir: string | undefined; warning?: string } {
    if (!i.choice || i.choice === MAIN_KEY) {
        return { key: MAIN_KEY, configDir: i.originalConfigDir };
    }
    const account = i.accounts.find((a) => a.id === i.choice);
    if (!account || !i.folderExists(account.folder)) {
        return { key: MAIN_KEY, configDir: i.originalConfigDir, warning: ACCOUNT_GONE_WARNING };
    }
    return { key: account.id, configDir: account.folder };
}

/** True when claudeCode.environmentVariables forces one CLAUDE_CONFIG_DIR on every window. */
export function findConfigDirOverride(envVars: unknown): boolean {
    if (!Array.isArray(envVars)) {
        return false;
    }
    return envVars.some((v) => v && typeof v === 'object' && v.name === 'CLAUDE_CONFIG_DIR' && typeof v.value === 'string' && v.value !== '');
}
