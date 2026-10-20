import {parseBridgePalette} from '../patches/src/coloreader/bridge.ts';
import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {readLimited} from './http.mjs';

export function documentScript(core) {
    return `(() => {
        const module = {exports: {}};
        const exports = module.exports;
        ${core}
        // Electron apps use localhost and custom ports, which the core normally rejects.
        // Use the plugin hook, with main-process fetch as a fallback for CORS failures.
        globalThis.DarkReader = {Plugins: {fetch: async ({url, responseType, mimeType}) => {
            const response = await fetch(url).catch(async () => {
                const {data, mime} = await globalThis.__coloreaderResource.fetch(url);
                return new Response(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)), {headers: {'Content-Type': mime}});
            });
            if (!response.ok) throw new Error('Resource request failed');
            const mime = response.headers.get('content-type') ?? '';
            if (mimeType && !mime.toLowerCase().startsWith(mimeType)) throw new Error('Resource MIME type mismatch');
            if (responseType !== 'data-url') return response.text();
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });
        }}};
        // Theme hidden windows before they appear.
        globalThis.__coloreaderInjector = {update(theme) { if (theme) module.exports.enable({...theme, immediateModify: true}); }};
    })();`;
}

export function startElectronInjector(core, renderer, {app, ipcMain, nativeTheme, webContents}, scripts) {
    const channel = `coloreader:${randomUUID()}`;
    const directory = fs.mkdtempSync(join(process.env.XDG_RUNTIME_DIR || tmpdir(), 'coloreader-'));
    const preload = join(directory, 'preload.cjs');
    let userscript = '';
    try {
        const {name} = JSON.parse(fs.readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'));
        const path = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'coloreader', `${name}.js`);
        const source = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : scripts[name];
        if (source) userscript = `\nif (process.isMainFrame) webFrame.executeJavaScript(${JSON.stringify(source)}).catch(console.error);`;
    } catch (error) {
        console.error('[coloreader] userscript', error);
    }
    fs.writeFileSync(preload, renderer.replace('__COLOREADER_CHANNEL__', JSON.stringify(channel)) + userscript);
    process.once('exit', () => fs.rmSync(directory, {recursive: true, force: true}));
    const script = documentScript(core);
    let palette = null;
    let sent;
    const theme = () => palette && {...palette, paletteMode: true, mode: palette.mode ?? (nativeTheme.shouldUseDarkColors ? 1 : 0)};
    const broadcast = () => {
        const current = theme();
        const encoded = JSON.stringify(current);
        if (!current || encoded === sent) return;
        sent = encoded;
        for (const wc of webContents.getAllWebContents()) wc.send(channel, current);
    };
    app.on('session-created', (ses) => ses.registerPreloadScript({type: 'frame', filePath: preload}));
    nativeTheme.on('updated', broadcast);
    ipcMain.handle(channel, (event) => event.sender.getURL().startsWith('devtools:') ? null : {script, theme: theme()});
    // Fetch CSS and images without cookies or redirects.
    ipcMain.handle(channel + ':fetch', async (event, url) => {
        if (!/^https?:\/\//.test(url)) throw new Error('Unsupported resource URL');
        const response = await event.sender.session.fetch(url, {credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15_000)});
        const mime = response.headers.get('content-type') ?? '';
        if (!response.ok || !/^(text\/css|image\/)/i.test(mime)) throw new Error('Unsupported resource response');
        const data = await readLimited(response, 4 * 1024 * 1024);
        return {data: data.toString('base64'), mime};
    });

    let delay = 1000;
    const connect = () => {
        const ws = new WebSocket(`ws://127.0.0.1:${process.env.COLOREADER_BRIDGE_PORT ?? 7521}`);
        ws.onmessage = ({data}) => {
            let next = null;
            try { next = parseBridgePalette(JSON.parse(data)); } catch {}
            if (!next) { ws.close(); return; }
            delay = 1000;
            palette = next;
            broadcast();
        };
        ws.onclose = () => {
            setTimeout(connect, delay);
            delay = Math.min(delay * 2, 30_000);
        };
    };
    app.whenReady().then(connect);
}
