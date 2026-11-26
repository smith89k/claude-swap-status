# Sessions tab: see every running Claude session and jump to it

Date: 2026-11-27
Status: approved 2026-11-27

## Intent

The user runs several Claude sessions at once: in more than one Antigravity window, on more than one account, sometimes in terminals and in the Claude desktop app. They want one place that lists every running session on the PC and lets them **jump to where a session is running** with one click. That place is a new **Sessions** tab in the existing Claude Accounts side panel.

"Control" means **find and jump to** here. The user picked "jump to where it's running" over opening a copy here or opening the project in a new window.

## What the spike proved (2026-11-27, Antigravity on Windows)

A throwaway extension tested both risky steps in the user's real Antigravity:

1. **Bringing another window to the front works.** `vscode.commands.executeCommand('vscode.openFolder', Uri.file(folder), { forceNewWindow: true })`, with `folder` already open in another window, brought that window to the front. No new window opened.
   - **Corollary:** if no window has that folder open, the same call **opens a new window**. The feature must only make this call for a folder it knows is open in a live window.
2. **Claude reuses a session's tab.** `vscode.commands.executeCommand('claude-vscode.editor.open', sessionId)` switched to the existing tab for that session (3 Claude tabs before, 3 after).

Also seen: sessions from the **Claude desktop app** are listed in `~/.claude/sessions/` with `entrypoint: "claude-desktop"`. The IDE can't bring that app to the front.

## Goals

