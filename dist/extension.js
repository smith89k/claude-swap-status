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
var vscode = __toESM(require("vscode"));
var import_child_process = require("child_process");
var import_util = require("util");
var execAsync = (0, import_util.promisify)(import_child_process.exec);
var statusBarItem;
var pollIntervalTimer;
function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "claudeSwap.switchAccount";
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(vscode.commands.registerCommand("claudeSwap.switchAccount", switchAccount));
  context.subscriptions.push(vscode.commands.registerCommand("claudeSwap.addAccount", addAccount));
  context.subscriptions.push(vscode.commands.registerCommand("claudeSwap.refreshStatus", refreshStatusAndBar));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("claudeSwap.pollIntervalMinutes") || e.affectsConfiguration("claudeSwap.cswapExecutablePath")) {
      setupPolling();
    }
  }));
  setupPolling();
}
function getProgressBar(pct) {
  const totalBars = 5;
  const filled = Math.max(0, Math.min(totalBars, Math.round(pct / 100 * totalBars)));
  return "\u2588".repeat(filled) + "\u2591".repeat(totalBars - filled);
}
function formatResetIn(resetsAt) {
  if (!resetsAt) {
    return null;
  }
  const ms = new Date(resetsAt).getTime() - Date.now();
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
function formatWindow(window2) {
  const resetIn = formatResetIn(window2.resetsAt);
  return `${getProgressBar(window2.pct)} ${Math.round(window2.pct)}%${resetIn ? ` R:${resetIn}` : ""}`;
}
function formatResetDetail(label, window2) {
  if (!window2 || !window2.resetsAt) {
    return `${label}: no reset scheduled`;
  }
  const when = window2.clock ? ` at ${window2.clock}` : "";
  const resetIn = formatResetIn(window2.resetsAt);
  return `${label} resets${when}${resetIn ? ` (in ${resetIn})` : ""}`;
}
var STATUS_LABELS = {
  ok: "ok",
  token_expired: "token expired",
  relogin_required: "re-login needed",
  no_credentials: "no credentials",
  api_key: "API key (no quota)",
  keychain_unavailable: "keychain unavailable",
  foreign_credential: "foreign credential",
  unavailable: "unavailable"
};
function statusLabel(status) {
  return status && STATUS_LABELS[status] || status || "unknown";
}
function needsAttention(status) {
  return !!status && status !== "ok" && status !== "token_expired";
}
function getUsage(acc) {
  if (acc.usageStatus === "ok" && acc.usage) {
    return { usage: acc.usage, stale: false, ageSeconds: acc.usageAgeSeconds };
  }
  if (acc.lastGoodUsage) {
    return { usage: acc.lastGoodUsage, stale: true, ageSeconds: acc.lastGoodAgeSeconds };
  }
  return null;
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
function getCswapCommand() {
  const config = vscode.workspace.getConfiguration("claudeSwap");
  return config.get("cswapExecutablePath") || "cswap";
}
function setupPolling() {
  if (pollIntervalTimer) {
    clearInterval(pollIntervalTimer);
    pollIntervalTimer = void 0;
  }
  const config = vscode.workspace.getConfiguration("claudeSwap");
  const minutes = Math.max(0.5, config.get("pollIntervalMinutes") || 1);
  refreshStatusAndBar();
  pollIntervalTimer = setInterval(() => {
    refreshStatusAndBar();
  }, minutes * 60 * 1e3);
}
async function fetchCswapData() {
  const cmd = getCswapCommand();
  try {
    const { stdout } = await execAsync(`${cmd} list --json`);
    const data = JSON.parse(stdout);
    return data;
  } catch (error) {
    console.error("Error executing cswap:", error);
    return null;
  }
}
async function refreshStatusAndBar() {
  const data = await fetchCswapData();
  statusBarItem.backgroundColor = void 0;
  if (!data || !data.accounts) {
    statusBarItem.text = `$(account) Claude: cswap error`;
    statusBarItem.tooltip = `Failed to read from cswap. Make sure claude-swap is installed and in your PATH.`;
    statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    statusBarItem.show();
    return;
  }
  const activeNum = data.activeAccountNumber;
  const activeAccount = data.accounts.find((a) => a.number === activeNum);
  if (activeAccount) {
    const num = activeAccount.number;
    const nameLabel = activeAccount.alias ? activeAccount.alias : activeAccount.email;
    let fiveHourStr = "N/A";
    let sevenDayStr = "N/A";
    let resetLines = "";
    let staleMark = "";
    const status = activeAccount.usageStatus;
    const found = getUsage(activeAccount);
    if (found) {
      const usage = found.usage;
      resetLines = `
${formatResetDetail("5h", usage.fiveHour)}
${formatResetDetail("7d", usage.sevenDay)}`;
      if (found.stale) {
        staleMark = " $(history)";
        resetLines = `
Showing last known usage from ${formatAge(found.ageSeconds)} ago (${statusLabel(status)}).${resetLines}`;
      }
      if (usage.fiveHour) {
        const pct = usage.fiveHour.pct;
        fiveHourStr = formatWindow(usage.fiveHour);
        if (pct >= 85) {
          statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
        } else if (pct >= 70) {
          statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        }
      }
      if (usage.sevenDay) {
        const pct = usage.sevenDay.pct;
        sevenDayStr = formatWindow(usage.sevenDay);
        if (pct >= 85) {
          statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
        } else if (pct >= 70 && statusBarItem.backgroundColor === void 0) {
          statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        }
      }
    } else if (status) {
      fiveHourStr = statusLabel(status);
      sevenDayStr = statusLabel(status);
    }
    if (needsAttention(status) && statusBarItem.backgroundColor === void 0) {
      statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    }
    statusBarItem.text = `$(account) Claude ${num}: ${nameLabel} | 5h: ${fiveHourStr} | 7d: ${sevenDayStr}${staleMark}`;
    statusBarItem.tooltip = `Active Claude Code Account
Email: ${activeAccount.email}
Status: ${statusLabel(status)}${resetLines}
Click to switch accounts.`;
  } else {
    statusBarItem.text = `$(account) Claude: No Active Account`;
    statusBarItem.tooltip = `No active account selected in cswap. Click to switch or add an account.`;
  }
  statusBarItem.show();
}
async function switchAccount() {
  const data = await fetchCswapData();
  if (!data || !data.accounts || data.accounts.length === 0) {
    vscode.window.showErrorMessage("No Claude accounts found. Please add an account first.");
    return;
  }
  const activeNum = data.activeAccountNumber;
  const quickPickItems = data.accounts.map((acc) => {
    const isActive = acc.number === activeNum;
    let desc = acc.email;
    const found = getUsage(acc);
    if (found) {
      const fPctStr = found.usage.fiveHour ? formatWindow(found.usage.fiveHour) : "?";
      const sPctStr = found.usage.sevenDay ? formatWindow(found.usage.sevenDay) : "?";
      desc += ` (5h: ${fPctStr}, 7d: ${sPctStr})`;
      if (found.stale) {
        desc += ` [last known, ${statusLabel(acc.usageStatus)}]`;
      }
    } else {
      desc += ` (${statusLabel(acc.usageStatus)})`;
    }
    return {
      label: `${isActive ? "$(check) " : ""}Account ${acc.number}${acc.alias ? ` (${acc.alias})` : ""}`,
      description: desc,
      accountNum: acc.number
    };
  });
  quickPickItems.push({
    label: `$(add) Add New Account...`,
    description: `Log into a new Claude Code account`,
    accountNum: -1
  });
  const selected = await vscode.window.showQuickPick(quickPickItems, {
    placeHolder: "Select a Claude account to switch to"
  });
  if (selected) {
    if (selected.accountNum === -1) {
      vscode.commands.executeCommand("claudeSwap.addAccount");
    } else if (selected.accountNum !== activeNum) {
      const cmd = getCswapCommand();
      try {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Switching to Account ${selected.accountNum}...`,
          cancellable: false
        }, async () => {
          await execAsync(`${cmd} switch ${selected.accountNum}`);
        });
        vscode.window.showInformationMessage(`Successfully switched to Claude Account ${selected.accountNum}.`);
        refreshStatusAndBar();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to switch account: ${error.message}`);
      }
    }
  }
}
function addAccount() {
  const term = vscode.window.createTerminal("Claude Swap");
  const cmd = getCswapCommand();
  term.show();
  term.sendText(`${cmd} add`);
}
function deactivate() {
  if (pollIntervalTimer) {
    clearInterval(pollIntervalTimer);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
