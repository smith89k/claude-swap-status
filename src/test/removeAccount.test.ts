import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeAccountNow } from '../core/removeAccount';
import { finishPendingRemoval, PENDING_REMOVE_KEY } from '../vscode/pendingRemoval';
import { Registry } from '../core/registry';
import { UsageCache } from '../core/usage';
import type { CredentialStore } from '../core/credentials';
import type { ConfigTarget } from '../core/types';
import { fake, FakeMemento } from './fakes/vscode';

async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'cs-remove-'));
    const registry = new Registry(root);
    const cache = new UsageCache(root);
    const folder = join(root, 'a1');
    await mkdir(folder, { recursive: true });
    await registry.add({ id: 'a1', folder });
    await cache.put('a1', { status: 'ok' });
    const removed: ConfigTarget[] = [];
    const credentials: CredentialStore = {
        read: async () => undefined,
        write: async () => undefined,
        remove: async (t) => { removed.push(t); },
    };
    return { root, registry, cache, folder, credentials, removed };
}

test('deleting an unused account removes its folder, list entry and usage', async () => {
    const s = await setup();
    const r = await removeAccountNow({ ...s, platform: 'win32', id: 'a1', inUse: async () => false });
    assert.equal(r, 'removed');
    assert.ok(!existsSync(s.folder));
    assert.equal(await s.registry.get('a1'), undefined);
    assert.equal(await s.cache.get('a1'), undefined);
    assert.equal(s.removed.length, 0);
});

test('an account still in use is left alone', async () => {
    const s = await setup();
    const r = await removeAccountNow({ ...s, platform: 'win32', id: 'a1', inUse: async () => true });
    assert.equal(r, 'inUse');
    assert.ok(existsSync(s.folder));
    assert.ok(await s.registry.get('a1'));
});

test('an unknown account is reported as missing', async () => {
    const s = await setup();
    assert.equal(await removeAccountNow({ ...s, platform: 'win32', id: 'zz', inUse: async () => false }), 'missing');
});

test('on macOS the Keychain item for that folder is deleted too', async () => {
    const s = await setup();
    await removeAccountNow({ ...s, platform: 'darwin', id: 'a1', inUse: async () => false });
    assert.deepEqual(s.removed, [{ configHome: s.folder, configDirEnv: s.folder }]);
});

test('after the switch-and-reload, the pending delete runs once and says so', async () => {
    fake.reset();
    const state = new FakeMemento();
    await state.update(PENDING_REMOVE_KEY, { id: 'a1', label: 'Claude 2: work' });
    const calls: string[] = [];
    await finishPendingRemoval(state as any, async (id) => { calls.push(id); return 'removed'; }, { tries: 3, delayMs: 1 });
    assert.deepEqual(calls, ['a1']);
    assert.equal(state.get(PENDING_REMOVE_KEY), undefined);
    assert.ok(fake.messages.some((m) => m.level === 'info' && m.text.includes('Deleted "Claude 2: work"')));
});

test('if Claude is still using it, the pending delete retries and then explains', async () => {
    fake.reset();
    const state = new FakeMemento();
    await state.update(PENDING_REMOVE_KEY, { id: 'a1', label: 'Claude 2' });
    let n = 0;
    await finishPendingRemoval(state as any, async () => { n++; return 'inUse'; }, { tries: 3, delayMs: 1 });
    assert.equal(n, 3);
    assert.equal(state.get(PENDING_REMOVE_KEY), undefined);
    assert.ok(fake.messages.some((m) => m.level === 'warning' && m.text.includes('Claude 2')));
});

test('with nothing pending, nothing runs', async () => {
    fake.reset();
    let n = 0;
    await finishPendingRemoval(new FakeMemento() as any, async () => { n++; return 'removed'; }, { tries: 3, delayMs: 1 });
    assert.equal(n, 0);
    assert.equal(fake.messages.length, 0);
});
