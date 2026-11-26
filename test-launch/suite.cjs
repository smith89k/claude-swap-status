// Runs inside a real VS Code started by scripts/run-launch-test.mjs, with a fake
// home folder. Checks that the packaged extension loads and works end to end.
const vscode = require('vscode');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.run = async function run() {
    const home = os.homedir();
    assert.ok(home.includes('cs-launch-home-'), `the test must run with a fake home folder, got ${home}`);

    const ext = vscode.extensions.getExtension('smith89k.claude-swap-status');
    assert.ok(ext, 'the extension is installed in the test editor');
    const api = await ext.activate();
    assert.ok(ext.isActive, 'the extension activates');

    const registered = await vscode.commands.getCommands(true);
    for (const { command } of ext.packageJSON.contributes.commands) {
        assert.ok(registered.includes(command), `command ${command} is registered`);
    }

    assert.equal(api.thisWindowKey(), 'main', 'a window with no choice uses the main login');
    assert.equal(process.env.CLAUDE_CONFIG_DIR, undefined, 'the main login exports no CLAUDE_CONFIG_DIR');

    await api.refresh();
    const views = api.views();
    const main = views.find((v) => v.isMain);
    assert.ok(main, 'the main login is listed');
    assert.equal(main.email, 'launch-test@example.com', 'the main login identity is read from .claude.json');
    assert.ok(main.isThisWindow, 'the main login is marked as this window');
    assert.equal(main.entry && main.entry.status, 'no_credentials', 'with no login file, usage says not signed in (and nothing is sent over the network)');

    const beats = fs.readdirSync(path.join(home, '.claude-accounts', 'windows')).filter((n) => n.endsWith('.json'));
    assert.equal(beats.length, 1, 'this window wrote one heartbeat');

    await vscode.commands.executeCommand('claudeSwap.openPanel');
    await sleep(1500);

    console.log('[launch-test] all checks passed');
};
