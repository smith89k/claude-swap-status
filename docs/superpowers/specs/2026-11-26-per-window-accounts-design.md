# Per-window Claude accounts, without claude-swap

Date: 2026-11-26
Status: approved 2026-11-26

## Intent

The user opens two or three Antigravity IDE windows (or VS Code windows) at the same time. Each window should use a different Claude account in the Claude Code panel. They should be able to change any window's account from this extension without touching the other windows.

Today the extension calls the `cswap` CLI (claude-swap). cswap swaps the one shared login in `~/.claude`, so every window follows that login and they can't differ. The user also wants the extension to stop depending on cswap. It should be a standalone extension that does the account and usage work itself.

## Goals

1. Each window (workspace) uses its own Claude account. That covers the Claude Code panel and any `claude` started in that window's integrated terminal.
2. Switch the current window's account from the status bar or the side panel. Other windows don't change.
3. A side panel in the Primary Side Bar with its own Activity Bar icon. It lists every account with its usage and which windows use it, plus actions for each account.
4. The status bar shows the current window's account and usage. Keep today's format, warning colours (70% / 85%), reset countdowns, and the stale-data clock icon.
5. Add, rename, and remove accounts inside the extension. Signing in uses Claude's own sign-in screen.
6. Every account window has the same Claude setup as the main one: settings, plugins, skills, commands, agents, output styles, rules, memory, and chat history. Only the login is different.
7. Fresh usage numbers for every account, including accounts no window is using right now. For those, the extension renews the login itself, but only while nothing else is using it.
8. Windows, macOS and Linux.

## Non-goals

- Changing which account the main login (`~/.claude`) is signed in to. cswap's global `switch` is dropped.
- Importing accounts from claude-swap. This is a clean break: users sign in once per account.
- Auto-switching when a limit is near.
- API-key accounts and setup-token accounts.
- Remote windows (SSH, WSL, dev containers). v1 targets local windows only.

## Anti-goals (failure even if everything else works)

- **Signing anyone out.** Never refresh a token that a running Claude may hold. Refreshing rotates the refresh token, which leaves the other holder with a dead one.
- **Damaging the main setup.** Never delete, overwrite, or follow a link into the main config folder (`~/.claude`) or `~/.claude.json`.
- **Writing to the user's repo.** Account choices and local paths must not land in the project's `.vscode/settings.json`.
- **Flooding the usage endpoint.** Three windows must not mean three times the requests. The endpoint returns 429 and its budget may be per account.
- **Leaking secrets.** Tokens must never appear in logs, error messages, the output channel, or process arguments.

## Constraints (checked on this machine)

**How the Claude Code extension starts Claude.** Checked in VS Code 2.1.330 and Antigravity 2.1.332.

- It builds the child process environment as `{...process.env}`, then applies `claudeCode.environmentVariables` on top.
- It also reads `process.env.CLAUDE_CONFIG_DIR` directly in several places, for example IDE lock files and the config-file watcher.
- It activates on `onStartupFinished` and `onWebviewPanel:claudeVSCodePanel`.

**What that means for this design.**

- Each window has its own extension host process. Any extension in that host can change `process.env`, and Claude inherits the change, but only in that window.
- `process.env.CLAUDE_CONFIG_DIR` must be set **before the Claude extension activates**. Otherwise its watchers and IDE lock files point at the wrong folder.

**Claude's settings can't do this per window.** `claudeCode.environmentVariables` and `claudeCode.claudeProcessWrapper` are `machine` scope. VS Code ignores them in workspace settings, so they can't vary per window. If the user has set `CLAUDE_CONFIG_DIR` there, it overrides ours and per-window accounts can't work.

