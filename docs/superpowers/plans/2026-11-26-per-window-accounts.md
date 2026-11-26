# Per-window Claude Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each Antigravity IDE / VS Code window use its own Claude account. The user manages accounts from the status bar and a new side panel, and the extension no longer depends on claude-swap.

**Architecture:**
- Pure logic lives in `src/core/` and never imports `vscode`. It covers paths, locks, credential storage, OAuth calls, the account and window registries, usage polling, setup sharing, safe delete, and the view snapshot. It's unit-tested with `node:test`.
- Thin glue in `src/vscode/` runs at `*` activation. It sets this window's `CLAUDE_CONFIG_DIR` before the Claude Code extension starts, then a polling controller renders the status bar and tree view.

**Tech Stack:** TypeScript (strict), esbuild bundle, VS Code API `^1.90.0`, Node built-ins only (`fs/promises`, `crypto`, `child_process`, global `fetch`), `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-11-26-per-window-accounts-design.md` (read it first; this plan argues from it).

## Global Constraints

- **Dependencies:** no new runtime dependencies. Node built-ins only. Bundle with esbuild as today.
- **VS Code version:** `engines.vscode` and `@types/vscode` become `^1.90.0`, which gives Node 18+ with global `fetch`.
- **Platforms:** `win32`, `darwin`, `linux`.
- **Accounts root:** `~/.claude-accounts`. It holds `accounts.json`, `usage.json`, `windows/`, `locks/`, and one folder per account. An account's `folder` string is exported **verbatim** as `CLAUDE_CONFIG_DIR`, because the macOS Keychain name is a hash of that exact string.
- **Usage call:** `GET https://api.anthropic.com/api/oauth/usage` with headers `Authorization: Bearer <accessToken>`, `anthropic-beta: oauth-2025-04-20`, and `User-Agent: claude-swap-status`. Timeout 5 000 ms.
- **Refresh call:** `POST https://platform.claude.com/v1/oauth/token` with `Content-Type: application/json` and body `{"grant_type":"refresh_token","refresh_token":<rt>,"client_id":"9d1c250a-e61b-44d9-88ed-5944d1962f5e"}`.
  - Response `access_token`, `expires_in` (seconds), and optional `refresh_token` and `scope` (space-separated).
  - `invalid_grant` means the user must sign in again.
- **Claude's locks:** a lock is a directory, and `mkdir` is the mutex.
  - Credential locks are `<configHome>/.oauth_refresh.lock`, then `<configHome>.lock`. Both go stale after 60 000 ms.
  - The config lock is `<globalConfig>.lock`, stale after 10 000 ms.
  - We touch held locks every 3 000 ms and wait at most 9 000 ms per lock.
- **macOS Keychain:**
  - Binary: `/usr/bin/security`, called by that absolute path.
  - Service: `Claude Code-credentials` when `CLAUDE_CONFIG_DIR` is unset or empty. Otherwise `Claude Code-credentials-` + the first 8 hex chars of `sha256(NFC(raw value))`.
  - Account: `$USER`, then the OS username, then `claude-code-user`.
  - Secrets go only through `security -i` on stdin with `-X <hex>`. Refuse any line over 4 096 bytes. Exit 44 means "not found".
- **Polling:** `claudeSwap.pollIntervalMinutes` (default 1, minimum 0.5).
  - Token-expiry skew is 60 000 ms.
  - A 429 without `Retry-After` backs off for 300 000 ms.
  - The heartbeat is written every 30 000 ms and is stale after 90 000 ms.
- **Colours:** at 70% or more, warning. At 85% or more, error. Use whichever of 5h and 7d is higher.
- **Command ids:** keep `claudeSwap.switchAccount`, `claudeSwap.addAccount`, and `claudeSwap.refreshStatus`.
- **Never:**
  - write into the main config home
  - follow a link or junction when deleting
  - put a token in logs, error messages, the output channel, or process arguments
- **Window choice:** stored in `context.workspaceState` under the key `claudeSwap.windowAccount`, as `"main"` or an account id. Never in any settings file.
- **User-facing text:** plain English, in the README's tone.

## Review Focus

1. **The account folder is deleted or moved outside the extension** while a window still points at it. The window should fall back to the main login with a warning and never export a missing folder. (Task 11: `missing folder falls back to main`.)
2. **`accounts.json` or `usage.json` is corrupt** (a crash mid-write or a hand edit). The extension should keep working. A corrupt registry is set aside, never silently overwritten. (Task 6: `corrupt registry is set aside, not lost`. Task 8: `corrupt usage cache reads as empty`.)
3. **The home path has spaces or non-ASCII characters** (`C:\Users\Nguyễn Văn`). The Keychain hash should use NFC, Keychain quoting should survive `"` and `\`, and links should still work. (Task 2: NFC test. Task 4: quoting test. Task 9: temp dirs named `cs space ễ-*`.)
4. **The main setup lacks some shared folders** (no `skills/` yet). There should be no dangling links, and the folder gets linked on a later sync once it exists. (Task 9: `missing source is skipped, then linked once it exists`.)
5. **A token has no `expiresAt`, or expires inside the 60 s skew.** It's treated as expired: renewed if the account is idle, shown as stale if it's in use. (Task 8: `missing expiresAt counts as expired`.)

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/core/types.ts` | Shared data shapes (below). No logic. |
| `src/core/format.ts` | Bars, countdowns, labels, colour level, picking fresh vs last-known usage. |
| `src/core/paths.ts` | Every path rule: accounts root, config home, global config (legacy rule), credential and lock paths, Keychain names, ids. |
| `src/core/fsjson.ts` | `readJson` and `writeJsonAtomic`. |
| `src/core/locks.ts` | proper-lockfile-compatible directory locks, plus Claude's credential and config lock pairs. |
| `src/core/credentials.ts` | Reading and writing a folder's OAuth credential (file, or macOS Keychain), plus `readIdentity`. |
| `src/core/oauth.ts` | The usage and refresh HTTP calls (the only file with endpoints and the client id). |
| `src/core/registry.ts` | `accounts.json`, shared by all windows. |
| `src/core/windows.ts` | Window heartbeats and "is this account in use". |
| `src/core/usage.ts` | `usage.json` cache and the per-account poll decision (fetch, renew, or keep stale). |
| `src/core/share.ts` | Linking or copying the main setup into account folders, and the `.claude.json` seed and MCP sync. |
| `src/core/safeDelete.ts` | Removing an account folder without ever following a link. |
| `src/core/snapshot.ts` | Turning registry, windows, and usage into `AccountView[]` for the UI. |
| `src/core/windowEnv.ts` | Pure decision about which config dir this window exports, plus override detection. |
| `src/vscode/windowAccount.ts` | Activation-time glue: apply env and terminal env, warnings, the reload prompt. |
| `src/vscode/controller.ts` | Poll and heartbeat timers. Produces snapshots and fires change events. |
| `src/vscode/statusBar.ts` | Status bar item. |
| `src/vscode/accountsView.ts` | Tree view in the Primary Side Bar. |
| `src/vscode/commands.ts` | Every command: quick pick, add, rename, remove, use in window, main login, open panel, refresh. |
| `src/extension.ts` | `activate` and `deactivate` wiring only. All cswap code removed. |
| `src/test/*.test.ts` | Unit tests for `src/core/*`. |
| `scripts/build-tests.mjs` | Bundles tests to `out-test/` with esbuild. |
| `media/accounts.svg` | Activity Bar icon. |

---

### Task 1: Test harness, shared types, formatting

**Files:**
- Create: `scripts/build-tests.mjs`, `src/core/types.ts`, `src/core/format.ts`, `src/test/format.test.ts`, `.github/workflows/ci.yml`
- Modify: `package.json` (scripts), `.gitignore`, `.github/workflows/publish.yml`

**Interfaces:**
- Produces: everything in `types.ts`, plus `progressBar(pct: number): string`, `formatResetIn(resetsAt: string | undefined, now?: number): string | null`, `formatWindow(w: UsageWindow, now?: number): string`, `formatResetDetail(label: string, w: UsageWindow | undefined, now?: number): string`, `statusLabel(status?: string): string`, `needsAttention(status?: string): boolean`, `formatAge(seconds?: number): string`, `usageLevel(usage?: Usage): 'normal' | 'warning' | 'error'`, and `pickUsage(entry: UsageEntry | undefined, now: number): { usage: Usage; stale: boolean; ageSeconds?: number } | null`.

- [ ] **Step 0: Branch and install.** Run `git checkout -b feat/per-window-accounts` and then `npm install`. Expected: no errors.

- [ ] **Step 1: Create `src/core/types.ts` with exactly these shapes** (every later task uses them):

```ts
export const MAIN_KEY = 'main';
export interface OAuthCredential { accessToken: string; refreshToken?: string; expiresAt?: number; scopes?: string[]; subscriptionType?: string; [key: string]: unknown; }
export interface CredentialFile { claudeAiOauth?: OAuthCredential; [key: string]: unknown; }
export interface ConfigTarget { configHome: string; configDirEnv: string | undefined; }
export interface UsageWindow { pct: number; resetsAt?: string; }
export interface Usage { fiveHour?: UsageWindow; sevenDay?: UsageWindow; }
export type UsageStatus = 'ok' | 'token_expired' | 'relogin_required' | 'no_credentials' | 'rate_limited' | 'unavailable';
export interface UsageEntry { status: UsageStatus; usage?: Usage; fetchedAt?: number; lastGood?: Usage; lastGoodAt?: number; backoffUntil?: number; plan?: string; }
export interface Account { id: string; folder: string; email?: string; orgUuid?: string; orgName?: string; alias?: string; createdAt: string; }
export interface Identity { email: string; orgUuid?: string; orgName?: string; }
export interface WindowBeat { windowId: string; accountKey: string; workspaceName: string; pid: number; updatedAt: number; }
export interface AccountView { key: string; label: string; email?: string; orgName?: string; isMain: boolean; isThisWindow: boolean; signedIn: boolean; usedBy: string[]; entry?: UsageEntry; }
```

- [ ] **Step 2: Create `scripts/build-tests.mjs`.** It uses the esbuild JS API to bundle every `src/test/*.test.ts` into `out-test/` with options `{ bundle: true, platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'], sourcemap: 'inline', logLevel: 'warning' }`.
  - Add `"test": "node scripts/build-tests.mjs && node --test \"out-test/*.test.js\""` to `package.json` scripts.
  - Add `out-test` to `.gitignore`.

