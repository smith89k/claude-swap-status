# Sessions tab: All | Active switch, with finished sessions

Date: 2026-11-27
Status: approved 2026-11-27

## Intent

The Sessions tab only lists running sessions (a non-goal of the first version). The user wants to see finished sessions too, and reopen them. A switch at the top of the tab, **All | Active**, picks between the two lists.

## Decisions the user made

- Switch labels and order: **All | Active**, at the top of the Sessions tab.
- The tab opens on **Active** and remembers the last choice.
- **All** = the running groups first (as today), then finished sessions from the **last 30 days**, newest first, grouped **Today**, **Yesterday**, **Earlier this week**, **Older**.
- Clicking a finished session **reopens it in a Claude tab in this window**.

## Facts checked on this PC

- Every conversation is saved as `<configHome>/projects/<sanitized cwd>/<sessionId>.jsonl`. Sub-folders inside a project folder hold sub-agent logs and are ignored. 152 files changed in the last 30 days; some are over 20 MB.
- `~/.claude/history.jsonl` is not usable as the source: it misses 117 of those 152 (sessions started in the editor are not in it).
- In a transcript, `cwd` and `entrypoint` sit in the first few lines. The title is a `{"type":"ai-title","aiTitle":…}` line written near the end, and a rename is a `{"type":"custom-title","customTitle":…}` line. Some transcripts have no title line.
- The Claude extension reopens a conversation with `claude-vscode.editor.open(sessionId)`, which starts Claude with `--resume <id>` **in the window's folder**, using **the window's account folder**. So a reopen only works when the conversation's folder is one of this window's folders and its account is this window's account.

## Design

### Reading finished sessions (`src/core/pastSessions.ts`)

- For each account source (the same list the running list uses), list `<configHome>/projects/*/*.jsonl`. Skip files whose modified time is older than 30 days.
- Read only the **first 64 KB** (for `cwd`, `entrypoint`, the first real user message, an early rename) and the **last 128 KB** (for the newest `ai-title` and `custom-title`). Broken lines are skipped.
- Title, first match wins: rename → AI title → first user message (first line, cut to 60 characters; messages that start with `<`, meta and sidechain messages are skipped) → folder name.
- Last active = the file's modified time.
- A file without a `cwd` is skipped. A file that can't be read is skipped; the rest still show.
- Results are cached per file by modified time and size, so a file is re-read only when it changes.
- Read only. Nothing here writes to Claude's folders.

### Model (`src/core/sessionsModel.ts`)

- `SessionsModel` gains `past: SessionGroup[]` (`count` stays the running count, used by the tab badge).
- A finished session that is also running (same session id) is left out of `past`.
- Day groups use local midnight: Today, Yesterday, Earlier this week (2–6 days ago), Older (7–30 days ago). Empty groups are not shown.
- A finished row: title = the conversation title; subtitle = folder name; status `finished`; meta = `Claude tab` / `terminal` / `Claude app` · `<age> ago`.
- Whether it can be reopened, checked in this order:
  1. Made in the Claude app → note: "This conversation was in the Claude app. Reopen it there."
  2. Another account → note: "This conversation belongs to <account>. Switch this window to <account> to reopen it."
  3. Its folder is not one of this window's folders → note: "This conversation is from the <folder> folder. Open that folder to reopen it."
  4. Otherwise it can be reopened.

### Controller (`src/vscode/sessions.ts`)

- Running sessions are still re-read every 3 seconds while the panel is visible. Finished sessions are re-read at most every 30 seconds.
- `jump(id)`: a running session works as today. Otherwise, if it's a finished session that can be reopened, run `claude-vscode.editor.open(id)` (`opened`); if it has a note, show it (`noted`); if it's unknown, `missing`.

### Panel (`media/panel.js`, `media/panel.css`)

- On the Sessions tab only, a small two-button switch **All | Active** sits above the list. The choice is kept in the webview state; the default is Active.
- Active: exactly as today.
- All: running groups, then the finished groups. Finished rows have a hollow grey dot.
- Empty All view: "No Claude sessions in the last 30 days."

## Non-goals

- Searching or filtering old sessions, deleting them, or showing more than 30 days.
- Switching this window's account or opening another folder to reopen a conversation.
- Finished sessions in the "Jump to a Claude Session" quick pick.

## Testing

- Unit tests: reading titles (rename beats AI title beats first message beats folder), the 30-day cutoff, skipping sub-agent folders and broken files, the cache, day groups, leaving out running ones, and each of the three notes.
- Controller test: clicking a finished session runs `claude-vscode.editor.open` with its id; a note-only one shows its note.
- By hand in Antigravity: switch to All, click a finished session from this folder and account, and check that it reopens.
