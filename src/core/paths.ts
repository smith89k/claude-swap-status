// Every path rule in one place. These mirror Claude Code's own rules so the
// extension reads and writes exactly the files Claude does.
import { createHash, randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Folder holding the extension's accounts, registry, usage cache and window heartbeats. */
export function accountsRoot(home: string = os.homedir()): string {
    return path.join(home, '.claude-accounts');
}

export function accountFolder(root: string, id: string): string {
    return path.join(root, id);
}

export function newAccountId(): string {
    return randomBytes(4).toString('hex');
}

/** True only when `target` is strictly inside `root` (never `root` itself). */
export function isInside(root: string, target: string): boolean {
    const rel = path.relative(path.resolve(root), path.resolve(target));
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Claude's config folder: CLAUDE_CONFIG_DIR when set and non-empty, otherwise ~/.claude. */
export function configHome(configDirEnv: string | undefined, home: string = os.homedir()): string {
    return configDirEnv ? configDirEnv : path.join(home, '.claude');
}

/**
 * Claude's global config file. A legacy `<configHome>/.config.json` wins when it is a
 * regular file that is non-empty, or empty but writable with no `.claude.json` next to
 * where it would be. Otherwise `(CLAUDE_CONFIG_DIR || home)/.claude.json`.
 */
export function globalConfigPath(configDirEnv: string | undefined, home: string = os.homedir()): string {
    const globalCfg = path.join(configDirEnv ? configDirEnv : home, '.claude.json');
    const legacy = path.join(configHome(configDirEnv, home), '.config.json');
    try {
        const st = statSync(legacy);
        if (st.isFile() && (st.size > 0 || (isWritable(legacy) && !existsSync(globalCfg)))) {
            return legacy;
        }
    } catch {
        // No legacy file (or unreadable): the normal file wins.
    }
    return globalCfg;
}

function isWritable(file: string): boolean {
    try {
        accessSync(file, constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

export function credentialsPath(home: string): string {
    return path.join(home, '.credentials.json');
}

/** Claude's two credential-refresh locks, in the order it takes them. */
export function credentialLockPaths(home: string): [string, string] {
    const trimmed = home.replace(/[\\/]+$/, '');
    return [path.join(trimmed, '.oauth_refresh.lock'), trimmed + '.lock'];
}

export function configLockPath(globalConfig: string): string {
    return globalConfig + '.lock';
}

/** macOS Keychain service name Claude derives from the raw CLAUDE_CONFIG_DIR string. */
export function keychainService(configDirEnv: string | undefined): string {
    if (!configDirEnv) {
        return 'Claude Code-credentials';
    }
    const digest = createHash('sha256').update(configDirEnv.normalize('NFC'), 'utf8').digest('hex').slice(0, 8);
    return `Claude Code-credentials-${digest}`;
}

/** macOS Keychain account name: $USER, then the OS username, then a fixed fallback. */
export function keychainAccount(env: NodeJS.ProcessEnv = process.env): string {
    if (env.USER) {
        return env.USER;
    }
    try {
        const name = os.userInfo().username;
        if (name) {
            return name;
        }
    } catch {
        // Fall through.
    }
    return 'claude-code-user';
}
