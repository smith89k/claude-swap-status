// Starts a separate VS Code with this extension and a fake, empty home folder,
// then runs test-launch/suite.cjs inside it. Your real ~/.claude and accounts are
// never touched. Set VSCODE_EXECUTABLE to use an installed VS Code instead of a
// downloaded test copy.
import { runTests } from '@vscode/test-electron';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const extensionDevelopmentPath = resolve('.');
const home = mkdtempSync(join(tmpdir(), 'cs-launch-home-'));
mkdirSync(join(home, '.claude'), { recursive: true });
writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'launch-test@example.com' } }));
const workspace = mkdtempSync(join(tmpdir(), 'cs-launch-ws-'));

try {
    await runTests({
        vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || undefined,
        extensionDevelopmentPath,
        extensionTestsPath: join(extensionDevelopmentPath, 'test-launch', 'suite.cjs'),
        launchArgs: [workspace, '--disable-extensions', '--user-data-dir', join(home, 'vscode-user'), '--extensions-dir', join(home, 'vscode-ext'), '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
        extensionTestsEnv: { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: '' },
    });
} catch (e) {
    console.error('Launch test failed:', e?.message ?? e);
    process.exit(1);
}
