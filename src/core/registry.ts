// The list of accounts, in <root>/accounts.json, shared by every window.
import { rename } from 'node:fs/promises';
import * as path from 'node:path';
import { CorruptJsonError, readJson, writeJsonAtomic } from './fsjson';
import { withLock } from './locks';
import type { Account } from './types';

interface RegistryFile {
    version: 1;
    accounts: Account[];
}

export type AccountPatch = { email?: string; orgUuid?: string; orgName?: string; alias?: string };

export class Registry {
    private readonly file: string;
    private readonly lockPath: string;

    constructor(root: string) {
        this.file = path.join(root, 'accounts.json');
        this.lockPath = path.join(root, 'accounts.json.lock');
    }

    async list(): Promise<Account[]> {
        try {
            const data = await readJson<RegistryFile>(this.file);
            return Array.isArray(data?.accounts) ? data!.accounts : [];
        } catch (e) {
            if (e instanceof CorruptJsonError) {
                return [];
            }
            throw e;
        }
    }

    async get(id: string): Promise<Account | undefined> {
        return (await this.list()).find((a) => a.id === id);
    }

    async add(a: { id: string; folder: string }): Promise<Account> {
        const account: Account = { id: a.id, folder: a.folder, createdAt: new Date().toISOString() };
        await this.mutate((accounts) => {
            if (accounts.some((x) => x.id === a.id)) {
                throw new Error(`Account ${a.id} already exists`);
            }
            accounts.push(account);
        });
        return account;
    }

    async update(id: string, patch: AccountPatch): Promise<Account> {
        let updated: Account | undefined;
        await this.mutate((accounts) => {
            const found = accounts.find((x) => x.id === id);
            if (!found) {
                throw new Error(`No account ${id}`);
            }
            for (const key of ['email', 'orgUuid', 'orgName', 'alias'] as const) {
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
        await this.mutate((accounts) => {
            const i = accounts.findIndex((x) => x.id === id);
            if (i >= 0) {
                accounts.splice(i, 1);
            }
        });
    }

    /** Read, change and write the file under the registry lock. A corrupt file is set aside first. */
    private async mutate(change: (accounts: Account[]) => void): Promise<void> {
        await withLock(this.lockPath, { staleMs: 10_000 }, async () => {
            let accounts: Account[] = [];
            try {
                const data = await readJson<RegistryFile>(this.file);
                accounts = Array.isArray(data?.accounts) ? data!.accounts : [];
            } catch (e) {
                if (!(e instanceof CorruptJsonError)) {
                    throw e;
                }
                await rename(this.file, `${this.file}.corrupt-${Date.now()}`);
            }
            change(accounts);
            const next: RegistryFile = { version: 1, accounts };
            await writeJsonAtomic(this.file, next);
        });
    }
}