- [ ] **Step 3: Write the failing tests** in `src/test/format.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { progressBar, formatResetIn, formatWindow, formatResetDetail, statusLabel, needsAttention, formatAge, usageLevel, pickUsage } from '../core/format';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const M = 60_000, H = 60 * M, D = 24 * H;
const at = (ms: number) => new Date(NOW + ms).toISOString();

test('progressBar rounds to five cells and clamps', () => {
  assert.equal(progressBar(25), '█░░░░');
  assert.equal(progressBar(0), '░░░░░');
  assert.equal(progressBar(140), '█████');
});
test('formatResetIn shows two units and drops a zero second unit', () => {
  assert.equal(formatResetIn(at(3 * H + 12 * M), NOW), '3h12m');
  assert.equal(formatResetIn(at(D + 4 * H), NOW), '1d4h');
  assert.equal(formatResetIn(at(4 * D), NOW), '4d');
  assert.equal(formatResetIn(at(45 * M), NOW), '45m');
  assert.equal(formatResetIn(at(-5 * M), NOW), '0m');
  assert.equal(formatResetIn(undefined, NOW), null);
  assert.equal(formatResetIn('not a date', NOW), null);
});
test('formatWindow and formatResetDetail', () => {
  assert.equal(formatWindow({ pct: 25.4, resetsAt: at(3 * H + 12 * M) }, NOW), '█░░░░ 25% R:3h12m');
  assert.equal(formatWindow({ pct: 25.4 }, NOW), '█░░░░ 25%');
  assert.equal(formatResetDetail('5h', undefined, NOW), '5h: no reset scheduled');
});
test('usageLevel uses the higher window: 70 warns, 85 is an error', () => {
  assert.equal(usageLevel(undefined), 'normal');
  assert.equal(usageLevel({ fiveHour: { pct: 69.9 } }), 'normal');
  assert.equal(usageLevel({ fiveHour: { pct: 70 } }), 'warning');
  assert.equal(usageLevel({ sevenDay: { pct: 85 } }), 'error');
  assert.equal(usageLevel({ fiveHour: { pct: 10 }, sevenDay: { pct: 86 } }), 'error');
});
test('status labels and which statuses need attention', () => {
  assert.equal(statusLabel('relogin_required'), 're-login needed');
  assert.equal(statusLabel('rate_limited'), 'rate limited');
  assert.equal(statusLabel('no_credentials'), 'not signed in');
  assert.equal(statusLabel('weird'), 'weird');
  assert.equal(statusLabel(undefined), 'unknown');
  assert.equal(needsAttention('ok'), false);
  assert.equal(needsAttention('token_expired'), false);
  assert.equal(needsAttention('rate_limited'), false);
  assert.equal(needsAttention('relogin_required'), true);
  assert.equal(needsAttention('no_credentials'), true);
});
test('formatAge', () => {
  assert.equal(formatAge(undefined), 'a while');
  assert.equal(formatAge(30), 'under a minute');
  assert.equal(formatAge(600), '10m');
  assert.equal(formatAge(3900), '1h5m');
  assert.equal(formatAge(7200), '2h');
  assert.equal(formatAge(90_000), '1d');
});
test('pickUsage prefers fresh usage, else last known with its age', () => {
  const u = { fiveHour: { pct: 1 } }, old = { fiveHour: { pct: 2 } };
  assert.deepEqual(pickUsage({ status: 'ok', usage: u, fetchedAt: NOW - 10_000 }, NOW), { usage: u, stale: false, ageSeconds: 10 });
  assert.deepEqual(pickUsage({ status: 'token_expired', lastGood: old, lastGoodAt: NOW - 120_000 }, NOW), { usage: old, stale: true, ageSeconds: 120 });
  assert.equal(pickUsage({ status: 'no_credentials' }, NOW), null);
  assert.equal(pickUsage(undefined, NOW), null);
});
```

- [ ] **Step 4: Run `npm test`.** Expected: FAIL, because it can't resolve `../core/format`.

- [ ] **Step 5: Implement `src/core/format.ts`.** Move the existing helpers from `src/extension.ts` (`getProgressBar`, `formatResetIn`, `formatWindow`, `formatResetDetail`, `STATUS_LABELS`, `statusLabel`, `needsAttention`, `formatAge`) into it, renaming `getProgressBar` to `progressBar`.
  - Add an injectable `now` parameter.
  - `formatResetDetail` computes the clock with `new Date(resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })`.
  - The status labels are `ok`, `token expired`, `re-login needed`, `not signed in`, `rate limited`, and `unavailable`.
  - Leave `src/extension.ts` untouched for now. Task 12 rewrites it.

- [ ] **Step 6: Run `npm test`.** Expected: PASS (7 tests).

- [ ] **Step 7: CI.**
  - Create `.github/workflows/ci.yml`:
    - Trigger on `push` and `pull_request`.
    - Matrix `os: [ubuntu-24.04, windows-2025, macos-15]`.
    - Steps: `actions/checkout@v7`, `actions/setup-node@v7` with `node-version: 24.x` and `cache: npm`, `npm ci --ignore-scripts`, `npx tsc -p ./ --noEmit`, `npm test`.
  - In `publish.yml`, add a step named `Unit tests` that runs `npm test` right after `Type check`.

- [ ] **Step 8: Commit.**

```bash
git add scripts/build-tests.mjs src/core/types.ts src/core/format.ts src/test/format.test.ts package.json package-lock.json .gitignore .github/workflows
git commit -m "test: add unit test harness and move formatting into core"
```

---

### Task 2: Path rules

**Files:**
- Create: `src/core/paths.ts`, `src/test/paths.test.ts`

**Interfaces:**
- Produces: `accountsRoot(home?: string): string` (`<home>/.claude-accounts`), `accountFolder(root: string, id: string): string`, `newAccountId(): string` (8 lowercase hex chars from `crypto.randomBytes(4)`), `isInside(root: string, target: string): boolean`, `configHome(configDirEnv: string | undefined, home?: string): string`, `globalConfigPath(configDirEnv: string | undefined, home?: string): string` (synchronous), `credentialsPath(configHome: string): string`, `credentialLockPaths(configHome: string): [string, string]`, `configLockPath(globalConfig: string): string`, `keychainService(configDirEnv: string | undefined): string`, and `keychainAccount(env?: NodeJS.ProcessEnv): string`. `home` defaults to `os.homedir()`.

- [ ] **Step 1: Write the failing tests** in `src/test/paths.test.ts`:

```ts
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
  assert.equal(p.keychainService('/Users/Nguye\u0302\u0303n'), p.keychainService('/Users/Nguy\u1ec5n'));
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
test('globalConfigPath follows the legacy .config.json rule', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cs-paths-'));
  assert.equal(p.globalConfigPath(undefined, home), join(home, '.claude.json'));
  assert.equal(p.globalConfigPath(join(home, 'acc'), home), join(home, 'acc', '.claude.json'));
  await mkdir(join(home, '.claude'));
  await writeFile(join(home, '.claude', '.config.json'), '{"x":1}');
  assert.equal(p.globalConfigPath(undefined, home), join(home, '.claude', '.config.json'));
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL, because `../core/paths` isn't found.

- [ ] **Step 3: Implement `src/core/paths.ts`.**
  - `globalConfigPath` rule: the legacy path is `<configHome>/.config.json`. It wins when it's a regular file and either its size is greater than 0, or it's writable and `(configDirEnv || home)/.claude.json` doesn't exist. Otherwise return `(configDirEnv || home)/.claude.json`. Any stat error means the non-legacy path wins.
  - `isInside` resolves both paths and checks that `path.relative` is non-empty, doesn't start with `..`, and isn't absolute.
  - `credentialLockPaths` strips trailing separators before appending `.lock`.

- [ ] **Step 4: Run `npm test`.** Expected: PASS.

- [ ] **Step 5: Commit** with `git add src/core/paths.ts src/test/paths.test.ts && git commit -m "feat(core): path, lock and keychain name rules"`.

---

### Task 3: Atomic JSON and Claude-compatible locks

**Files:**
- Create: `src/core/fsjson.ts`, `src/core/locks.ts`, `src/test/locks.test.ts`

**Interfaces:**
- Consumes: `credentialLockPaths` and `configLockPath` (Task 2).
- Produces:
  - `fsjson.ts`: `class CorruptJsonError extends Error`, `readJson<T>(file: string): Promise<T | undefined>` (returns undefined when the file is missing, throws `CorruptJsonError` on bad JSON), and `writeJsonAtomic(file: string, value: unknown): Promise<void>`.
  - `locks.ts`: `class LockTimeoutError extends Error`, `acquireLock(lockPath: string, opts: { staleMs: number; touchMs?: number; waitMs?: number }): Promise<() => Promise<void>>`, `withLock<T>(lockPath: string, opts: { staleMs: number; touchMs?: number; waitMs?: number }, fn: () => Promise<T>): Promise<T>`, `withCredentialLocks<T>(configHome: string, fn: () => Promise<T>): Promise<T>`, `withConfigLock<T>(globalConfig: string, fn: () => Promise<T>): Promise<T>`, and the constants `CREDENTIAL_STALE_MS = 60_000`, `CONFIG_STALE_MS = 10_000`, `TOUCH_MS = 3_000`, `WAIT_MS = 9_000`.

- [ ] **Step 1: Write the failing tests** in `src/test/locks.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readJson, writeJsonAtomic, CorruptJsonError } from '../core/fsjson';
import { acquireLock, withCredentialLocks, LockTimeoutError } from '../core/locks';
import { credentialLockPaths } from '../core/paths';

const tmp = () => mkdtemp(join(tmpdir(), 'cs-locks-'));

