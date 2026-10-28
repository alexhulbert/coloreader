const {contextBridge, ipcRenderer, webFrame} = require('electron');
const channel = __COLOREADER_CHANNEL__;
const world = 76321;
webFrame.setIsolatedWorldInfo(world, {name: 'Coloreader', securityOrigin: location.href, csp: ''});
if (process.contextIsolated) {
    contextBridge.exposeInIsolatedWorld(world, '__coloreaderResource', {fetch: (url) => ipcRenderer.invoke(channel + ':fetch', url)});
}
let queue = Promise.resolve();
let pendingTheme;
let updateQueued = false;
const run = (getCode) => {
    queue = queue.then(() => webFrame.executeJavaScriptInIsolatedWorld(world, [{code: getCode()}])).catch(() => {});
};
const update = (theme) => `globalThis.__coloreaderInjector?.update(${JSON.stringify(theme)});`;
ipcRenderer.on(channel, (_event, theme) => {
    pendingTheme = theme;
    if (updateQueued) return;
    updateQueued = true;
    run(() => {
        updateQueued = false;
        return update(pendingTheme);
    });
});
const start = () => ipcRenderer.invoke(channel).then((payload) => {
    if (payload) run(() => payload.script + '\n' + update(payload.theme));
});
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {once: true});
} else {
    start();
}