1. A **Sessions** tab in the side panel, next to **Accounts**. It lists every running Claude session on this PC, from every account (the main login's config folder and every folder in `~/.claude-accounts`).
2. Each row shows:
   - the project (folder name)
   - the session's name
   - the account (with the crown 👑 for the main account)
   - where it runs: this window, another window, a terminal, the Claude app, or an outside terminal
   - its status: **Waiting for you**, **Working**, or **Idle**
   - how long it has been in that status
3. Rows are grouped by status, with **Waiting for you** first. The tab label shows the count, e.g. "Sessions 4".
4. **Clicking a row jumps to the session:**
   - **Claude tab in this window:** open/reveal its tab (`claude-vscode.editor.open`).
   - **Claude tab in another window:** bring that window to the front and reveal the session's Claude tab there.
   - **Terminal inside an IDE window:** bring that window to the front (if it isn't this one) and show the terminal running that session. If the terminal can't be found, bringing the window forward is enough.
   - **Claude app or outside terminal:** no jump. The row says where it is, and clicking shows a short note.
5. It works the same in VS Code and Antigravity, on Windows, macOS and Linux.

## Non-goals

- Stopping, restarting, sending messages to, or approving requests for a session.
- Past (finished) sessions. Only running ones are listed.
- Bringing the Claude desktop app or an outside terminal app to the front.
- The phone app idea (parked). The session list built here can be reused by it later.

## Anti-goals

- **Opening an unwanted new window.** Never call `vscode.openFolder` unless a live window has that exact folder or workspace open.
- **Opening a second live copy of a session** in another window.
- **Touching sessions.** The feature only reads Claude's files and never writes into Claude's `sessions/` folders.
- **A noticeable slowdown.** Reading the session files must stay cheap.

## Constraints and facts (checked on this PC)

**Session files.** Each running Claude session writes `<configHome>/sessions/<pid>.json`, next to a `<pid>.<hash>.key` file, which must be ignored. The fields used:

| Field | Meaning |
|---|---|
| `pid` | The Claude process id. A row counts only while this pid is alive. |
| `sessionId` | The conversation id, passed to `claude-vscode.editor.open`. |
| `cwd` | The project folder. |
| `name` | The session's name. It may be long, or be the first prompt's text. |
| `entrypoint` | `claude-vscode` is a Claude tab in an IDE, `claude-desktop` is the Claude app, anything else (e.g. `cli`) is a terminal. |
| `status` | `waiting` (waiting for you), `busy` (working), `shell` (running a command, shown as Working), `idle`. Anything else counts as Idle. |
| `statusUpdatedAt`, `updatedAt`, `startedAt` | Times in ms. The age shown uses the first one present. |

Other facts:

- **Config folders to scan:** the main config home (`configHome(originalConfigDir)`), plus `<account folder>/sessions` for every registered account.
- **One window per folder.** VS Code and Antigravity let a folder be open in only one window, so a folder identifies a window.
- **Heartbeats.** Every window already writes a heartbeat (`~/.claude-accounts/windows/<windowId>.json`). This feature adds the window's folders, and its `.code-workspace` file when there is one, so other windows know what is open where.
- **Process tree.** A terminal's shell pid is `await terminal.processId`. A Claude process started in that terminal is a child of the shell, sometimes with one or two processes in between. Finding a process's parent:
  - **Windows:** PowerShell `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"`, reading `ParentProcessId`. This takes about 0.5–1 s, so it runs only on click.
  - **macOS and Linux:** `ps -o ppid= -p <pid>`.

## Approaches

1. **Window-to-window notes plus "open folder" to bring a window forward.** (Chosen.)
   - The clicking window writes a small request file for the target window, then asks the IDE to open the target's folder, which brings that window forward.
   - The target window picks up the request and reveals the tab or terminal.
   - Both risky steps were proven in the spike. It uses only extension APIs and needs no OS tricks.
2. **OS-level window focus** (e.g. PowerShell `SetForegroundWindow` with a window handle). Dropped: it needs different code per OS, Windows often blocks it from background processes, and it can't pick a tab inside the window.
3. **URI links** (`antigravity://anthropic.claude-code/open?session=…`). Dropped: the IDE sends the link to whichever window was focused last, not to the window that has the session.

## Design

### Reading sessions (pure, `src/core/sessions.ts`)

- `listSessions(sources: { accountKey: string; configHome: string }[], isAlive): Promise<RunningSession[]>` reads every `sessions/*.json`. It skips unreadable files and dead pids, and tags each session with the account key whose folder it came from.
- `RunningSession = { pid, sessionId, cwd, name, kind: 'ide' | 'terminal' | 'app', status: 'waiting' | 'working' | 'idle', since: number, accountKey }`.

### Where a session runs (pure, `src/core/sessionsModel.ts`)

- `locate(session, liveWindows, thisWindowId)` returns one of:
  - `{ where: 'thisWindow' }`
  - `{ where: 'otherWindow', windowId, openTarget }`
  - `{ where: 'app' }`
  - `{ where: 'outside' }`
- **Matching rule:** a window matches when one of its folders equals the session's `cwd`, or contains it (for terminal sessions in a subfolder). Path comparison ignores case on Windows and trailing slashes, and the longest matching folder wins.
- `openTarget` is the window's `.code-workspace` file if it has one, otherwise the folder the window opened. It is never the session's `cwd`, which might be a subfolder and would open a new window.
- `toSessionsModel(sessions, liveWindows, accountViews, thisWindowId, now)` builds the tab's content:
  - groups in the order Waiting for you, Working, Idle; inside a group, the longest wait first
  - each row's title (folder name), subtitle (session name, cut to about 60 characters), account name and whether it's the main account, the "where" text, the age text (reusing `formatAge`), and whether it can jump

### The jump

- **Same window:**
  - IDE session: `claude-vscode.editor.open(sessionId)`.
  - Terminal session: find this window's terminal whose shell is an ancestor (up to 3 levels) of the session's pid, then `terminal.show()`.
- **Other window:**
  1. Write `~/.claude-accounts/requests/<targetWindowId>.json`, containing `{ sessionId, pid, kind, at }`.
  2. Run `vscode.openFolder(openTarget, { forceNewWindow: true })`. Only do this when the target's heartbeat is live; otherwise show "That window just closed."
- **Target window:** watches `~/.claude-accounts/requests/` with `fs.watch`, plus a 2-second poll as a fallback.
  - When it sees its own file, it reads and deletes it, and ignores it if it's older than 30 seconds.
  - Then it does the same-window action.
  - If the Claude extension isn't installed or the command fails, it shows "Couldn't open that Claude session here."
- **Claude app or outside terminal:** no jump. Show an info message: "This session runs in the Claude app" or "…in a terminal outside the editor".

### Panel

- **Tabs:** the webview gets two tabs at the top, **Accounts** and **Sessions N**, built as an accessible tablist. The chosen tab is remembered with `setState`.
- **Sessions content:** status group headings, then rows.
  - Each row is a button: folder name in bold, then the session name, then a line with account (with crown), where, and age.
  - A status dot uses theme colours: waiting = warning colour, working = progress colour, idle = muted.
  - Rows that can't jump look the same but show their note on click.
  - When nothing is running: "No Claude sessions are running right now."
- **Updates:** the controller re-reads sessions every 3 seconds while the panel is visible, and not at all while it's hidden. Window heartbeats now include folders and workspace file. A `claudeSwap.jumpToSession` command (taking a session id) does the jump, so the panel and tests use the same path.
- **Narrow sidebars:** the same rules as the Accounts tab (no sideways scroll at 170–760 px).

## Testing

- **Unit tests:**
  - `listSessions`: alive/dead pids, `.key` files ignored, bad JSON, missing folders.
  - `locate`: this window, other window, subfolder cwd, case and slash differences, no match, the app, workspace-file target.
  - `toSessionsModel`: grouping and order, labels, crown flag, ages.
  - Request files: write, take (read and delete), and expiry.
  - Parent-pid parsing for both the Windows and `ps` outputs, using an injected runner.
- **Glue tests** with the editor stand-in:
  - Clicking a session in another window writes the request and calls `vscode.openFolder` with the workspace target, never the cwd.
  - A dead target window means no `openFolder` call.
  - A received request calls `claude-vscode.editor.open` with the session id.
- **Launch test:** `claudeSwap.jumpToSession` is registered.
- **Layout check:** the existing width check, run on the Sessions tab too.
- **Manual (user, Antigravity):** two windows on different folders, each with a Claude chat.
  - Click the other window's session in the Sessions tab: it comes forward and shows that chat.
  - A terminal `claude` in the other window: that window comes forward and shows the terminal.
  - A Claude app session: it shows the note and opens no window.

## Calls made without asking (check these)

- A window still running an older version of the extension writes a heartbeat without folders, so it can't be a jump target. Its sessions show as "outside" until that window reloads.
- Sessions are only re-read while the panel is visible (every 3 s), to keep things light.
- Session names are cut to about 60 characters, because some are the full first prompt.
- The uncommitted naming, crown and layout changes are saved as their own commit before this work starts.

## Left to the builder

- Exact visuals within the existing panel style (boxes, theme colours).
- The poll timings within what's stated above.
- How many ancestor levels to walk for terminals (at least 3).
