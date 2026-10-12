const {contextBridge, ipcRenderer, webFrame} = require('electron');
const channel = __COLOREADER_CHANNEL__;
const world = 76321;
webFrame.setIsolatedWorldInfo(world, {name: 'Coloreader', securityOrigin: location.href, csp: ''});
if (process.contextIsolated) {
    contextBridge.exposeInIsolatedWorld(world, '__coloreaderResource', {fetch: (url) => ipcRenderer.invoke(channel + ':fetch', url)});
}
let queue = Promise.resolve();
const run = (code) => {
    queue = queue.then(() => webFrame.executeJavaScriptInIsolatedWorld(world, [{code}])).catch(() => {});
};
const update = (theme) => `globalThis.__coloreaderInjector?.update(${JSON.stringify(theme)});`;
ipcRenderer.on(channel, (_event, theme) => run(update(theme)));
const start = () => ipcRenderer.invoke(channel).then((payload) => {
    if (payload) run(payload.script + '\n' + update(payload.theme));
});
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {once: true});
} else {
    start();
}
