import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Registry, effectiveNumbers } from '../core/registry';

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

test('listSync reads the same accounts without waiting, and is empty for a missing or corrupt file', async () => {
    const root = await tmp();
    const reg = new Registry(root);
    assert.deepEqual(reg.listSync(), []);
    await reg.add({ id: 'a1', folder: join(root, 'a1') });
    assert.deepEqual(reg.listSync().map((a) => a.id), ['a1']);
    await writeFile(join(root, 'accounts.json'), '{broken');
    assert.deepEqual(reg.listSync(), []);
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

test('add gives each account the lowest free number from 2, and numbers stay put', async () => {
    const root = await tmp();
    const reg = new Registry(root);
    const a = await reg.add({ id: 'a', folder: join(root, 'a') });
    const b = await reg.add({ id: 'b', folder: join(root, 'b') });
    assert.deepEqual([a.number, b.number], [2, 3]);
    await reg.remove('a');
    const c = await reg.add({ id: 'c', folder: join(root, 'c') });
    assert.equal(c.number, 2);
    assert.equal((await reg.get('b'))?.number, 3);
});

test('effectiveNumbers fills in numbers for accounts saved before numbering', () => {
    const n = effectiveNumbers([
        { id: 'old', folder: '/x', createdAt: 't' },
        { id: 'two', folder: '/y', createdAt: 't', number: 2 },
        { id: 'older', folder: '/z', createdAt: 't' },
    ]);
    assert.deepEqual([n.get('old'), n.get('two'), n.get('older')], [3, 2, 4]);
});

test('the main login (Claude 1) can have a name too', async () => {
    const root = await tmp();
    const reg = new Registry(root);
    assert.equal(await reg.getMainAlias(), undefined);
    await reg.add({ id: 'a', folder: join(root, 'a') });
    await reg.setMainAlias('personal');
    assert.equal(await reg.getMainAlias(), 'personal');
    assert.equal((await reg.list()).length, 1);
    await reg.setMainAlias('');
    assert.equal(await reg.getMainAlias(), undefined);
});

test('an icon is saved with the account and cleared with an empty value', async () => {
    const reg = new Registry(await tmp());
    await reg.add({ id: 'ab12cd34', folder: '/x' });
    await reg.update('ab12cd34', { icon: 'rocket' });
    assert.equal((await reg.get('ab12cd34'))?.icon, 'rocket');
    await reg.update('ab12cd34', { icon: '' });
    assert.equal((await reg.get('ab12cd34'))?.icon, undefined);
});
