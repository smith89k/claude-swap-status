import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as p from '../core/paths';

test('configHome uses CLAUDE_CONFIG_DIR only when non-empty', () => {
    assert.equal(p.configHome(undefined, '/h'), join('/h', '.claude'));
    assert.equal(p.configHome('', '/h'), join('/h', '.claude'));
    assert.equal(p.configHome('/x/acc', '/h'), '/x/acc');
});

test('keychainService hashes the raw value after NFC', () => {
    assert.equal(p.keychainService(undefined), 'Claude Code-credentials');
    assert.equal(p.keychainService(''), 'Claude Code-credentials');
    const raw = '/Users/a/.claude-accounts/ab12cd34';
    assert.equal(p.keychainService(raw), 'Claude Code-credentials-' + createHash('sha256').update(raw).digest('hex').slice(0, 8));
    assert.equal(p.keychainService('/Users/Nguyễn'), p.keychainService('/Users/Nguyễn'));
});

test('keychainAccount prefers USER', () => {
    assert.equal(p.keychainAccount({ USER: 'sam' }), 'sam');
    assert.ok(p.keychainAccount({}).length > 0);
});

test('isInside accepts strict children only', () => {
    const r = join('/a', 'root');
    assert.equal(p.isInside(r, join(r, 'x')), true);
    assert.equal(p.isInside(r, r), false);
    assert.equal(p.isInside(r, join('/a', 'rootx', 'y')), false);
    assert.equal(p.isInside(r, join(r, '..', 'b')), false);
});

test('lock paths', () => {
    const h = join('/h', '.claude');
    assert.deepEqual(p.credentialLockPaths(h), [join(h, '.oauth_refresh.lock'), h + '.lock']);
    assert.equal(p.configLockPath(join('/h', '.claude.json')), join('/h', '.claude.json') + '.lock');
    assert.equal(p.credentialsPath(h), join(h, '.credentials.json'));
});

test('newAccountId is 8 hex chars', () => assert.match(p.newAccountId(), /^[0-9a-f]{8}$/));

test('accountsRoot and accountFolder', () => {
    assert.equal(p.accountsRoot('/h'), join('/h', '.claude-accounts'));
    assert.equal(p.accountFolder(join('/h', '.claude-accounts'), 'ab'), join('/h', '.claude-accounts', 'ab'));
});

test('globalConfigPath follows the legacy .config.json rule', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cs-paths-'));
    assert.equal(p.globalConfigPath(undefined, home), join(home, '.claude.json'));
    assert.equal(p.globalConfigPath(join(home, 'acc'), home), join(home, 'acc', '.claude.json'));
    await mkdir(join(home, '.claude'));
    await writeFile(join(home, '.claude', '.config.json'), '{"x":1}');
    assert.equal(p.globalConfigPath(undefined, home), join(home, '.claude', '.config.json'));
});
