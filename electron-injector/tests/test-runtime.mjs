import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {createServer} from 'node:http';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = await fs.readFile(join(root, '.work/electron-injector/injector.cjs'));
const manifest = JSON.parse(await fs.readFile(join(root, '.work/electron-injector/electron-injector.json'), 'utf8'));
const source = resolve(process.env.ELECTRON_BIN ?? '/usr/lib/electron39/electron');
const mode = process.env.TEST_CACHED; // '1' cached, 'broken' corrupt cache, 'update' download, else embedded
const directory = await fs.mkdtemp(join(tmpdir(), 'coloreader-runtime-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const palette = (mode) => ({v: 1, mode, bgDark: '#23001e', fgDark: '#f9d1ea', bgLight: '#f9d1ea', fgLight: '#23001e', accent: '#e79bea'});

// Serve the update feed, stylesheet and palette bridge from one local port.
let downloads = 0;
let connections = 0;
let current = null;
const peers = new Set();
const server = createServer((request, response) => {
    if (request.url.endsWith('.json') || request.url.endsWith('.cjs')) {
        downloads++;
        response.end(request.url.endsWith('.cjs') ? bundle : JSON.stringify(manifest));
    } else if (request.url.endsWith('.css')) {
        response.writeHead(200, {'Content-Type': 'text/css'});
        response.end('.external {background: #000; color: #fff}');
    } else {
        response.writeHead(200, {'Content-Type': 'text/html'});
        response.end(`<link rel="stylesheet" href="${base}/asset.css"><div class="external">External CSS without CORS</div>`);
    }
});
const send = (socket, value) => {
    const data = Buffer.from(JSON.stringify(value));
    const header = data.length < 126 ? Buffer.from([0x81, data.length]) : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
    socket.write(Buffer.concat([header, data]));
};
server.on('upgrade', (request, socket) => {
    assert.equal(request.headers.origin, undefined, 'native WebSocket sends an Origin header');
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    connections++;
    peers.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => peers.delete(socket));
    socket.on('data', () => socket.destroy()); // this client only sends close frames
    if (current) send(socket, current);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let child;
try {
    // Give the copied binary a test app instead of its real resources.
    const runtime = join(directory, 'runtime');
    await fs.mkdir(join(runtime, 'resources/app'), {recursive: true});
    for (const name of await fs.readdir(dirname(source))) {
        if (name !== 'resources' && name !== basename(source)) await fs.symlink(join(dirname(source), name), join(runtime, name));
    }
    await fs.copyFile(source, join(runtime, basename(source)), fs.constants.COPYFILE_FICLONE);
    await fs.writeFile(join(runtime, 'resources/app/package.json'), '{"name": "coloreader-fixture", "main": "main.cjs"}');
    await fs.copyFile(join(root, 'electron-injector/tests/fixture.cjs'), join(runtime, 'resources/app/main.cjs'));
    const cache = join(directory, 'cache');
    const cached = join(cache, 'coloreader/electron-injector');
    if (mode === '1' || mode === 'broken') {
        await fs.mkdir(cached, {recursive: true});
        await fs.writeFile(join(cached, 'injector.cjs'), mode === '1' ? bundle : 'throw new Error("corrupt cache must not execute")');
        await fs.writeFile(join(cached, 'update.json'), JSON.stringify({...manifest, checkedAt: Date.now()}));
    }
    const runtimeDir = join(directory, 'xdg-runtime');
    await fs.mkdir(runtimeDir);
    const library = process.env.COLOREADER_TEST_LIBRARY ?? join(root, '.work/electron-injector/libcoloreader.so');
    const env = {...process.env, LD_PRELOAD: library + (process.env.COLOREADER_TEST_PRELOAD ? ':' + process.env.COLOREADER_TEST_PRELOAD : ''), COLOREADER_DEBUG: '1',
        COLOREADER_UPDATES: mode === 'update' ? '1' : '0', COLOREADER_UPDATE_BASE: base, COLOREADER_BRIDGE_PORT: String(server.address().port),
        COLOREADER_TEST_PAGE: `http://localhost:${server.address().port}/page`, XDG_CACHE_HOME: cache, XDG_RUNTIME_DIR: runtimeDir};
    child = spawn(join(runtime, basename(source)), [`--user-data-dir=${join(directory, 'profile')}`, '--disable-gpu', '--disable-dev-shm-usage', `--ozone-platform=${process.env.COLOREADER_TEST_PLATFORM ?? 'x11'}`],
        {env, detached: true});
    let exited = false;
    let errors = '';
    let complete;
    child.once('exit', () => { exited = true; });
    child.stderr.on('data', (data) => { errors += data; });
    const until = async (condition) => { while (!condition() && !exited) await sleep(25); };
    const lines = readline.createInterface({input: child.stdout});
    lines.on('line', async (line) => {
        const event = JSON.parse(line);
        if (event.complete) { complete = event; return; }
        const before = connections;
        await until(() => peers.size);
        if (event.command === 'invalid') for (const peer of peers) send(peer, {...palette('dark'), bgDark: 'url(bad)'});
        else if (event.command === 'reconnect-light') { current = palette('light'); for (const peer of peers) peer.destroy(); }
        else { current = palette(event.command); for (const peer of peers) send(peer, current); }
        if (['invalid', 'reconnect-light'].includes(event.command)) await until(() => connections > before);
        child.stdin.write('\n');
    });
    const [[code]] = await Promise.all([once(child, 'exit'), once(lines, 'close')]);
    assert.equal(code, 0, errors);
    assert.ok(complete, errors);
    assert.equal(connections, 3, 'one initial bridge connection, invalid-message reconnect, forced reconnect');
    assert.deepEqual((await fs.readdir(runtimeDir)).filter((name) => name.startsWith('coloreader-')), [], 'temporary preload files leaked');
    assert.match(errors, mode === '1' ? /using cached bundle/ : /using embedded bundle/);
    if (mode === 'broken') assert.match(errors, /checksum mismatch/);
    assert.equal(downloads, mode === 'update' ? 2 : 0, 'unexpected update downloads');
    if (mode === 'update') assert.deepEqual(await fs.readFile(join(cached, 'injector.cjs')), bundle);
    console.log(JSON.stringify({...complete, connections, downloads, mode}));
} finally {
    if (child?.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    for (const peer of peers) peer.destroy();
    server.closeAllConnections();
    server.close();
    await fs.rm(directory, {recursive: true, force: true});
}
