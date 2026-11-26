"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode7 = __toESM(require("vscode"));

// src/core/paths.ts
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var os = __toESM(require("node:os"));
var path = __toESM(require("node:path"));
function accountsRoot(home = os.homedir()) {
  return path.join(home, ".claude-accounts");
}
function accountFolder(root, id) {
  return path.join(root, id);
}
function newAccountId() {
  return (0, import_node_crypto.randomBytes)(4).toString("hex");
}
function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
function configHome(configDirEnv, home = os.homedir()) {
  return configDirEnv ? configDirEnv : path.join(home, ".claude");
}
function globalConfigPath(configDirEnv, home = os.homedir()) {
  const globalCfg = path.join(configDirEnv ? configDirEnv : home, ".claude.json");
  const legacy = path.join(configHome(configDirEnv, home), ".config.json");
  try {
    const st = (0, import_node_fs.statSync)(legacy);
    if (st.isFile() && (st.size > 0 || isWritable(legacy) && !(0, import_node_fs.existsSync)(globalCfg))) {
      return legacy;
    }
  } catch {
  }
  return globalCfg;
}
function isWritable(file) {
  try {
    (0, import_node_fs.accessSync)(file, import_node_fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
function credentialsPath(home) {
  return path.join(home, ".credentials.json");
}
function credentialLockPaths(home) {
  const trimmed = home.replace(/[\\/]+$/, "");
  return [path.join(trimmed, ".oauth_refresh.lock"), trimmed + ".lock"];
}
function configLockPath(globalConfig) {
  return globalConfig + ".lock";
}
function keychainService(configDirEnv) {
  if (!configDirEnv) {
    return "Claude Code-credentials";
  }
  const digest = (0, import_node_crypto.createHash)("sha256").update(configDirEnv.normalize("NFC"), "utf8").digest("hex").slice(0, 8);
  return `Claude Code-credentials-${digest}`;
}
function keychainAccount(env = process.env) {
  if (env.USER) {
    return env.USER;
  }
  try {
    const name = os.userInfo().username;
    if (name) {
      return name;
    }
  } catch {
  }
  return "claude-code-user";
}

// src/core/registry.ts
var import_node_fs2 = require("node:fs");
var import_promises3 = require("node:fs/promises");
var path4 = __toESM(require("node:path"));

// src/core/fsjson.ts
var import_node_crypto2 = require("node:crypto");
var import_promises = require("node:fs/promises");
var path2 = __toESM(require("node:path"));
var CorruptJsonError = class extends Error {
  constructor(file) {
    super(`File is not valid JSON: ${path2.basename(file)}`);
    this.file = file;
    this.name = "CorruptJsonError";
  }
};
async function readJson(file) {
  let text;
  try {
    text = await (0, import_promises.readFile)(file, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") {
      return void 0;
    }
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CorruptJsonError(file);
  }
}
async function writeJsonAtomic(file, value) {
  await (0, import_promises.mkdir)(path2.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${(0, import_node_crypto2.randomBytes)(4).toString("hex")}.tmp`;
  await (0, import_promises.writeFile)(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 384 });
  try {
    await (0, import_promises.rename)(tmp, file);
  } catch (e) {
    await (0, import_promises.unlink)(tmp).catch(() => void 0);
    throw e;
  }
}

// src/core/locks.ts
var import_promises2 = require("node:fs/promises");
var path3 = __toESM(require("node:path"));
var CREDENTIAL_STALE_MS = 6e4;
var CONFIG_STALE_MS = 1e4;
var TOUCH_MS = 3e3;
var WAIT_MS = 9e3;
var LockTimeoutError = class extends Error {
  constructor(lockPath) {
    super(`Timed out waiting for lock ${path3.basename(lockPath)}`);
    this.name = "LockTimeoutError";
  }
};
var sleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
async function acquireLock(lockPath, opts) {
  const deadline = Date.now() + (opts.waitMs ?? WAIT_MS);
  await (0, import_promises2.mkdir)(path3.dirname(lockPath), { recursive: true });
  for (; ; ) {
    try {
      await (0, import_promises2.mkdir)(lockPath);
      break;
    } catch (e) {
      if (e?.code !== "EEXIST") {
        throw e;
      }
    }
    let stale = false;
    try {
      const st = await (0, import_promises2.stat)(lockPath);
      stale = Date.now() - st.mtimeMs > opts.staleMs;
    } catch (e) {
      if (e?.code === "ENOENT") {
        continue;
      }
      throw e;
    }
    if (stale) {
      await (0, import_promises2.rmdir)(lockPath).catch(() => void 0);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new LockTimeoutError(lockPath);
    }
    await sleep(100 + Math.random() * 150);
  }
  const timer = setInterval(() => {
    const now = /* @__PURE__ */ new Date();
    (0, import_promises2.utimes)(lockPath, now, now).catch(() => void 0);
  }, opts.touchMs ?? TOUCH_MS);
  timer.unref();
  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    clearInterval(timer);
    await (0, import_promises2.rmdir)(lockPath).catch((e) => {
      if (e?.code !== "ENOENT") {
        throw e;
      }
    });
  };
}
async function withLock(lockPath, opts, fn) {
  const release = await acquireLock(lockPath, opts);
  try {
    return await fn();
  } finally {
    await release();
  }
}
async function withCredentialLocks(home, fn) {
  const [primary, legacy] = credentialLockPaths(home);
  return withLock(primary, { staleMs: CREDENTIAL_STALE_MS }, () => withLock(legacy, { staleMs: CREDENTIAL_STALE_MS }, fn));
}
async function withConfigLock(globalConfig, fn) {
  return withLock(configLockPath(globalConfig), { staleMs: CONFIG_STALE_MS }, fn);
}

// src/core/registry.ts
function effectiveNumbers(accounts) {
  const out = /* @__PURE__ */ new Map();
  const taken = /* @__PURE__ */ new Set([1]);
  for (const a of accounts) {
    if (typeof a.number === "number" && a.number >= 2 && !taken.has(a.number)) {
      out.set(a.id, a.number);
      taken.add(a.number);
    }
  }
  let next = 2;
  for (const a of accounts) {
    if (out.has(a.id)) {
      continue;
    }
    while (taken.has(next)) {
      next++;
    }
    out.set(a.id, next);
    taken.add(next);
  }
  return out;
}
function lowestFree(accounts) {
  const used = new Set(effectiveNumbers(accounts).values());
  let n = 2;
  while (used.has(n)) {
    n++;
  }
  return n;
}
var Registry = class {
  file;
  lockPath;
  constructor(root) {
    this.file = path4.join(root, "accounts.json");
    this.lockPath = path4.join(root, "accounts.json.lock");
  }
  async readFile() {
    try {
      return await readJson(this.file);
    } catch (e) {
      if (e instanceof CorruptJsonError) {
        return void 0;
      }
      throw e;
    }
  }
  async list() {
    const data = await this.readFile();
    return Array.isArray(data?.accounts) ? data.accounts : [];
  }
  /** Same as list(), without waiting: used at window start, before Claude launches. */
  listSync() {
    try {
      const data = JSON.parse((0, import_node_fs2.readFileSync)(this.file, "utf8"));
      return Array.isArray(data?.accounts) ? data.accounts : [];
    } catch {
      return [];
    }
  }
  async get(id) {
    return (await this.list()).find((a) => a.id === id);
  }
  async getMainAlias() {
    const alias = (await this.readFile())?.mainAlias;
    return typeof alias === "string" && alias ? alias : void 0;
  }
  async setMainAlias(alias) {
    await this.mutate((file) => {
      if (alias) {
        file.mainAlias = alias;
      } else {
        delete file.mainAlias;
      }
    });
  }
  async add(a) {
    let account;
    await this.mutate((file) => {
      if (file.accounts.some((x) => x.id === a.id)) {
        throw new Error(`Account ${a.id} already exists`);
      }
      account = { id: a.id, folder: a.folder, number: lowestFree(file.accounts), createdAt: (/* @__PURE__ */ new Date()).toISOString() };
      file.accounts.push(account);
    });
    return account;
  }
  async update(id, patch) {
    let updated;
    await this.mutate((file) => {
      const found = file.accounts.find((x) => x.id === id);
      if (!found) {
        throw new Error(`No account ${id}`);
      }
      for (const key of ["email", "orgUuid", "orgName", "alias"]) {
        if (!(key in patch)) {
          continue;
        }
        const value = patch[key];
        if (value === void 0 || value === "") {
          delete found[key];
        } else {
          found[key] = value;
        }
      }
      updated = found;
    });
    return updated;
  }
  async remove(id) {
    await this.mutate((file) => {
      const i = file.accounts.findIndex((x) => x.id === id);
      if (i >= 0) {
        file.accounts.splice(i, 1);
      }
    });
  }
  /** Read, change and write the file under the registry lock. A corrupt file is set aside first. */
  async mutate(change) {
    await withLock(this.lockPath, { staleMs: 1e4 }, async () => {
      let file = { version: 1, accounts: [] };
      try {
        const data = await readJson(this.file);
        if (data && typeof data === "object") {
          file = { ...data, version: 1, accounts: Array.isArray(data.accounts) ? data.accounts : [] };
        }
      } catch (e) {
        if (!(e instanceof CorruptJsonError)) {
          throw e;
        }
        await (0, import_promises3.rename)(this.file, `${this.file}.corrupt-${Date.now()}`);
      }
      change(file);
      await writeJsonAtomic(this.file, file);
    });
  }
};

// src/vscode/accountsPanel.ts
var vscode = __toESM(require("vscode"));
var import_node_crypto3 = require("node:crypto");

// src/core/format.ts
function progressBar(pct) {
  const totalBars = 5;
  const filled = Math.max(0, Math.min(totalBars, Math.round(pct / 100 * totalBars)));
  return "\u2588".repeat(filled) + "\u2591".repeat(totalBars - filled);
}
function formatResetIn(resetsAt, now = Date.now()) {
  if (!resetsAt) {
    return null;
  }
  const ms = new Date(resetsAt).getTime() - now;
  if (isNaN(ms)) {
    return null;
  }
  const minutes = Math.max(0, Math.floor(ms / 6e4));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor(minutes % (24 * 60) / 60);
  const mins = minutes % 60;
  if (days > 0) {
    return `${days}d${hours > 0 ? `${hours}h` : ""}`;
  }
  if (hours > 0) {
    return `${hours}h${mins > 0 ? `${mins}m` : ""}`;
  }
  return `${mins}m`;
}
function formatWindow(w, now = Date.now()) {
  const resetIn = formatResetIn(w.resetsAt, now);
  return `${progressBar(w.pct)} ${Math.round(w.pct)}%${resetIn ? ` R:${resetIn}` : ""}`;
}
function formatResetDetail(label, w, now = Date.now()) {
  if (!w || !w.resetsAt) {
    return `${label}: no reset scheduled`;
  }
  const date = new Date(w.resetsAt);
  const clock = isNaN(date.getTime()) ? "" : ` at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const resetIn = formatResetIn(w.resetsAt, now);
  return `${label} resets${clock}${resetIn ? ` (in ${resetIn})` : ""}`;
}
var STATUS_LABELS = {
  ok: "ok",
  token_expired: "token expired",
  relogin_required: "re-login needed",
  no_credentials: "not signed in",
  rate_limited: "rate limited",
  unavailable: "unavailable"
};
function statusLabel(status) {
  return status && STATUS_LABELS[status] || status || "unknown";
}
function needsAttention(status) {
  return !!status && status !== "ok" && status !== "token_expired" && status !== "rate_limited";
}
function formatAge(seconds) {
  if (seconds === void 0) {
    return "a while";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) {
    return "under a minute";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h${minutes % 60 > 0 ? `${minutes % 60}m` : ""}` : `${Math.floor(hours / 24)}d`;
}
function usageLevel(usage) {
  const top = Math.max(usage?.fiveHour?.pct ?? 0, usage?.sevenDay?.pct ?? 0);
  if (top >= 85) {
    return "error";
  }
  if (top >= 70) {
    return "warning";
  }
  return "normal";
}
function pickUsage(entry, now) {
  if (entry?.status === "ok" && entry.usage) {
    return { usage: entry.usage, stale: false, ageSeconds: ageOf(entry.fetchedAt, now) };
  }
  if (entry?.lastGood) {
    return { usage: entry.lastGood, stale: true, ageSeconds: ageOf(entry.lastGoodAt, now) };
  }
  return null;
}
function ageOf(at, now) {
  return at === void 0 ? void 0 : Math.max(0, Math.round((now - at) / 1e3));
}

// src/core/panelModel.ts
var CHROME_HINT = "Claude in Chrome works only in windows that use the same account as the Chrome extension.";
var MAIN_REMOVE_NOTE = "This is your main account (the crown): your normal Claude login. It can't be deleted because its folder holds your settings and chat history.";
var FIVE_HOURS_MS = 5 * 36e5;
var SEVEN_DAYS_MS = 7 * 24 * 36e5;
function meter(label, w, now) {
  const windowMs = label === "5h" ? FIVE_HOURS_MS : SEVEN_DAYS_MS;
  const pct = Math.max(0, Math.min(100, w.pct));
  const m = {
    label,
    pct,
    pctText: `${Math.round(w.pct)}%`,
    level: usageLevel(label === "5h" ? { fiveHour: w } : { sevenDay: w }),
    title: `${Math.round(w.pct)}% of the ${label === "5h" ? "5-hour" : "weekly"} limit used.`
  };
  const resetIn = formatResetIn(w.resetsAt, now);
  if (resetIn) {
    m.resetText = resetIn;
    const left = new Date(w.resetsAt).getTime() - now;
    m.pace = Math.round(Math.max(0, Math.min(1, 1 - left / windowMs)) * 1e3) / 1e3;
    m.title += ` ${Math.round(m.pace * 100)}% of the time has passed. Resets in ${resetIn}.`;
  }
  return m;
}
function detailFor(v) {
  if (v.isThisWindow) {
    const others = v.usedBy.length > 1 ? v.usedBy : [];
    return others.length ? `Also open in ${others.join(", ")}` : "";
  }
  return v.usedBy.length ? `Open in ${v.usedBy.join(", ")}` : "Not open in any window";
}
function toAccount(v, now) {
  const status = v.entry?.status;
  const found = pickUsage(v.entry, now);
  const meters = [];
  if (found?.usage.fiveHour) {
    meters.push(meter("5h", found.usage.fiveHour, now));
  }
  if (found?.usage.sevenDay) {
    meters.push(meter("7d", found.usage.sevenDay, now));
  }
  let state = "ok";
  let note;
  if (!v.signedIn) {
    state = "notSignedIn";
    note = "Not signed in yet";
  } else if (status === "relogin_required" || status === "no_credentials") {
    state = "relogin";
    note = "Sign-in expired";
  } else if (found?.stale) {
    state = "stale";
    note = `Last known, ${formatAge(found.ageSeconds)} ago`;
  } else if (!v.entry) {
    state = "checking";
    note = "Checking usage\u2026";
  } else if (!found) {
    state = "problem";
    note = status === "rate_limited" ? "Checked too often, trying again soon" : status === "token_expired" ? "Waiting for Claude to renew the login" : "Usage unavailable right now";
  }
  const actions = [];
  if (state === "notSignedIn") {
    actions.push("signIn");
  } else if (state === "relogin") {
    actions.push("signInAgain");
  } else if (!v.isThisWindow) {
    actions.push("use");
  }
  if (v.signedIn || v.isMain) {
    actions.push("rename");
  }
  actions.push("remove");
  const a = {
    key: v.key,
    name: v.label,
    detail: detailFor(v),
    isMain: v.isMain,
    isThisWindow: v.isThisWindow,
    state,
    meters,
    actions,
    canRemove: !v.isMain
  };
  if (v.isMain) {
    a.removeNote = MAIN_REMOVE_NOTE;
  }
  if (v.email) {
    a.email = v.email;
  }
  const plan = v.entry?.plan;
  if (plan) {
    a.plan = plan.charAt(0).toUpperCase() + plan.slice(1);
  }
  if (note) {
    a.note = note;
  }
  return a;
}
function toPanelModel(views, now) {
  const accounts = views.map((v) => toAccount(v, now));
  const hasExtraAccounts = views.some((v) => !v.isMain);
  const model = {
    current: accounts.find((a) => a.isThisWindow),
    others: accounts.filter((a) => !a.isThisWindow),
    hasExtraAccounts
  };
  if (hasExtraAccounts) {
    model.hint = CHROME_HINT;
  }
  return model;
}

// src/vscode/accountsPanel.ts
var ACTION_COMMANDS = {
  use: "claudeSwap.useInThisWindow",
  signIn: "claudeSwap.signInAgain",
  signInAgain: "claudeSwap.signInAgain",
  rename: "claudeSwap.renameAccount",
  remove: "claudeSwap.removeAccount",
  add: "claudeSwap.addAccount",
  refresh: "claudeSwap.refreshStatus"
};
var AccountsPanelProvider = class {
  constructor(extensionUri, controller2) {
    this.extensionUri = extensionUri;
    this.controller = controller2;
    this.subscription = controller2.onDidChange(() => this.post());
  }
  static viewType = "claudeSwap.accounts";
  view;
  subscription;
  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.post();
      }
    });
    view.onDidDispose(() => {
      this.view = void 0;
    });
  }
  post() {
    if (!this.view || !this.controller.loaded) {
      return;
    }
    void this.view.webview.postMessage({ type: "state", model: toPanelModel(this.controller.views, Date.now()) });
  }
  onMessage(msg) {
    if (!msg || typeof msg !== "object") {
      return;
    }
    const m = msg;
    if (m.type === "ready") {
      this.post();
      return;
    }
    if (m.type !== "action" || typeof m.action !== "string" || !(m.action in ACTION_COMMANDS)) {
      return;
    }
    const key = typeof m.key === "string" ? m.key : void 0;
    void vscode.commands.executeCommand(ACTION_COMMANDS[m.action], key);
  }
  html(webview, media) {
    const nonce = (0, import_node_crypto3.randomBytes)(16).toString("base64");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.js"));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>Claude Accounts</title>
</head>
<body>
<main id="app"><p class="loading">Checking your Claude accounts\u2026</p></main>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
  dispose() {
    this.subscription.dispose();
  }
};

// src/vscode/commands.ts
var vscode3 = __toESM(require("vscode"));
var import_promises5 = require("node:fs/promises");

// src/core/share.ts
var import_promises4 = require("node:fs/promises");
var path5 = __toESM(require("node:path"));
var SHARED_DIRS = ["projects", "plugins", "skills", "commands", "agents", "output-styles", "rules", "plans"];
var SHARED_FILES = ["settings.json", "CLAUDE.md", "keybindings.json"];
var PROMPT_HISTORY = "history.jsonl";
var MANIFEST = ".claude-accounts-manifest.json";
async function exists(p, kind) {
  try {
    const st = await (0, import_promises4.stat)(p);
    return kind === "dir" ? st.isDirectory() : st.isFile();
  } catch {
    return false;
  }
}
async function isMissing(p) {
  try {
    await (0, import_promises4.lstat)(p);
    return false;
  } catch (e) {
    return e?.code === "ENOENT";
  }
}
async function readManifest(accountHome) {
  try {
    const m = await readJson(path5.join(accountHome, MANIFEST));
    return { links: Array.isArray(m?.links) ? m.links : [], copies: Array.isArray(m?.copies) ? m.copies : [] };
  } catch {
    return { links: [], copies: [] };
  }
}
async function syncSharedSetup(o) {
  const windows = o.platform === "win32";
  const manifest = await readManifest(o.accountHome);
  const links = new Set(manifest.links);
  const copies = new Set(manifest.copies);
  for (const name of SHARED_DIRS) {
    const src = path5.join(o.mainHome, name);
    const dst = path5.join(o.accountHome, name);
    if (await exists(src, "dir") && await isMissing(dst)) {
      await (0, import_promises4.symlink)(src, dst, windows ? "junction" : "dir");
      links.add(name);
    }
  }
  const files = windows ? SHARED_FILES : [...SHARED_FILES, PROMPT_HISTORY];
  for (const name of files) {
    const src = path5.join(o.mainHome, name);
    const dst = path5.join(o.accountHome, name);
    if (!await exists(src, "file")) {
      continue;
    }
    if (windows) {
      await (0, import_promises4.copyFile)(src, dst);
      copies.add(name);
    } else if (await isMissing(dst)) {
      await (0, import_promises4.symlink)(src, dst, "file");
      links.add(name);
    }
  }
  const next = { links: [...links], copies: [...copies] };
  await writeJsonAtomic(path5.join(o.accountHome, MANIFEST), next);
  return next;
}
async function readObject(file) {
  try {
    const data = await readJson(file);
    return data && typeof data === "object" && !Array.isArray(data) ? data : void 0;
  } catch (e) {
    if (e instanceof CorruptJsonError) {
      return void 0;
    }
    throw e;
  }
}
async function seedGlobalConfig(mainGlobal, accountGlobal) {
  if (!await isMissing(accountGlobal)) {
    return;
  }
  const main = await readObject(mainGlobal) ?? {};
  const seed = {};
  for (const key of ["hasCompletedOnboarding", "lastOnboardingVersion", "mcpServers"]) {
    if (main[key] !== void 0) {
      seed[key] = main[key];
    }
  }
  await writeJsonAtomic(accountGlobal, seed);
}
async function syncMcpServers(mainGlobal, accountGlobal) {
  const main = await readObject(mainGlobal) ?? {};
  await withConfigLock(accountGlobal, async () => {
    const account = await readObject(accountGlobal);
    if (!account) {
      return;
    }
    if (main.mcpServers === void 0) {
      if (!("mcpServers" in account)) {
        return;
      }
      delete account.mcpServers;
    } else {
      account.mcpServers = main.mcpServers;
    }
    await writeJsonAtomic(accountGlobal, account);
  });
}

// src/core/types.ts
var MAIN_KEY = "main";

// src/core/windowEnv.ts
var WINDOW_ACCOUNT_KEY = "claudeSwap.windowAccount";
var ACCOUNT_GONE_WARNING = "The Claude account this window used is gone, so this window is back on your main account.";
function resolveWindowEnv(i) {
  if (!i.choice || i.choice === MAIN_KEY) {
    return { key: MAIN_KEY, configDir: i.originalConfigDir };
  }
  const account = i.accounts.find((a) => a.id === i.choice);
  if (!account || !i.folderExists(account.folder)) {
    return { key: MAIN_KEY, configDir: i.originalConfigDir, warning: ACCOUNT_GONE_WARNING };
  }
  return { key: account.id, configDir: account.folder };
}
function findConfigDirOverride(envVars) {
  if (!Array.isArray(envVars)) {
    return false;
  }
  return envVars.some((v) => v && typeof v === "object" && v.name === "CLAUDE_CONFIG_DIR" && typeof v.value === "string" && v.value !== "");
}

// src/vscode/pendingRemoval.ts
var vscode2 = __toESM(require("vscode"));
var PENDING_REMOVE_KEY = "claudeSwap.pendingRemove";
var sleep2 = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
async function finishPendingRemoval(state, run, opts = { tries: 6, delayMs: 2e3 }) {
  const pending = state.get(PENDING_REMOVE_KEY);
  if (!pending || typeof pending.id !== "string") {
    return;
  }
  await state.update(PENDING_REMOVE_KEY, void 0);
  for (let i = 0; i < opts.tries; i++) {
    const r = await run(pending.id);
    if (r === "removed") {
      void vscode2.window.showInformationMessage(`Deleted "${pending.label}".`);
      return;
    }
    if (r === "missing") {
      return;
    }
    if (i < opts.tries - 1) {
      await sleep2(opts.delayMs);
    }
  }
  void vscode2.window.showWarningMessage(
    `Couldn't delete "${pending.label}" yet because Claude is still using it. Try again from the Claude Accounts panel in a moment.`
  );
}

// src/vscode/commands.ts
function registerCommands(context, c) {
  const reg = (id, fn) => context.subscriptions.push(vscode3.commands.registerCommand(id, fn));
  const viewFor = (arg) => {
    const key = typeof arg === "string" ? arg : arg?.key;
    return key ? c.views.find((v) => v.key === key) : void 0;
  };
  const usageSummary = (v) => {
    const found = pickUsage(v.entry, Date.now());
    if (!v.signedIn) {
      return "not signed in";
    }
    if (!found) {
      return v.entry ? statusLabel(v.entry.status) : "checking\u2026";
    }
    const parts = [];
    if (found.usage.fiveHour) {
      parts.push(`5h: ${formatWindow(found.usage.fiveHour)}`);
    }
    if (found.usage.sevenDay) {
      parts.push(`7d: ${formatWindow(found.usage.sevenDay)}`);
    }
    return parts.join("   ") + (found.stale ? "   (last known)" : "");
  };
  const pickAccount = async (placeHolder, filter = () => true) => {
    const items = c.views.filter(filter).map((v) => ({
      label: `${v.isThisWindow ? "$(check) " : ""}${v.isMain ? "\u{1F451} " : ""}${v.label}`,
      description: v.email && v.email !== v.label ? v.email : void 0,
      detail: usageSummary(v),
      view: v
    }));
    const pick = await vscode3.window.showQuickPick(items, { placeHolder });
    return pick?.view;
  };
  const confirmReload = async (message) => {
    const config = vscode3.workspace.getConfiguration("claudeSwap");
    if (!config.get("confirmBeforeReload", true)) {
      return true;
    }
    const reload = "Reload";
    const always = "Reload, don't ask again";
    const pick = await vscode3.window.showInformationMessage(message, { modal: true }, reload, always);
    if (pick === always) {
      await config.update("confirmBeforeReload", false, vscode3.ConfigurationTarget.Global);
    }
    return pick === reload || pick === always;
  };
  const switchTo = async (key, label) => {
    if (key === c.thisWindowKey) {
      return;
    }
    if (!await confirmReload(`Use "${label}" in this window? The window will reload.`)) {
      return;
    }
    await context.workspaceState.update(WINDOW_ACCOUNT_KEY, key);
    await vscode3.commands.executeCommand("workbench.action.reloadWindow");
  };
  reg("claudeSwap.switchAccount", async () => {
    const items = c.views.map((v) => ({
      label: `${v.isThisWindow ? "$(check) " : ""}${v.isMain ? "\u{1F451} " : ""}${v.label}`,
      description: v.email && v.email !== v.label ? v.email : void 0,
      detail: [usageSummary(v), v.usedBy.length ? `open in ${v.usedBy.join(", ")}` : ""].filter(Boolean).join("   \xB7   "),
      run: () => switchTo(v.key, v.label)
    }));
    items.push(
      { label: "", kind: vscode3.QuickPickItemKind.Separator, run: () => void 0 },
      { label: "$(add) Add account\u2026", run: () => vscode3.commands.executeCommand("claudeSwap.addAccount") },
      { label: "$(list-tree) Open accounts panel", run: () => vscode3.commands.executeCommand("claudeSwap.openPanel") }
    );
    const pick = await vscode3.window.showQuickPick(items, { placeHolder: "Pick the Claude account for this window" });
    await pick?.run();
  });
  reg("claudeSwap.useInThisWindow", async (arg) => {
    const v = viewFor(arg) ?? await pickAccount("Pick the Claude account for this window", (x) => !x.isThisWindow);
    if (v) {
      await switchTo(v.key, v.label);
    }
  });
  reg("claudeSwap.useMainLogin", async () => {
    await switchTo(MAIN_KEY, c.views.find((v) => v.isMain)?.label ?? "Claude 1");
  });
  reg("claudeSwap.addAccount", async () => {
    if (!await confirmReload("Add a new Claude account? This window will reload and Claude will ask you to sign in.")) {
      return;
    }
    const id = newAccountId();
    const folder = accountFolder(c.root, id);
    try {
      await (0, import_promises5.mkdir)(folder, { recursive: true });
      await seedGlobalConfig(globalConfigPath(c.originalConfigDir), globalConfigPath(folder));
      await syncSharedSetup({ mainHome: configHome(c.originalConfigDir), accountHome: folder, platform: process.platform });
      await c.registry.add({ id, folder });
    } catch (e) {
      c.log.error(`add account failed: ${e?.code ?? e?.name ?? "error"}`);
      void vscode3.window.showErrorMessage(`Could not add the account: ${e?.message ?? "unknown error"}`);
      return;
    }
    await context.workspaceState.update(WINDOW_ACCOUNT_KEY, id);
    await vscode3.commands.executeCommand("workbench.action.reloadWindow");
  });
  reg("claudeSwap.renameAccount", async (arg) => {
    const v = viewFor(arg) ?? await pickAccount("Pick an account to rename");
    if (!v) {
      return;
    }
    const current = v.isMain ? await c.registry.getMainAlias() : (await c.registry.get(v.key))?.alias;
    const value = await vscode3.window.showInputBox({
      prompt: `New name for "${v.label}". Leave empty to go back to "Claude ${v.number}".`,
      value: current ?? "",
      validateInput: (s) => s.length > 30 ? "Keep it under 30 characters." : void 0
    });
    if (value === void 0) {
      return;
    }
    if (v.isMain) {
      await c.registry.setMainAlias(value.trim());
    } else {
      await c.registry.update(v.key, { alias: value.trim() });
    }
    await c.refresh(true);
  });
  reg("claudeSwap.removeAccount", async (arg) => {
    const v = viewFor(arg) ?? await pickAccount("Pick an account to delete", (x) => !x.isMain);
    if (!v) {
      return;
    }
    if (v.isMain) {
      void vscode3.window.showInformationMessage(MAIN_REMOVE_NOTE);
      return;
    }
    const otherWindows = v.openWindows - (v.isThisWindow ? 1 : 0);
    if (otherWindows > 0) {
      void vscode3.window.showWarningMessage(`"${v.label}" is open in another window (${v.usedBy.join(", ")}). Switch that window to another account first, then delete it.`);
      return;
    }
    if (v.isThisWindow) {
      const mainLabel = c.views.find((x) => x.isMain)?.label ?? "Claude 1";
      const pick2 = await vscode3.window.showWarningMessage(
        `Delete "${v.label}"? This window will switch to ${mainLabel} and reload, then the account is deleted. You'll need to sign in again to use it later.`,
        { modal: true },
        "Delete"
      );
      if (pick2 !== "Delete") {
        return;
      }
      const pending = { id: v.key, label: v.label };
      await context.workspaceState.update(PENDING_REMOVE_KEY, pending);
      await context.workspaceState.update(WINDOW_ACCOUNT_KEY, MAIN_KEY);
      await vscode3.commands.executeCommand("workbench.action.reloadWindow");
      return;
    }
    const pick = await vscode3.window.showWarningMessage(`Delete "${v.label}"? You'll need to sign in again to use it later.`, { modal: true }, "Delete");
    if (pick !== "Delete") {
      return;
    }
    try {
      const r = await c.removeAccount(v.key);
      if (r === "inUse") {
        void vscode3.window.showWarningMessage(`Couldn't delete "${v.label}" because Claude is still using it. Close that Claude session and try again.`);
      }
    } catch (e) {
      c.log.error(`delete account failed: ${e?.code ?? e?.name ?? "error"}`);
      void vscode3.window.showErrorMessage(`Could not delete the account: ${e?.message ?? "unknown error"}`);
    }
    await c.refresh(true);
  });
  reg("claudeSwap.signInAgain", async (arg) => {
    const v = viewFor(arg);
    if (v && !v.isThisWindow) {
      await switchTo(v.key, v.label);
      return;
    }
    const pick = await vscode3.window.showInformationMessage("Type /login in the Claude panel to sign in again.", "Open Terminal");
    if (pick) {
      const term = vscode3.window.createTerminal({ name: "Claude sign-in" });
      term.show();
      term.sendText("claude");
    }
  });
  reg("claudeSwap.openPanel", () => vscode3.commands.executeCommand("workbench.view.extension.claudeSwap"));
}

// src/vscode/controller.ts
var vscode4 = __toESM(require("vscode"));
var import_node_crypto4 = require("node:crypto");
var path9 = __toESM(require("node:path"));

// src/core/credentials.ts
var import_node_child_process = require("node:child_process");
var import_promises6 = require("node:fs/promises");
var KeychainError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "KeychainError";
  }
};
var SECURITY = "/usr/bin/security";
var NOT_FOUND = 44;
var STDIN_LINE_LIMIT = 4096;
var SECURITY_TIMEOUT_MS = 1e4;
var defaultSecurityRunner = (args, stdin) => new Promise((resolve2, reject) => {
  const child = (0, import_node_child_process.spawn)(SECURITY, args, { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), SECURITY_TIMEOUT_MS);
  child.stdout.on("data", (d) => stdout += d);
  child.stderr.on("data", (d) => stderr += d);
  child.on("error", (e) => {
    clearTimeout(timer);
    reject(new KeychainError(`Could not run the Keychain tool (${e.code ?? "error"})`));
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    resolve2({ code: code ?? -1, stdout, stderr });
  });
  child.stdin.end(stdin ?? "");
});
function quote(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
async function readFileStore(t) {
  return readJson(credentialsPath(t.configHome));
}
async function removeFile(t) {
  await (0, import_promises6.unlink)(credentialsPath(t.configHome)).catch((e) => {
    if (e?.code !== "ENOENT") {
      throw e;
    }
  });
}
function createCredentialStore(opts) {
  if (opts.platform !== "darwin") {
    return {
      read: readFileStore,
      write: (t, value) => writeJsonAtomic(credentialsPath(t.configHome), value),
      remove: removeFile
    };
  }
  const run = opts.runSecurity ?? defaultSecurityRunner;
  const account = () => keychainAccount(opts.env ?? process.env);
  return {
    async read(t) {
      const r = await run(["find-generic-password", "-a", account(), "-w", "-s", keychainService(t.configDirEnv)]);
      if (r.code === NOT_FOUND) {
        return readFileStore(t);
      }
      if (r.code !== 0) {
        throw new KeychainError(`Keychain read failed (exit ${r.code})`);
      }
      const text = r.stdout.endsWith("\n") ? r.stdout.slice(0, -1) : r.stdout;
      try {
        return JSON.parse(text);
      } catch {
        throw new KeychainError("Keychain item is not valid JSON");
      }
    },
    async write(t, value) {
      const hex = Buffer.from(JSON.stringify(value), "utf8").toString("hex");
      const line = `add-generic-password -U -a ${quote(account())} -s ${quote(keychainService(t.configDirEnv))} -X ${hex}
`;
      if (Buffer.byteLength(line, "utf8") > STDIN_LINE_LIMIT) {
        throw new KeychainError("Credential too large to save to the Keychain safely");
      }
      const r = await run(["-i"], line);
      if (r.code !== 0) {
        throw new KeychainError(`Keychain write failed (exit ${r.code})`);
      }
    },
    async remove(t) {
      const r = await run(["delete-generic-password", "-a", account(), "-s", keychainService(t.configDirEnv)]);
      if (r.code !== 0 && r.code !== NOT_FOUND) {
        throw new KeychainError(`Keychain delete failed (exit ${r.code})`);
      }
    }
  };
}
async function readIdentity(globalConfig) {
  let data;
  try {
    data = await readJson(globalConfig);
  } catch (e) {
    if (e instanceof CorruptJsonError) {
      return void 0;
    }
    throw e;
  }
  const acc = data?.oauthAccount;
  if (!acc || typeof acc.emailAddress !== "string" || !acc.emailAddress) {
    return void 0;
  }
  const id = { email: acc.emailAddress };
  if (typeof acc.organizationUuid === "string") {
    id.orgUuid = acc.organizationUuid;
  }
  if (typeof acc.organizationName === "string") {
    id.orgName = acc.organizationName;
  }
  return id;
}

// src/core/oauth.ts
var USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
var TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
var CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
var BETA_HEADER = "oauth-2025-04-20";
var USER_AGENT = "claude-swap-status";
var TIMEOUT_MS = 5e3;
var defaultFetch = (url, init) => globalThis.fetch(url, init);
async function withTimeout(fn) {
  const controller2 = new AbortController();
  const timer = setTimeout(() => controller2.abort(), TIMEOUT_MS);
  try {
    return await fn(controller2.signal);
  } finally {
    clearTimeout(timer);
  }
}
function toWindow(raw) {
  if (!raw || typeof raw.utilization !== "number") {
    return void 0;
  }
  const w = { pct: raw.utilization };
  if (typeof raw.resets_at === "string" && raw.resets_at) {
    w.resetsAt = raw.resets_at;
  }
  return w;
}
async function fetchUsage(accessToken, fetchImpl = defaultFetch) {
  let res;
  try {
    res = await withTimeout((signal) => fetchImpl(USAGE_URL, {
      method: "GET",
      headers: { "Authorization": `Bearer ${accessToken}`, "anthropic-beta": BETA_HEADER, "User-Agent": USER_AGENT },
      signal
    }));
  } catch {
    return { ok: false, kind: "network" };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, kind: "unauthorized" };
  }
  if (res.status === 429) {
    const raw = res.headers.get("retry-after");
    const seconds = raw === null || raw.trim() === "" ? NaN : Number(raw);
    return Number.isFinite(seconds) && seconds >= 0 ? { ok: false, kind: "rate_limited", retryAfterMs: seconds * 1e3 } : { ok: false, kind: "rate_limited" };
  }
  if (res.status !== 200) {
    return { ok: false, kind: "bad_response" };
  }
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, kind: "bad_response" };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, kind: "bad_response" };
  }
  const usage = {};
  const fiveHour = toWindow(data.five_hour);
  const sevenDay = toWindow(data.seven_day);
  if (fiveHour) {
    usage.fiveHour = fiveHour;
  }
  if (sevenDay) {
    usage.sevenDay = sevenDay;
  }
  return { ok: true, usage };
}
async function refreshAccessToken(cred, fetchImpl = defaultFetch, now = Date.now()) {
  if (!cred.refreshToken) {
    return { ok: false, kind: "no_refresh_token" };
  }
  let res;
  try {
    res = await withTimeout((signal) => fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: cred.refreshToken, client_id: CLIENT_ID }),
      signal
    }));
  } catch {
    return { ok: false, kind: "network" };
  }
  let data;
  try {
    data = await res.json();
  } catch {
    data = void 0;
  }
  if (res.status !== 200) {
    if ((res.status === 400 || res.status === 401) && data?.error === "invalid_grant") {
      return { ok: false, kind: "invalid_grant" };
    }
    return { ok: false, kind: "bad_response" };
  }
  if (!data || typeof data.access_token !== "string" || typeof data.expires_in !== "number") {
    return { ok: false, kind: "bad_response" };
  }
  const next = { ...cred, accessToken: data.access_token, expiresAt: now + data.expires_in * 1e3 };
  if (typeof data.refresh_token === "string" && data.refresh_token) {
    next.refreshToken = data.refresh_token;
  }
  if (typeof data.scope === "string" && data.scope) {
    next.scopes = data.scope.split(/\s+/).filter(Boolean);
  }
  return { ok: true, cred: next };
}

