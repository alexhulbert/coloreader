import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {DAY, checkForUpdate, loadCachedBundle, older} from '../updater.mjs';

const repository = 'alexhulbert/coloreader';
const version = '2026.1012.1.1';
const bundle = Buffer.from(`exports.version = "${version}"; exports.start = () => "cached bundle";`);
const manifest = {version, sha256: createHash('sha256').update(bundle).digest('hex')};
const temporary = async (fn) => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'coloreader-update-'));
    try { await fn(directory); } finally { await fs.rm(directory, {recursive: true, force: true}); }
};
const serve = (release = manifest, code = bundle) => async (url) => new Response(url.endsWith('.json') ? JSON.stringify(release) : code);

test('versions compare numerically', () => {
    assert.ok(older('2026.1012.9.1', '2026.1012.10.1'));
    assert.equal(older(version, version), false);
    assert.throws(() => older('1', version));
});

test('cache is verified and shared across daily checks', async () => temporary(async (directory) => {
    let clock = 100_000_000;
    let requests = 0;
    const options = {repository, version: '0.0.0.0', directory, now: () => clock, fetcher: (url) => { requests++; return serve()(url); }};
    assert.equal(await checkForUpdate(options), 'updated');
    assert.deepEqual(await fs.readFile(join(directory, 'injector.cjs')), bundle);
    assert.equal(loadCachedBundle('0.0.0.0', () => {}, directory).start(), 'cached bundle');
    assert.throws(() => loadCachedBundle('2026.1013.1.1', () => {}, directory), /Older/);
    assert.equal(await checkForUpdate(options), 'fresh');
    assert.equal(requests, 2);
    clock += DAY;
    assert.equal(await checkForUpdate(options), 'current');
    assert.equal(requests, 3);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['injector.cjs', 'update.json']);
    await fs.writeFile(join(directory, 'injector.cjs'), 'throw new Error("tampered")');
    assert.throws(() => loadCachedBundle('0.0.0.0', () => {}, directory), /checksum/);
}));

test('concurrent checks publish a usable cache without sharing temporary files', async () => temporary(async (directory) => {
    const options = {repository, version: '0.0.0.0', directory, fetcher: serve()};
    const outcomes = await Promise.all([checkForUpdate(options), checkForUpdate(options)]);
    assert.ok(outcomes.every((value) => ['updated', 'current', 'fresh'].includes(value)));
    assert.deepEqual(await fs.readFile(join(directory, 'injector.cjs')), bundle);
    assert.equal(loadCachedBundle('0.0.0.0', () => {}, directory).start(), 'cached bundle');
    assert.deepEqual((await fs.readdir(directory)).sort(), ['injector.cjs', 'update.json']);
}));

test('an interrupted update repairs metadata without downloading the bundle again', async () => temporary(async (directory) => {
    await fs.writeFile(join(directory, 'injector.cjs'), bundle);
    await fs.writeFile(join(directory, 'update.json'), JSON.stringify({version: '0.0.0.0', sha256: 'old', checkedAt: 0}));
    let requests = 0;
    const options = {repository, version: '0.0.0.0', directory, now: () => DAY * 10, fetcher: (url) => { requests++; return serve()(url); }};
    assert.equal(await checkForUpdate(options), 'current');
    assert.equal(requests, 1);
    assert.equal(loadCachedBundle('0.0.0.0', () => {}, directory).start(), 'cached bundle');
}));

test('malformed cache metadata is replaced with a usable update', async () => temporary(async (directory) => {
    await fs.writeFile(join(directory, 'update.json'), '{broken');
    assert.equal(await checkForUpdate({repository, version: '0.0.0.0', directory, fetcher: serve()}), 'updated');
    assert.equal(loadCachedBundle('0.0.0.0', () => {}, directory).start(), 'cached bundle');
}));

test('bad manifests, checksums and offline checks keep the last bundle', async () => temporary(async (directory) => {
    const previous = Buffer.from('last good bundle');
    await fs.writeFile(join(directory, 'injector.cjs'), previous);
    const options = {repository, version: '0.0.0.0', directory, now: () => DAY * 10, fetcher: serve(manifest, Buffer.alloc(bundle.length))};
    await assert.rejects(checkForUpdate(options), /verification/);
    assert.equal(await checkForUpdate(options), 'fresh');
    options.now = () => DAY * 12;
    options.fetcher = async () => { throw new Error('offline'); };
    await assert.rejects(checkForUpdate(options), /offline/);
    options.now = () => DAY * 14;
    options.fetcher = serve({...manifest, version: 'latest'});
    await assert.rejects(checkForUpdate(options), /version/);
    assert.deepEqual(await fs.readFile(join(directory, 'injector.cjs')), previous);
}));

test('downgrades and oversized responses never replace the cache', async () => temporary(async (directory) => {
    const options = {repository, version: '2026.1013.1.1', directory, fetcher: serve()};
    assert.equal(await checkForUpdate(options), 'older');
    await assert.rejects(fs.access(join(directory, 'injector.cjs')));
    await fs.rm(join(directory, 'update.json'));
    options.version = '0.0.0.0';
    options.fetcher = async () => new Response(Buffer.alloc(65537));
    await assert.rejects(checkForUpdate(options), /too large/);
}));
