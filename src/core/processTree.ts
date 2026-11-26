// Finds a process's parent, so a window can tell which of its terminals started
// a Claude session. Only integer pids are ever passed to the command.
import { execFile } from 'node:child_process';

export type ProcRunner = (cmd: string, args: string[]) => Promise<string>;

const defaultRunner: ProcRunner = (cmd, args) =>
    new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 5_000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
    });

export async function parentPid(pid: number, platform: NodeJS.Platform, run: ProcRunner = defaultRunner): Promise<number | undefined> {
    if (!Number.isInteger(pid) || pid <= 0) {
        return undefined;
    }
    let out: string;
    try {
        out = platform === 'win32'
            ? await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId`])
            : await run('ps', ['-o', 'ppid=', '-p', String(pid)]);
    } catch {
        return undefined;
    }
    const n = Number(out.trim());
    return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Parent, grandparent, … up to `levels`, stopping at the top or at a loop. */
export async function ancestors(pid: number, levels: number, platform: NodeJS.Platform, run: ProcRunner = defaultRunner): Promise<number[]> {
    const out: number[] = [];
    const seen = new Set<number>([pid]);
    let current = pid;
    for (let i = 0; i < levels; i++) {
        const parent = await parentPid(current, platform, run);
        if (parent === undefined || seen.has(parent)) {
            break;
        }
        out.push(parent);
        seen.add(parent);
        current = parent;
    }
    return out;
}
