import {DAY, checkForUpdate, loadCachedBundle} from './updater.mjs';

export function boot(repository, embedded, require) {
    const log = (...args) => { if (process.env.COLOREADER_DEBUG === '1') console.error('[coloreader]', ...args); };
    let bundle = embedded;
    try { bundle = loadCachedBundle(embedded.version, require); log('using cached bundle', bundle.version); }
    catch (error) { log('using embedded bundle', embedded.version, error.message); }
    bundle.start(require);
    if (process.env.COLOREADER_UPDATES === '0') return;
    const check = () => checkForUpdate({repository, version: bundle.version}).then(log, (error) => log(error.message));
    require('electron').app.whenReady().then(() => { check(); setInterval(check, DAY).unref(); });
}
