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
  const minutes = config.get("pollIntervalMinutes") || 5;
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
  if (!data || !data.accounts) {
    statusBarItem.text = `$(account) Claude: cswap error`;
    statusBarItem.tooltip = `Failed to read from cswap. Make sure claude-swap is installed and in your PATH.`;
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
    if (activeAccount.usageStatus === "ok" && activeAccount.usage) {
      const getProgressBar = (pct) => {
        const totalBars = 5;
        const filled = Math.max(0, Math.min(totalBars, Math.round(pct / 100 * totalBars)));
        return "\u2588".repeat(filled) + "\u2591".repeat(totalBars - filled);
      };
      if (activeAccount.usage.fiveHour) {
        const pct = activeAccount.usage.fiveHour.pct;
        fiveHourStr = `${getProgressBar(pct)} ${Math.round(pct)}%`;
      }
      if (activeAccount.usage.sevenDay) {
        const pct = activeAccount.usage.sevenDay.pct;
        sevenDayStr = `${getProgressBar(pct)} ${Math.round(pct)}%`;
      }
    } else if (activeAccount.usageStatus) {
      fiveHourStr = activeAccount.usageStatus;
      sevenDayStr = activeAccount.usageStatus;
    }
    statusBarItem.text = `$(account) Claude ${num}: ${nameLabel} | 5h: ${fiveHourStr} | 7d: ${sevenDayStr}`;
    statusBarItem.tooltip = `Active Claude Code Account
Email: ${activeAccount.email}
Status: ${activeAccount.usageStatus}
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
    if (acc.usageStatus === "ok" && acc.usage) {
      const getProgressBar = (pct) => {
        const totalBars = 5;
        const filled = Math.max(0, Math.min(totalBars, Math.round(pct / 100 * totalBars)));
        return "\u2588".repeat(filled) + "\u2591".repeat(totalBars - filled);
      };
      const fPctNum = acc.usage.fiveHour ? Math.round(acc.usage.fiveHour.pct) : null;
      const sPctNum = acc.usage.sevenDay ? Math.round(acc.usage.sevenDay.pct) : null;
      const fPctStr = fPctNum !== null ? `${getProgressBar(fPctNum)} ${fPctNum}%` : "?";
      const sPctStr = sPctNum !== null ? `${getProgressBar(sPctNum)} ${sPctNum}%` : "?";
      desc += ` (5h: ${fPctStr}, 7d: ${sPctStr})`;
    } else {
      desc += ` (${acc.usageStatus})`;
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
