import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';
import ChromeExtension from 'crx';
import {root, upstream, distribution} from './upstream.mjs';
import {buildInjector, output as injectorOutput} from '../electron-injector/build.mjs';

const artifacts = resolve(root, 'artifacts');
const state = resolve(root, '.work/release.json');
const releases = `https://github.com/${distribution.repository}/releases`;
const staging = (platform) => resolve(root, '.work/package', platform);
const zip = (archive, directory) => execFileSync('zip', ['-qr', archive, '.'], {cwd: directory});

// Edit a staged copy so the build output stays reusable.
async function stage(platform, build, version, edit) {
    const extension = resolve(staging(platform), 'extension');
    await rm(staging(platform), {recursive: true, force: true});
    await cp(resolve(upstream, 'build/release', build), extension, {recursive: true});
    const manifest = {...JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')), version};
    edit(manifest);
    await writeFile(resolve(extension, 'manifest.json'), `${JSON.stringify(manifest, null, 4)}\n`);
    return manifest;
}

async function packageFirefox(version) {
    const manifest = await stage('firefox', 'firefox', version, (manifest) => {
        manifest.browser_specific_settings.gecko = {
            ...manifest.browser_specific_settings.gecko,
            id: distribution.firefoxId,
            update_url: `${releases}/latest/download/updates.json`,
            data_collection_permissions: {required: ['none']},
        };
    });
    zip(resolve(artifacts, `coloreader-firefox-${version}-unsigned.xpi`), resolve(staging('firefox'), 'extension'));

    // Include the patched source so Mozilla can rebuild the XPI.
    const source = resolve(staging('firefox'), 'source/darkreader');
    const patches = resolve(root, 'patches');
    const list = (...args) => execFileSync('git', ['ls-files', '-z', ...args], {cwd: upstream, encoding: 'utf8'}).split('\0').filter(Boolean);
    const files = new Set([
        ...list(),
        ...list('--others', '--exclude-standard', '--', 'src'),
        ...(await readdir(patches, {recursive: true, withFileTypes: true})).filter((entry) => entry.isFile()).map((entry) => relative(patches, resolve(entry.parentPath, entry.name))),
    ]);
    for (const file of files) {
        await mkdir(dirname(resolve(source, file)), {recursive: true});
        await cp(resolve(upstream, file), resolve(source, file));
    }
    for (const name of ['manifest.json', 'manifest-firefox.json']) {
        const path = resolve(source, 'src', name);
        const original = JSON.parse(await readFile(path, 'utf8'));
        await writeFile(path, `${JSON.stringify({...original, version, ...(name === 'manifest-firefox.json' && {browser_specific_settings: manifest.browser_specific_settings})}, null, 4)}\n`);
    }
    await writeFile(resolve(staging('firefox'), 'source/BUILD.txt'), `Coloreader ${version}\nNode.js 24, npm, Git.\n\ncd darkreader\nnpm ci --ignore-scripts\nnode tasks/build.js --release --firefox\n\nOutput: build/release/darkreader-firefox.xpi\n`);
    zip(resolve(artifacts, `coloreader-firefox-${version}-source.zip`), resolve(staging('firefox'), 'source'));
    return manifest;
}

async function packageChrome(version) {
    const manifest = await stage('chrome', 'chrome-mv3', version, (manifest) => {
        manifest.update_url = `${releases}/latest/download/updates.xml`;
    });
    zip(resolve(artifacts, `coloreader-chrome-${version}.zip`), resolve(staging('chrome'), 'extension'));
    return manifest;
}

async function packageAll() {
    const now = new Date();
    const version = process.env.COLOREADER_VERSION ?? [
        now.getUTCFullYear(),
        (now.getUTCMonth() + 1) * 100 + now.getUTCDate(),
        now.getUTCHours() * 60 + now.getUTCMinutes(),
        now.getUTCSeconds() * 100 + Number(process.env.GITHUB_RUN_ATTEMPT ?? 1),
    ].join('.');
    await mkdir(artifacts, {recursive: true});
    const manifests = {chrome: await packageChrome(version), firefox: await packageFirefox(version)};
    if (process.platform === 'linux' && process.arch === 'x64') {
        manifests.electron = await buildInjector({version, buildAPI: false});
        await cp(resolve(injectorOutput, 'libcoloreader.so'), resolve(artifacts, `coloreader-electron-linux-x64-${version}.so`));
        await cp(resolve(injectorOutput, 'injector.cjs'), resolve(artifacts, `coloreader-electron-${version}.cjs`));
        await cp(resolve(injectorOutput, 'electron-injector.json'), resolve(artifacts, 'electron-injector.json'));
    }
    await writeFile(state, JSON.stringify({version, manifests}));
    console.log(version);
}

// Package the signed extensions and write the release feeds.
async function updates() {
    const {version, manifests} = JSON.parse(await readFile(state, 'utf8'));
    const out = resolve(artifacts, 'release');
    const asset = (file) => `${releases}/download/coloreader-v${version}/${file}`;
    await rm(out, {recursive: true, force: true});
    await mkdir(out, {recursive: true});

    // The Chrome signing key also determines its extension ID.
    assert.ok(process.env.CHROME_EXTENSION_KEY, 'CHROME_EXTENSION_KEY must hold the PEM private key');
    const chrome = new ChromeExtension({privateKey: process.env.CHROME_EXTENSION_KEY, codebase: asset(`coloreader-chrome-${version}.crx`)});
    await chrome.load(resolve(staging('chrome'), 'extension'));
    await writeFile(resolve(out, `coloreader-chrome-${version}.crx`), await chrome.pack());
    await writeFile(resolve(out, 'updates.xml'), chrome.generateUpdateXML());
    await cp(resolve(artifacts, `coloreader-chrome-${version}.zip`), resolve(out, `coloreader-chrome-${version}.zip`));
    if (manifests.electron) {
        await cp(resolve(artifacts, `coloreader-electron-linux-x64-${version}.so`), resolve(out, `coloreader-electron-linux-x64-${version}.so`));
        await cp(resolve(artifacts, `coloreader-electron-${version}.cjs`), resolve(out, `coloreader-electron-${version}.cjs`));
        await cp(resolve(artifacts, 'electron-injector.json'), resolve(out, 'electron-injector.json'));
    }

    // Check Mozilla's signed package against the staged manifest.
    const signed = resolve(artifacts, 'signed/firefox');
    const [name, ...more] = (await readdir(signed)).filter((file) => file.endsWith('.xpi'));
    assert.ok(name && !more.length, 'Expected one signed Firefox XPI');
    const xpi = resolve(signed, name);
    const manifest = JSON.parse(execFileSync('unzip', ['-p', xpi, 'manifest.json'], {encoding: 'utf8'}));
    assert.deepEqual(manifest, manifests.firefox, 'Signed manifest differs from the packaged build');
    assert.match(execFileSync('unzip', ['-Z1', xpi], {encoding: 'utf8'}), /META-INF\/mozilla\.rsa/);
    const data = await readFile(xpi);
    const file = `coloreader-firefox-${version}.xpi`;
    await writeFile(resolve(out, file), data);
    const feed = {addons: {
        [manifest.browser_specific_settings.gecko.id]: {updates: [{
            version,
            update_link: asset(file),
            update_hash: `sha256:${createHash('sha256').update(data).digest('hex')}`,
            applications: {gecko: {strict_min_version: manifest.browser_specific_settings.gecko.strict_min_version}},
        }]},
    }};
    await writeFile(resolve(out, 'updates.json'), `${JSON.stringify(feed, null, 2)}\n`);
}

const command = {package: packageAll, updates}[process.argv[2]];
assert.ok(command, 'Usage: node scripts/release.mjs package | updates');
await command();
