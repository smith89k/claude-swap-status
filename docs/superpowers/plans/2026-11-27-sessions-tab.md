# Sessions Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Sessions tab to the Claude Accounts side panel that lists every running Claude session on the PC, across all accounts, and jumps to where a session runs when you click it.

**Architecture:**
- **Pure logic in `src/core/`:** reads Claude's `sessions/*.json` files, works out which window each session belongs to, and handles cross-window jump requests and parent-process lookups. Unit-tested with `node:test`.
- **A `SessionsController` in `src/vscode/`:** polls while the panel is visible, runs the jump (locally, or by writing a request file and calling `vscode.openFolder` on the target window's own folder), and handles requests addressed to its window.
- **The webview:** gets Accounts / Sessions tabs.

**Tech Stack:** TypeScript (strict), esbuild, VS Code API `~1.90`, Node built-ins only, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-27-sessions-tab-design.md` (approved; read it, especially "What the spike proved").

## Global Constraints

- **No new runtime dependencies.** Node built-ins only.
- **Never call `vscode.openFolder`** unless a live heartbeat (≤ 90 s old, pid alive) shows a window whose `openTarget` is that exact path. Never call it with the session's `cwd`.
- **Polling:** re-read sessions every 3 000 ms, only while the panel is visible.
- **Requests:** files live at `<accountsRoot>/requests/<windowId>.json`. A request older than 30 000 ms is ignored. The watcher has a 2 000 ms poll fallback.
- **Session names** are cut to 60 characters: 59 characters plus `…`.
- **Terminal matching** walks up to 3 ancestor levels from the session's pid.
- **`entrypoint`:** `claude-vscode` → `ide`, `claude-desktop` → `app`, anything else → `terminal`.
- **`status`:** `waiting` → `waiting`, `busy` or `shell` → `working`, anything else → `idle`.
- **Age** uses `statusUpdatedAt ?? updatedAt ?? startedAt`.
- **Group order and headings:**
  - `waiting` → "Waiting for you"
  - `working` → "Working"
  - `idle` → "Idle"
  - Inside a group, the oldest `since` comes first.
- **Exact user-facing text:**
  - "No Claude sessions are running right now."
  - "That window just closed."
  - "Couldn't open that Claude session here."
  - "This session runs in the Claude app."
  - "This session runs in a terminal outside the editor."
  - "This session runs in a window that can't be reached. Reload that window, then try again."
- **Parent pid lookup:**
  - Windows: `powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_Process -Filter \"ProcessId=<pid>\").ParentProcessId"`
  - Elsewhere: `ps -o ppid= -p <pid>`
  - Only integer pids are ever put into a command.
- **Never write into Claude's own `sessions/` folders.**
- **Width check:** no sideways scroll at 170, 220, 300, 560 or 760 px.

## Review Focus

1. **A terminal session whose `cwd` is a subfolder of a window's folder** (after `cd src`). It should match that window and jump using the window's `openTarget`, not the subfolder. Covered in Task 2: `a subfolder session belongs to the window that has its parent folder open`.
2. **Path spelling differences on Windows** (`C:\X\Proj` vs `c:/x/proj/`). They should still match. Covered in Task 2: `paths match across case, slash style and trailing slash on Windows`.
3. **A stale or foreign request file** (older than 30 s, or written for another window). It should be ignored and the stale one deleted. Covered in Task 3: `an old request is dropped and deleted`.
4. **A session file caught mid-write** (bad JSON), or a dead pid. It should be skipped silently, with no error shown. Covered in Task 1: `dead pids, key files and broken files are skipped`.
5. **The target window closing between listing and clicking.** There should be no `openFolder` call, and "That window just closed." is shown. Covered in Task 4: `a closed target window gets a message, never openFolder`.

---

### Task 1: Read running sessions

**Files:**
- Create: `src/core/sessions.ts`, `src/test/sessions.test.ts`

**Interfaces:**
- Consumes: `isPidAlive` (`src/core/windows.ts`), `readJson` (`src/core/fsjson.ts`).
- Produces:
  - `type SessionKind = 'ide' | 'terminal' | 'app'`
  - `type SessionStatus = 'waiting' | 'working' | 'idle'`
  - `interface RunningSession { pid: number; sessionId: string; cwd: string; name: string; kind: SessionKind; status: SessionStatus; since: number; accountKey: string }`
  - `interface SessionSource { accountKey: string; configHome: string }`
  - `listSessions(sources: SessionSource[], isAlive?: (pid: number) => boolean): Promise<RunningSession[]>`

- [ ] **Step 1: Write the failing tests** in `src/test/sessions.test.ts`. Each test makes temp `configHome` folders containing `sessions/`.

```ts
test('reads sessions from every account folder and maps kind, status and age', async () => {
  // main/sessions/10.json {pid:10, sessionId:'s1', cwd:'C:\\p\\a', name:'a-1', entrypoint:'claude-vscode', status:'waiting', statusUpdatedAt:500, updatedAt:400, startedAt:300}
  // acc/sessions/20.json  {pid:20, sessionId:'s2', cwd:'/p/b', name:'', entrypoint:'cli', status:'shell', updatedAt:700, startedAt:600}
  // main/sessions/30.json {pid:30, sessionId:'s3', cwd:'/x', name:'n', entrypoint:'claude-desktop', status:'odd', startedAt:900}
  const got = await listSessions([{ accountKey: 'main', configHome: main }, { accountKey: 'a1', configHome: acc }], () => true);
  const by = Object.fromEntries(got.map((s) => [s.sessionId, s]));
  assert.deepEqual(by.s1, { pid: 10, sessionId: 's1', cwd: 'C:\\p\\a', name: 'a-1', kind: 'ide', status: 'waiting', since: 500, accountKey: 'main' });
  assert.deepEqual([by.s2.kind, by.s2.status, by.s2.since, by.s2.name, by.s2.accountKey], ['terminal', 'working', 700, 'b', 'a1']);
  assert.deepEqual([by.s3.kind, by.s3.status, by.s3.since], ['app', 'idle', 900]);
});
test('dead pids, key files and broken files are skipped', async () => {
  // sessions/10.json (pid 10, dead), sessions/11.<hash>.key, sessions/12.json = '{"pid":', sessions/13.json missing sessionId
  assert.deepEqual(await listSessions([{ accountKey: 'main', configHome: home }], (p) => p !== 10), []);
});
test('a missing sessions folder is just empty', async () => {
  assert.deepEqual(await listSessions([{ accountKey: 'a9', configHome: join(tmp, 'nope') }]), []);
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL, because `../core/sessions` can't be resolved.
- [ ] **Step 3: Implement `listSessions`.**
  - Read `<configHome>/sessions/*.json`, skipping other files.
  - A file is valid only if it has a numeric `pid`, a string `sessionId`, and a string `cwd`. Skip any file that's invalid, unreadable, or whose pid is dead.
  - The default `isAlive` is `isPidAlive`.
  - Use the mappings from Global Constraints.
  - When `name` is empty, fall back to the last segment of `cwd`, splitting on both `\` and `/`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(core): read running Claude sessions from every account`.

---

### Task 2: Which window a session is in, and the tab's content

**Files:**
- Create: `src/core/sessionsModel.ts`, `src/test/sessionsModel.test.ts`
- Modify: `src/core/types.ts` (`WindowBeat` gets `folders?: string[]` and `openTarget?: string`)

**Interfaces:**
- Consumes: `RunningSession` (Task 1), `WindowBeat`, `AccountView`, `formatAge`.
- Produces:
  - `samePath(a: string, b: string, platform?: NodeJS.Platform): boolean`
  - `isUnder(child: string, folder: string, platform?: NodeJS.Platform): boolean` (true when `child` equals `folder` or is inside it)
  - `type SessionPlace = { where: 'thisWindow' } | { where: 'otherWindow'; windowId: string; openTarget: string } | { where: 'app' } | { where: 'outside' }`
  - `locate(s: RunningSession, liveWindows: WindowBeat[], thisWindowId: string, platform?: NodeJS.Platform): SessionPlace`
  - `interface SessionRow { sessionId: string; pid: number; kind: SessionKind; status: SessionStatus; title: string; subtitle: string; accountName: string; isMain: boolean; whereText: string; ageText: string; canJump: boolean; note?: string }`
  - `interface SessionGroup { status: SessionStatus; heading: string; rows: SessionRow[] }`
  - `interface SessionsModel { count: number; groups: SessionGroup[] }`
  - `toSessionsModel(sessions: RunningSession[], liveWindows: WindowBeat[], accounts: AccountView[], thisWindowId: string, now: number, platform?: NodeJS.Platform): SessionsModel`
  - `platform` defaults to `process.platform`. On `win32`, comparison ignores case, treats `/` as `\`, and ignores trailing separators.

- [ ] **Step 1: Write the failing tests** in `src/test/sessionsModel.test.ts`.

```ts
const W = (id: string, folders: string[], openTarget?: string) => ({ windowId: id, accountKey: 'main', workspaceName: id, pid: 1, updatedAt: 0, folders, openTarget: openTarget ?? folders[0] });
const S = (p: Partial<RunningSession>): RunningSession => ({ pid: 5, sessionId: 'x', cwd: 'C:\\p\\a', name: 'n', kind: 'ide', status: 'idle', since: 0, accountKey: 'main', ...p });

test('paths match across case, slash style and trailing slash on Windows', () => {
  assert.equal(samePath('C:\\X\\Proj', 'c:/x/proj/', 'win32'), true);
  assert.equal(samePath('/x/Proj', '/x/proj', 'linux'), false);
  assert.equal(isUnder('C:\\p\\a\\src', 'c:/p/a', 'win32'), true);
  assert.equal(isUnder('C:\\p\\ab', 'C:\\p\\a', 'win32'), false);
});
test('locates this window, another window, the app, and outside', () => {
  const wins = [W('me', ['C:\\p\\a']), W('other', ['C:\\p\\b'])];
  assert.deepEqual(locate(S({}), wins, 'me', 'win32'), { where: 'thisWindow' });
  assert.deepEqual(locate(S({ cwd: 'c:/p/b' }), wins, 'me', 'win32'), { where: 'otherWindow', windowId: 'other', openTarget: 'C:\\p\\b' });
  assert.deepEqual(locate(S({ kind: 'app' }), wins, 'me', 'win32'), { where: 'app' });
  assert.deepEqual(locate(S({ cwd: 'D:\\z', kind: 'terminal' }), wins, 'me', 'win32'), { where: 'outside' });
});
test('a subfolder session belongs to the window that has its parent folder open', () => {
  const wins = [W('other', ['C:\\p\\b'], 'C:\\ws\\b.code-workspace')];
  assert.deepEqual(locate(S({ cwd: 'C:\\p\\b\\src', kind: 'terminal' }), wins, 'me', 'win32'), { where: 'otherWindow', windowId: 'other', openTarget: 'C:\\ws\\b.code-workspace' });
});
test('the longest matching folder wins, and an old heartbeat without folders never matches', () => {
  const wins = [W('outer', ['C:\\p']), W('inner', ['C:\\p\\b']), { windowId: 'old', accountKey: 'main', workspaceName: 'old', pid: 1, updatedAt: 0 }];
  assert.equal((locate(S({ cwd: 'C:\\p\\b\\x' }), wins as any, 'me', 'win32') as any).windowId, 'inner');
});
test('groups waiting, working, idle in that order, oldest first, with labels and crown', () => {
  const views = [{ key: 'main', number: 1, label: 'personal', isMain: true } as any, { key: 'a1', number: 2, label: 'work', isMain: false } as any];
  const m = toSessionsModel([
    S({ sessionId: 'i', status: 'idle', since: 1000 }),
    S({ sessionId: 'w2', status: 'waiting', since: 9000, accountKey: 'a1' }),
    S({ sessionId: 'w1', status: 'waiting', since: 5000, name: 'x'.repeat(80) }),
    S({ sessionId: 'k', status: 'working', since: 2000, kind: 'app' }),
  ], [W('me', ['C:\\p\\a'])], views, 'me', 65_000, 'win32');
  assert.equal(m.count, 4);
  assert.deepEqual(m.groups.map((g) => [g.heading, g.rows.map((r) => r.sessionId)]), [['Waiting for you', ['w1', 'w2']], ['Working', ['k']], ['Idle', ['i']]]);
  const w1 = m.groups[0].rows[0];
  assert.deepEqual([w1.title, w1.subtitle.length, w1.subtitle.endsWith('…'), w1.accountName, w1.isMain, w1.canJump, w1.ageText], ['a', 60, true, 'personal', true, true, '1m']);
  assert.equal(m.groups[0].rows[1].accountName, 'work');
  const k = m.groups[1].rows[0];
  assert.deepEqual([k.canJump, k.note], [false, 'This session runs in the Claude app.']);
});
test('nothing running gives an empty model', () => {
  assert.deepEqual(toSessionsModel([], [], [], 'me', 0), { count: 0, groups: [] });
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement it.** Use these strings:
  - **`whereText`:**
    - `thisWindow`: `Claude tab · this window` or `terminal · this window`
    - `otherWindow`: `Claude tab · other window` or `terminal · other window`
    - `app`: `Claude app`
    - `outside`: `outside the editor`
  - **`note`**, for rows that can't jump: `app` uses the Claude-app sentence. `outside` uses the outside-terminal sentence for `terminal` sessions, and the can't-be-reached sentence for `ide` sessions.
  - **`subtitle`** is `''` when the name equals the title.
  - **`accountName`** falls back to the account key when no view matches.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(core): place each session in a window and build the Sessions tab content`.

---

### Task 3: Jump requests and parent processes

**Files:**
- Create: `src/core/jumpRequests.ts`, `src/core/processTree.ts`, `src/test/jump.test.ts`

**Interfaces:**
- Consumes: `writeJsonAtomic`, `readJson` (fsjson), `SessionKind` (Task 1).
- Produces:
  - `interface JumpRequest { sessionId: string; pid: number; kind: SessionKind; at: number }`
  - `requestPath(root: string, windowId: string): string`
  - `writeJumpRequest(root: string, windowId: string, req: JumpRequest): Promise<void>`
  - `takeJumpRequest(root: string, windowId: string, now: number, maxAgeMs?: number): Promise<JumpRequest | undefined>` (reads and deletes the request. Returns undefined if it's missing, broken or too old; default max age 30 000.)
  - `type ProcRunner = (cmd: string, args: string[]) => Promise<string>`
  - `parentPid(pid: number, platform: NodeJS.Platform, run?: ProcRunner): Promise<number | undefined>`
  - `ancestors(pid: number, levels: number, platform: NodeJS.Platform, run?: ProcRunner): Promise<number[]>`

- [ ] **Step 1: Write the failing tests** in `src/test/jump.test.ts`.

```ts
test('a request is written for one window and taken once', async () => {
  await writeJumpRequest(root, 'w1', { sessionId: 's', pid: 5, kind: 'ide', at: 1000 });
  assert.equal(await takeJumpRequest(root, 'w2', 1000), undefined);
  assert.deepEqual(await takeJumpRequest(root, 'w1', 2000), { sessionId: 's', pid: 5, kind: 'ide', at: 1000 });
  assert.equal(await takeJumpRequest(root, 'w1', 2000), undefined);
});
test('an old request is dropped and deleted', async () => {
  await writeJumpRequest(root, 'w1', { sessionId: 's', pid: 5, kind: 'ide', at: 0 });
  assert.equal(await takeJumpRequest(root, 'w1', 31_000), undefined);
  assert.ok(!existsSync(requestPath(root, 'w1')));
});
test('parentPid asks PowerShell on Windows and ps elsewhere', async () => {
  const calls: string[][] = [];
  const run: ProcRunner = async (cmd, args) => { calls.push([cmd, ...args]); return cmd === 'ps' ? '  4321\n' : '1234\r\n'; };
  assert.equal(await parentPid(77, 'win32', run), 1234);
  assert.ok(calls[0][0] === 'powershell' && calls[0].join(' ').includes('ProcessId=77'));
  assert.equal(await parentPid(77, 'linux', run), 4321);
  assert.deepEqual(calls[1], ['ps', '-o', 'ppid=', '-p', '77']);
});
test('parentPid gives up on bad output or a bad pid', async () => {
  assert.equal(await parentPid(77, 'linux', async () => 'nope'), undefined);
  assert.equal(await parentPid(1.5, 'linux', async () => { throw new Error('never called'); }), undefined);
});
test('ancestors walks up to the given number of levels', async () => {
  const parent: Record<number, string> = { 10: '20', 20: '30', 30: '0' };
  assert.deepEqual(await ancestors(10, 3, 'linux', async (_c, a) => parent[Number(a[a.length - 1])] ?? ''), [20, 30]);
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement both files.**
  - The default runner uses `child_process.execFile` with a 5 000 ms timeout and returns stdout. It never uses a shell string.
  - `ancestors` stops at a missing parent, a pid of 0 or less, or a repeated pid.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(core): cross-window jump requests and parent process lookup`.

---

### Task 4: Sessions controller and the jump

**Files:**
- Create: `src/vscode/sessions.ts`, `src/test/sessionsController.test.ts`
- Modify:
  - `src/vscode/controller.ts`: make `windowId` public readonly, and have the heartbeat include `folders` and `openTarget`.
  - `src/test/fakes/vscode.ts`: add `Uri.file`, `workspace.workspaceFolders`, `workspace.workspaceFile`, `window.terminals`, and `EventEmitter`.
  - `src/extension.ts`: create the controller, register `claudeSwap.jumpToSession`, start watching.
  - `package.json`: add the command `claudeSwap.jumpToSession`, titled "Jump to a Claude Session", category "Claude Swap".

**Interfaces:**
- Consumes: Tasks 1–3, `WindowRegistry.live()`, `AccountsController` (`views`, `registry`, `root`, `originalConfigDir`, `windowId`, `windows`).
- Produces:
  - `class SessionsController implements vscode.Disposable`, with:
    - `constructor(d: { root: string; thisWindowId: string; sources: () => Promise<SessionSource[]>; liveWindows: () => Promise<WindowBeat[]>; accounts: () => AccountView[]; log: { warn(s: string): void }; platform?: NodeJS.Platform; now?: () => number; run?: ProcRunner })`
    - `readonly onDidChange: vscode.Event<SessionsModel>`
    - `model: SessionsModel`
    - `sessions: RunningSession[]`
    - `refresh(): Promise<void>`
    - `setVisible(visible: boolean): void`
    - `jump(sessionId: string): Promise<'opened' | 'forwarded' | 'noted' | 'gone' | 'missing'>`
    - `handleRequest(): Promise<void>`
    - `startWatching(): void`
  - The heartbeat gets:
    - `folders`: the workspace folders' `fsPath`
    - `openTarget`: `workspace.workspaceFile.fsPath` when its scheme is `file`; otherwise the first folder; undefined for an untitled multi-root workspace

- [ ] **Step 1: Write the failing tests** in `src/test/sessionsController.test.ts`. They use the stand-in editor (`fake.commands`, `fake.messages`) and a temp root.

```ts
// helper: controller(sessionsInFolder, liveWindows) wires sources to a temp config home holding session files with live pids (isAlive via process.pid), thisWindowId 'me'
test('a session in another window writes the request and brings that window forward', async () => {
  const c = await controller([{ sessionId: 's2', cwd: 'C:\\p\\b', entrypoint: 'claude-vscode' }], [W('me', ['C:\\p\\a']), W('other', ['C:\\p\\b'], 'C:\\ws\\b.code-workspace')]);
  assert.equal(await c.jump('s2'), 'forwarded');
  assert.deepEqual((await takeJumpRequest(root, 'other', Date.now()))?.sessionId, 's2');
  const open = fake.commands.find((x) => x.id === 'vscode.openFolder')!;
  assert.equal((open.args[0] as any).fsPath, 'C:\\ws\\b.code-workspace');
  assert.deepEqual(open.args[1], { forceNewWindow: true });
});
test('a closed target window gets a message, never openFolder', async () => {
  const live = [W('me', ['C:\\p\\a']), W('other', ['C:\\p\\b'])];
  const c = await controller([{ sessionId: 's2', cwd: 'C:\\p\\b', entrypoint: 'claude-vscode' }], live); // helper's liveWindows() returns this same array
  await c.refresh();
  live.splice(1, 1); // window "other" closes after the list was drawn
  assert.equal(await c.jump('s2'), 'gone');
  assert.ok(!fake.commands.some((x) => x.id === 'vscode.openFolder'));
  assert.ok(fake.messages.some((m) => m.text === 'That window just closed.'));
});
test('a session in this window opens its Claude tab', async () => {
  const c = await controller([{ sessionId: 's1', cwd: 'C:\\p\\a', entrypoint: 'claude-vscode' }], [W('me', ['C:\\p\\a'])]);
  assert.equal(await c.jump('s1'), 'opened');
  assert.deepEqual(fake.commands.find((x) => x.id === 'claude-vscode.editor.open')?.args, ['s1']);
});
test('a request addressed to this window opens the Claude tab here', async () => {
  const c = await controller([], [W('me', ['C:\\p\\a'])]);
  await writeJumpRequest(root, 'me', { sessionId: 's9', pid: 1, kind: 'ide', at: Date.now() });
  await c.handleRequest();
  assert.deepEqual(fake.commands.find((x) => x.id === 'claude-vscode.editor.open')?.args, ['s9']);
});
test('a Claude app session only shows a note', async () => {
  const c = await controller([{ sessionId: 's3', cwd: 'C:\\x', entrypoint: 'claude-desktop' }], [W('me', ['C:\\p\\a'])]);
  assert.equal(await c.jump('s3'), 'noted');
  assert.ok(fake.messages.some((m) => m.text === 'This session runs in the Claude app.'));
  assert.ok(!fake.commands.some((x) => x.id === 'vscode.openFolder'));
});
test('a terminal session in this window shows the terminal whose shell started it', async () => {
  // fake.terminals = [{ processId: Promise.resolve(900), show() { shown.push(900) } }, { processId: Promise.resolve(901), show() { shown.push(901) } }]
  // run (ProcRunner) maps 555 -> 700 -> 901
  const c = await controller([{ sessionId: 's4', cwd: 'C:\\p\\a', entrypoint: 'cli', pid: 555 }], [W('me', ['C:\\p\\a'])]);
  assert.equal(await c.jump('s4'), 'opened');
  assert.deepEqual(shown, [901]);
});
```

The helper's `liveWindows` returns the array it was given, so a test can close a window by changing that array. Don't add test-only methods to the class.

`jump` must check `liveWindows()` again at click time, not only use what `refresh()` saw.

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `SessionsController`.**
  - **`jump`:**
    1. Find the session; if it isn't there, refresh once. Still missing gives `'missing'`.
    2. Work out its place with `locate`.
    3. **This window:** run the local action and return `'opened'`.
    4. **Another window:** check that `liveWindows()` still contains `windowId`. If not, show the "closed" message and return `'gone'`. Otherwise `writeJumpRequest`, then run `vscode.openFolder(Uri.file(openTarget), { forceNewWindow: true })`, and return `'forwarded'`.
    5. **App or outside:** show `row.note` and return `'noted'`.
  - **Local action:**
    - `ide`: `claude-vscode.editor.open` with the session id. On error, show "Couldn't open that Claude session here."
    - `terminal`: `ancestors(pid, 3)`. Show the first terminal whose `processId` is in that list. If none matches, do nothing.
  - **`startWatching`:** `fs.watch(<root>/requests)` (create the folder first), plus `setInterval(handleRequest, 2000)`.
  - **`setVisible(true)`:** refresh now, then every 3 000 ms. `setVisible(false)` stops the timer.
- [ ] **Step 4: Wire it in `extension.ts`.**
  - `sources` = the main login (`MAIN_KEY`, `configHome(original)`) plus every registry account (`id`, `folder`).
  - `liveWindows` = `c.windows.live()`.
  - `accounts` = `() => c.views`.
  - Register `claudeSwap.jumpToSession(sessionId?: string)`. With no id, it shows a quick pick of the rows (heading, title, account) and then jumps.
  - Call `startWatching()`.
  - Add the `package.json` command.
- [ ] **Step 5: Run `npx tsc -p ./ --noEmit && npm test && npm run build`.** Expected: clean, all tests pass.
- [ ] **Step 6: Commit:** `feat: sessions controller, cross-window jump and request handling`.

---

### Task 5: Accounts / Sessions tabs in the panel

**Files:**
- Modify: `src/vscode/accountsPanel.ts`, `media/panel.js`, `media/panel.css`, `src/extension.ts`

**Interfaces:**
- Consumes: `SessionsController` (Task 4).
- Produces:
  - The webview message `{ type: 'state', model, sessions: SessionsModel }`.
  - The webview action `{ type: 'jump', sessionId }`, which the provider turns into `claudeSwap.jumpToSession`.

- [ ] **Step 1: Provider.**
  - The constructor also takes `sessions: SessionsController`.
  - `post()` includes `sessions: sessions.model`, and is called on `sessions.onDidChange`.
  - Visibility changes call `sessions.setVisible(view.visible)`, and resolving the view calls `setVisible(true)`.
  - `onMessage` accepts `{ type: 'jump', sessionId: string }`.
- [ ] **Step 2: `panel.js`.**
  - **Tab bar:** at the top, `role="tablist"` with two `role="tab"` buttons, "Accounts" and "Sessions" (with a count badge when the count is above 0). It uses `aria-selected`, and arrow keys move between tabs.
  - **Tab memory:** the chosen tab is kept in `setState({ model, sessions, tab })`.
  - **Sessions tab:**
    - For each group: an `h2` heading, then rows.
    - Each row is a `<button class="session">` containing:
      - a status dot (`data-status`)
      - the title, in bold
      - the crown SVG (reuse `CROWN`) before `accountName` when `isMain`
      - the subtitle
      - a meta line: `whereText · ageText`
    - Clicking a row posts `{ type: 'jump', sessionId }`.
    - When the count is 0: a `p.intro` with "No Claude sessions are running right now."
- [ ] **Step 3: `panel.css`.**
  - The tab bar is a flex row with an underline indicator (`--accent`) on the selected tab.
  - Session rows use the existing box style (border `--box`, radius 4px, padding 10px 12px) and must shrink (`min-width: 0`, ellipsis on long text).
  - Dot colours: waiting = `--fill-warning`, working = `--fill-normal`, idle = `--muted`.
  - Use the same container rules as the Accounts tab.
- [ ] **Step 4: Visual and width check with headless Chrome.**
  - Extend the scratchpad preview (`frame-v.html`) with a sample `sessions` model and a `tab=sessions` query.
  - Take screenshots with `"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu --window-size=1700,820 --screenshot=<out.png> http://127.0.0.1:47831/widths.html?tab=sessions`.
  - Run the existing `layout-check.js` through a page that writes its result into `document.body` and is read with `--dump-dom`.
  - Expected: the check returns `[]` for both tabs, and the screenshot shows the tabs, groups, dots and crown.
- [ ] **Step 5: Run `npx tsc -p ./ --noEmit && npm test && npm run test:launch`.** Expected: all pass. The launch test now also sees `claudeSwap.jumpToSession` registered, because it checks every contributed command.
- [ ] **Step 6: Commit:** `feat: Sessions tab in the side panel`.

---

### Task 6: README, package, and the manual check

**Files:**
- Modify: `README.md`, `.gitignore` (add `.superpowers/`)

- [ ] **Step 1: README.**
  - Add a "Sessions tab" section: what it lists, the three groups, what clicking does in each case (this window, another window, terminal, Claude app, outside terminal), and that it never opens a new window.
  - Add `Claude Swap: Jump to a Claude Session` to the Commands table.
  - Under "Good to know", note that a window running an older version needs a reload before you can jump to it.
- [ ] **Step 2: Packaging.** Add `.superpowers/` to `.gitignore`. Run `npx --yes @vscode/vsce@3 package`. Expected: `DONE Packaged`, with `.superpowers` absent from `vsce ls`.
- [ ] **Step 3: Manual check (user, Antigravity), using two windows on different folders, each with a Claude chat, plus a `claude` running in a terminal of the second window:**
  1. The Sessions tab in window 1 lists all of them, grouped, with the right account names and the crown on the main account.
  2. Clicking the window-2 chat brings window 2 forward on that chat, and no new window opens.
  3. Clicking the window-2 terminal session brings window 2 forward and shows that terminal.
  4. Clicking a Claude desktop app session shows "This session runs in the Claude app." and nothing else.
- [ ] **Step 4: Commit:** `docs: Sessions tab in the README`.