test('writeJsonAtomic round-trips and leaves no temp files', async () => {
  const d = await tmp(); const f = join(d, 'sub', 'a.json');
  await writeJsonAtomic(f, { a: 1 });
  assert.deepEqual(await readJson(f), { a: 1 });
  assert.deepEqual(await readdir(join(d, 'sub')), ['a.json']);
});
test('readJson: missing is undefined, bad JSON throws CorruptJsonError', async () => {
  const d = await tmp();
  assert.equal(await readJson(join(d, 'none.json')), undefined);
  await writeFile(join(d, 'bad.json'), '{nope');
  await assert.rejects(readJson(join(d, 'bad.json')), CorruptJsonError);
});
test('acquire creates the lock dir, release removes it', async () => {
  const lp = join(await tmp(), 'x.lock');
  const release = await acquireLock(lp, { staleMs: 60_000 });
  assert.ok(existsSync(lp));
  await release();
  assert.ok(!existsSync(lp));
});
test('a held lock makes a second acquire time out', async () => {
  const lp = join(await tmp(), 'x.lock');
  const release = await acquireLock(lp, { staleMs: 60_000 });
  await assert.rejects(acquireLock(lp, { staleMs: 60_000, waitMs: 300 }), LockTimeoutError);
  await release();
});
test('a stale lock is taken over', async () => {
  const lp = join(await tmp(), 'x.lock');
  await mkdir(lp);
  const old = (Date.now() - 61_000) / 1000;
  await utimes(lp, old, old);
  const release = await acquireLock(lp, { staleMs: 60_000, waitMs: 300 });
  await release();
});
test('the holder keeps touching the lock', async () => {
  const lp = join(await tmp(), 'x.lock');
  const release = await acquireLock(lp, { staleMs: 60_000, touchMs: 50 });
  const past = (Date.now() - 30_000) / 1000;
  await utimes(lp, past, past);
  await delay(250);
  assert.ok((await stat(lp)).mtimeMs > past * 1000 + 1000);
  await release();
});
test('withCredentialLocks holds both locks and always releases', async () => {
  const home = join(await tmp(), 'acc'); await mkdir(home);
  const [a, b] = credentialLockPaths(home);
  await withCredentialLocks(home, async () => { assert.ok(existsSync(a) && existsSync(b)); });
  assert.ok(!existsSync(a) && !existsSync(b));
  await assert.rejects(withCredentialLocks(home, async () => { throw new Error('boom'); }), /boom/);
  assert.ok(!existsSync(a) && !existsSync(b));
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `src/core/fsjson.ts`.**
  - Create the parent directory recursively.
  - Write to `${file}.${process.pid}.${random hex}.tmp` with mode `0o600`, then `rename` over the target.
  - On a rename failure, delete the temp file and rethrow.

- [ ] **Step 4: Implement `src/core/locks.ts`.**
  - `acquireLock` loops on `mkdir(lockPath)`:
    - On `EEXIST`, `stat` the lock. If `now - mtimeMs > staleMs`, `rmdir` it (non-recursive) and retry right away. Otherwise sleep 100–250 ms with jitter, and once `waitMs` (default `WAIT_MS`) has passed, throw `LockTimeoutError`.
    - Any other error is rethrown.
  - After acquiring, a `setInterval(touchMs ?? TOUCH_MS)` calls `utimes(lockPath, now, now)`, ignoring errors, with `.unref()`.
  - The returned release function clears the interval and runs `rmdir`, ignoring `ENOENT`.
  - `withCredentialLocks` takes the first path, then the second (both `{ staleMs: CREDENTIAL_STALE_MS }`), and releases them in reverse inside `finally`.
  - `withConfigLock` takes `configLockPath(globalConfig)` with `{ staleMs: CONFIG_STALE_MS }`.

- [ ] **Step 5: Run `npm test`.** Expected: PASS.

- [ ] **Step 6: Commit** with `git commit -m "feat(core): atomic json writes and Claude-compatible locks"` (add the three files).

---

### Task 4: Credential store and identity

**Files:**
- Create: `src/core/credentials.ts`, `src/test/credentials.test.ts`

**Interfaces:**
- Consumes: `credentialsPath`, `keychainService`, `keychainAccount`, `globalConfigPath` (Task 2), and `readJson`/`writeJsonAtomic` (Task 3).
- Produces:
  - `type SecurityRunner = (args: string[], stdin?: string) => Promise<{ code: number; stdout: string; stderr: string }>`
  - `class KeychainError extends Error`
  - `interface CredentialStore { read(t: ConfigTarget): Promise<CredentialFile | undefined>; write(t: ConfigTarget, value: CredentialFile): Promise<void>; remove(t: ConfigTarget): Promise<void>; }`
  - `createCredentialStore(opts: { platform: NodeJS.Platform; runSecurity?: SecurityRunner; env?: NodeJS.ProcessEnv }): CredentialStore`
  - `readIdentity(globalConfig: string): Promise<Identity | undefined>`

- [ ] **Step 1: Write the failing tests** in `src/test/credentials.test.ts`:

```ts
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
  const run: SecurityRunner = async (args, stdin) => { calls.push({ args, stdin }); return { code: reply.code, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' }; };
  return { run, calls };
}

test('file store round-trips and keeps unknown fields', async () => {
  const home = await tmp(); const t = { configHome: home, configDirEnv: home };
  const store = createCredentialStore({ platform: 'linux' });
  assert.equal(await store.read(t), undefined);
  await store.write(t, cred);
  assert.deepEqual(await store.read(t), cred);
});
test('mac read uses the hashed service and the USER account', async () => {
  const raw = '/u/.claude-accounts/ab'; const { run, calls } = fakeRunner({ code: 0, stdout: JSON.stringify(cred) + '\n' });
  const store = createCredentialStore({ platform: 'darwin', runSecurity: run, env: { USER: 'sam' } });
  assert.deepEqual(await store.read({ configHome: raw, configDirEnv: raw }), cred);
  assert.deepEqual(calls[0].args, ['find-generic-password', '-a', 'sam', '-w', '-s', keychainService(raw)]);
});
test('mac read falls back to the plaintext file on exit 44', async () => {
  const home = await tmp(); await writeFile(join(home, '.credentials.json'), JSON.stringify(cred));
  const { run } = fakeRunner({ code: 44 });
  const store = createCredentialStore({ platform: 'darwin', runSecurity: run, env: { USER: 'sam' } });
  assert.deepEqual(await store.read({ configHome: home, configDirEnv: home }), cred);
});
test('mac write sends hex on stdin, never the secret in argv', async () => {
  const raw = '/u/.claude-accounts/ab'; const { run, calls } = fakeRunner({ code: 0 });
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
test('keychain errors never carry the secret', async () => {
  const { run } = fakeRunner({ code: 51, stdout: JSON.stringify(cred), stderr: 'denied' });
  const store = createCredentialStore({ platform: 'darwin', runSecurity: run, env: { USER: 'sam' } });
  await assert.rejects(store.read({ configHome: '/x', configDirEnv: '/x' }), (e: Error) => e instanceof KeychainError && !e.message.includes('secret'));
});
test('readIdentity reads oauthAccount', async () => {
  const d = await tmp(); const f = join(d, '.claude.json');
  assert.equal(await readIdentity(f), undefined);
  await writeFile(f, JSON.stringify({ oauthAccount: { emailAddress: 'w@x.com', organizationUuid: 'org1', organizationName: 'Acme' } }));
  assert.deepEqual(await readIdentity(f), { email: 'w@x.com', orgUuid: 'org1', orgName: 'Acme' });
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.

- [ ] **Step 3: Implement `src/core/credentials.ts`.**
  - **Linux and Windows:** use `credentialsPath(t.configHome)` with `readJson`/`writeJsonAtomic`. `remove` unlinks the file and ignores `ENOENT`.
  - **macOS:**
    - Read with `['find-generic-password','-a',acct,'-w','-s',svc]`. Strip exactly one trailing `\n` and parse the JSON. Exit 44 falls back to the file. Any other non-zero exit throws `KeychainError` with the message `Keychain read failed (exit <code>)`, which never includes stdout.
    - Write sends the single line from the test to `['-i']`. If that line is over 4096 bytes UTF-8, throw `KeychainError('Credential too large to save to the Keychain safely')` without running anything.
    - Remove runs `['delete-generic-password','-a',acct,'-s',svc]`, where exit 44 is fine.
  - `svc` is `keychainService(t.configDirEnv)` and `acct` is `keychainAccount(env)`.
  - The default runner spawns `/usr/bin/security` with a 10 000 ms kill timeout.
  - `readIdentity` returns undefined if the file is missing, corrupt, or has no `oauthAccount.emailAddress`.

- [ ] **Step 4: Run `npm test`.** Expected: PASS.

- [ ] **Step 5: Commit** with `git commit -m "feat(core): credential store for files and macOS Keychain"`.

---

### Task 5: OAuth usage and refresh calls

**Files:**
- Create: `src/core/oauth.ts`, `src/test/oauth.test.ts`

**Interfaces:**
- Consumes: `OAuthCredential`, `Usage` (Task 1).
- Produces:
  - Constants: `USAGE_URL`, `TOKEN_URL`, `CLIENT_ID`, `BETA_HEADER`.
  - `type FetchLike = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>`
  - `type UsageResult = { ok: true; usage: Usage } | { ok: false; kind: 'unauthorized' | 'rate_limited' | 'network' | 'bad_response'; retryAfterMs?: number }`
  - `type RefreshResult = { ok: true; cred: OAuthCredential } | { ok: false; kind: 'invalid_grant' | 'no_refresh_token' | 'network' | 'bad_response' }`
  - `fetchUsage(accessToken: string, fetchImpl?: FetchLike): Promise<UsageResult>`
  - `refreshAccessToken(cred: OAuthCredential, fetchImpl?: FetchLike, now?: number): Promise<RefreshResult>`
  - The default `fetchImpl` is `globalThis.fetch`.

- [ ] **Step 1: Write the failing tests** in `src/test/oauth.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchUsage, refreshAccessToken, USAGE_URL, TOKEN_URL, type FetchLike } from '../core/oauth';

function fake(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init: any }[] = [];
  const fn: FetchLike = async (url, init) => { calls.push({ url, init }); return { status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => body }; };
  return { fn, calls };
}
const throwing: FetchLike = async () => { throw new Error('ECONNRESET'); };