// src/core/snapshot.ts
function nameFor(number, alias) {
  return alias || `Claude ${number}`;
}
function buildSnapshot(i) {
  const windowsFor = (key) => i.liveWindows.filter((w) => w.accountKey === key);
  const usedBy = (key) => [...new Set(windowsFor(key).map((w) => w.workspaceName))];
  const numbers = effectiveNumbers(i.accounts);
  const views = i.accounts.map((a) => {
    const number = numbers.get(a.id);
    const v = {
      key: a.id,
      number,
      label: nameFor(number, a.alias),
      isMain: false,
      isThisWindow: i.thisWindowKey === a.id,
      signedIn: !!a.email,
      usedBy: usedBy(a.id),
      openWindows: windowsFor(a.id).length
    };
    if (a.email) {
      v.email = a.email;
    }
    if (a.orgName) {
      v.orgName = a.orgName;
    }
    if (i.usage[a.id]) {
      v.entry = i.usage[a.id];
    }
    return v;
  });
  const main = {
    key: MAIN_KEY,
    number: 1,
    label: nameFor(1, i.mainAlias),
    isMain: true,
    isThisWindow: i.thisWindowKey === MAIN_KEY,
    signedIn: !!i.mainIdentity,
    usedBy: usedBy(MAIN_KEY),
    openWindows: windowsFor(MAIN_KEY).length
  };
  if (i.mainIdentity?.email) {
    main.email = i.mainIdentity.email;
  }
  if (i.mainIdentity?.orgName) {
    main.orgName = i.mainIdentity.orgName;
  }
  if (i.usage[MAIN_KEY]) {
    main.entry = i.usage[MAIN_KEY];
  }
  views.push(main);
  return views;
}

