import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {cp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {QueryBuilder} from '@getgrit/gritql';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const upstream = resolve(root, '.work/darkreader');
export const {coloreader: distribution} = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const pin = resolve(root, 'upstream.json');
const patterns = readFileSync(resolve(root, 'patches/integration.grit'), 'utf8');
// Keep Grit's downloaded library under .work too.
process.env.GRIT_GLOBAL_DIR ??= resolve(root, '.work/grit');

// Apply these patterns in order; a missed match fails the build.
const patches = {
    'src/defaults.ts': ['default_theme', 'default_settings'],
    'src/definitions.d.ts': ['theme_type'],
    'src/utils/validation.ts': ['validate_palette'],
    'src/inject/dynamic-theme/modify-colors.ts': ['color_import', 'palette_color_cache_keys', 'palette_color_context', 'background_color', 'foreground_color', 'border_color', 'shadow_color'],
    'src/inject/dynamic-theme/modify-css.ts': ['image_import', 'native_controls', 'native_control_scheme', 'canvas_color', 'link_color', 'css_color_scheme', 'scrollbar_thumb', 'palette_default_colors', 'background_images'],
    'src/inject/dynamic-theme/adopted-style-manger.ts': ['palette_adopted_cleanup'],
    'src/inject/dynamic-theme/stylesheet-modifier.ts': ['variable_rule_update', 'variable_rule_properties'],
    'src/inject/dynamic-theme/inline-style.ts': ['inline_svg', 'inline_cache_keys', 'inline_cache_invalidation'],
    'src/inject/dynamic-theme/index.ts': ['palette_cache_without_fixes', 'palette_render_updates', 'pdf_overlay_target', 'palette_source_import', 'site_fixes_extension', 'palette_source_theme', 'palette_source_watch', 'palette_source_stop', 'palette_adopted_rebuild', 'palette_neutral_background', 'palette_neutral_text', 'palette_template_colors'],
    'src/api/index.ts': ['site_fixes_api'],
    'src/background/extension.ts': ['integration_import', 'start_palette', 'browser_colors', 'browser_light_target', 'pdf_target'],
    'src/background/window-theme.ts': ['browser_palette_import', 'browser_palette_colors'],
    'src/stubs/utils/theme.ts': ['stub_imports'],
};

const git = (...args) => execFileSync('git', args, {cwd: upstream, encoding: 'utf8'});
const show = (commit, path) => process.env.COLOREADER_UPSTREAM_SOURCE
    ? readFileSync(resolve(process.env.COLOREADER_UPSTREAM_SOURCE, path), 'utf8')
    : git('show', `${commit}:${path}`);

export async function readSiteFixes(extension) {
    const directory = resolve(root, 'site-fixes');
    return Promise.all((await readdir(directory)).filter((name) => name.endsWith(extension)).sort().map(async (name) => {
        const source = await readFile(resolve(directory, name), 'utf8');
        const values = (key) => Array.from(source.matchAll(new RegExp(`^//\\s*@${key}\\s+(\\S+)`, 'gm')), (match) => match[1]);
        return {name, source, matches: values('match'), electron: values('electron')};
    }));
}

// Build the patched files in memory before writing the checkout.
async function generate(commit) {
    const {ESLint} = createRequire(resolve(upstream, 'package.json'))('eslint');
    const eslint = new ESLint({cwd: upstream, fix: true});
    const files = new Map();
    const lint = async (path, content) => {
        const [result] = await eslint.lintText(content, {filePath: resolve(upstream, path)});
        assert.equal(result.errorCount, 0, `${path}: patched code fails lint\n${JSON.stringify(result.messages, null, 2)}`);
        files.set(path, result.output ?? content);
    };
    for (const [path, names] of Object.entries(patches)) {
        let content = show(commit, path);
        for (const name of names) {
            const result = await new QueryBuilder(`${patterns}\n${name}()`).applyToFile({path, content});
            assert.ok(result, `${path}: ${name} matched nothing`);
            content = result.content;
        }
        await lint(path, content);
    }
    const configs = (await readSiteFixes('.config')).map((fix) => fix.source);
    await lint('src/coloreader/site-fixes.config.ts', `export default ${JSON.stringify(configs.join('\n\n================================\n\n'))};\n`);
    const scripts = (await readSiteFixes('.js')).filter((script) => script.matches.length);
    for (const script of scripts) {
        files.set(`src/config/coloreader/${script.name}`, script.source);
    }
    const manifests = {};
    for (const name of ['manifest.json', 'manifest-firefox.json', 'manifest-chrome-mv3.json']) {
        const manifest = manifests[name] = JSON.parse(show(commit, `src/${name}`));
        manifest.content_scripts = manifest.content_scripts
            .map((script) => ({...script, js: script.js.filter((file) => file !== 'inject/fallback.js')}))
            .filter((script) => script.js.length);
        manifest.content_scripts.unshift(...scripts.map((script) => ({matches: script.matches, js: [`config/coloreader/${script.name}`], run_at: 'document_start', world: 'MAIN'})));
    }
    manifests['manifest.json'].name = manifests['manifest.json'].browser_action.default_title = 'Coloreader';
    manifests['manifest.json'].description = 'Theme websites with your system palette. Based on Dark Reader.';
    manifests['manifest-chrome-mv3.json'].action.default_title = 'Coloreader';
    manifests['manifest-firefox.json'].browser_specific_settings.gecko.id = distribution.firefoxId;
    manifests['manifest-firefox.json'].browser_specific_settings.gecko.strict_min_version = '128.0';
    manifests['manifest-chrome-mv3.json'].minimum_chrome_version = '111.0.0.0';
    for (const [name, manifest] of Object.entries(manifests)) {
        files.set(`src/${name}`, `${JSON.stringify(manifest, null, 4)}\n`);
    }
    return files;
}

// Start from the pinned originals so repeated patching gives the same result.
async function patch(commit) {
    const files = await generate(commit);
    await rm(resolve(upstream, 'src/config/coloreader'), {recursive: true, force: true});
    await mkdir(resolve(upstream, 'src/config/coloreader'), {recursive: true});
    await cp(resolve(root, 'patches'), upstream, {recursive: true});
    for (const [path, content] of files) {
        await writeFile(resolve(upstream, path), content);
    }
    console.log(`Patched ${files.size} files at ${commit}`);
}

// Recreate the disposable checkout from the pinned or latest stable release.
async function prepare(latest) {
    const previous = JSON.parse(await readFile(pin, 'utf8'));
    const state = {...previous};
    if (latest) {
        const headers = {Accept: 'application/vnd.github+json', 'User-Agent': 'coloreader'};
        if (process.env.GH_TOKEN) {
            headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
        }
        const response = await fetch('https://api.github.com/repos/darkreader/darkreader/releases/latest', {headers, signal: AbortSignal.timeout(30_000)});
        assert.ok(response.ok, `Release lookup failed: ${response.status}`);
        state.tag = (await response.json()).tag_name;
    }
    assert.match(state.tag, /^v\d+\.\d+\.\d+$/);
    await rm(upstream, {recursive: true, force: true});
    await mkdir(upstream, {recursive: true});
    git('init', '--quiet');
    git('fetch', '--quiet', '--depth=1', state.repository, `refs/tags/${state.tag}`);
    state.commit = git('rev-parse', 'FETCH_HEAD^{commit}').trim();
    if (state.tag === previous.tag) {
        assert.equal(state.commit, previous.commit, 'The pinned tag moved; refusing to build it');
    }
    git('checkout', '--quiet', '--detach', state.commit);
    execFileSync('npm', ['ci', '--ignore-scripts'], {cwd: upstream, stdio: 'inherit'});
    await patch(state.commit);
    await writeFile(pin, `${JSON.stringify(state, null, 2)}\n`);
}

if (import.meta.main) {
    const [command, flag] = process.argv.slice(2);
    if (command === 'prepare') {
        await prepare(flag === '--latest');
    } else if (command === 'patch') {
        await patch(JSON.parse(await readFile(pin, 'utf8')).commit);
    } else {
        throw new Error('Usage: node scripts/upstream.mjs prepare [--latest] | patch');
    }
}
