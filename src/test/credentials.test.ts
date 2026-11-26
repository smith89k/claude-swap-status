import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredentialStore, readIdentity, KeychainError, type SecurityRunner } from '../core/credentials';
import { keychainService } from '../core/paths';

const cred = { claudeAiOauth: { accessToken: 'AT-secret', refreshToken: 'RT-secret', expiresAt: 5, extra: 'x' }, organizationUuid: 'o' };
const tmp = () => mkdtemp(join(tmpdir(), 'cs-cred-'));

function fakeRunner(reply: { code: number; stdout?: string; stderr?: string }) {
    const calls: { args: string[]; stdin?: string }[] = [];
    const run: SecurityRunner = async (args, stdin) => {
        calls.push({ args, stdin });
        return { code: reply.code, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' };
    };
    return { run, calls };
}

test('file store round-trips and keeps unknown fields', async () => {
    const home = await tmp();
    const t = { configHome: home, configDirEnv: home };
    const store = createCredentialStore({ platform: 'linux' });
    assert.equal(await store.read(t), undefined);
    await store.write(t, cred);
    assert.deepEqual(await store.read(t), cred);
});

test('file store remove deletes the file and tolerates a missing one', async () => {
    const home = await tmp();
    const t = { configHome: home, configDirEnv: home };
    const store = createCredentialStore({ platform: 'win32' });
    await store.write(t, cred);
    await store.remove(t);
    assert.equal(await store.read(t), undefined);
    await store.remove(t);
});

test('mac read uses the hashed service and the USER account', async () => {
    const raw = '/u/.claude-accounts/ab';
    const { run, calls } = fakeRunner({ code: 0, stdout: JSON.stringify(cred) + '\n' });
    const store = createCredentialStore({ platform: 'darwin', runSecurity: run, env: { USER: 'sam' } });
    assert.deepEqual(await store.read({ configHome: raw, configDirEnv: raw }), cred);
    assert.deepEqual(calls[0].args, ['find-generic-password', '-a', 'sam', '-w', '-s', keychainService(raw)]);
});

test('mac read falls back to the plaintext file on exit 44', async () => {
    const home = await tmp();
    await writeFile(join(home, '.credentials.json'), JSON.stringify(cred));
    const { run } = fakeRunner({ code: 44 });
    const store = createCredentialStore({ platform: 'darwin', runSecurity: run, env: { USER: 'sam' } });
    assert.deepEqual(await store.read({ configHome: home, configDirEnv: home }), cred);
});

test('mac write sends hex on stdin, never the secret in argv', async () => {
    const raw = '/u/.claude-accounts/ab';
    const { run, calls } = fakeRunner({ code: 0 });
    const store = createCredentialStore({ platform: 'darwin', runSecurity: run, env: { USER: 'sam' } });
    await store.write({ configHome: raw, configDirEnv: raw }, cred);
    const hex = Buffer.from(JSON.stringify(cred), 'utf8').toString('hex');
    assert.deepEqual(calls[0].args, ['-i']);
    assert.equal(calls[0].stdin, `add-generic-password -U -a "sam" -s "${keychainService(raw)}" -X ${hex}\n`);
});

test('mac quoting escapes quotes and backslashes', async () => {
    const { run, calls } = fakeRunner({ code: 0 });
    const store = createCredentialStore({ platform: 'darwin', runSecurity: run, env: { USER: 'a"b\\c' } });
    await store.write({ configHome: '/x', configDirEnv: '/x' }, cred);
    assert.ok(calls[0].stdin!.includes('-a "a\\"b\\\\c"'));
});

test('mac write refuses a stdin line over 4096 bytes', async () => {
    const { run, calls } = fakeRunner({ code: 0 });
    const store = createCredentialStore({ platform: 'darwin', runSecurity: run, env: { USER: 'sam' } });
    const big = { claudeAiOauth: { accessToken: 'x'.repeat(3000) } };
    await assert.rejects(store.write({ configHome: '/x', configDirEnv: '/x' }, big), KeychainError);
    assert.equal(calls.length, 0);
});

test('mac remove deletes the keychain item and treats exit 44 as done', async () => {
    const raw = '/u/.claude-accounts/ab';
    const { run, calls } = fakeRunner({ code: 44 });
    const store = createCredentialStore({ platform: 'darwin', runSecurity: run, env: { USER: 'sam' } });
    await store.remove({ configHome: raw, configDirEnv: raw });
    assert.deepEqual(calls[0].args, ['delete-generic-password', '-a', 'sam', '-s', keychainService(raw)]);
});

test('keychain errors never carry the secret', async () => {
    const { run } = fakeRunner({ code: 51, stdout: JSON.stringify(cred), stderr: 'denied' });
    const store = createCredentialStore({ platform: 'darwin', runSecurity: run, env: { USER: 'sam' } });
    await assert.rejects(
        store.read({ configHome: '/x', configDirEnv: '/x' }),
        (e: Error) => e instanceof KeychainError && !e.message.includes('secret'),
    );
});

test('readIdentity reads oauthAccount', async () => {
    const d = await tmp();
    const f = join(d, '.claude.json');
    assert.equal(await readIdentity(f), undefined);
    await writeFile(f, JSON.stringify({ oauthAccount: { emailAddress: 'w@x.com', organizationUuid: 'org1', organizationName: 'Acme' } }));
    assert.deepEqual(await readIdentity(f), { email: 'w@x.com', orgUuid: 'org1', orgName: 'Acme' });
    await writeFile(f, '{broken');
    assert.equal(await readIdentity(f), undefined);
});
