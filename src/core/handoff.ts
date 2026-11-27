// Handoff: small request files Claude Away leaves in <accounts root>/handoff/ so the right
// VS Code window closes a conversation's Claude tab neatly when Claude Away takes it over,
// and reopens it when Claude Away hands it back.
//
// Claude Away keeps a copy of this file (src/shared/handoff.ts). Keep both identical: it may
// only import ./types, which sits next to it in both projects.
//
//   <sessionId>.json             a request (written atomically; a newer one replaces an older one)
//   <sessionId>.<windowId>.claim  a request one window has taken (an atomic rename: one winner)
//   <sessionId>.result.json      what that window did
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import type { WindowBeat } from './types';

export const HANDOFF_VERSION = 1;
/** How long a request stays valid: closing is only useful right away, reopening can wait for the folder to be opened. */
export const CLOSE_MAX_AGE_MS = 30_000;
export const OPEN_MAX_AGE_MS = 5 * 60_000;
export const RESULT_MAX_AGE_MS = 5 * 60_000;
/** A claim older than this belongs to a window that stopped mid-way. */
export const CLAIM_MAX_AGE_MS = 2 * 60_000;
/** A window heartbeat older than this means the window is gone (the same rule as the window registry). */
export const BEAT_STALE_MS = 90_000;
/** A request dated further ahead than this is not trusted (the clock jumped). */
const FUTURE_SLACK_MS = 60_000;

export type HandoffAction = 'close' | 'open';

export interface HandoffRequest {
    v: 1;
    action: HandoffAction;
    sessionId: string;
    /** The folder the conversation runs in. */
    cwd: string;
    /** "main" or the account id the conversation belongs to. */
    accountKey: string;
    /** close only: the process number of the editor's Claude for this conversation. */
    pid?: number;
    at: number;
}

export type HandoffOutcome = 'closed' | 'not-here' | 'opened' | 'already-open';

export interface HandoffResult {
    v: 1;
    action: HandoffAction;
    result: HandoffOutcome;
    windowId: string;
    at: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTCOMES: readonly string[] = ['closed', 'not-here', 'opened', 'already-open'];

export function handoffDir(root: string): string {
    return path.join(root, 'handoff');
}

const requestFile = (root: string, id: string) => path.join(handoffDir(root), `${id}.json`);
const resultFile = (root: string, id: string) => path.join(handoffDir(root), `${id}.result.json`);
const safeWindow = (windowId: string) => windowId.replace(/[^A-Za-z0-9_-]/g, '_');
const claimFile = (root: string, id: string, windowId: string) => path.join(handoffDir(root), `${id}.${safeWindow(windowId)}.claim`);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseRequest(raw: unknown, platform: NodeJS.Platform = process.platform): HandoffRequest | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    const r = raw as Record<string, unknown>;
    const absolute = platform === 'win32' ? path.win32.isAbsolute : path.posix.isAbsolute;
    if (r.v !== HANDOFF_VERSION || (r.action !== 'close' && r.action !== 'open')) {
        return undefined;
    }
    if (typeof r.sessionId !== 'string' || !UUID.test(r.sessionId) || typeof r.cwd !== 'string' || !absolute(r.cwd)) {
        return undefined;
    }
    if (typeof r.accountKey !== 'string' || !r.accountKey || !isNum(r.at)) {
        return undefined;
    }
    const req: HandoffRequest = { v: 1, action: r.action, sessionId: r.sessionId, cwd: r.cwd, accountKey: r.accountKey, at: r.at };
    if (r.action === 'close') {
        if (!isNum(r.pid) || !Number.isInteger(r.pid) || r.pid <= 0) {
            return undefined;
        }
        req.pid = r.pid;
    }
    return req;
}

export function isFresh(req: HandoffRequest, now: number): boolean {
    const age = now - req.at;
    return age >= -FUTURE_SLACK_MS && age <= (req.action === 'close' ? CLOSE_MAX_AGE_MS : OPEN_MAX_AGE_MS);
}

function parseResult(raw: unknown): HandoffResult | undefined {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r !== 'object' || r.v !== HANDOFF_VERSION || (r.action !== 'close' && r.action !== 'open')) {
        return undefined;
    }
    if (typeof r.result !== 'string' || !OUTCOMES.includes(r.result) || typeof r.windowId !== 'string' || !isNum(r.at)) {
        return undefined;
    }
    return { v: 1, action: r.action, result: r.result as HandoffOutcome, windowId: r.windowId, at: r.at };
}

