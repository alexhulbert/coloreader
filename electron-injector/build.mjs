import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {createRequire, stripTypeScriptTypes} from 'node:module';
import {resolve} from 'node:path';
import {root, upstream, distribution} from '../scripts/upstream.mjs';

export const output = resolve(root, '.work/electron-injector');

export async function buildInjector({version = process.env.COLOREADER_VERSION ?? '0.0.0.0', buildAPI = true} = {}) {
    if (buildAPI) execFileSync(process.execPath, ['tasks/build.js', '--api'], {cwd: upstream, stdio: 'inherit'});
    const {rollup} = createRequire(resolve(upstream, 'package.json'))('rollup');
    const compile = async (entry) => {
        const bundle = await rollup({
            input: resolve(root, 'electron-injector', entry),
            external: (id) => id.startsWith('node:'),
            onwarn: (warning) => { throw new Error(warning.message); },
            plugins: [{name: 'strip-types', transform: (code, id) => id.endsWith('.ts') ? stripTypeScriptTypes(code) : null}],
        });
        try { return (await bundle.generate({format: 'cjs'})).output[0].code; }
        finally { await bundle.close(); }
    };
    const core = await readFile(resolve(upstream, 'darkreader.js'), 'utf8');
    const renderer = await readFile(resolve(root, 'electron-injector/renderer.cjs'), 'utf8');
    const payload = `${await compile('main.mjs')}
exports.version = ${JSON.stringify(version)};
exports.start = (require) => exports.startElectronInjector(${JSON.stringify(core)}, ${JSON.stringify(renderer)}, require('electron'));`;
    const bootstrap = `(() => { try {
    const require = process.getBuiltinModule('module').createRequire(process.execPath);
    const load = (define) => { const module = {exports: {}}; define(require, module, module.exports); return module.exports; };
    load((require, module, exports) => {${await compile('bootstrap.mjs')}
    }).boot(${JSON.stringify(distribution.repository)}, load((require, module, exports) => {${payload}
    }), require);
} catch (error) { if (process.env.COLOREADER_DEBUG === '1') console.error('[coloreader]', error); } })();`;
    await mkdir(output, {recursive: true});
    await writeFile(resolve(output, 'injector.cjs'), payload);
    await writeFile(resolve(output, 'payload.h'), `static const char coloreader_payload[] = ${JSON.stringify(bootstrap)};\n`);
    // Truncating the old file could crash an app that has it mapped.
    execFileSync(process.env.CC ?? 'cc', ['-shared', '-fPIC', '-O2', '-Wall', '-Wextra', '-Werror', '-I', output,
        '-o', resolve(output, 'libcoloreader.so.tmp'), resolve(root, 'electron-injector/injector.c')], {stdio: 'inherit'});
    await rename(resolve(output, 'libcoloreader.so.tmp'), resolve(output, 'libcoloreader.so'));
    const manifest = {version, sha256: createHash('sha256').update(payload).digest('hex')};
    await writeFile(resolve(output, 'electron-injector.json'), JSON.stringify(manifest) + '\n');
    console.log(`Built ${output}/libcoloreader.so (${version})`);
    return manifest;
}

if (import.meta.main) await buildInjector();