test('fetchUsage sends bearer and beta headers and normalises windows', async () => {
  const { fn, calls } = fake(200, { five_hour: { utilization: 25, resets_at: '2026-11-26T15:00:00Z' }, seven_day: { utilization: 16, resets_at: null } });
  assert.deepEqual(await fetchUsage('tok', fn), { ok: true, usage: { fiveHour: { pct: 25, resetsAt: '2026-11-26T15:00:00Z' }, sevenDay: { pct: 16 } } });
  assert.equal(calls[0].url, USAGE_URL);
  assert.equal(calls[0].init.headers['Authorization'], 'Bearer tok');
  assert.equal(calls[0].init.headers['anthropic-beta'], 'oauth-2025-04-20');
});
test('fetchUsage maps failures', async () => {
  assert.deepEqual(await fetchUsage('t', fake(429, {}, { 'retry-after': '120' }).fn), { ok: false, kind: 'rate_limited', retryAfterMs: 120_000 });
  assert.deepEqual(await fetchUsage('t', fake(429, {}).fn), { ok: false, kind: 'rate_limited' });
  assert.deepEqual(await fetchUsage('t', fake(401, {}).fn), { ok: false, kind: 'unauthorized' });
  assert.deepEqual(await fetchUsage('t', fake(500, {}).fn), { ok: false, kind: 'bad_response' });
  assert.deepEqual(await fetchUsage('t', throwing), { ok: false, kind: 'network' });
});
test('refreshAccessToken posts the grant and rotates tokens', async () => {
  const { fn, calls } = fake(200, { access_token: 'A2', refresh_token: 'R2', expires_in: 3600, scope: 'user:inference user:profile' });
  const r = await refreshAccessToken({ accessToken: 'A1', refreshToken: 'R1', expiresAt: 0, subscriptionType: 'max' }, fn, 1_000);
  assert.deepEqual(r, { ok: true, cred: { accessToken: 'A2', refreshToken: 'R2', expiresAt: 3_601_000, subscriptionType: 'max', scopes: ['user:inference', 'user:profile'] } });
  assert.equal(calls[0].url, TOKEN_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { grant_type: 'refresh_token', refresh_token: 'R1', client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e' });
});
test('refreshAccessToken keeps the old refresh token when none comes back', async () => {
  const r = await refreshAccessToken({ accessToken: 'A1', refreshToken: 'R1' }, fake(200, { access_token: 'A2', expires_in: 60 }).fn, 0);
  assert.equal(r.ok && r.cred.refreshToken, 'R1');
});
test('refresh failures carry no token text', async () => {
  const r = await refreshAccessToken({ accessToken: 'A1', refreshToken: 'R1' }, fake(400, { error: 'invalid_grant' }).fn, 0);
  assert.deepEqual(r, { ok: false, kind: 'invalid_grant' });
  const none = fake(200, {});
  assert.deepEqual(await refreshAccessToken({ accessToken: 'A1' }, none.fn, 0), { ok: false, kind: 'no_refresh_token' });
  assert.equal(none.calls.length, 0);
  assert.deepEqual(await refreshAccessToken({ accessToken: 'A1', refreshToken: 'R1' }, throwing, 0), { ok: false, kind: 'network' });
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.

- [ ] **Step 3: Implement `src/core/oauth.ts`.**
  - **Timeouts:** both calls use `AbortController` plus `setTimeout(5000)`, cleared in `finally`.
  - **Usage results:**
    - 200 with an object body maps `five_hour`/`seven_day` to `{ pct: utilization, resetsAt?: resets_at }`. Omit a window when it's absent, and omit `resetsAt` when it's null.
    - 401 and 403 are `unauthorized`.
    - 429 is `rate_limited`, with `retryAfterMs` set only when `Retry-After` parses as seconds.
    - Any other status, or a body that isn't JSON, is `bad_response`.
    - A thrown error or abort is `network`.
  - **Refresh results:**
    - A 400 or 401 whose body `error === 'invalid_grant'` is `invalid_grant`.
    - Other non-200 responses are `bad_response`.
    - Success returns `{ ...cred, accessToken, expiresAt: now + expires_in * 1000 }`, plus `refreshToken` and `scopes` only when the response has them.
  - Keep all endpoint and client-id values in this one file.

- [ ] **Step 4: Run `npm test`.** Expected: PASS.

- [ ] **Step 5: Commit** with `git commit -m "feat(core): usage and token refresh calls"`.

---

### Task 6: Account registry

**Files:**
- Create: `src/core/registry.ts`, `src/test/registry.test.ts`

**Interfaces:**
- Consumes: `readJson`, `writeJsonAtomic`, `CorruptJsonError`, `withLock` (Task 3), and `Account` (Task 1).
- Produces: `class Registry { constructor(root: string); list(): Promise<Account[]>; get(id: string): Promise<Account | undefined>; add(a: { id: string; folder: string }): Promise<Account>; update(id: string, patch: { email?: string; orgUuid?: string; orgName?: string; alias?: string }): Promise<Account>; remove(id: string): Promise<void>; }`. The file is `<root>/accounts.json` with the shape `{ "version": 1, "accounts": Account[] }`. Writes hold `withLock(<root>/accounts.json.lock, { staleMs: 10_000 })`. Setting `alias: ''` removes the alias.

- [ ] **Step 1: Write the failing tests** in `src/test/registry.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Registry } from '../core/registry';

const tmp = () => mkdtemp(join(tmpdir(), 'cs-reg-'));

test('add, list, update, clear alias and remove', async () => {
  const root = await tmp(); const reg = new Registry(root);
  assert.deepEqual(await reg.list(), []);
  const a = await reg.add({ id: 'ab12cd34', folder: join(root, 'ab12cd34') });
  assert.equal(typeof a.createdAt, 'string');
  await reg.update('ab12cd34', { alias: 'work', email: 'w@x.com' });
  assert.equal((await reg.get('ab12cd34'))?.alias, 'work');
  await reg.update('ab12cd34', { alias: '' });
  assert.equal((await reg.get('ab12cd34'))?.alias, undefined);
  await reg.remove('ab12cd34');
  assert.deepEqual(await reg.list(), []);
});
test('update of an unknown id rejects', async () => {
  await assert.rejects(new Registry(await tmp()).update('nope', { alias: 'x' }));
});
test('parallel adds from several windows all survive', async () => {
  const root = await tmp();
  await Promise.all([0, 1, 2].map((i) => new Registry(root).add({ id: `id${i}`, folder: join(root, `id${i}`) })));
  assert.deepEqual((await new Registry(root).list()).map((a) => a.id).sort(), ['id0', 'id1', 'id2']);
});
test('corrupt registry is set aside, not lost', async () => {
  const root = await tmp();
  await writeFile(join(root, 'accounts.json'), '{not json');
  const reg = new Registry(root);
  assert.deepEqual(await reg.list(), []);
  await reg.add({ id: 'n1', folder: join(root, 'n1') });
  assert.ok((await readdir(root)).some((n) => n.startsWith('accounts.json.corrupt-')));
  assert.equal((await reg.list()).length, 1);
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.

- [ ] **Step 3: Implement `src/core/registry.ts`.**
  - `list` returns `[]` for a missing file or a `CorruptJsonError`.
  - Every mutation runs read, modify, then `writeJsonAtomic`, all under the lock.
  - If that read hits `CorruptJsonError`, first `rename` the file to `accounts.json.corrupt-<Date.now()>`, then continue from an empty list.

- [ ] **Step 4: Run `npm test`.** Expected: PASS.

- [ ] **Step 5: Commit** with `git commit -m "feat(core): shared account registry"`.

---

### Task 7: Window heartbeats and in-use detection

**Files:**
- Create: `src/core/windows.ts`, `src/test/windows.test.ts`

**Interfaces:**
- Consumes: `readJson`, `writeJsonAtomic` (Task 3), and `WindowBeat` (Task 1).
- Produces:
  - `isPidAlive(pid: number): boolean`
  - `class WindowRegistry { constructor(root: string, now?: () => number, isAlive?: (pid: number) => boolean); beat(b: Omit<WindowBeat, 'updatedAt'>): Promise<void>; remove(windowId: string): Promise<void>; live(): Promise<WindowBeat[]>; }`. Files live at `<root>/windows/<windowId>.json`. A beat is live when `now - updatedAt <= 90_000` and `isAlive(pid)`. Dead beats are deleted on a best-effort basis.
  - `isAccountInUse(a: { accountKey: string; configHome: string; liveWindows: WindowBeat[]; isAlive?: (pid: number) => boolean; now?: () => number }): Promise<boolean>`

- [ ] **Step 1: Write the failing tests** in `src/test/windows.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WindowRegistry, isAccountInUse, isPidAlive } from '../core/windows';

const tmp = () => mkdtemp(join(tmpdir(), 'cs-win-'));

test('live() keeps fresh beats with live pids only', async () => {
  const root = await tmp(); let now = 1_000_000; const alive = new Set([111, 222]);
  const reg = new WindowRegistry(root, () => now, (pid) => alive.has(pid));
  await reg.beat({ windowId: 'w1', accountKey: 'main', workspaceName: 'a', pid: 111 });
  await reg.beat({ windowId: 'w2', accountKey: 'ab', workspaceName: 'b', pid: 222 });
  await reg.beat({ windowId: 'w3', accountKey: 'ab', workspaceName: 'c', pid: 333 });
  now += 60_000;
  await reg.beat({ windowId: 'w2', accountKey: 'ab', workspaceName: 'b', pid: 222 });
  now += 40_000;
  assert.deepEqual((await reg.live()).map((b) => b.windowId), ['w2']);
});
test('remove() deletes a beat', async () => {
  const root = await tmp(); const reg = new WindowRegistry(root);
  await reg.beat({ windowId: 'w1', accountKey: 'main', workspaceName: 'a', pid: process.pid });
  await reg.remove('w1');
  assert.ok(!existsSync(join(root, 'windows', 'w1.json')));
});
test('isPidAlive', () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(2 ** 22 + 12345), false);
});
test('in use: a live window, a live Claude session, or a fresh refresh lock', async () => {
  const home = join(await tmp(), 'acc'); await mkdir(join(home, 'sessions'), { recursive: true });
  const base = { accountKey: 'ab', configHome: home, liveWindows: [], isAlive: (p: number) => p === 4242 };
  assert.equal(await isAccountInUse(base), false);
  assert.equal(await isAccountInUse({ ...base, liveWindows: [{ windowId: 'w', accountKey: 'ab', workspaceName: 'x', pid: 1, updatedAt: 0 }] }), true);
  await writeFile(join(home, 'sessions', '4242.json'), JSON.stringify({ pid: 4242 }));
  assert.equal(await isAccountInUse(base), true);
  await rm(join(home, 'sessions', '4242.json'));
  await writeFile(join(home, 'sessions', '999.json'), JSON.stringify({ pid: 999 }));
  await writeFile(join(home, 'sessions', 'bad.json'), '{x');
  assert.equal(await isAccountInUse(base), false);
  await mkdir(join(home, '.oauth_refresh.lock'));
  assert.equal(await isAccountInUse(base), true);
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.

- [ ] **Step 3: Implement `src/core/windows.ts`.**
  - `isPidAlive` runs `process.kill(pid, 0)`. `ESRCH` means false and `EPERM` means true.
  - `isAccountInUse` returns true when any of these hold:
    - a live window has a matching `accountKey`
    - any `<configHome>/sessions/*.json` (skipping unreadable files) has a numeric `pid` for which `isAlive` is true
    - `<configHome>/.oauth_refresh.lock` exists with `now - mtimeMs <= 60_000`

- [ ] **Step 4: Run `npm test`.** Expected: PASS.

- [ ] **Step 5: Commit** with `git commit -m "feat(core): window heartbeats and in-use detection"`.

---

### Task 8: Usage cache and the poll decision

**Files:**
- Create: `src/core/usage.ts`, `src/test/usage.test.ts`

**Interfaces:**
- Consumes: `CredentialStore` (Task 4), `UsageResult` and `RefreshResult` (Task 5), `withLock` and `fsjson` (Task 3), and the types from Task 1.
- Produces:
  - `class UsageCache { constructor(root: string); read(): Promise<Record<string, UsageEntry>>; get(key: string): Promise<UsageEntry | undefined>; put(key: string, e: UsageEntry): Promise<void>; remove(key: string): Promise<void>; }`. The file is `<root>/usage.json`. Writes hold `withLock(<root>/usage.json.lock, { staleMs: 10_000 })`. A corrupt file reads as `{}`.
  - `interface PollDeps { cache: UsageCache; credentials: CredentialStore; fetchUsage(token: string): Promise<UsageResult>; refresh(cred: OAuthCredential): Promise<RefreshResult>; inUse(): Promise<boolean>; withCredentialLocks<T>(configHome: string, fn: () => Promise<T>): Promise<T>; withFetchLock<T>(key: string, fn: () => Promise<T>): Promise<T>; now(): number; }`
  - `pollAccount(key: string, target: ConfigTarget, intervalMs: number, deps: PollDeps): Promise<UsageEntry>`
  - Constants: `EXPIRY_SKEW_MS = 60_000` and `DEFAULT_BACKOFF_MS = 300_000`.

- [ ] **Step 1: Write the failing tests** in `src/test/usage.test.ts`. First write this helper in the test file:

```ts
async function setup(o: { cred?: CredentialFile; inUse?: boolean; usage?: UsageResult; refresh?: RefreshResult;
  cache?: Record<string, UsageEntry>; onCredLock?: (store: { set(f: CredentialFile): void }) => void;
  realFetchLock?: boolean; fetchDelayMs?: number }):
  Promise<{ deps: PollDeps; counts: { fetch: number; refresh: number; credLocks: number }; store: CredentialStore & { set(f: CredentialFile): void }; lastFetchToken(): string | undefined }>
// - store holds one CredentialFile in memory (o.cred); write() and set() replace it
// - deps.cache = new UsageCache(<temp root>), pre-filled with o.cache via put()
// - deps.now = () => 1_000_000; deps.inUse = async () => !!o.inUse
// - deps.withCredentialLocks: counts.credLocks++, calls o.onCredLock?.(store), then fn()
// - deps.withFetchLock: pass-through, or withLock(join(root, 'locks', `fetch-${key}.lock`), { staleMs: 30_000 }, fn) when o.realFetchLock
// - deps.fetchUsage: waits o.fetchDelayMs ?? 0, counts.fetch++, records the token, returns o.usage ?? { ok: true, usage: {} }
// - deps.refresh: counts.refresh++, returns o.refresh ?? { ok: false, kind: 'network' }
```

Then the tests:

```ts
const T = { configHome: '/acc', configDirEnv: '/acc' };
const valid = { claudeAiOauth: { accessToken: 'A', refreshToken: 'R', expiresAt: 1_000_000 + 3_600_000, subscriptionType: 'max' } };
const expired = { claudeAiOauth: { accessToken: 'A', refreshToken: 'R', expiresAt: 1_000_000 + 30_000 } }; // inside the 60 s skew
const U = { fiveHour: { pct: 40 } };

test('a fresh cache entry is returned without any network call', async () => {
  const s = await setup({ cred: valid, cache: { k: { status: 'ok', usage: U, fetchedAt: 1_000_000 - 10_000 } } });
  assert.deepEqual((await pollAccount('k', T, 60_000, s.deps)).usage, U);
  assert.equal(s.counts.fetch, 0);
});
test('a valid token fetches usage and records last good and plan', async () => {
  const s = await setup({ cred: valid, usage: { ok: true, usage: U } });
  const e = await pollAccount('k', T, 60_000, s.deps);
  assert.deepEqual(e, { status: 'ok', usage: U, fetchedAt: 1_000_000, lastGood: U, lastGoodAt: 1_000_000, plan: 'max' });
  assert.deepEqual(await s.deps.cache.get('k'), e);
});
test('expired while in use keeps last good and never renews', async () => {
  const s = await setup({ cred: expired, inUse: true, cache: { k: { status: 'ok', lastGood: U, lastGoodAt: 1, fetchedAt: 0 } } });
  const e = await pollAccount('k', T, 60_000, s.deps);
  assert.equal(e.status, 'token_expired'); assert.deepEqual(e.lastGood, U);
  assert.equal(s.counts.refresh, 0); assert.equal(s.counts.fetch, 0);
});
test('expired while idle renews under Claude locks, saves, then fetches', async () => {
  const s = await setup({ cred: expired, inUse: false, refresh: { ok: true, cred: { accessToken: 'A2', refreshToken: 'R2', expiresAt: 9e12 } }, usage: { ok: true, usage: U } });
  const e = await pollAccount('k', T, 60_000, s.deps);
  assert.equal(e.status, 'ok'); assert.equal(s.counts.credLocks, 1); assert.equal(s.counts.refresh, 1);
  assert.equal((await s.store.read(T))!.claudeAiOauth!.accessToken, 'A2');
  assert.equal(s.lastFetchToken(), 'A2');
});
test('renewal re-reads first and skips refresh if someone already renewed', async () => {
  const s = await setup({ cred: expired, inUse: false, usage: { ok: true, usage: U }, onCredLock: (store) => store.set(valid) });
  await pollAccount('k', T, 60_000, s.deps);
  assert.equal(s.counts.refresh, 0); assert.equal(s.counts.fetch, 1);
});
test('invalid_grant marks relogin_required', async () => {
  const s = await setup({ cred: expired, inUse: false, refresh: { ok: false, kind: 'invalid_grant' } });
  assert.equal((await pollAccount('k', T, 60_000, s.deps)).status, 'relogin_required');
});
test('429 stores a back-off that later polls respect', async () => {
  const s = await setup({ cred: valid, usage: { ok: false, kind: 'rate_limited' } });
  const e = await pollAccount('k', T, 0, s.deps);
  assert.equal(e.status, 'rate_limited'); assert.equal(e.backoffUntil, 1_000_000 + 300_000);
  await pollAccount('k', T, 0, s.deps);
  assert.equal(s.counts.fetch, 1);
});
test('missing expiresAt counts as expired', async () => {
  const s = await setup({ cred: { claudeAiOauth: { accessToken: 'A', refreshToken: 'R' } }, inUse: true });
  assert.equal((await pollAccount('k', T, 60_000, s.deps)).status, 'token_expired');
});
test('no credentials gives no_credentials', async () => {
  const s = await setup({});
  assert.equal((await pollAccount('k', T, 60_000, s.deps)).status, 'no_credentials');
});
test('corrupt usage cache reads as empty', async () => {
  const root = await tmp(); await writeFile(join(root, 'usage.json'), '{x');
  assert.deepEqual(await new UsageCache(root).read(), {});
});
test('two windows polling at once fetch only once', async () => {
  // real UsageCache + real withLock-based withFetchLock in one temp root, fetchUsage resolves after 100 ms
  const s = await setup({ cred: valid, usage: { ok: true, usage: U }, realFetchLock: true, fetchDelayMs: 100 });
  await Promise.all([pollAccount('k', T, 60_000, s.deps), pollAccount('k', T, 60_000, s.deps)]);
  assert.equal(s.counts.fetch, 1);
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.

- [ ] **Step 3: Implement `pollAccount`.** Use this exact order:

```text
prev = cache.get(key)
if prev.backoffUntil > now  -> return prev
if prev.fetchedAt defined and now - prev.fetchedAt < intervalMs -> return prev
withFetchLock(key):
  prev = cache.get(key); repeat both checks above (another window may have just fetched)
  file = credentials.read(target); if !file?.claudeAiOauth?.accessToken -> save {status:'no_credentials', fetchedAt:now}
  cred = file.claudeAiOauth; plan = cred.subscriptionType
  if cred.expiresAt === undefined or cred.expiresAt - EXPIRY_SKEW_MS <= now:
     if await inUse() -> save {...keepLast(prev), status:'token_expired', fetchedAt:now, plan}
     withCredentialLocks(target.configHome):
        file = credentials.read(target)  // re-read
        if still expired: r = refresh(cred)
            ok -> credentials.write(target, {...file, claudeAiOauth: r.cred}); cred = r.cred
            invalid_grant | no_refresh_token -> save {...keepLast(prev), status:'relogin_required', fetchedAt:now, plan}
            otherwise -> save {...keepLast(prev), status:'unavailable', fetchedAt:now, plan}
        else cred = file.claudeAiOauth
  r = fetchUsage(cred.accessToken)
     ok -> {status:'ok', usage, fetchedAt:now, lastGood:usage, lastGoodAt:now, plan}
     unauthorized -> {...keepLast(prev), status:'token_expired', fetchedAt:now, plan}
     rate_limited -> {...keepLast(prev), status:'rate_limited', fetchedAt:now, backoffUntil: now + (retryAfterMs ?? DEFAULT_BACKOFF_MS), plan}
     network | bad_response -> {...keepLast(prev), status:'unavailable', fetchedAt:now, plan}
  cache.put(key, entry); return entry
keepLast(prev) = { lastGood: prev?.lastGood, lastGoodAt: prev?.lastGoodAt } (omit undefined keys)
```

Every caught error is logged by the caller with only `key` and the error kind. No token text.

- [ ] **Step 4: Run `npm test`.** Expected: PASS.

- [ ] **Step 5: Commit** with `git commit -m "feat(core): shared usage cache and safe renew-when-idle polling"`.

---

### Task 9: Sharing the main setup, and safe delete

**Files:**
- Create: `src/core/share.ts`, `src/core/safeDelete.ts`, `src/test/share.test.ts`

**Interfaces:**
- Consumes: `isInside` (Task 2), `readJson`/`writeJsonAtomic`/`withConfigLock` (Task 3).
- Produces:
  - Constants: `SHARED_DIRS = ['projects','plugins','skills','commands','agents','output-styles','rules','plans']`, `SHARED_FILES = ['settings.json','CLAUDE.md','keybindings.json']`, `PROMPT_HISTORY = 'history.jsonl'`, `MANIFEST = '.claude-accounts-manifest.json'`.
  - `interface Manifest { links: string[]; copies: string[] }`
  - `syncSharedSetup(o: { mainHome: string; accountHome: string; platform: NodeJS.Platform }): Promise<Manifest>`
  - `seedGlobalConfig(mainGlobal: string, accountGlobal: string): Promise<void>`
  - `syncMcpServers(mainGlobal: string, accountGlobal: string): Promise<void>`
  - `removeAccountFolder(root: string, folder: string): Promise<void>` (in `safeDelete.ts`)

- [ ] **Step 1: Write the failing tests** in `src/test/share.test.ts`. Every test starts from a `fixture()` helper:
  - `root = mkdtemp(join(tmpdir(), 'cs space ễ-'))`, `mainHome = root/main`, `accountHome = root/acc1` (created empty), `mainGlobal = root/main.claude.json`, and `accGlobal = accountHome/.claude.json`.
  - `mainHome` holds `projects/p.txt` (`x`), an empty `skills/`, `settings.json` (`{"a":1}`), `.credentials.json` (`secret`), and `sessions/1.json`.
  - `mainGlobal` holds `{ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.332', mcpServers: { a: {} }, oauthAccount: { emailAddress: 'me@x' }, projects: {} }`.
  - Every test below begins with `const { root, mainHome, accountHome, mainGlobal, accGlobal } = await fixture();` (shown only in the first test).

```ts
test('links shared folders that exist, never secrets or runtime dirs, and records them', async () => {
  const { mainHome, accountHome } = await fixture();
  const m = await syncSharedSetup({ mainHome, accountHome, platform: process.platform });
  assert.ok((await lstat(join(accountHome, 'projects'))).isSymbolicLink());
  assert.equal(await readFile(join(accountHome, 'projects', 'p.txt'), 'utf8'), 'x');
  assert.ok(!existsSync(join(accountHome, '.credentials.json')));
  assert.ok(!existsSync(join(accountHome, 'sessions')));
  assert.deepEqual([...m.links].sort(), process.platform === 'win32' ? ['projects', 'skills'] : ['projects', 'settings.json', 'skills']);
  assert.equal(await readFile(join(accountHome, 'settings.json'), 'utf8'), '{"a":1}');
  assert.ok(existsSync(join(accountHome, MANIFEST)));
});
test('missing source is skipped, then linked once it exists', async () => {
  await syncSharedSetup({ mainHome, accountHome, platform: process.platform });
  assert.ok(!existsSync(join(accountHome, 'agents')));
  await mkdir(join(mainHome, 'agents'));
  await syncSharedSetup({ mainHome, accountHome, platform: process.platform });
  assert.ok((await lstat(join(accountHome, 'agents'))).isSymbolicLink());
});
test('Windows mode copies files from main every time (main wins)', async () => {
  await writeFile(join(mainHome, 'settings.json'), '{"v":1}');
  await syncSharedSetup({ mainHome, accountHome, platform: 'win32' });
  await writeFile(join(accountHome, 'settings.json'), '{"edited":true}');
  await writeFile(join(mainHome, 'settings.json'), '{"v":2}');
  const m = await syncSharedSetup({ mainHome, accountHome, platform: 'win32' });
  assert.equal(await readFile(join(accountHome, 'settings.json'), 'utf8'), '{"v":2}');
  assert.ok(m.copies.includes('settings.json'));
  assert.ok(!existsSync(join(accountHome, 'history.jsonl')));
});
test('seedGlobalConfig copies onboarding flags and mcpServers once, never oauthAccount', async () => {
  // main .claude.json: { hasCompletedOnboarding:true, lastOnboardingVersion:'2.1.332', mcpServers:{a:{}}, oauthAccount:{emailAddress:'me@x'} , projects:{} }
  await seedGlobalConfig(mainGlobal, accGlobal);
  assert.deepEqual(await readJson(accGlobal), { hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.332', mcpServers: { a: {} } });
  await writeJsonAtomic(accGlobal, { kept: 1 });
  await seedGlobalConfig(mainGlobal, accGlobal);
  assert.deepEqual(await readJson(accGlobal), { kept: 1 });
});
test('syncMcpServers replaces mcpServers only', async () => {
  await writeJsonAtomic(accGlobal, { oauthAccount: { emailAddress: 'w@x' }, mcpServers: { old: {} } });
  await syncMcpServers(mainGlobal, accGlobal);
  assert.deepEqual(await readJson(accGlobal), { oauthAccount: { emailAddress: 'w@x' }, mcpServers: { a: {} } });
});
test('removeAccountFolder deletes the account but never what its links point to', async () => {
  // root/acc1 synced from main (projects linked), plus acc1/own.txt and a user-made link acc1/extra -> main/skills
  await removeAccountFolder(root, join(root, 'acc1'));
  assert.ok(!existsSync(join(root, 'acc1')));
  assert.equal(await readFile(join(mainHome, 'projects', 'p.txt'), 'utf8'), 'x');
  assert.ok(existsSync(join(mainHome, 'skills')));
});
test('removeAccountFolder refuses a folder outside the accounts root', async () => {
  await assert.rejects(removeAccountFolder(root, mainHome), /outside/);
  assert.ok(existsSync(join(mainHome, 'projects', 'p.txt')));
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.

- [ ] **Step 3: Implement `src/core/share.ts`.**
  - **Directories:** for each `SHARED_DIRS` entry whose source exists and whose target is missing (checked with `lstat`), call `fs.symlink(src, dst, platform === 'win32' ? 'junction' : 'dir')`.
  - **Files:**
    - On `win32`, `copyFile` each existing `SHARED_FILES` entry on every call. Skip `PROMPT_HISTORY` entirely, so it's never forked.
    - Elsewhere, `fs.symlink(src, dst, 'file')` for each missing target, including `PROMPT_HISTORY`.
  - **Manifest:** record names in the manifest, merged with the existing one, and write it atomically. Never create anything in `mainHome`.
  - `seedGlobalConfig` runs only when `accountGlobal` is missing. It copies just `hasCompletedOnboarding`, `lastOnboardingVersion`, and `mcpServers`, whichever are present.
  - `syncMcpServers` runs under `withConfigLock(accountGlobal)`:
    - If the account file is missing, return.
    - Otherwise set `mcpServers` to main's value, or delete the key when main has none, and write atomically.

- [ ] **Step 4: Implement `src/core/safeDelete.ts`.**
  - If `!isInside(root, folder)`, throw `Error('Refusing to delete a folder outside the accounts folder')`.
  - Walk the tree with `lstat`:
    - Symbolic link or junction: `unlink`, and on `EPERM`/`EISDIR` fall back to non-recursive `rmdir`. Never descend into it.
    - Directory: recurse into its children, then `rmdir`.
    - File: `unlink`.
  - Never call `fs.rm` with `recursive`.

- [ ] **Step 5: Run `npm test`** on Windows locally. Expected: PASS. CI covers macOS and Linux.

- [ ] **Step 6: Commit** with `git commit -m "feat(core): share the main Claude setup into account folders and delete them safely"`.

---

### Task 10: View snapshot

**Files:**
- Create: `src/core/snapshot.ts`, `src/test/snapshot.test.ts`

**Interfaces:**
- Consumes: the types from Task 1.
- Produces: `buildSnapshot(i: { accounts: Account[]; mainIdentity?: Identity; liveWindows: WindowBeat[]; usage: Record<string, UsageEntry>; thisWindowKey: string }): AccountView[]`.
  - Order: registry order first, then the main login last.
  - `label`: `alias ?? email ?? 'New account (not signed in)'`. Main is always `'Main login'`, with its email in `email`.
  - `signedIn`: `!!email` (for main, `!!mainIdentity`).
  - `usedBy`: the unique workspace names of live windows with that key, in first-seen order.

- [ ] **Step 1: Write the failing tests** in `src/test/snapshot.test.ts`:

```ts
test('accounts in order, main last, with usedBy and this-window marks', () => {
  const views = buildSnapshot({
    accounts: [{ id: 'a1', folder: '/r/a1', email: 'w@x.com', alias: 'work', createdAt: 't' }, { id: 'a2', folder: '/r/a2', createdAt: 't' }],
    mainIdentity: { email: 'me@x.com' },
    liveWindows: [
      { windowId: 'w1', accountKey: 'a1', workspaceName: 'proj-a', pid: 1, updatedAt: 0 },
      { windowId: 'w2', accountKey: 'a1', workspaceName: 'proj-a', pid: 2, updatedAt: 0 },
      { windowId: 'w3', accountKey: 'main', workspaceName: 'proj-c', pid: 3, updatedAt: 0 },
    ],
    usage: { a1: { status: 'ok', usage: { fiveHour: { pct: 40 } } } },
    thisWindowKey: 'a1',
  });
  assert.deepEqual(views.map((v) => [v.key, v.label, v.isMain, v.isThisWindow, v.signedIn, v.usedBy]), [
    ['a1', 'work', false, true, true, ['proj-a']],
    ['a2', 'New account (not signed in)', false, false, false, []],
    ['main', 'Main login', true, false, true, ['proj-c']],
  ]);
  assert.equal(views[0].entry?.usage?.fiveHour?.pct, 40);
  assert.equal(views[2].email, 'me@x.com');
});
test('label falls back to email; main without identity is not signed in', () => {
  const v = buildSnapshot({ accounts: [{ id: 'a1', folder: '/r', email: 'w@x.com', createdAt: 't' }], liveWindows: [], usage: {}, thisWindowKey: 'main' });
  assert.equal(v[0].label, 'w@x.com');
  assert.equal(v[1].signedIn, false);
  assert.equal(v[1].isThisWindow, true);
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `buildSnapshot`.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(core): account view snapshot"`.

---

### Task 11: Which config folder this window exports

**Files:**
- Create: `src/core/windowEnv.ts`, `src/test/windowEnv.test.ts`

**Interfaces:**
- Produces: `WINDOW_ACCOUNT_KEY = 'claudeSwap.windowAccount'`, `resolveWindowEnv(i: { choice: string | undefined; accounts: Account[]; folderExists: (p: string) => boolean; originalConfigDir: string | undefined }): { key: string; configDir: string | undefined; warning?: string }`, and `findConfigDirOverride(envVars: unknown): boolean`.

- [ ] **Step 1: Write the failing tests** in `src/test/windowEnv.test.ts`:

```ts
const acc = { id: 'a1', folder: '/r/a1', createdAt: 't' };
test('no choice or main uses the original config dir', () => {
  assert.deepEqual(resolveWindowEnv({ choice: undefined, accounts: [acc], folderExists: () => true, originalConfigDir: undefined }), { key: 'main', configDir: undefined });
  assert.deepEqual(resolveWindowEnv({ choice: 'main', accounts: [acc], folderExists: () => true, originalConfigDir: '/custom' }), { key: 'main', configDir: '/custom' });
});
test('a known account with its folder exports that folder verbatim', () => {
  assert.deepEqual(resolveWindowEnv({ choice: 'a1', accounts: [acc], folderExists: () => true, originalConfigDir: undefined }), { key: 'a1', configDir: '/r/a1' });
});
test('missing folder falls back to main', () => {
  const r = resolveWindowEnv({ choice: 'a1', accounts: [acc], folderExists: () => false, originalConfigDir: undefined });
  assert.equal(r.key, 'main'); assert.equal(r.configDir, undefined); assert.match(r.warning!, /main login/);
});
test('unknown account id falls back to main with a warning', () => {
  const r = resolveWindowEnv({ choice: 'zz', accounts: [acc], folderExists: () => true, originalConfigDir: undefined });
  assert.equal(r.key, 'main'); assert.ok(r.warning);
});
test('findConfigDirOverride', () => {
  assert.equal(findConfigDirOverride([{ name: 'CLAUDE_CONFIG_DIR', value: 'C:\\x' }]), true);
  assert.equal(findConfigDirOverride([{ name: 'CLAUDE_CONFIG_DIR', value: '' }]), false);
  assert.equal(findConfigDirOverride([{ name: 'OTHER', value: '1' }]), false);
  assert.equal(findConfigDirOverride(undefined), false);
  assert.equal(findConfigDirOverride('junk'), false);
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement it.** The fallback warning text is exactly: `The Claude account this window used is gone, so this window is back on your main login.`
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(core): decide which Claude folder a window uses"`.

---

### Task 12: Activation, controller, status bar (cswap removed)

**Files:**
- Create: `src/vscode/windowAccount.ts`, `src/vscode/controller.ts`, `src/vscode/statusBar.ts`
- Modify: `src/extension.ts` (full rewrite) and `package.json` (`activationEvents`, `engines`, `devDependencies`, `configuration`)

**Interfaces:**
- Consumes: everything in `src/core`.
- Produces (for Task 13):
  - `class AccountsController implements vscode.Disposable { readonly onDidChange: vscode.Event<AccountView[]>; views: AccountView[]; readonly thisWindowKey: string; readonly root: string; readonly originalConfigDir: string | undefined; readonly registry: Registry; readonly cache: UsageCache; readonly credentials: CredentialStore; refresh(force?: boolean): Promise<void>; }`
  - `applyWindowAccount(context: vscode.ExtensionContext, originalConfigDir: string | undefined, registry: Registry): Promise<{ key: string; configDir: string | undefined }>`
  - `class StatusBar implements vscode.Disposable { update(views: AccountView[]): void }`

- [ ] **Step 1: `package.json` changes.**
  - `"activationEvents": ["*"]`
  - `"engines": { "vscode": "^1.90.0" }`
  - devDependency `"@types/vscode": "^1.90.0"`
  - Delete the `claudeSwap.cswapExecutablePath` setting.
  - Add `claudeSwap.confirmBeforeReload` (`boolean`, default `true`, description `Ask before reloading a window to switch its Claude account.`).
  - Run `npm install`.

- [ ] **Step 2: Implement `applyWindowAccount`.** In this order:
  1. Read the choice from `workspaceState[WINDOW_ACCOUNT_KEY]` and call `resolveWindowEnv`, using `existsSync` for `folderExists`.
  2. If the result fell back, store `'main'` and show the warning.
  3. For an account key, inside a try/catch that logs and continues:
     - `syncSharedSetup({ mainHome: configHome(original), accountHome: configDir, platform: process.platform })`
     - `syncMcpServers(globalConfigPath(original), globalConfigPath(configDir))`
  4. If `configDir` is set, set `process.env.CLAUDE_CONFIG_DIR = configDir` and `context.environmentVariableCollection.replace('CLAUDE_CONFIG_DIR', configDir)`. Otherwise restore `process.env.CLAUDE_CONFIG_DIR` to `original` (delete it if undefined) and call `environmentVariableCollection.delete('CLAUDE_CONFIG_DIR')`.
  5. If `findConfigDirOverride(workspace.getConfiguration('claudeCode').get('environmentVariables'))` is true, show the warning `Your Claude settings set CLAUDE_CONFIG_DIR for every window, so each window can't have its own account. Remove it from claudeCode.environmentVariables.` with an `Open Settings` button that runs `workbench.action.openSettings` with `claudeCode.environmentVariables`.
  6. If `vscode.extensions.getExtension('anthropic.claude-code')?.isActive` and `configDir !== original`, and the stored `claudeSwap.lastReloadPrompt` timestamp is more than 120 000 ms old, store `Date.now()` and show `Reload this window so Claude uses this window's account.` with a `Reload` button that runs `workbench.action.reloadWindow`.

- [ ] **Step 3: Implement `AccountsController`.**
  - **Setup:**
    - `windowId = crypto.randomUUID()`
    - Output channel: `vscode.window.createOutputChannel('Claude Swap Status', { log: true })`
    - Heartbeat timer every 30 000 ms writes `{ windowId, accountKey: thisWindowKey, workspaceName: vscode.workspace.name ?? 'Untitled window', pid: process.pid }`.
    - Poll timer every `max(0.5, pollIntervalMinutes) * 60_000` ms, restarted when the configuration changes.
  - **Each `refresh(force)`:**
    1. Run `registry.list()` and `windows.live()`.
    2. For accounts with no `email`, call `readIdentity(globalConfigPath(a.folder))`. If it's found, run `registry.update` and show `Signed in as <email>. Give this account a short name?` with a `Rename` button. Show it once per id per session.
    3. Also check identities: if an account's `email` + `orgUuid` match another account or the main login, warn once: `"<label>" is the same Claude account as "<other>". That works, but you may not need both.`
    4. Read `mainIdentity` with `readIdentity(globalConfigPath(original))`.
    5. Run `pollAccount` for every account (target `{ configHome: folder, configDirEnv: folder }`) and for `MAIN_KEY` (target `{ configHome: configHome(original), configDirEnv: original }`), all in parallel. Use `intervalMs = force ? 0 : interval`.
       - `inUse = () => isAccountInUse({ accountKey: key, configHome, liveWindows })`
       - `withFetchLock = (k, fn) => withLock(join(root, 'locks', `fetch-${k}.lock`), { staleMs: 30_000 }, fn)`
       - Wire in the real `withCredentialLocks`, `fetchUsage`, and `refreshAccessToken`.
       - Errors are logged as `poll <key>: <error.name>`.
    6. `views = buildSnapshot(...)`, then fire `onDidChange`.
  - **`dispose`:** clear the timers and run `windows.remove(windowId)`.
  - **`credentials`:** `createCredentialStore({ platform: process.platform })`.

- [ ] **Step 4: Implement `StatusBar`.** Priority 100, left aligned, command `claudeSwap.switchAccount`.
  - **Text:**
    - `$(account) Claude: <label> | 5h: <formatWindow> | 7d: <formatWindow>`, with ` $(history)` added when `pickUsage(...).stale`.
    - `checking…` when there's no entry yet.
    - `$(account) Claude: <label> | not signed in` when `!signedIn`.
  - **Background:**
    - `usageLevel` maps to `statusBarItem.errorBackground` or `statusBarItem.warningBackground`.
    - Otherwise `needsAttention(status)` or not signed in gets the warning background.
  - **Tooltip:** `Claude account for this window`, email, organisation, plan, `Status: <statusLabel>`, both `formatResetDetail` lines, `Showing last known usage from <formatAge> ago` when stale, and `Click to switch accounts.`

- [ ] **Step 5: Rewrite `src/extension.ts`.**
  - At module load: `const ORIGINAL_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || undefined`.
  - `activate` runs in this order:
    1. `registry = new Registry(accountsRoot())`
    2. `await applyWindowAccount(...)`
    3. Create the controller and the status bar.
    4. Subscribe `statusBar.update` to `onDidChange`.
    5. Register `claudeSwap.refreshStatus`. Task 13 adds the rest.
    6. `controller.refresh()`
  - Delete all `cswap` and `exec` code.

- [ ] **Step 6: Verify.**
  - Run `npx tsc -p ./ --noEmit && npm test && npm run build`. Expected: no errors, all tests pass, and `dist/extension.js` is built.
  - Press F5 in Antigravity. Expected: the status bar shows `Claude: Main login | 5h: … | 7d: …` with real numbers, and `~/.claude-accounts/windows/` holds one heartbeat file that disappears when the dev host closes.

- [ ] **Step 7: Commit** with `git commit -m "feat: per-window account activation and status bar without cswap"`.

---

### Task 13: Side panel and account commands

**Files:**
- Create: `src/vscode/accountsView.ts`, `src/vscode/commands.ts`, `media/accounts.svg`
- Modify: `src/extension.ts` (register both) and `package.json` (`commands`, `viewsContainers`, `views`, `viewsWelcome`, `menus`)

**Interfaces:**
- Consumes: `AccountsController` (Task 12), plus `newAccountId`, `accountFolder`, `globalConfigPath`, `configHome`, `seedGlobalConfig`, `syncSharedSetup`, and `removeAccountFolder`.
- Produces:
  - `type Node = { kind: 'account'; view: AccountView } | { kind: 'detail'; text: string; tooltip?: string }`
  - `class AccountsTreeProvider implements vscode.TreeDataProvider<Node>`
  - `registerCommands(context: vscode.ExtensionContext, c: AccountsController): void`

- [ ] **Step 1: `package.json` contributions.**
  - **`viewsContainers.activitybar`:** `[{ "id": "claudeSwap", "title": "Claude Accounts", "icon": "media/accounts.svg" }]`
  - **`views`:** `{ "claudeSwap": [{ "id": "claudeSwap.accounts", "name": "Accounts" }] }`
  - **`viewsWelcome`:** for `claudeSwap.accounts`, the content is `No extra Claude accounts yet. Each window can use its own account.\n[Add your first account](command:claudeSwap.addAccount)`.
  - **Commands** (title, plus icon where shown):
    - `claudeSwap.switchAccount` — "Claude Swap: Switch Account"
    - `claudeSwap.addAccount` — "Claude Swap: Add Account", `$(add)`
    - `claudeSwap.refreshStatus` — "Claude Swap: Refresh Usage", `$(refresh)`
    - `claudeSwap.useInThisWindow` — "Use in This Window", `$(arrow-swap)`
    - `claudeSwap.useMainLogin` — "Claude Swap: Use Main Login in This Window"
    - `claudeSwap.renameAccount` — "Rename"
    - `claudeSwap.removeAccount` — "Remove"
    - `claudeSwap.signInAgain` — "Sign In Again"
    - `claudeSwap.openPanel` — "Claude Swap: Open Accounts Panel"
  - **`menus["view/title"]`:** add and refresh in `navigation` when `view == claudeSwap.accounts`.
  - **`menus["view/item/context"]`:**
    - `useInThisWindow` (`inline`) when `view == claudeSwap.accounts && viewItem =~ /\bother\b/`
    - `renameAccount` and `removeAccount` when `viewItem =~ /\badded\b/`
    - `signInAgain` when `viewItem =~ /\b(relogin|notSignedIn)\b/`
  - **`menus.commandPalette`:** hide `useInThisWindow`, `renameAccount`, `removeAccount`, and `signInAgain` (`"when": "false"`). They're reached through the panel and the quick pick.

- [ ] **Step 2: Implement `AccountsTreeProvider`.** It refreshes on `controller.onDidChange`.
  - **Account node:**
    - Expanded.
    - `label = view.label`
    - `description`: `this window`, else `not in use` when `usedBy` is empty, else empty. For main, add the email.
    - `iconPath`: `ThemeIcon(isThisWindow ? 'pass-filled' : 'circle-large-outline', ThemeColor)`, where the colour comes from `usageLevel` (`charts.red` / `charts.yellow`), or `list.warningForeground` when attention is needed.
    - `contextValue` is space-joined: `account`, then `main` or `added`, then `this` or `other`, plus `notSignedIn` and `relogin` when they apply.
    - `tooltip`: a `MarkdownString` with email, organisation, plan, reset details, and `Updated <formatAge> ago`.
  - **Children** (detail nodes):
    - `5h <formatWindow>` and `7d <formatWindow>`, with ` (last known)` added when stale.
    - `used by: <names joined by ', '>` when `usedBy` isn't empty.
    - `Not signed in yet` when `!signedIn`.
    - `Status: <statusLabel>` when `needsAttention`.

- [ ] **Step 3: Implement `registerCommands`.** Shared helper: `confirmReload(message)`.
  - If `claudeSwap.confirmBeforeReload` is false, return true.
  - Otherwise show a modal with `Reload` and `Reload, don't ask again`. The second option sets the setting to false globally.
  - **`switchAccount`:**
    - A quick pick with one item per view: label `$(check) ` for this window plus `view.label`, description `5h <pct>% · 7d <pct>%` or the status label, and detail `used by: …`.
    - Then `$(add) Add account…` and `$(list-tree) Open accounts panel`.
    - Picking a view runs `useInThisWindow`.
  - **`useInThisWindow(node?)`:**
    - If there's no node, pick one with the same quick pick.
    - If it's this window, do nothing.
    - Otherwise `confirmReload('Switch this window to "<label>"? The window will reload.')`, then `workspaceState.update(WINDOW_ACCOUNT_KEY, view.key)`, then `workbench.action.reloadWindow`.
  - **`useMainLogin`:** the same, with `MAIN_KEY`.
  - **`addAccount`:**
    1. `confirmReload('Add a new Claude account? This window will reload and Claude will ask you to sign in.')`
    2. `id = newAccountId()`, `folder = accountFolder(root, id)`, `mkdir` recursively
    3. `seedGlobalConfig(globalConfigPath(original), globalConfigPath(folder))`
    4. `syncSharedSetup(...)`
    5. `registry.add({ id, folder })`
    6. Set the workspace state to `id`, then reload.
  - **`renameAccount(node?)`:** `showInputBox({ prompt: 'Short name for this account (leave empty to show the email)', value: alias, validateInput: v => v.length > 30 ? 'Keep it under 30 characters.' : undefined })`, then `registry.update(id, { alias: value })` and refresh.
  - **`removeAccount(node?)`:**
    - If `usedBy` isn't empty, show the warning `"<label>" is open in: <names>. Switch those windows to another account first.` and stop.
    - Otherwise show the modal `Remove "<label>"? You'll need to sign in again to use it later.` with `Remove`.
    - Then, on `darwin`, `credentials.remove({ configHome: folder, configDirEnv: folder })`, catching and logging any error.
    - Then `removeAccountFolder(root, folder)`, `registry.remove(id)`, `cache.remove(id)`, and refresh.
  - **`signInAgain(node?)`:**
    - If it's not this window, run `useInThisWindow`.
    - Otherwise show `Type /login in the Claude panel to sign in again.` with an `Open Terminal` button. That button creates the terminal `Claude sign-in` and sends `claude` (the terminal already carries this window's `CLAUDE_CONFIG_DIR`).
  - **`openPanel`:** run `workbench.view.extension.claudeSwap`.

- [ ] **Step 4: Draw `media/accounts.svg`.** A 24×24 single-colour SVG of two overlapping person silhouettes (`fill="currentColor"`).

- [ ] **Step 5: Verify.** Run `npx tsc -p ./ --noEmit && npm test && npm run build`. Expected: clean. Then press F5 in Antigravity and check each of these:
  - (a) The Activity Bar shows the icon, and the panel lists `Main login` with usage.
  - (b) **Add account** reloads the window, and the Claude panel asks you to sign in. After signing in, the panel shows the email within one poll and offers Rename.
  - (c) **Use in This Window** on `Main login` reloads back.
  - (d) **Remove** on an unused account deletes `~/.claude-accounts/<id>`, while `~/.claude/projects` keeps the same file count.

- [ ] **Step 6: Commit** with `git commit -m "feat: Claude Accounts side panel and account commands"`.

---

### Task 14: Docs, packaging, release check

**Files:**
- Modify: `README.md`, `package.json` (`version`, `description`), `.vscodeignore`

- [ ] **Step 1: Packaging.**
  - Add `docs/**`, `scripts/**`, `out-test/**`, and `media/*.psd` to `.vscodeignore`. Don't add `media/accounts.svg`, which has to ship.
  - Set `"version": "0.3.0"`.
  - Set `"description"` to `"See your Claude Code usage in the status bar, and give each Antigravity IDE or VS Code window its own Claude account. Not affiliated with Anthropic."`.

- [ ] **Step 2: README rewrite** (plain English, same tone and header):
  - Remove the "needs claude-swap" badge, "Step 1: Install claude-swap", the `cswapExecutablePath` row, and every `cswap` troubleshooting entry.
  - Add these sections:
    - **"How it works":** each account is its own Claude folder, and each window remembers its account.
    - **"Add an account"**
    - **"Switch a window's account":** it reloads only that window.
    - **"The side panel"**
    - **"Good to know":**
      - Switching reloads the window.
      - On Windows, settings changed inside an account window are replaced by your main settings the next time it opens.
      - Usage numbers come from an unofficial Claude endpoint.
      - Accounts are kept in `~/.claude-accounts`.
  - Add **"Upgrading from 0.2.x":** the swap tool is no longer used, so sign in once per account with Add account.
  - In Credits, thank claude-swap for the approach.
  - Update the commands and settings tables to Task 13's lists.
  - Check that `art/*.html` doesn't mention cswap. If it does, note it for a later art refresh instead of editing the PNGs.

- [ ] **Step 3: Full check on Windows, in Antigravity, with three windows.** Install the build with `npx --yes @vscode/vsce@3 package` and then "Install from VSIX". Expected results:
  1. Windows A, B, and C are on `work`, `personal`, and `Main login`. Running `/status` in each Claude panel shows three different accounts.
  2. In window A's terminal, `claude` → `/status` shows `work`.
  3. Switching B to `Main login` reloads only B. A and C keep working.
  4. In A, your skills, plugins, output style, and `--resume` history are the same as in C.
  5. Close every window that uses `personal`. Set its `expiresAt` to `1` in `~/.claude-accounts/<id>/.credentials.json`, and wait one poll in another window. The panel shows fresh `personal` numbers. Opening `personal` again asks for no sign-in.
  6. Replace `accounts.json` with `{x`. Reload: the extension still loads, `accounts.json.corrupt-*` exists, and the panel shows Main login only.
  7. Remove an unused account. Its folder is gone, and `~/.claude/projects` is unchanged.

- [ ] **Step 4: Mac and Linux.** CI runs the unit tests on both. Before tagging `v0.3.0`, the Step 3 checklist must also be run by hand on a real Mac (Keychain path). Record who ran it and the result in the PR description.

- [ ] **Step 5: Commit** with `git commit -m "docs: README for standalone per-window accounts; bump to 0.3.0"`.
