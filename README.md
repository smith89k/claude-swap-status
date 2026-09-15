# Claude Code Multi-Account Manager (Antigravity IDE Plugin)

A VS Code / Antigravity IDE extension that provides a status bar usage tracker and an interactive account switcher for Claude Code.

This extension wraps the open-source [claude-swap](https://github.com/realiti4/claude-swap) CLI tool to provide a rich native graphical interface.

## Features

- **Status Bar Usage Tracking**: Displays your current Claude account, alias, and real-time usage (5-hour and 7-day limits) directly in the status bar.
- **Interactive Account Switcher**: Click the status bar or run the `Claude Swap: Switch Account` command to view all your accounts and easily swap the active one.
- **Add Accounts**: Add new accounts straight from the command palette.

## Prerequisites

You must have the `claude-swap` CLI tool installed.

```bash
uv tool install claude-swap
# or
pipx install claude-swap
```

## Settings

- `claudeSwap.pollIntervalMinutes`: How often to poll `cswap` for usage status (in minutes, default: 5).
- `claudeSwap.cswapExecutablePath`: The path to the `cswap` CLI executable if it is not in your system's PATH.

## Usage

1. Open this folder in Antigravity IDE.
2. Run `npm install`.
3. Press `F5` to launch the Extension Development Host.
4. The status bar will automatically display your usage. Click on it to switch accounts!
