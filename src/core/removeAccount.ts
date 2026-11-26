// Deleting an added account: its folder (never what its links point to), its Keychain
// item on macOS, its list entry and its cached usage. Claude 1 is never passed here.
import type { CredentialStore } from './credentials';
import type { Registry } from './registry';
import { removeAccountFolder } from './safeDelete';
import type { UsageCache } from './usage';

export type RemoveResult = 'removed' | 'inUse' | 'missing';

export async function removeAccountNow(o: {
    root: string;
    registry: Registry;
    cache: UsageCache;
    credentials: CredentialStore;
    platform: NodeJS.Platform;
    id: string;
    inUse: () => Promise<boolean>;
    log?: (line: string) => void;
}): Promise<RemoveResult> {
    const account = await o.registry.get(o.id);
    if (!account) {
        return 'missing';
    }
    if (await o.inUse()) {
        return 'inUse';
    }
    if (o.platform === 'darwin') {
        await o.credentials.remove({ configHome: account.folder, configDirEnv: account.folder })
            .catch((e: any) => o.log?.(`keychain delete: ${e?.name ?? 'error'}`));
    }
    await removeAccountFolder(o.root, account.folder);
    await o.registry.remove(account.id);
    await o.cache.remove(account.id);
    return 'removed';
}
