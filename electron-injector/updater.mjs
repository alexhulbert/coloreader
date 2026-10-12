import {createHash, randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readLimited} from './http.mjs';

export const DAY = 24 * 60 * 60 * 1000;
const MAX_BUNDLE = 8 * 1024 * 1024;
const VERSION = /^\d{1,9}\.\d{1,9}\.\d{1,9}\.\d{1,9}$/;

export function older(a, b) {
    if (!VERSION.test(a) || !VERSION.test(b)) throw new Error('Invalid injector version');
    const key = (version) => version.split('.').map((part) => part.padStart(9, '0')).join('');
    return key(a) < key(b);
}

export const cacheDirectory = () => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'coloreader', 'electron-injector');
const releaseBase = (repository) => process.env.COLOREADER_UPDATE_BASE ?? `https://github.com/${repository}/releases`;
const digest = (data) => createHash('sha256').update(data).digest('hex');

export async function checkForUpdate({repository, version, directory = cacheDirectory(), fetcher = fetch, now = Date.now}) {
    await fs.mkdir(directory, {recursive: true, mode: 0o700});
    const write = async (name, data) => {
        const path = join(directory, name);
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, data, {mode: 0o600, flag: 'wx'});
            await fs.rename(temporary, path);
        } finally {
            await fs.rm(temporary, {force: true});
        }
    };
    const download = async (url, limit) => {
        const response = await fetcher(url, {signal: AbortSignal.timeout(30_000)});
        if (!response.ok) throw new Error(`Update request failed: ${response.status}`);
        return readLimited(response, limit);
    };
    const state = await fs.readFile(join(directory, 'update.json'), 'utf8').then(JSON.parse).catch(() => ({}));
    const age = now() - state.checkedAt;
    if (age >= 0 && age < DAY) return 'fresh';
    const attempt = {...state, checkedAt: now()};
    await write('update.json', JSON.stringify(attempt));
    const release = JSON.parse(await download(`${releaseBase(repository)}/latest/download/electron-injector.json`, 65536));
    if (older(release.version, version)) return 'older';
    const current = digest(await fs.readFile(join(directory, 'injector.cjs')).catch(() => '')) === release.sha256;
    if (!current) {
        const bundle = await download(`${releaseBase(repository)}/download/coloreader-v${release.version}/coloreader-electron-${release.version}.cjs`, MAX_BUNDLE);
        if (digest(bundle) !== release.sha256) throw new Error('Injector download failed integrity verification');
        await write('injector.cjs', bundle);
    }
    await write('update.json', JSON.stringify({...attempt, version: release.version, sha256: release.sha256}));
    return current ? 'current' : 'updated';
}

// Check the digest before running cached code in the app's main process.
export function loadCachedBundle(version, require, directory = cacheDirectory()) {
    const state = JSON.parse(readFileSync(join(directory, 'update.json'), 'utf8'));
    if (older(state.version, version)) throw new Error('Older cached bundle');
    const code = readFileSync(join(directory, 'injector.cjs'));
    if (digest(code) !== state.sha256) throw new Error('Cached bundle checksum mismatch');
    const module = {exports: {}};
    new Function('require', 'module', 'exports', code.toString())(require, module, module.exports);
    return module.exports;
}
