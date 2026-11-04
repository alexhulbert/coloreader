import {DAY, checkForUpdate, loadCachedBundle} from './updater.mjs';
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

export function boot(repository, embedded, require) {
    const log = (...args) => { if (process.env.COLOREADER_DEBUG === '1') console.error('[coloreader]', ...args); };
    const electron = require('electron');
    try {
        const {name} = JSON.parse(readFileSync(join(electron.app.getAppPath(), 'package.json'), 'utf8'));
        const path = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'coloreader', `${name}.main.cjs`);
        if (existsSync(path)) require(path)(electron);
    } catch (error) {
        console.error('[coloreader] main script', error);
    }
    let bundle = embedded;
    try { bundle = loadCachedBundle(embedded.version, require); log('using cached bundle', bundle.version); }
    catch (error) { log('using embedded bundle', embedded.version, error.message); }
    bundle.start(require);
    if (process.env.COLOREADER_UPDATES === '0') return;
    const check = () => checkForUpdate({repository, version: bundle.version}).then(log, (error) => log(error.message));
    electron.app.whenReady().then(() => { check(); setInterval(check, DAY).unref(); });
}
