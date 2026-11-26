// Deletes an account folder without ever following a link or junction, so the
// shared folders it points to (your main chat history, skills, plugins) are never touched.
import { lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import { isInside } from './paths';

async function removeLink(p: string): Promise<void> {
    try {
        await unlink(p);
    } catch (e: any) {
        if (e?.code === 'EPERM' || e?.code === 'EISDIR') {
            await rmdir(p); // Directory links on Windows; rmdir removes the link, not its target.
        } else if (e?.code !== 'ENOENT') {
            throw e;
        }
    }
}

async function deleteTree(p: string): Promise<void> {
    let st;
    try {
        st = await lstat(p);
    } catch (e: any) {
        if (e?.code === 'ENOENT') {
            return;
        }
        throw e;
    }
    if (st.isSymbolicLink()) {
        await removeLink(p);
        return;
    }
    if (st.isDirectory()) {
        for (const name of await readdir(p)) {
            await deleteTree(path.join(p, name));
        }
        await rmdir(p);
        return;
    }
    await unlink(p);
}

export async function removeAccountFolder(root: string, folder: string): Promise<void> {
    if (!isInside(root, folder)) {
        throw new Error('Refusing to delete a folder outside the accounts folder');
    }
    await deleteTree(folder);
}
