import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Registry } from '../core/registry';

const tmp = () => mkdtemp(join(tmpdir(), 'cs-reg-'));

test('add, list, update, clear alias and remove', async () => {
    const root = await tmp();
    const reg = new Registry(root);
    assert.deepEqual(await reg.list(), []);
    const a = await reg.add({ id: 'ab12cd34', folder: join(root, 'ab12cd34') });
    assert.equal(typeof a.createdAt, 'string');
    await reg.update('ab12cd34', { alias: 'work', email: 'w@x.com' });
    assert.equal((await reg.get('ab12cd34'))?.alias, 'work');
    await reg.update('ab12cd34', { alias: '' });
    assert.equal((await reg.get('ab12cd34'))?.alias, undefined);
    await reg.remove('ab12cd34');
    assert.deepEqual(await reg.list(), []);
});

test('update of an unknown id rejects', async () => {
    await assert.rejects(new Registry(await tmp()).update('nope', { alias: 'x' }));
});

test('parallel adds from several windows all survive', async () => {
    const root = await tmp();
    await Promise.all([0, 1, 2].map((i) => new Registry(root).add({ id: `id${i}`, folder: join(root, `id${i}`) })));
    assert.deepEqual((await new Registry(root).list()).map((a) => a.id).sort(), ['id0', 'id1', 'id2']);
});

test('corrupt registry is set aside, not lost', async () => {
    const root = await tmp();
    await writeFile(join(root, 'accounts.json'), '{not json');
    const reg = new Registry(root);
    assert.deepEqual(await reg.list(), []);
    await reg.add({ id: 'n1', folder: join(root, 'n1') });
    assert.ok((await readdir(root)).some((n) => n.startsWith('accounts.json.corrupt-')));
    assert.equal((await reg.list()).length, 1);
});
