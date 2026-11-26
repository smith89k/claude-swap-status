// A small note one window leaves for another: "please show this session".
// Lives at <accounts root>/requests/<windowId>.json and is read once.
import { unlink } from 'node:fs/promises';
import * as path from 'node:path';
import { readJson, writeJsonAtomic } from './fsjson';
import type { SessionKind } from './sessions';

export interface JumpRequest {
    sessionId: string;
    pid: number;
    kind: SessionKind;
    at: number;
}

export const REQUEST_MAX_AGE_MS = 30_000;

export function requestPath(root: string, windowId: string): string {
    return path.join(root, 'requests', `${windowId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}

export async function writeJumpRequest(root: string, windowId: string, req: JumpRequest): Promise<void> {
    await writeJsonAtomic(requestPath(root, windowId), req);
}

/** Reads and deletes this window's request. Missing, broken or too old gives undefined. */
export async function takeJumpRequest(root: string, windowId: string, now: number, maxAgeMs: number = REQUEST_MAX_AGE_MS): Promise<JumpRequest | undefined> {
    const file = requestPath(root, windowId);
    let req: JumpRequest | undefined;
    try {
        req = await readJson<JumpRequest>(file);
    } catch {
        req = undefined;
    }
    await unlink(file).catch(() => undefined);
    if (!req || typeof req.sessionId !== 'string' || typeof req.pid !== 'number' || typeof req.at !== 'number') {
        return undefined;
    }
    if (now - req.at > maxAgeMs) {
        return undefined;
    }
    return req;
}
