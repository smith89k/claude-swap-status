# Claude Swap Status

See your Claude Code usage right in the status bar of Antigravity IDE (or VS Code), and switch between Claude accounts with one click.

This extension is a small visual add-on for [claude-swap](https://github.com/realiti4/claude-swap). **It needs claude-swap installed to work.**

> **Unofficial add-on.** This extension is not made by or affiliated with the author of [claude-swap](https://github.com/realiti4/claude-swap), or with Anthropic. "Claude" is a trademark of Anthropic.

## Step 1: Install claude-swap first

> ⚠️ **This extension does nothing on its own.** It only shows what the `cswap` tool reports. Install claude-swap and add an account **before** you install this extension. Otherwise the status bar will show `Claude: cswap error`.

1. Install the `claude-swap` command line tool:

   ```bash
   uv tool install claude-swap
   # or
   pipx install claude-swap
   ```

2. Add at least one Claude account:

   ```bash
   cswap add
   ```

3. Check that it works:

   ```bash
   cswap list --json
   ```

   You should see your accounts. If you see `command not found`, close and reopen your terminal, then try again.

For more help, see the [claude-swap page](https://github.com/realiti4/claude-swap).

## Step 2: Install this extension

**From a `.vsix` file**

1. Download the latest `.vsix` file from the [Releases](https://github.com/smith89k/claude-swap-status/releases) page.
2. In Antigravity IDE, open the Extensions panel.
3. Click the `...` menu and choose **Install from VSIX...**.
4. Pick the file you downloaded.

The status bar item appears once the editor finishes starting up.

## Features

### Usage at a glance

The status bar shows the active account and how much of your limits you have used:

```text
👤 Claude 1: work | 5h: █░░░░ 25% | 7d: █░░░░ 16%
```

- **5h** is your 5-hour usage limit.
- **7d** is your 7-day usage limit.
- Hover over it to see the account email and status.

### Warning colors

The status bar changes color so you notice before you run out:

| Usage          | Color  |
| -------------- | ------ |
| Below 70%      | Normal |
| 70% or more    | Yellow |
| 85% or more    | Red    |

### Switch accounts in one click

Click the status bar to see all your accounts with their usage, then pick one to switch to.

### Add a new account

Pick **Add New Account...** from the list, or run **Claude Swap: Add Account** from the Command Palette. A terminal opens and walks you through logging in.

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type **Claude Swap**:

| Command                        | What it does                                   |
| ------------------------------ | ---------------------------------------------- |
| `Claude Swap: Switch Account`  | Show all accounts and switch the active one.   |
| `Claude Swap: Add Account`     | Open a terminal to log in to a new account.    |
| `Claude Swap: Refresh Usage`   | Update the usage numbers right now.            |

## Settings

| Setting                           | Default | Description                                                          |
| --------------------------------- | ------- | -------------------------------------------------------------------- |
| `claudeSwap.pollIntervalMinutes`  | `5`     | How often to check usage, in minutes.                                |
| `claudeSwap.cswapExecutablePath`  | `cswap` | Full path to the `cswap` tool, if it is not in your system's PATH.   |

## Troubleshooting

**The status bar says `Claude: cswap error`**

The extension could not run `cswap`.

1. Open a terminal and run `cswap list --json`.
2. If the command is not found, install claude-swap (see [Step 1](#step-1-install-claude-swap-first)).
3. If it works in the terminal but not in the editor, set `claudeSwap.cswapExecutablePath` to the full path of `cswap`, then restart the editor.

   Find the path with `where cswap` (Windows) or `which cswap` (macOS / Linux).

**The status bar says `Claude: No Active Account`**

Click it and choose an account, or add one with **Add New Account...**.

**The usage shows something other than a percentage**

claude-swap could not read usage for that account right now. Try **Claude Swap: Refresh Usage**, or run `cswap list` in a terminal to see more detail.

## Development

1. Clone this repository and open the folder in Antigravity IDE.
2. Run `npm install`.
3. Press `F5` to launch the Extension Development Host.
4. Run `npm run build` to bundle the extension.
5. Run `npx @vscode/vsce package` to create a `.vsix` file.

## Credits

- [claude-swap](https://github.com/realiti4/claude-swap) by realiti4, which does all the real account and usage work.

## License

[MIT](LICENSE)