// src/core/safeDelete.ts
var import_promises7 = require("node:fs/promises");
var path6 = __toESM(require("node:path"));
async function removeLink(p) {
  try {
    await (0, import_promises7.unlink)(p);
  } catch (e) {
    if (e?.code === "EPERM" || e?.code === "EISDIR") {
      await (0, import_promises7.rmdir)(p);
    } else if (e?.code !== "ENOENT") {
      throw e;
    }
  }
}
async function deleteTree(p) {
  let st;
  try {
    st = await (0, import_promises7.lstat)(p);
  } catch (e) {
    if (e?.code === "ENOENT") {
      return;
    }
    throw e;
  }
  if (st.isSymbolicLink()) {
    await removeLink(p);
    return;
  }
  if (st.isDirectory()) {
    for (const name of await (0, import_promises7.readdir)(p)) {
      await deleteTree(path6.join(p, name));
    }
    await (0, import_promises7.rmdir)(p);
    return;
  }
  await (0, import_promises7.unlink)(p);
}
async function removeAccountFolder(root, folder) {
  if (!isInside(root, folder)) {
    throw new Error("Refusing to delete a folder outside the accounts folder");
  }
  await deleteTree(folder);
}

// src/core/removeAccount.ts
async function removeAccountNow(o) {
  const account = await o.registry.get(o.id);
  if (!account) {
    return "missing";
  }
  if (await o.inUse()) {
    return "inUse";
  }
  if (o.platform === "darwin") {
    await o.credentials.remove({ configHome: account.folder, configDirEnv: account.folder }).catch((e) => o.log?.(`keychain delete: ${e?.name ?? "error"}`));
  }
  await removeAccountFolder(o.root, account.folder);
  await o.registry.remove(account.id);
  await o.cache.remove(account.id);
  return "removed";
}