**Where Claude keeps its files** (this mirrors Claude Code's own rules):

- **Config home:** `CLAUDE_CONFIG_DIR` if set, otherwise `~/.claude`.
- **Credentials on Windows and Linux:** `<config home>/.credentials.json`. Shape: `{ claudeAiOauth: { accessToken, refreshToken, expiresAt (ms), refreshTokenExpiresAt, scopes, subscriptionType, rateLimitTier, … }, organizationUuid }`.
- **Global config:** `(CLAUDE_CONFIG_DIR || $HOME)/.claude.json`. There's a legacy `<config home>/.config.json` rule, mirrored in claude-swap `paths.py`.
  - It holds `oauthAccount { emailAddress, organizationUuid, organizationName, displayName, … }`.
  - It also holds user-scope `mcpServers` and onboarding flags (`hasCompletedOnboarding`, `lastOnboardingVersion`).

**Credentials on macOS.**

- They live in the login Keychain as a generic password.
- Service name for the default folder: `Claude Code-credentials`.
- Service name for a custom folder: `Claude Code-credentials-<first 8 hex chars of sha256(NFC(raw CLAUDE_CONFIG_DIR string))>`. Hash exactly the string that gets exported, never a resolved path.
- Account name: `$USER`, falling back to the OS username.
- Always call `/usr/bin/security` by absolute path. Pass secrets through `security -i` on stdin, never in argv. stdin lines are limited to 4096 bytes.
- A plaintext `.credentials.json` seed is moved into the Keychain by Claude the first time it writes.

**Usage endpoint.**

- `GET https://api.anthropic.com/api/oauth/usage`
- Headers: `Authorization: Bearer <accessToken>` and `anthropic-beta: oauth-2025-04-20`.
- Response: `five_hour` and `seven_day`, each `{ utilization, resets_at }`. There's an optional `limits[]` with per-model weekly windows and an optional `extra_usage`.
- Returns 429 with `Retry-After` when the budget is used up.

**Token refresh.**

- `POST https://platform.claude.com/v1/oauth/token`
- Body: `grant_type=refresh_token`, `refresh_token`, `client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e`.
- The response may carry a new `refresh_token`, which rotates the old one.
- `invalid_grant` means the user has to sign in again.

**Claude's own locks.** These use the npm `proper-lockfile` protocol, where the lock is a directory and `mkdir` is the mutex.

- **Credential refresh:** `<config home>/.oauth_refresh.lock`, then `<config home>.lock`. Both go stale after 60 s, and the holder touches them every 5 s.
- **Config writes:** `<.claude.json path>.lock`. Goes stale after 10 s.

**Unofficial interfaces.** The usage endpoint, the refresh endpoint, and the client id aren't public APIs. Keep them in one module so a change is a one-file fix.

**Windows links.** File symlinks and directory symlinks need admin rights or Developer Mode. Directory junctions don't need either. Hard links break when Claude writes a file atomically (temp file plus rename).

**Packaging.** `docs/**` isn't in `.vscodeignore`. Add it so this spec doesn't ship inside the `.vsix`.

**Licence.** claude-swap is MIT. Reusing its approach is fine. Credit it in the README.

## Approaches

1. **The extension sets the window's `CLAUDE_CONFIG_DIR` inside its own extension host, before Claude starts.** (Chosen.)
   - Each account is its own Claude config folder.
   - The extension remembers which account each workspace uses and exports that folder in that window only.
   - Switching reloads the window.
   - **Trade-off:** it depends on the Claude extension inheriting `process.env`. That's verified in both IDEs today, but Anthropic could change it.
2. **One IDE profile per account,** each with `claudeCode.environmentVariables` set in that profile's user settings.
   - Uses only official settings.
   - But the user creates the profiles by hand, extensions and settings drift between profiles, and switching accounts means switching profiles.
   - The user picked option 1 over this.
3. **A separate IDE instance per account** (`--user-data-dir`). Dropped: each instance has its own extensions, settings, and IDE sign-in.
4. **`cswap run`.** Dropped: it works in a terminal only, not in the Claude panel. It also keeps the cswap dependency.

## Design

### Accounts and where they live

- **Each account is a Claude config folder** that the extension creates under `~/.claude-accounts/<id>/` (builder picks the id scheme).
  - It sits outside `~/.claude` so Claude never treats it as part of the main setup.
  - It sits in the home folder rather than extension storage, so VS Code, Antigravity, and every profile see the same accounts.
- **Account registry:** `~/.claude-accounts/accounts.json`. One entry per account: id, folder, email, organisation uuid and name, alias, and created time.
  - Every write uses a lock file and an atomic write (temp file plus rename), because several windows share it.
- **The main login** (the config home the IDE was started with, usually `~/.claude`) appears as a built-in "Main login" entry.
  - Its identity comes from its `.claude.json`.
  - It can't be removed or renamed.
- **Duplicates:** if two entries turn out to be the same account (same email and organisation), show a warning but allow it. Each folder has its own refresh token, so they don't interfere.

### Which account a window uses

- The choice is stored in `context.workspaceState`: either an account id or `main`. That's per workspace and per machine, and never written to the repo.
- **Activation event: `*`.** This makes the extension activate before Claude's `onStartupFinished`. On activation:
  1. Remember the original `process.env.CLAUDE_CONFIG_DIR` (it may be unset). That value defines "Main login".
  2. Read the window's choice. If it names an account whose folder is missing, fall back to the main login and show a warning.
  3. For an account, refresh the shared setup in its folder (see below). Then set `process.env.CLAUDE_CONFIG_DIR` to the folder (the exact string, so the Keychain hash matches). Also call `context.environmentVariableCollection.replace('CLAUDE_CONFIG_DIR', folder)` so new terminals in this window get it.
  4. For the main login, restore the original value and clear the terminal environment collection.
- **If the Claude extension is already active** when this runs (the race was lost), show a "Reload to apply this window's account" prompt. Guard it so it can't loop: at most once per window session.
- **If the user's `claudeCode.environmentVariables` contains `CLAUDE_CONFIG_DIR`,** show a warning that per-window accounts can't work while it's set, with a button that opens the setting.
- **Live window registry.** Each window writes a heartbeat file, `~/.claude-accounts/windows/<window id>.json`, holding the account id, workspace name, extension host pid, and updated time.
  - It's refreshed about every 30 s and removed on deactivate.
  - It counts as dead when it's older than about 90 s or its pid is gone.
  - The panel uses it to show "used by …". Renewal uses it to tell whether an account is in use.

### Switching

- The status bar click and the panel's "Use in this window" action both set `workspaceState`, then run `workbench.action.reloadWindow`.
- The first time, show a confirm, because a reload interrupts a running Claude task. It offers "Don't ask again", backed by a setting. (My call.)
- "Use main login" switches the window back to the main login.

### Adding an account

"Add account…" does this:

1. Creates the folder and links or copies the shared setup into it.
2. Seeds its `.claude.json` with the main file's onboarding flags and `mcpServers`. No `oauthAccount`.
3. Records the account as "not signed in yet", assigns it to this window, and reloads.

After the reload, the Claude panel in that window shows Claude's own sign-in screen. The extension watches that folder's `.claude.json`. When `oauthAccount` appears, it fills in the email and organisation and offers to set an alias.

An account that's still "not signed in" shows a "Sign in" action, which switches this window to it. Running `claude` in that window's terminal also signs in to it, because of the terminal environment collection.

### Renaming and removing

- **Rename** sets the alias in the registry.
- **Remove** works like this:
  - Refuse while any live window uses the account, and name those windows.
  - Ask for confirmation.
  - On macOS, delete that folder's Keychain item.
  - Delete the folder safely:
    - The resolved path must be inside `~/.claude-accounts`.
    - First unlink every link the extension created (they're listed in a manifest inside the folder).
    - Then delete recursively using `lstat`, **never following a link or junction**.
    - A bug here could wipe the main chat history.

### Sharing the setup (everything except the login)

The source is the main config home.

**An explicit allowlist, with nothing else linked.**

- **Directories:** `projects/` (chat history and memory), `plugins/`, `skills/`, `commands/`, `agents/`, `output-styles/`, `rules/`, `plans/`.
  - They're linked: a junction on Windows, a symlink on macOS and Linux.
  - Concurrent Claude processes sharing `projects/` is the same as two windows on the main login today.
- **Files:** `settings.json`, `CLAUDE.md`, `keybindings.json`.
  - On macOS and Linux they're symlinks. Claude writes through symlinks to the target.
  - On Windows they're copied from the main folder each time a window starts. The main folder wins, so a settings change made inside an account window is lost at the next start. Document this in the README.
- **`history.jsonl`** (prompt history):
  - Share it on macOS and Linux with a symlink.
  - On Windows, share it only if that can be done without forking it. Otherwise skip it, because it's a nice-to-have.
- **Never link or copy:** `.credentials.json`, `.claude.json`, `sessions/`, `ide/`, `session-env/`, `shell-snapshots/`, `statsig/`, `cache/`, or locks.

**`.claude.json` stays per account.** On each window start, copy `mcpServers` from the main file into the account's file. Take Claude's config lock while writing, and never touch `oauthAccount`.

**A manifest** in each account folder records everything the extension created. It's used for safe removal and for repairing links that went missing.

**Nothing is ever written into the main folder.**

### Usage and renewing logins

**One shared usage cache:** `~/.claude-accounts/usage.json`, keyed by account id (plus `main`). Each entry holds the data, fetch time, status, last good data and its time, and any 429 back-off-until time.

**Each poll** runs every `claudeSwap.pollIntervalMinutes` (unchanged, default 1, minimum 0.5). For each account:

1. If the cache is fresher than the poll interval, use it.
2. Otherwise take a short per-account fetch lock, so only one window fetches. Re-check the cache. Then fetch.
3. Respect any back-off-until time shared in the cache. On a 429, honour `Retry-After`.

**Reading the token:** from the file on Windows and Linux. On macOS, from the Keychain item for that folder, falling back to the plaintext file.

**If the access token is still valid** (`expiresAt` minus 60 s of skew), fetch usage.

**If it has expired:**

- **The account is in use** if a live window heartbeat names it, or a live pid is listed in `<folder>/sessions/*.json`, or Claude's refresh lock exists. In that case don't renew. Show the last known numbers with the clock icon. Claude renews its own token.
- **The account isn't in use:**
  1. Take Claude's two credential locks with its protocol (stale after 60 s, touched every 5 s).
  2. Re-read the credential, because someone may have just refreshed it.
  3. Refresh, then write the new credential back while keeping all other fields. On Windows and Linux use temp file plus rename. On macOS use `security -i`.
  4. Release the locks.
  5. On `invalid_grant`, show "re-login needed".
- **The main login follows the same rules.** It's usually in use, so it usually won't be renewed.

**Status labels and colours** reuse today's set: ok, token expired, re-login needed, no credentials, unavailable, and so on.

### Status bar

- **Text:** `$(account) Claude: <alias or email> | 5h: █░░░░ 25% R:3h12m | 7d: █░░░░ 16% R:1d4h`, with the same colours, the same clock icon for stale data, and a hover with the email, organisation, plan, and exact reset times.
  - The cswap slot number is dropped.
- **Click:** a quick pick. It lists every account with its usage, "Use main login", "Add account…", and "Open accounts panel".

### Side panel (Primary Side Bar)

- An `activitybar` view container (a monochrome SVG icon, titled "Claude Accounts") holding one native tree view. (My call: a native tree view matches every theme, is keyboard and screen-reader friendly, and needs far less code than a webview.)
- Rough look:

```text
CLAUDE ACCOUNTS                    [+] [⟳]
  ● work  (this window)
      5h ██░░░ 40%  R:2h10m
      7d █░░░░ 18%  R:3d4h
      used by: claude-swap-status
  ○ personal
      5h ░░░░░  4%  R:4h55m
      7d ███░░ 61%  R:1d2h
      used by: blog-site
  ○ spare          (not in use)
      5h ░░░░░  0%   ·  7d ░░░░░ 9%
  ○ Main login · you@example.com
      used by: 1 window
```

- Warning colours appear as coloured `ThemeIcon`s.
- **Title-bar actions:** Add account, Refresh.
- **Item actions** (inline and right-click): Use in this window, Rename, Remove, Sign in again (shown when re-login is needed).
- **Hover:** email, organisation, plan, exact reset times, and last updated.
- **With no accounts added,** a welcome view with an "Add your first account" button.

### Commands and settings

- **Keep these command ids** so existing keybindings still work:
  - `claudeSwap.switchAccount`
  - `claudeSwap.addAccount` (new behaviour)
  - `claudeSwap.refreshStatus`
- **Add:**
  - `claudeSwap.useInThisWindow`
  - `claudeSwap.useMainLogin`
  - `claudeSwap.renameAccount`
  - `claudeSwap.removeAccount`
  - `claudeSwap.openPanel`
- **Settings:**
  - Keep `claudeSwap.pollIntervalMinutes`.
  - Remove `claudeSwap.cswapExecutablePath`.
  - Add `claudeSwap.confirmBeforeReload` (default true).

### Release

- Version 0.3.0. Remove all cswap code.
- **README rewrite:**
  - No claude-swap install step.
  - How per-window accounts work.
  - Caveats: switching reloads the window, the Windows settings-copy note, and that it relies on unofficial endpoints.
  - Thank claude-swap for the approach.
- Update the `package.json` description and remove the "needs claude-swap" badge.
- Check that `art/` banners don't mention cswap.
- Release notes tell existing users to sign in once per account.

### Testing

- There are no tests today. Add unit tests (Node's built-in test runner) for the pure logic:
  - usage formatting
  - the Keychain service-name hash
  - the lock protocol (stale, touch, contention)
  - in-use detection
  - safe delete never following links or junctions
  - registry concurrent writes
  - share allowlist and manifest repair
- Run the unit tests in CI on Windows, macOS and Linux (matrix), with `security` and the network mocked.
- **Manual check on Windows:**
  - Open three Antigravity windows on three accounts.
  - Check `/status` in each.
  - Switch one, and confirm the other two don't change.
  - Leave an unused account idle past token expiry, and confirm it renews without signing anything out.
  - Remove an account, and confirm the main chat history is untouched.
- **Mac must be tested by hand on a real Mac before release.** It can't be tested on this machine.

## Left to the builder

- Module layout, id scheme, file formats, heartbeat and stale timings (within the ranges above).
- Exact extra entries in the share allowlist beyond the required set.
- Whether to show per-model weekly limits (`limits[]`) and extra usage in the hover. Nice to have.
- The wording of messages, keeping the README's plain-English tone.
