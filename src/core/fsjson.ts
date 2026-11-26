// JSON files shared between windows: read safely, write atomically.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export class CorruptJsonError extends Error {
    constructor(public readonly file: string) {
        super(`File is not valid JSON: ${path.basename(file)}`);
        this.name = 'CorruptJsonError';
    }
}

/** Returns undefined when the file does not exist; throws CorruptJsonError on bad JSON. */
export async function readJson<T>(file: string): Promise<T | undefined> {
    let text: string;
    try {
        text = await readFile(file, 'utf8');
    } catch (e: any) {
        if (e?.code === 'ENOENT') {
            return undefined;
        }
        throw e;
    }
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new CorruptJsonError(file);
    }
}

/** Writes to a temp file next to the target, then renames it over the target. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
        await rename(tmp, file);
    } catch (e) {
        await unlink(tmp).catch(() => undefined);
        throw e;
    }
}
