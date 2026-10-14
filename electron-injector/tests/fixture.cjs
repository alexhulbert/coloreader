// Exercise the injector in hidden windows using local test pages.
const {app, BrowserWindow} = require('electron');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const readline = require('node:readline');
const pending = [];
readline.createInterface({input: process.stdin}).on('line', () => pending.shift()());
const command = (name) => new Promise((resolve) => {
    pending.push(resolve);
    console.log(JSON.stringify({command: name}));
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const colors = async (wc, bg, fg, label) => {
    let value;
    for (let i = 0; i < 200; i++) {
        value = await wc.executeJavaScript(`({bg: getComputedStyle(document.body).backgroundColor,
            fg: getComputedStyle(document.body).color, reader: typeof DarkReader,
            engine: typeof __coloreaderInjector, resource: typeof __coloreaderResource, node: typeof require})`);
        if (value.bg === bg && value.fg === fg) break;
        await delay(25);
    }
    assert.equal(value.bg, bg, label + ' background');
    assert.equal(value.fg, fg, label + ' foreground');
    assert.equal(value.reader, 'undefined', 'core leaked into application world');
    assert.equal(value.engine, 'undefined', 'adapter leaked into application world');
    assert.equal(value.resource, 'undefined', 'resource bridge leaked into application world');
    assert.equal(value.node, 'undefined', 'Node exposed to page');
};
const load = (win, source, csp = '') => win.loadURL('data:text/html,' + encodeURIComponent(
    `<meta http-equiv="Content-Security-Policy" content="${csp}">
    <style nonce="fixture">body {background: ${source === 'light' ? '#fff' : '#000'};color:${source === 'light' ? '#000' : '#fff'}}</style><p>Coloreader</p>`));
const dark = ['rgb(35, 0, 30)', 'rgb(249, 209, 234)'];
const light = [...dark].reverse();

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    assert.ok(!process.env.LD_PRELOAD?.includes('libcoloreader.so'), 'injector inherited by Electron children');
    const childPreload = execFileSync('/usr/bin/env', {encoding: 'utf8'}).split('\n').find((line) => line.startsWith('LD_PRELOAD='));
    assert.equal(childPreload, process.env.COLOREADER_TEST_PRELOAD ? `LD_PRELOAD=${process.env.COLOREADER_TEST_PRELOAD}` : undefined, 'child preload changed');
    assert.equal(process.env.LD_PRELOAD, process.env.COLOREADER_TEST_PRELOAD, 'unrelated preload was changed');
    const windows = [undefined, 'coloreader-extra-session'].map((partition) => new BrowserWindow({show: false, webPreferences: {
        partition, sandbox: true, contextIsolation: true, nodeIntegration: false,
        backgroundThrottling: false, // keep hidden windows rendering
    }}));
    for (const win of windows) win.webContents.on('preload-error', (_event, _path, error) => console.error('PRELOAD_ERROR', error));
    await Promise.all(windows.map((win) => load(win, 'light')));
    await colors(windows[0].webContents, 'rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'before bridge');
    await command('dark');
    for (const win of windows) await colors(win.webContents, ...dark, 'dark target');
    await command('light');
    for (const win of windows) await colors(win.webContents, ...light, 'live light target');
    for (const win of windows) {
        await load(win, 'dark');
        await colors(win.webContents, ...light, 'dark source to light target');
    }
    await command('dark');
    for (const win of windows) await colors(win.webContents, ...dark, 'dark source to dark target');
    const loaded = new Promise((resolve) => windows[0].webContents.once('did-finish-load', resolve));
    windows[0].reload();
    await loaded;
    await colors(windows[0].webContents, ...dark, 'reload');
    await command('invalid');
    await delay(200);
    await colors(windows[0].webContents, ...dark, 'invalid palette retained');
    await command('reconnect-light');
    for (const win of windows) await colors(win.webContents, ...light, 'reconnect');
    await windows[0].webContents.executeJavaScript("document.body.innerHTML += '<div style=\"background:#fff;color:#000\">dynamic</div>'");
    await delay(100); // wait for the inline-style observer
    assert.equal(await windows[0].webContents.executeJavaScript('getComputedStyle(document.body.lastElementChild).backgroundColor'), light[1], 'opposite-tone dynamic inline style on a dark source canvas');
    await load(windows[0], 'dark', "default-src 'none'; script-src 'none'; style-src 'nonce-fixture'");
    await colors(windows[0].webContents, ...light, 'strict CSP');
    await windows[0].webContents.executeJavaScript(`{
        const script = document.createElement('script');
        script.textContent = 'globalThis.coloreaderCSPViolation = true';
        document.head.append(script);
    }`);
    assert.equal(await windows[0].webContents.executeJavaScript('typeof coloreaderCSPViolation'), 'undefined', 'application CSP was weakened');
    await windows[0].loadURL(process.env.COLOREADER_TEST_PAGE);
    let external;
    for (let i = 0; i < 200; i++) {
        external = await windows[0].webContents.executeJavaScript('getComputedStyle(document.querySelector(".external")).backgroundColor');
        if (external !== 'rgb(0, 0, 0)') break;
        await delay(25);
    }
    assert.notEqual(external, 'rgb(0, 0, 0)', 'cross-origin stylesheet was not recolored');
    assert.notEqual(external, light[0], 'cross-origin surface collapsed into the canvas');
    console.log(JSON.stringify({complete: true, electron: process.versions.electron}));
    app.exit(0);
}).catch((error) => { console.error(error.stack); app.exit(1); });
setTimeout(() => { console.error('fixture timeout'); app.exit(2); }, 40_000).unref();
