// Finds finished Claude conversations: the saved transcripts in
// <config folder>/projects/<folder>/<session id>.jsonl. Read only: nothing here writes there.
// Transcripts can be tens of MB, so only the start and the end of each file are read.
import { open, readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { SessionKind, SessionSource } from './sessions';

export interface PastSession {
    sessionId: string;
    cwd: string;
    title: string;
    kind: SessionKind;
    /** When the conversation was last written to (ms). */
    lastActive: number;
    accountKey: string;
}

export interface TranscriptInfo {
    cwd?: string;
    entrypoint?: string;
    firstPrompt?: string;
    aiTitle?: string;
    customTitle?: string;
}

export const PAST_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 128 * 1024;
const PROMPT_LIMIT = 60;

function lines(text: string, dropFirst: boolean, dropLast: boolean): any[] {
    const parts = text.split('\n');
    if (dropFirst) {
        parts.shift(); // cut in the middle of a line
    }
    if (dropLast) {
        parts.pop();
    }
    const out: any[] = [];
    for (const line of parts) {
        if (!line.trim()) {
            continue;
        }
        try {
            out.push(JSON.parse(line));
        } catch {
            // A broken or half-written line: skip it.
        }
    }
    return out;
}

function promptText(entry: any): string | undefined {
    if (entry?.type !== 'user' || entry.isMeta || entry.isSidechain) {
        return undefined;
    }
    const content = entry.message?.content;
    let text: string | undefined;
    if (typeof content === 'string') {
        text = content;
    } else if (Array.isArray(content)) {
        text = content.find((p: any) => p?.type === 'text' && typeof p.text === 'string')?.text;
    }
    const first = text?.trim().split(/\r?\n/)[0]?.trim();
    if (!first || first.startsWith('<')) {
        return undefined; // commands, caveats and tool output are not what the user typed
    }
    return first.length > PROMPT_LIMIT ? first.slice(0, PROMPT_LIMIT - 1) + '…' : first;
}

/** Pulls what the list needs out of the start (`head`) and end (`tail`) of a transcript. */
export function parseTranscript(head: string, tail: string, headIsWhole: boolean, tailIsWhole: boolean): TranscriptInfo {
    const info: TranscriptInfo = {};
    for (const e of lines(head, false, !headIsWhole)) {
        if (!info.cwd && typeof e?.cwd === 'string' && e.cwd) {
            info.cwd = e.cwd;
        }
        if (!info.entrypoint && typeof e?.entrypoint === 'string') {
            info.entrypoint = e.entrypoint;
        }
        if (!info.firstPrompt) {
            info.firstPrompt = promptText(e);
        }
        if (e?.type === 'custom-title' && typeof e.customTitle === 'string' && e.customTitle) {
            info.customTitle = e.customTitle;
        }
        if (e?.type === 'ai-title' && typeof e.aiTitle === 'string' && e.aiTitle) {
            info.aiTitle = e.aiTitle;
        }
    }
    // The end of the file holds the newest titles, so they win over any found at the start.
    for (const e of lines(tail, !tailIsWhole, false)) {
        if (e?.type === 'custom-title' && typeof e.customTitle === 'string' && e.customTitle) {
            info.customTitle = e.customTitle;
        }
        if (e?.type === 'ai-title' && typeof e.aiTitle === 'string' && e.aiTitle) {
            info.aiTitle = e.aiTitle;
        }
    }
    return info;
}

function lastSegment(p: string): string {
    const parts = p.split(/[\\/]+/).filter(Boolean);
    return parts[parts.length - 1] ?? p;
}

function kindOf(entrypoint: string | undefined): SessionKind {
    if (entrypoint === 'claude-vscode') {
        return 'ide';
    }
    if (entrypoint === 'claude-desktop') {
        return 'app';
    }
    return 'terminal';
}

async function readEnds(file: string, size: number): Promise<{ head: string; tail: string; headIsWhole: boolean; tailIsWhole: boolean }> {
    const fh = await open(file, 'r');
    try {
        const headLen = Math.min(size, HEAD_BYTES);
        const head = Buffer.alloc(headLen);
        await fh.read(head, 0, headLen, 0);
        if (size <= HEAD_BYTES) {
            const text = head.toString('utf8');
            return { head: text, tail: '', headIsWhole: true, tailIsWhole: true };
        }
        const tailLen = Math.min(size, TAIL_BYTES);
        const tail = Buffer.alloc(tailLen);
        await fh.read(tail, 0, tailLen, size - tailLen);
        return { head: head.toString('utf8'), tail: tail.toString('utf8'), headIsWhole: false, tailIsWhole: tailLen === size };
    } finally {
        await fh.close();
    }
}

interface CacheEntry {
    mtimeMs: number;
    size: number;
    info: TranscriptInfo;
}

/** Lists finished conversations, remembering what it read so unchanged files aren't read again. */
export class PastSessionReader {
    private cache = new Map<string, CacheEntry>();
    /** How many transcripts were actually opened on the last list() call (for tests). */
    lastReads = 0;

    async list(sources: SessionSource[], now: number, days: number = PAST_DAYS): Promise<PastSession[]> {
        const cutoff = now - days * DAY_MS;
        const out: PastSession[] = [];
        const seen = new Set<string>();
        this.lastReads = 0;
        for (const src of sources) {
            const root = path.join(src.configHome, 'projects');
            let folders: string[];
            try {
                folders = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
            } catch {
                continue;
            }
            for (const folder of folders) {
                let names: string[];
                try {
                    names = (await readdir(path.join(root, folder), { withFileTypes: true })).filter((d) => d.isFile() && d.name.endsWith('.jsonl')).map((d) => d.name);
                } catch {
                    continue;
                }
                for (const name of names) {
                    const file = path.join(root, folder, name);
                    try {
                        const st = await stat(file);
                        if (st.mtimeMs < cutoff) {
                            continue;
                        }
                        seen.add(file);
                        let hit = this.cache.get(file);
                        if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
                            const ends = await readEnds(file, st.size);
                            this.lastReads++;
                            hit = { mtimeMs: st.mtimeMs, size: st.size, info: parseTranscript(ends.head, ends.tail, ends.headIsWhole, ends.tailIsWhole) };
                            this.cache.set(file, hit);
                        }
                        const info = hit.info;
                        if (!info.cwd) {
                            continue;
                        }
                        out.push({
                            sessionId: name.slice(0, -'.jsonl'.length),
                            cwd: info.cwd,
                            title: info.customTitle ?? info.aiTitle ?? info.firstPrompt ?? lastSegment(info.cwd),
                            kind: kindOf(info.entrypoint),
                            lastActive: st.mtimeMs,
                            accountKey: src.accountKey,
                        });
                    } catch {
                        // Gone, locked or unreadable: skip it, the rest still show.
                    }
                }
            }
        }
        for (const key of this.cache.keys()) {
            if (!seen.has(key)) {
                this.cache.delete(key);
            }
        }
        return out;
    }
}
