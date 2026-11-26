import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWindowEnv, findConfigDirOverride, WINDOW_ACCOUNT_KEY } from '../core/windowEnv';

const acc = { id: 'a1', folder: '/r/a1', createdAt: 't' };

test('the workspace-state key is fixed', () => assert.equal(WINDOW_ACCOUNT_KEY, 'claudeSwap.windowAccount'));

test('no choice or main uses the original config dir', () => {
    assert.deepEqual(resolveWindowEnv({ choice: undefined, accounts: [acc], folderExists: () => true, originalConfigDir: undefined }), { key: 'main', configDir: undefined });
    assert.deepEqual(resolveWindowEnv({ choice: 'main', accounts: [acc], folderExists: () => true, originalConfigDir: '/custom' }), { key: 'main', configDir: '/custom' });
});

test('a known account with its folder exports that folder verbatim', () => {
    assert.deepEqual(resolveWindowEnv({ choice: 'a1', accounts: [acc], folderExists: () => true, originalConfigDir: undefined }), { key: 'a1', configDir: '/r/a1' });
});

test('missing folder falls back to main', () => {
    const r = resolveWindowEnv({ choice: 'a1', accounts: [acc], folderExists: () => false, originalConfigDir: undefined });
    assert.equal(r.key, 'main');
    assert.equal(r.configDir, undefined);
    assert.match(r.warning!, /main account/);
});

test('unknown account id falls back to main with a warning', () => {
    const r = resolveWindowEnv({ choice: 'zz', accounts: [acc], folderExists: () => true, originalConfigDir: undefined });
    assert.equal(r.key, 'main');
    assert.ok(r.warning);
});

test('findConfigDirOverride', () => {
    assert.equal(findConfigDirOverride([{ name: 'CLAUDE_CONFIG_DIR', value: 'C:\\x' }]), true);
    assert.equal(findConfigDirOverride([{ name: 'CLAUDE_CONFIG_DIR', value: '' }]), false);
    assert.equal(findConfigDirOverride([{ name: 'OTHER', value: '1' }]), false);
    assert.equal(findConfigDirOverride(undefined), false);
    assert.equal(findConfigDirOverride('junk'), false);
});