const tempName = (file: string) => `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;

async function writeAtomic(file: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = tempName(file);
    await writeFile(tmp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    try {
        await rename(tmp, file);
    } catch (e) {
        await unlink(tmp).catch(() => undefined);
        throw e;
    }
}

async function readParsed(file: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(file, 'utf8'));
    } catch {
        return undefined; // missing, or broken
    }
}

export async function writeRequest(root: string, req: HandoffRequest): Promise<void> {
    await writeAtomic(requestFile(root, req.sessionId), req);
}

/** For a program that is about to exit and can't wait for an async write. */
export function writeRequestSync(root: string, req: HandoffRequest): void {
    const file = requestFile(root, req.sessionId);
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = tempName(file);
    writeFileSync(tmp, JSON.stringify(req), { encoding: 'utf8', mode: 0o600 });
    try {
        renameSync(tmp, file);
    } catch (e) {
        try {
            unlinkSync(tmp);
        } catch {
            // already gone
        }
        throw e;
    }
}

export async function readResult(root: string, sessionId: string): Promise<HandoffResult | undefined> {
    return parseResult(await readParsed(resultFile(root, sessionId)));
}

async function names(root: string): Promise<string[]> {
    try {
        return await readdir(handoffDir(root));
    } catch {
        return [];
    }
}

/** Conversations that have a request waiting (temp files of a write in progress are not requests). */
export async function pendingRequests(root: string): Promise<string[]> {
    return (await names(root)).map((n) => /^(.+)\.json$/.exec(n)?.[1]).filter((id): id is string => !!id && UUID.test(id));
}

export async function peekRequest(root: string, sessionId: string, platform: NodeJS.Platform = process.platform): Promise<HandoffRequest | undefined> {
    return parseRequest(await readParsed(requestFile(root, sessionId)), platform);
}

/** Takes a request for this window. Only one window can: the others get undefined. */
export async function claimRequest(root: string, sessionId: string, windowId: string, platform: NodeJS.Platform = process.platform): Promise<HandoffRequest | undefined> {
    const claim = claimFile(root, sessionId, windowId);
    try {
        await rename(requestFile(root, sessionId), claim);
    } catch {
        return undefined; // another window took it, or it was replaced or removed meanwhile
    }
    const now = new Date();
    await utimes(claim, now, now).catch(() => undefined); // the claim's age counts from now
    const req = parseRequest(await readParsed(claim), platform);
    if (!req) {
        await unlink(claim).catch(() => undefined);
    }
    return req;
}

export async function finishClaim(root: string, sessionId: string, windowId: string, result: HandoffResult | undefined): Promise<void> {
    if (result) {
        await writeAtomic(resultFile(root, sessionId), result);
    }
    await unlink(claimFile(root, sessionId, windowId)).catch(() => undefined);
}

/** Removes requests past their age, results older than 5 minutes and claims left by a window that stopped. */
export async function sweep(root: string, now: number, platform: NodeJS.Platform = process.platform): Promise<void> {
    const dir = handoffDir(root);
    for (const name of await names(root)) {
        const file = path.join(dir, name);
        let drop = false;
        if (name.endsWith('.result.json')) {
            const r = parseResult(await readParsed(file));
            drop = !r || now - r.at > RESULT_MAX_AGE_MS;
        } else if (name.endsWith('.claim')) {
            try {
                drop = now - (await stat(file)).mtimeMs > CLAIM_MAX_AGE_MS;
            } catch {
                drop = false;
            }
        } else if (/^[^.]+\.json$/.test(name)) {
            const req = parseRequest(await readParsed(file), platform);
            drop = !req || !isFresh(req, now);
        }
        if (drop) {
            await unlink(file).catch(() => undefined);
        }
    }
}

function norm(p: string, platform: NodeJS.Platform): string {
    if (platform === 'win32') {
        return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    }
    return p.replace(/\/+$/, '');
}

/** The window that should act for a conversation in `cwd`: the longest folder holding it, for that account. */
export function bestWindowFor(cwd: string, accountKey: string, windows: WindowBeat[], platform: NodeJS.Platform = process.platform): WindowBeat | undefined {
    const c = norm(cwd, platform);
    const sep = platform === 'win32' ? '\\' : '/';
    let best: { w: WindowBeat; length: number } | undefined;
    for (const w of windows) {
        if ((w.handoff ?? 0) < HANDOFF_VERSION || w.accountKey !== accountKey) {
            continue;
        }
        for (const folder of w.folders ?? []) {
            const f = norm(folder, platform);
            if (!f || (c !== f && !c.startsWith(f + sep))) {
                continue;
            }
            if (!best || f.length > best.length || (f.length === best.length && w.windowId < best.w.windowId)) {
                best = { w, length: f.length };
            }
        }
    }
    return best?.w;
}

function liveBeat(raw: unknown, now: number, isAlive: (pid: number) => boolean): WindowBeat | undefined {
    const b = raw as WindowBeat | null;
    if (!b || typeof b !== 'object' || typeof b.windowId !== 'string' || !isNum(b.pid) || !isNum(b.updatedAt)) {
        return undefined;
    }
    if ((b.handoff ?? 0) < HANDOFF_VERSION || now - b.updatedAt > BEAT_STALE_MS || !isAlive(b.pid)) {
        return undefined;
    }
    return b;
}

/** A live Claude Swap window that handles handoff and holds this folder for this account. Read only. */
export async function capableWindowFor(root: string, cwd: string, accountKey: string, now: number, isAlive: (pid: number) => boolean, platform: NodeJS.Platform = process.platform): Promise<WindowBeat | undefined> {
    const dir = path.join(root, 'windows');
    let list: string[];
    try {
        list = await readdir(dir);
    } catch {
        return undefined;
    }
    const beats: WindowBeat[] = [];
    for (const name of list.filter((n) => n.endsWith('.json'))) {
        const b = liveBeat(await readParsed(path.join(dir, name)), now, isAlive);
        if (b) {
            beats.push(b);
        }
    }
    return bestWindowFor(cwd, accountKey, beats, platform);
}

/** True if any live Claude Swap window handles handoff (it also cleans up old request files). */
export function anyCapableWindowSync(root: string, now: number, isAlive: (pid: number) => boolean): boolean {
    const dir = path.join(root, 'windows');
    let list: string[];
    try {
        list = readdirSync(dir);
    } catch {
        return false;
    }
    for (const name of list.filter((n) => n.endsWith('.json'))) {
        let raw: unknown;
        try {
            raw = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
        } catch {
            continue;
        }
        if (liveBeat(raw, now, isAlive)) {
            return true;
        }
    }
    return false;
}
