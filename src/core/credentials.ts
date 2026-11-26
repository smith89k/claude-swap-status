// Reading and saving the OAuth login stored in a Claude config folder.
// Windows and Linux keep it in <folder>/.credentials.json; macOS keeps it in the
// login Keychain under a name derived from the folder (see keychainService).
import { spawn } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import { CorruptJsonError, readJson, writeJsonAtomic } from './fsjson';
import { credentialsPath, keychainAccount, keychainService } from './paths';
import type { ConfigTarget, CredentialFile, Identity } from './types';

export type SecurityRunner = (args: string[], stdin?: string) => Promise<{ code: number; stdout: string; stderr: string }>;

export class KeychainError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'KeychainError';
    }
}

export interface CredentialStore {
    read(t: ConfigTarget): Promise<CredentialFile | undefined>;
    write(t: ConfigTarget, value: CredentialFile): Promise<void>;
    remove(t: ConfigTarget): Promise<void>;
}

const SECURITY = '/usr/bin/security';
const NOT_FOUND = 44;
const STDIN_LINE_LIMIT = 4096;
const SECURITY_TIMEOUT_MS = 10_000;

/** Runs /usr/bin/security (absolute path, so nothing earlier on PATH can intercept secrets). */
export const defaultSecurityRunner: SecurityRunner = (args, stdin) =>
    new Promise((resolve, reject) => {
        const child = spawn(SECURITY, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), SECURITY_TIMEOUT_MS);
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('error', (e) => {
            clearTimeout(timer);
            reject(new KeychainError(`Could not run the Keychain tool (${(e as NodeJS.ErrnoException).code ?? 'error'})`));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code: code ?? -1, stdout, stderr });
        });
        child.stdin.end(stdin ?? '');
    });

function quote(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function readFileStore(t: ConfigTarget): Promise<CredentialFile | undefined> {
    return readJson<CredentialFile>(credentialsPath(t.configHome));
}

async function removeFile(t: ConfigTarget): Promise<void> {
    await unlink(credentialsPath(t.configHome)).catch((e: any) => {
        if (e?.code !== 'ENOENT') {
            throw e;
        }
    });
}

export function createCredentialStore(opts: { platform: NodeJS.Platform; runSecurity?: SecurityRunner; env?: NodeJS.ProcessEnv }): CredentialStore {
    if (opts.platform !== 'darwin') {
        return {
            read: readFileStore,
            write: (t, value) => writeJsonAtomic(credentialsPath(t.configHome), value),
            remove: removeFile,
        };
    }

    const run = opts.runSecurity ?? defaultSecurityRunner;
    const account = () => keychainAccount(opts.env ?? process.env);

    return {
        async read(t) {
            const r = await run(['find-generic-password', '-a', account(), '-w', '-s', keychainService(t.configDirEnv)]);
            if (r.code === NOT_FOUND) {
                return readFileStore(t);
            }
            if (r.code !== 0) {
                throw new KeychainError(`Keychain read failed (exit ${r.code})`);
            }
            const text = r.stdout.endsWith('\n') ? r.stdout.slice(0, -1) : r.stdout;
            try {
                return JSON.parse(text) as CredentialFile;
            } catch {
                throw new KeychainError('Keychain item is not valid JSON');
            }
        },
        async write(t, value) {
            const hex = Buffer.from(JSON.stringify(value), 'utf8').toString('hex');
            const line = `add-generic-password -U -a ${quote(account())} -s ${quote(keychainService(t.configDirEnv))} -X ${hex}\n`;
            if (Buffer.byteLength(line, 'utf8') > STDIN_LINE_LIMIT) {
                throw new KeychainError('Credential too large to save to the Keychain safely');
            }
            const r = await run(['-i'], line);
            if (r.code !== 0) {
                throw new KeychainError(`Keychain write failed (exit ${r.code})`);
            }
        },
        async remove(t) {
            const r = await run(['delete-generic-password', '-a', account(), '-s', keychainService(t.configDirEnv)]);
            if (r.code !== 0 && r.code !== NOT_FOUND) {
                throw new KeychainError(`Keychain delete failed (exit ${r.code})`);
            }
        },
    };
}

/** Who a config folder is signed in as, from oauthAccount in its global config file. */
export async function readIdentity(globalConfig: string): Promise<Identity | undefined> {
    let data: any;
    try {
        data = await readJson<any>(globalConfig);
    } catch (e) {
        if (e instanceof CorruptJsonError) {
            return undefined;
        }
        throw e;
    }
    const acc = data?.oauthAccount;
    if (!acc || typeof acc.emailAddress !== 'string' || !acc.emailAddress) {
        return undefined;
    }
    const id: Identity = { email: acc.emailAddress };
    if (typeof acc.organizationUuid === 'string') {
        id.orgUuid = acc.organizationUuid;
    }
    if (typeof acc.organizationName === 'string') {
        id.orgName = acc.organizationName;
    }
    return id;
}