// src/core/usage.ts
var path7 = __toESM(require("node:path"));
var EXPIRY_SKEW_MS = 6e4;
var DEFAULT_BACKOFF_MS = 3e5;
var UsageCache = class {
  file;
  lockPath;
  constructor(root) {
    this.file = path7.join(root, "usage.json");
    this.lockPath = path7.join(root, "usage.json.lock");
  }
  async read() {
    try {
      const data = await readJson(this.file);
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch (e) {
      if (e instanceof CorruptJsonError) {
        return {};
      }
      throw e;
    }
  }
  async get(key) {
    return (await this.read())[key];
  }
  async put(key, e) {
    await this.mutate((all) => {
      all[key] = e;
    });
  }
  async remove(key) {
    await this.mutate((all) => {
      delete all[key];
    });
  }
  async mutate(change) {
    await withLock(this.lockPath, { staleMs: 1e4 }, async () => {
      const all = await this.read();
      change(all);
      await writeJsonAtomic(this.file, all);
    });
  }
};
function keepLast(prev) {
  const out = {};
  if (prev?.lastGood !== void 0) {
    out.lastGood = prev.lastGood;
  }
  if (prev?.lastGoodAt !== void 0) {
    out.lastGoodAt = prev.lastGoodAt;
  }
  return out;
}
function withPlan(entry, plan) {
  return plan ? { ...entry, plan } : entry;
}
function stillGood(prev, now, intervalMs) {
  if (!prev) {
    return void 0;
  }
  if (prev.backoffUntil !== void 0 && prev.backoffUntil > now) {
    return prev;
  }
  if (prev.fetchedAt !== void 0 && now - prev.fetchedAt < intervalMs) {
    return prev;
  }
  return void 0;
}
function isExpired(cred, now) {
  return cred.expiresAt === void 0 || cred.expiresAt - EXPIRY_SKEW_MS <= now;
}
async function pollAccount(key, target, intervalMs, deps) {
  const now = deps.now();
  const cached = stillGood(await deps.cache.get(key), now, intervalMs);
  if (cached) {
    return cached;
  }
  return deps.withFetchLock(key, async () => {
    const prev = await deps.cache.get(key);
    const again = stillGood(prev, now, intervalMs);
    if (again) {
      return again;
    }
    const entry = await check(prev, target, now, deps);
    await deps.cache.put(key, entry);
    return entry;
  });
}
async function check(prev, target, now, deps) {
  const file = await deps.credentials.read(target);
  let cred = file?.claudeAiOauth;
  if (!cred?.accessToken) {
    return { ...keepLast(prev), status: "no_credentials", fetchedAt: now };
  }
  const plan = cred.subscriptionType;
  if (isExpired(cred, now)) {
    if (await deps.inUse()) {
      return withPlan({ ...keepLast(prev), status: "token_expired", fetchedAt: now }, plan);
    }
    const renewed = await deps.withCredentialLocks(target.configHome, async () => {
      const latest = await deps.credentials.read(target);
      const latestCred = latest?.claudeAiOauth;
      if (latestCred?.accessToken && !isExpired(latestCred, now)) {
        return { cred: latestCred };
      }
      const r2 = await deps.refresh(latestCred ?? cred);
      if (r2.ok) {
        await deps.credentials.write(target, { ...latest ?? file, claudeAiOauth: r2.cred });
        return { cred: r2.cred };
      }
      const status = r2.kind === "invalid_grant" || r2.kind === "no_refresh_token" ? "relogin_required" : "unavailable";
      return { entry: withPlan({ ...keepLast(prev), status, fetchedAt: now }, plan) };
    });
    if ("entry" in renewed) {
      return renewed.entry;
    }
    cred = renewed.cred;
  }
  const r = await deps.fetchUsage(cred.accessToken);
  if (r.ok) {
    return withPlan({ status: "ok", usage: r.usage, fetchedAt: now, lastGood: r.usage, lastGoodAt: now }, plan);
  }
  if (r.kind === "unauthorized") {
    return withPlan({ ...keepLast(prev), status: "token_expired", fetchedAt: now }, plan);
  }
  if (r.kind === "rate_limited") {
    return withPlan({ ...keepLast(prev), status: "rate_limited", fetchedAt: now, backoffUntil: now + (r.retryAfterMs ?? DEFAULT_BACKOFF_MS) }, plan);
  }
  return withPlan({ ...keepLast(prev), status: "unavailable", fetchedAt: now }, plan);
}

// src/core/windows.ts
var import_promises8 = require("node:fs/promises");
var path8 = __toESM(require("node:path"));
var HEARTBEAT_STALE_MS = 9e4;
var REFRESH_LOCK_FRESH_MS = 6e4;
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}
var WindowRegistry = class {
  constructor(root, now = Date.now, isAlive = isPidAlive) {
    this.now = now;
    this.isAlive = isAlive;
    this.dir = path8.join(root, "windows");
  }
  dir;
  async beat(b) {
    const beat = { ...b, updatedAt: this.now() };
    await writeJsonAtomic(this.fileFor(b.windowId), beat);
  }
  async remove(windowId) {
    await (0, import_promises8.unlink)(this.fileFor(windowId)).catch(() => void 0);
  }
  /** Beats that are recent and whose process is still running. Dead ones are cleaned up. */
  async live() {
    let names;
    try {
      names = await (0, import_promises8.readdir)(this.dir);
    } catch {
      return [];
    }
    const out = [];
    for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
      const file = path8.join(this.dir, name);
      let beat;
      try {
        beat = await readJson(file);
      } catch {
        beat = void 0;
      }
      const fresh = !!beat && typeof beat.updatedAt === "number" && this.now() - beat.updatedAt <= HEARTBEAT_STALE_MS;
      if (beat && fresh && this.isAlive(beat.pid)) {
        out.push(beat);
      } else {
        await (0, import_promises8.unlink)(file).catch(() => void 0);
      }
    }
    return out;
  }
  fileFor(windowId) {
    return path8.join(this.dir, `${windowId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  }
};
async function isAccountInUse(a) {
  const isAlive = a.isAlive ?? isPidAlive;
  const now = a.now ?? Date.now;
  if (a.liveWindows.some((w) => w.accountKey === a.accountKey)) {
    return true;
  }
  const sessionsDir = path8.join(a.configHome, "sessions");
  let names = [];
  try {
    names = await (0, import_promises8.readdir)(sessionsDir);
  } catch {
    names = [];
  }
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    try {
      const s = await readJson(path8.join(sessionsDir, name));
      if (typeof s?.pid === "number" && isAlive(s.pid)) {
        return true;
      }
    } catch {
    }
  }
  try {
    const st = await (0, import_promises8.stat)(path8.join(a.configHome, ".oauth_refresh.lock"));
    if (now() - st.mtimeMs <= REFRESH_LOCK_FRESH_MS) {
      return true;
    }
  } catch {
  }
  return false;
}

// src/vscode/controller.ts
var HEARTBEAT_MS = 3e4;
var AccountsController = class {
  constructor(root, registry, thisWindowKey, originalConfigDir, log) {
    this.root = root;
    this.registry = registry;
    this.thisWindowKey = thisWindowKey;
    this.originalConfigDir = originalConfigDir;
    this.log = log;
    this.cache = new UsageCache(root);
    this.credentials = createCredentialStore({ platform: process.platform });
    this.windows = new WindowRegistry(root);
  }
  emitter = new vscode4.EventEmitter();
  onDidChange = this.emitter.event;
  views = [];
  loaded = false;
  cache;
  credentials;
  windows;
  windowId = (0, import_node_crypto4.randomUUID)();
  pollTimer;
  beatTimer;
  queue = Promise.resolve();
  busy = false;
  seenSignedIn = /* @__PURE__ */ new Map();
  disposables = [];
  start() {
    void this.beat();
    this.beatTimer = setInterval(() => void this.beat(), HEARTBEAT_MS);
    this.restartPolling();
    this.disposables.push(vscode4.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("claudeSwap.pollIntervalMinutes")) {
        this.restartPolling();
      }
    }));
  }
  /** Config target for an account key: its folder, or the main login's folder. */
  targetFor(key, folder) {
    if (key === MAIN_KEY || !folder) {
      return { configHome: configHome(this.originalConfigDir), configDirEnv: this.originalConfigDir };
    }
    return { configHome: folder, configDirEnv: folder };
  }
  refresh(force = false) {
    if (this.busy && !force) {
      return this.queue;
    }
    this.busy = true;
    this.queue = this.queue.then(() => this.doRefresh(force)).catch((e) => this.log.error(`refresh failed: ${e?.name ?? "Error"}: ${e?.message ?? ""}`)).finally(() => {
      this.busy = false;
    });
    return this.queue;
  }
  intervalMs() {
    const minutes = vscode4.workspace.getConfiguration("claudeSwap").get("pollIntervalMinutes") ?? 1;
    return Math.max(0.5, minutes) * 6e4;
  }
  restartPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    void this.refresh();
    this.pollTimer = setInterval(() => void this.refresh(), this.intervalMs());
  }
  async beat() {
    try {
      await this.windows.beat({
        windowId: this.windowId,
        accountKey: this.thisWindowKey,
        workspaceName: vscode4.workspace.name ?? "Untitled window",
        pid: process.pid
      });
    } catch (e) {
      this.log.warn(`heartbeat failed: ${e?.code ?? e?.name ?? "error"}`);
    }
  }
  async doRefresh(force) {
    const accounts = await this.registry.list();
    const liveWindows = await this.windows.live();
    for (const a of accounts) {
      if (a.email) {
        continue;
      }
      const id = await readIdentity(globalConfigPath(a.folder));
      if (id) {
        const updated = await this.registry.update(a.id, { email: id.email, orgUuid: id.orgUuid, orgName: id.orgName });
        Object.assign(a, updated);
      }
    }
    const mainIdentity = await readIdentity(globalConfigPath(this.originalConfigDir));
    const mainAlias = await this.registry.getMainAlias();
    const intervalMs = force ? 0 : this.intervalMs();
    const jobs = [
      ...accounts.map((a) => ({ key: a.id, target: this.targetFor(a.id, a.folder) })),
      { key: MAIN_KEY, target: this.targetFor(MAIN_KEY) }
    ];
    await Promise.all(jobs.map(
      ({ key, target }) => pollAccount(key, target, intervalMs, {
        cache: this.cache,
        credentials: this.credentials,
        fetchUsage: (token) => fetchUsage(token),
        refresh: (cred) => refreshAccessToken(cred),
        inUse: () => isAccountInUse({ accountKey: key, configHome: target.configHome, liveWindows }),
        withCredentialLocks,
        withFetchLock: (k, fn) => withLock(path9.join(this.root, "locks", `fetch-${k}.lock`), { staleMs: 3e4 }, fn),
        now: Date.now
      }).catch((e) => this.log.warn(`poll ${key}: ${e?.name ?? "Error"}`))
    ));
    const usage = await this.cache.read();
    this.views = buildSnapshot({ accounts, mainIdentity, mainAlias, liveWindows, usage, thisWindowKey: this.thisWindowKey });
    this.loaded = true;
    this.noticeSignIn(accounts, mainIdentity);
    this.emitter.fire(this.views);
  }
  /** When this window's account finishes signing in, say so once and check it isn't a duplicate. */
  noticeSignIn(accounts, mainIdentity) {
    const mine = this.views.find((v) => v.isThisWindow);
    if (!mine || mine.isMain) {
      return;
    }
    const before = this.seenSignedIn.get(mine.key);
    this.seenSignedIn.set(mine.key, mine.signedIn);
    if (before !== false || !mine.signedIn) {
      return;
    }
    const me = accounts.find((a) => a.id === mine.key);
    void vscode4.window.showInformationMessage(`Signed in as ${mine.email}. Give this account a short name?`, "Rename").then((pick) => {
      if (pick) {
        void vscode4.commands.executeCommand("claudeSwap.renameAccount", mine.key);
      }
    });
    if (!me?.email) {
      return;
    }
    const same = (email, org) => email === me.email && (org ?? "") === (me.orgUuid ?? "");
    const twin = accounts.find((a) => a.id !== me.id && same(a.email, a.orgUuid));
    const twinLabel = twin ? this.views.find((v) => v.key === twin.id)?.label : same(mainIdentity?.email, mainIdentity?.orgUuid) ? this.views.find((v) => v.isMain)?.label : void 0;
    if (twinLabel) {
      void vscode4.window.showWarningMessage(`"${mine.label}" is the same Claude account as "${twinLabel}". That works, but you may not need both.`);
    }
  }
  /** Deletes an added account if nothing is using it (no open window, no running Claude). */
  async removeAccount(id) {
    const account = await this.registry.get(id);
    return removeAccountNow({
      root: this.root,
      registry: this.registry,
      cache: this.cache,
      credentials: this.credentials,
      platform: process.platform,
      id,
      inUse: async () => !!account && isAccountInUse({ accountKey: id, configHome: account.folder, liveWindows: await this.windows.live() }),
      log: (line) => this.log.warn(line)
    });
  }
  async shutdown() {
    this.dispose();
    await this.windows.remove(this.windowId);
  }
  dispose() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    if (this.beatTimer) {
      clearInterval(this.beatTimer);
    }
    this.pollTimer = void 0;
    this.beatTimer = void 0;
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
    this.emitter.dispose();
  }
};

// src/vscode/statusBar.ts
var vscode5 = __toESM(require("vscode"));
function icon(view) {
  return view.isMain ? "\u{1F451}" : "$(account)";
}
var StatusBar = class {
  item = vscode5.window.createStatusBarItem(vscode5.StatusBarAlignment.Left, 100);
  constructor() {
    this.item.command = "claudeSwap.switchAccount";
    this.item.text = "$(sync~spin) Claude: checking\u2026";
    this.item.tooltip = "Checking your Claude accounts\u2026";
    this.item.show();
  }
  update(views) {
    const view = views.find((v) => v.isThisWindow);
    this.item.backgroundColor = void 0;
    if (!view) {
      this.item.text = "$(account) Claude";
      this.item.tooltip = "Click to switch accounts.";
      return;
    }
    if (!view.signedIn) {
      this.item.text = `${icon(view)} ${view.label} | not signed in`;
      this.item.backgroundColor = new vscode5.ThemeColor("statusBarItem.warningBackground");
      this.item.tooltip = view.isMain ? "Your main account (\u{1F451}) is not signed in. Sign in from the Claude panel.\nClick to switch accounts." : "This account is not signed in yet. Sign in from the Claude panel.\nClick to switch accounts.";
      return;
    }
    const now = Date.now();
    const status = view.entry?.status;
    const found = pickUsage(view.entry, now);
    let five = "N/A";
    let seven = "N/A";
    const lines = [view.isMain ? "Main Claude account (\u{1F451}) for this window" : "Claude account for this window"];
    if (view.email) {
      lines.push(`Email: ${view.email}`);
    }
    if (view.orgName) {
      lines.push(`Organisation: ${view.orgName}`);
    }
    if (view.entry?.plan) {
      lines.push(`Plan: ${view.entry.plan}`);
    }
    lines.push(`Status: ${statusLabel(status)}`);
    if (found) {
      const u = found.usage;
      if (u.fiveHour) {
        five = formatWindow(u.fiveHour, now);
      }
      if (u.sevenDay) {
        seven = formatWindow(u.sevenDay, now);
      }
      lines.push(formatResetDetail("5h", u.fiveHour, now), formatResetDetail("7d", u.sevenDay, now));
      if (found.stale) {
        lines.push(`Showing last known usage from ${formatAge(found.ageSeconds)} ago.`);
      }
      const level = usageLevel(u);
      if (level === "error") {
        this.item.backgroundColor = new vscode5.ThemeColor("statusBarItem.errorBackground");
      } else if (level === "warning") {
        this.item.backgroundColor = new vscode5.ThemeColor("statusBarItem.warningBackground");
      }
    } else if (!view.entry) {
      five = seven = "checking\u2026";
    } else {
      five = seven = statusLabel(status);
    }
    if (!this.item.backgroundColor && needsAttention(status)) {
      this.item.backgroundColor = new vscode5.ThemeColor("statusBarItem.warningBackground");
    }
    lines.push("Click to switch accounts.");
    this.item.text = `${icon(view)} ${view.label} | 5h: ${five} | 7d: ${seven}${found?.stale ? " $(history)" : ""}`;
    this.item.tooltip = lines.join("\n");
  }
  dispose() {
    this.item.dispose();
  }
};

// src/vscode/windowAccount.ts
var vscode6 = __toESM(require("vscode"));
var import_node_fs3 = require("node:fs");
var CLAUDE_EXTENSION_ID = "anthropic.claude-code";
var RELOAD_PROMPT_KEY = "claudeSwap.lastReloadPrompt";
var RELOAD_PROMPT_GAP_MS = 12e4;
async function applyWindowAccount(context, originalConfigDir, registry, log) {
  const choice = context.workspaceState.get(WINDOW_ACCOUNT_KEY);
  const resolved = resolveWindowEnv({ choice, accounts: registry.listSync(), folderExists: import_node_fs3.existsSync, originalConfigDir });
  const terminalEnv = context.environmentVariableCollection;
  if (resolved.configDir) {
    process.env.CLAUDE_CONFIG_DIR = resolved.configDir;
    terminalEnv.replace("CLAUDE_CONFIG_DIR", resolved.configDir);
  } else {
    delete process.env.CLAUDE_CONFIG_DIR;
    terminalEnv.delete("CLAUDE_CONFIG_DIR");
  }
  terminalEnv.description = "Gives Claude in this window's terminals the same account as this window.";
  if (resolved.warning) {
    await context.workspaceState.update(WINDOW_ACCOUNT_KEY, MAIN_KEY);
    void vscode6.window.showWarningMessage(resolved.warning);
  }
  if (resolved.key !== MAIN_KEY && resolved.configDir) {
    try {
      await syncSharedSetup({ mainHome: configHome(originalConfigDir), accountHome: resolved.configDir, platform: process.platform });
      await syncMcpServers(globalConfigPath(originalConfigDir), globalConfigPath(resolved.configDir));
    } catch (e) {
      log.warn(`Could not share your Claude setup with this account: ${e?.code ?? e?.name ?? "error"}`);
    }
  }
  const claudeSettings = vscode6.workspace.getConfiguration("claudeCode").get("environmentVariables");
  if (findConfigDirOverride(claudeSettings)) {
    void vscode6.window.showWarningMessage(
      "Your Claude settings set CLAUDE_CONFIG_DIR for every window, so each window can't have its own account. Remove it from claudeCode.environmentVariables.",
      "Open Settings"
    ).then((pick) => {
      if (pick) {
        void vscode6.commands.executeCommand("workbench.action.openSettings", "claudeCode.environmentVariables");
      }
    });
  }
  const claude = vscode6.extensions.getExtension(CLAUDE_EXTENSION_ID);
  if (claude?.isActive && resolved.configDir !== originalConfigDir) {
    const last = context.workspaceState.get(RELOAD_PROMPT_KEY) ?? 0;
    if (Date.now() - last > RELOAD_PROMPT_GAP_MS) {
      await context.workspaceState.update(RELOAD_PROMPT_KEY, Date.now());
      void vscode6.window.showInformationMessage("Reload this window so Claude uses this window's account.", "Reload").then((pick) => {
        if (pick) {
          void vscode6.commands.executeCommand("workbench.action.reloadWindow");
        }
      });
    }
  }
  return { key: resolved.key, configDir: resolved.configDir };
}

// src/extension.ts
var ORIGINAL_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || void 0;
var controller;
async function activate(context) {
  const log = vscode7.window.createOutputChannel("Claude Swap Status", { log: true });
  context.subscriptions.push(log);
  const root = accountsRoot();
  const registry = new Registry(root);
  const applied = await applyWindowAccount(context, ORIGINAL_CONFIG_DIR, registry, log);
  const c = new AccountsController(root, registry, applied.key, ORIGINAL_CONFIG_DIR, log);
  controller = c;
  const statusBar = new StatusBar();
  const panel = new AccountsPanelProvider(context.extensionUri, c);
  context.subscriptions.push(
    c,
    statusBar,
    panel,
    c.onDidChange((views) => statusBar.update(views)),
    vscode7.window.registerWebviewViewProvider(AccountsPanelProvider.viewType, panel),
    vscode7.commands.registerCommand("claudeSwap.refreshStatus", () => c.refresh(true))
  );
  registerCommands(context, c);
  c.start();
  void finishPendingRemoval(context.workspaceState, (id) => c.removeAccount(id)).then(() => c.refresh(true));
  return {
    thisWindowKey: () => c.thisWindowKey,
    views: () => c.views,
    refresh: () => c.refresh(true)
  };
}
async function deactivate() {
  await controller?.shutdown();
  controller = void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
