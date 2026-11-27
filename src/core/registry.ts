// The list of accounts, in <root>/accounts.json, shared by every window.
// Your normal Claude login is Claude 1; added accounts are Claude 2, Claude 3, …
import { readFileSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import * as path from 'node:path';
import { CorruptJsonError, readJson, writeJsonAtomic } from './fsjson';
import { withLock } from './locks';
import type { Account } from './types';

interface RegistryFile {
    version: 1;
    accounts: Account[];
    /** Optional name for the main login (Claude 1). */
    mainAlias?: string;
}

export type AccountPatch = { email?: string; orgUuid?: string; orgName?: string; alias?: string; icon?: string };

/**
 * The number each account shows as ("Claude 2"). Saved numbers are kept; accounts saved
 * before numbering get the lowest free numbers from 2, in list order.
 */
export function effectiveNumbers(accounts: Account[]): Map<string, number> {
    const out = new Map<string, number>();
    const taken = new Set<number>([1]);
    for (const a of accounts) {
        if (typeof a.number === 'number' && a.number >= 2 && !taken.has(a.number)) {
            out.set(a.id, a.number);
            taken.add(a.number);
        }
    }
    let next = 2;
    for (const a of accounts) {
        if (out.has(a.id)) {
            continue;
        }
        while (taken.has(next)) {
            next++;
        }
        out.set(a.id, next);
        taken.add(next);
    }
    return out;
}

function lowestFree(accounts: Account[]): number {
    const used = new Set(effectiveNumbers(accounts).values());
    let n = 2;
    while (used.has(n)) {
        n++;
    }
    return n;
}

export class Registry {
    private readonly file: string;
    private readonly lockPath: string;

    constructor(root: string) {
        this.file = path.join(root, 'accounts.json');
        this.lockPath = path.join(root, 'accounts.json.lock');
    }

    private async readFile(): Promise<RegistryFile | undefined> {
        try {
            return await readJson<RegistryFile>(this.file);
        } catch (e) {
            if (e instanceof CorruptJsonError) {
                return undefined;
            }
            throw e;
        }
    }

    async list(): Promise<Account[]> {
        const data = await this.readFile();
        return Array.isArray(data?.accounts) ? data!.accounts : [];
    }

    /** Same as list(), without waiting: used at window start, before Claude launches. */
    listSync(): Account[] {
        try {
            const data = JSON.parse(readFileSync(this.file, 'utf8')) as RegistryFile;
            return Array.isArray(data?.accounts) ? data.accounts : [];
        } catch {
            return [];
        }
    }

    async get(id: string): Promise<Account | undefined> {
        return (await this.list()).find((a) => a.id === id);
    }

    async getMainAlias(): Promise<string | undefined> {
        const alias = (await this.readFile())?.mainAlias;
        return typeof alias === 'string' && alias ? alias : undefined;
    }

    async setMainAlias(alias: string): Promise<void> {
        await this.mutate((file) => {
            if (alias) {
                file.mainAlias = alias;
            } else {
                delete file.mainAlias;
            }
        });
    }

    async add(a: { id: string; folder: string }): Promise<Account> {
        let account: Account | undefined;
        await this.mutate((file) => {
            if (file.accounts.some((x) => x.id === a.id)) {
                throw new Error(`Account ${a.id} already exists`);
            }
            account = { id: a.id, folder: a.folder, number: lowestFree(file.accounts), createdAt: new Date().toISOString() };
            file.accounts.push(account);
        });
        return account!;
    }

    async update(id: string, patch: AccountPatch): Promise<Account> {
        let updated: Account | undefined;
        await this.mutate((file) => {
            const found = file.accounts.find((x) => x.id === id);
            if (!found) {
                throw new Error(`No account ${id}`);
            }
            for (const key of ['email', 'orgUuid', 'orgName', 'alias', 'icon'] as const) {
                if (!(key in patch)) {
                    continue;
                }
                const value = patch[key];
                if (value === undefined || value === '') {
                    delete found[key];
                } else {
                    found[key] = value;
                }
            }
            updated = found;
        });
        return updated!;
    }

    async remove(id: string): Promise<void> {
        await this.mutate((file) => {
            const i = file.accounts.findIndex((x) => x.id === id);
            if (i >= 0) {
                file.accounts.splice(i, 1);
            }
        });
    }

    /** Read, change and write the file under the registry lock. A corrupt file is set aside first. */
    private async mutate(change: (file: RegistryFile) => void): Promise<void> {
        await withLock(this.lockPath, { staleMs: 10_000 }, async () => {
            let file: RegistryFile = { version: 1, accounts: [] };
            try {
                const data = await readJson<RegistryFile>(this.file);
                if (data && typeof data === 'object') {
                    file = { ...data, version: 1, accounts: Array.isArray(data.accounts) ? data.accounts : [] };
                }
            } catch (e) {
                if (!(e instanceof CorruptJsonError)) {
                    throw e;
                }
                await rename(this.file, `${this.file}.corrupt-${Date.now()}`);
            }
            change(file);
            await writeJsonAtomic(this.file, file);
        });
    }
}
