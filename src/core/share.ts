// Gives an account folder the same Claude setup as the main one: everything
// except the login. Folders are linked (a junction on Windows, which needs no
// admin rights; a symlink elsewhere). Files are symlinked on macOS/Linux and
// copied from the main folder on Windows, where file symlinks need admin rights.
// Nothing is ever written into the main folder.
import { copyFile, lstat, stat, symlink } from 'node:fs/promises';
import * as path from 'node:path';
import { CorruptJsonError, readJson, writeJsonAtomic } from './fsjson';
import { withConfigLock } from './locks';

export const SHARED_DIRS = ['projects', 'plugins', 'skills', 'commands', 'agents', 'output-styles', 'rules', 'plans'];
export const SHARED_FILES = ['settings.json', 'CLAUDE.md', 'keybindings.json'];
export const PROMPT_HISTORY = 'history.jsonl';
export const MANIFEST = '.claude-accounts-manifest.json';

export interface Manifest {
    links: string[];
    copies: string[];
}

async function exists(p: string, kind: 'dir' | 'file'): Promise<boolean> {
    try {
        const st = await stat(p);
        return kind === 'dir' ? st.isDirectory() : st.isFile();
    } catch {
        return false;
    }
}

async function isMissing(p: string): Promise<boolean> {
    try {
        await lstat(p);
        return false;
    } catch (e: any) {
        return e?.code === 'ENOENT';
    }
}

async function readManifest(accountHome: string): Promise<Manifest> {
    try {
        const m = await readJson<Manifest>(path.join(accountHome, MANIFEST));
        return { links: Array.isArray(m?.links) ? m!.links : [], copies: Array.isArray(m?.copies) ? m!.copies : [] };
    } catch {
        return { links: [], copies: [] };
    }
}

export async function syncSharedSetup(o: { mainHome: string; accountHome: string; platform: NodeJS.Platform }): Promise<Manifest> {
    const windows = o.platform === 'win32';
    const manifest = await readManifest(o.accountHome);
    const links = new Set(manifest.links);
    const copies = new Set(manifest.copies);

    for (const name of SHARED_DIRS) {
        const src = path.join(o.mainHome, name);
        const dst = path.join(o.accountHome, name);
        if ((await exists(src, 'dir')) && (await isMissing(dst))) {
            await symlink(src, dst, windows ? 'junction' : 'dir');
            links.add(name);
        }
    }

    const files = windows ? SHARED_FILES : [...SHARED_FILES, PROMPT_HISTORY];
    for (const name of files) {
        const src = path.join(o.mainHome, name);
        const dst = path.join(o.accountHome, name);
        if (!(await exists(src, 'file'))) {
            continue;
        }
        if (windows) {
            // The main folder wins: re-copied on every window start.
            await copyFile(src, dst);
            copies.add(name);
        } else if (await isMissing(dst)) {
            await symlink(src, dst, 'file');
            links.add(name);
        }
    }

    const next: Manifest = { links: [...links], copies: [...copies] };
    await writeJsonAtomic(path.join(o.accountHome, MANIFEST), next);
    return next;
}

async function readObject(file: string): Promise<Record<string, unknown> | undefined> {
    try {
        const data = await readJson<unknown>(file);
        return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
    } catch (e) {
        if (e instanceof CorruptJsonError) {
            return undefined;
        }
        throw e;
    }
}

/** First-run settings for a new account folder, so Claude skips onboarding and keeps your MCP servers. */
export async function seedGlobalConfig(mainGlobal: string, accountGlobal: string): Promise<void> {
    if (!(await isMissing(accountGlobal))) {
        return;
    }
    const main = (await readObject(mainGlobal)) ?? {};
    const seed: Record<string, unknown> = {};
    for (const key of ['hasCompletedOnboarding', 'lastOnboardingVersion', 'mcpServers']) {
        if (main[key] !== undefined) {
            seed[key] = main[key];
        }
    }
    await writeJsonAtomic(accountGlobal, seed);
}

/** Keeps the account's user-level MCP servers the same as the main login's. Never touches oauthAccount. */
export async function syncMcpServers(mainGlobal: string, accountGlobal: string): Promise<void> {
    const main = (await readObject(mainGlobal)) ?? {};
    await withConfigLock(accountGlobal, async () => {
        const account = await readObject(accountGlobal);
        if (!account) {
            return;
        }
        if (main.mcpServers === undefined) {
            if (!('mcpServers' in account)) {
                return;
            }
            delete account.mcpServers;
        } else {
            account.mcpServers = main.mcpServers;
        }
        await writeJsonAtomic(accountGlobal, account);
    });
}
