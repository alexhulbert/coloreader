import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {boot} from '../bootstrap.mjs';

test('local main hooks run before a cached palette bundle that has no hook support', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'coloreader-main-hook-'));
    const keys = ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'COLOREADER_UPDATES'];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
        process.env.XDG_CONFIG_HOME = join(directory, 'config');
        process.env.XDG_CACHE_HOME = join(directory, 'cache');
        process.env.COLOREADER_UPDATES = '0';
        const config = join(process.env.XDG_CONFIG_HOME, 'coloreader');
        const cache = join(process.env.XDG_CACHE_HOME, 'coloreader/electron-injector');
        await fs.mkdir(config, {recursive: true});
        await fs.mkdir(cache, {recursive: true});
        await fs.writeFile(join(directory, 'package.json'), '{"name":"fixture"}');
        await fs.writeFile(join(config, 'fixture.main.cjs'), 'module.exports=e=>e.events.push("main");');
        const code = 'require("electron").events.push("cached-load");exports.version="1.0.0.0";exports.start=r=>r("electron").events.push("cached-start");';
        await fs.writeFile(join(cache, 'injector.cjs'), code);
        await fs.writeFile(join(cache, 'update.json'), JSON.stringify({version: '1.0.0.0', sha256: createHash('sha256').update(code).digest('hex')}));
        const electron = {app: {getAppPath: () => directory}, events: []};
        const require = createRequire(import.meta.url);
        boot('fixture', {version: '0.0.0.0', start: () => assert.fail('cache was not used')}, id => id === 'electron' ? electron : require(id));
        assert.deepEqual(electron.events, ['main', 'cached-load', 'cached-start']);
    } finally {
        for (const key of keys) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
        await fs.rm(directory, {recursive: true, force: true});
    }
});
