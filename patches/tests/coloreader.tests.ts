import './inject/support/polyfills';
import {DEFAULT_THEME} from '../src/defaults';
import type {Theme} from '../src/definitions';
import {createOrUpdateDynamicTheme, removeDynamicTheme} from '../src/inject/dynamic-theme';
import {paletteSourceColor, readPaletteSource} from '../src/coloreader/source';
import {paletteImageAction} from '../src/coloreader/images';
import {modifyBackgroundColor, modifyForegroundColor} from '../src/inject/dynamic-theme/modify-colors';
import type {ImageDetails} from '../src/inject/dynamic-theme/image';
import {parseColorWithCache, rgbToString} from '../src/utils/color';
import {timeout} from './inject/support/test-utils';

describe('COLOREADER', () => {
    const base = {...DEFAULT_THEME, darkSchemeBackgroundColor: '#182030', darkSchemeTextColor: '#e8e0d0', lightSchemeBackgroundColor: '#f0e8d8', lightSchemeTextColor: '#202830'};
    const poles = (mode: 0 | 1) => mode ? ['rgb(24, 32, 48)', 'rgb(232, 224, 208)'] : ['rgb(240, 232, 216)', 'rgb(32, 40, 48)'];
    const style = (selector: string, pseudo?: string) => getComputedStyle(document.querySelector(selector)!, pseudo);
    const rgba = (color: string) => {
        const context = document.createElement('canvas').getContext('2d')!;
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const mapped = (color: string, target: Theme, text = false) => rgbToString(parseColorWithCache((text ? modifyForegroundColor : modifyBackgroundColor)(parseColorWithCache(color)!, target, false))!);
    const render = async (theme: Theme, fixes: Parameters<typeof createOrUpdateDynamicTheme>[1] = null, wait = 100) => {
        createOrUpdateDynamicTheme(theme, fixes, false);
        await timeout(wait);
    };
    const headStyle = (css: string) => document.head.append(Object.assign(document.createElement('style'), {className: 'source', textContent: css}));

    afterEach(() => {
        removeDynamicTheme();
        document.body.innerHTML = '';
        document.body.getAttributeNames().forEach((name) => document.body.removeAttribute(name));
        document.documentElement.removeAttribute('data-source-theme');
        document.head.querySelectorAll('style.source').forEach((node) => node.remove());
        document.adoptedStyleSheets = [];
    });

    for (const mode of [0, 1] as const) {
        const [bg, fg] = poles(mode);
        it(`recolors sheets, variables, inline styles and native controls to target ${mode}`, async () => {
            document.body.style.backgroundColor = '#fff';
            document.body.innerHTML = `
                <style>
                    :root { --surface: #101418; --text: #eaecf0; color-scheme: dark; }
                    .dark { background: var(--surface); color: var(--text); }
                    .light { background: #fff; color: #000; }
                </style>
                <div class="dark">Dark source <input value="Native control"></div>
                <div class="light">Light source</div>
                <div class="inline" style="background: #000; color: #fff">Inline</div>`;
            const target = {...base, mode, paletteSourceBackground: '#ffffff'};
            await render(target);
            expect(style('.dark').backgroundColor).toBe(mapped('#101418', target));
            expect(rgba(style('.dark').color)).toEqual(rgba(mapped('#eaecf0', target, true)));
            expect(style('.dark').backgroundColor).not.toBe(bg);
            expect(style('.light').backgroundColor).toBe(bg);
            expect(style('.light').color).toBe(fg);
            expect(style('.inline').backgroundColor).toBe(mapped('#000', target));
            expect(style('.inline').color).toBe(mapped('#fff', target, true));
            expect(getComputedStyle(document.documentElement).colorScheme).toBe(mode ? 'dark' : 'light');
            document.querySelector<HTMLElement>('.inline')!.style.color = '#000';
            await timeout(100);
            expect(style('.inline').color).toBe(fg);
        });
        it(`anchors the canvas in target ${mode}`, async () => {
            document.body.style.cssText = 'background:#101418; color:#fff';
            await render({...base, mode});
            expect(style('body').backgroundColor).toBe(bg);
            expect(style('body').color).toBe(fg);
        });
        it(`finds a fixed app canvas in target ${mode}`, async () => {
            document.body.innerHTML = '<style>.app {position:fixed;inset:0;background:#0f0f0f;color:#f1f1f1}</style><main class="app">App</main>';
            await render({...base, mode, scrollbarColor: 'auto'}, null, 150);
            expect(readPaletteSource()).toBe('#0f0f0f');
            const target = {...base, mode, paletteSourceBackground: '#0f0f0f'};
            expect(style('.app').backgroundColor).toBe(bg);
            expect(style('.app').color).toBe(mapped('#f1f1f1', target, true));
            expect(style('.app', '::selection').color).toBe(bg);
            const track = modifyBackgroundColor(paletteSourceColor(parseColorWithCache('#f1f1f1')!, target), target, false);
            expect(getComputedStyle(document.documentElement).scrollbarColor.match(/rgba?\([^)]*\)/g)![1]).toBe(rgbToString(parseColorWithCache(track)!));
        });
    }

    it('keeps contrasting text on filled button links', async () => {
        document.body.innerHTML = '<style>:root {--text:#fff} .button {background:#0969da;color:var(--text)}</style><a class="button" href="#">Conference</a><button class="button">Control</button>';
        await render({...base, mode: 0, lightSchemeBackgroundColor: '#ffffff', lightSchemeTextColor: '#000000', selectionColor: '#0969da'});
        expect(rgba(style('a').color)).toEqual(rgba(style('button').color));
        expect(style('a').backgroundColor).toBe(style('button').backgroundColor);
        expect(rgba(style('a').color)).not.toEqual(rgba(style('a').backgroundColor));
    });

    it('updates the same as a fresh render', async () => {
        document.body.innerHTML = '<style>body {background:#fff;color:#000} :root {--rgb:51,51,51} .raw {color:rgb(var(--rgb))} .card {background:#ddd;color:#333;box-shadow:0 0 2px #222}</style><div class="card">Card</div><span class="raw">Raw</span><span style="color:#333">Inline</span><div id="host"></div>';
        const root = document.querySelector('#host')!.attachShadow({mode: 'open'});
        root.innerHTML = '<style>b {background: rgba(255, 255, 255, 0.25); color: #000}</style><span>Adopted</span><b>Styled</b>';
        const sheet = new CSSStyleSheet();
        sheet.replaceSync('span {background:#ddd;color:#333}');
        root.adoptedStyleSheets = [sheet];
        const elements = [document.body, document.querySelector('.card')!, document.querySelector('.raw')!, document.querySelector('span[style]')!, root.querySelector('span')!, root.querySelector('b')!];
        const colors = () => elements.map((element) => {
            const {backgroundColor, color, boxShadow} = getComputedStyle(element);
            return [backgroundColor, color, boxShadow];
        });
        await render(base);
        for (const mode of [0, 1, 0, 0, 1] as const) {
            const target = {...base, mode, lightSchemeBackgroundColor: '#fff5eb', lightSchemeTextColor: '#402a00'};
            createOrUpdateDynamicTheme({...target, darkSchemeBackgroundColor: '#102030'}, null, false);
            await render(target);
            const updated = colors();
            removeDynamicTheme();
            await render(target);
            expect(updated).withContext(`target ${mode}`).toEqual(colors());
            expect(root.adoptedStyleSheets.length).toBe(2);
        }
    });

    it('releases the canvas when palette mode is off', async () => {
        document.body.style.cssText = 'background:#ccc; color:#000';
        await render(base);
        expect(style('body').backgroundColor).toBe('rgb(24, 32, 48)');
        const target = {...base, paletteMode: false};
        await render(target);
        expect(style('body').backgroundColor).toBe(mapped('#ccc', target));
        expect(style('body').backgroundColor).not.toBe('rgb(24, 32, 48)');
    });

    let adopted: CSSStyleSheet;
    const canvasChanges: Array<[string, () => void, () => void, string]> = [
        ['a root attribute', () => {
            document.body.innerHTML += '<style>:root[data-source-theme] body {background:#0f0f0f}</style>';
        }, () => document.documentElement.setAttribute('data-source-theme', 'night'), '#0f0f0f'],
        ['an inserted stylesheet', () => {}, () => headStyle('body {background:#0f0f0f}'), '#0f0f0f'],
        ['a CSSOM edit', () => headStyle('body {background:#fff}'), () => {
            const sheet = document.querySelector<HTMLStyleElement>('style.source')!.sheet!;
            sheet.deleteRule(0);
            sheet.insertRule('body {background:#0f0f0f}');
        }, '#0f0f0f'],
        ['an adopted stylesheet', () => {}, () => adopted.replaceSync('.adopted {color:#333} body {background:#0f0f0f}'), '#0f0f0f'],
        ['an app leaving the viewport', () => {
            document.body.innerHTML += '<main style="position:fixed;inset:0;background:#0f0f0f">App</main>';
        }, () => {
            document.querySelector<HTMLElement>('main')!.style.transform = 'translateX(200vw)';
        }, '#ffffff'],
    ];
    for (const [name, setup, change, canvas] of canvasChanges) {
        it(`follows the canvas after ${name}`, async () => {
            document.body.innerHTML = '<style>:root {--rgb:51,51,51} .sheet {color:#333} .raw {color:rgb(var(--rgb))}</style><span class="sheet">Sheet</span><span class="raw">Raw</span><span class="inline" style="color:#333">Inline</span><span class="adopted">Adopted</span>';
            adopted = new CSSStyleSheet();
            adopted.replaceSync('.adopted {color:#333}');
            document.adoptedStyleSheets = [adopted];
            setup();
            await render({...base, mode: 0});
            change();
            await timeout(200);
            expect(readPaletteSource()).toBe(canvas);
            const expected = mapped('#333', {...base, mode: 0, paletteSourceBackground: canvas}, true);
            for (const selector of ['.sheet', '.raw', '.inline', '.adopted']) {
                expect(style(selector).color).withContext(selector).toBe(expected);
            }
            removeDynamicTheme();
            expect(style('.inline').color).toBe('rgb(51, 51, 51)');
        });
    }

    it('maps fix templates from a white plane', async () => {
        document.body.style.cssText = 'background:#0f0f0f;color:#f1f1f1';
        document.body.innerHTML = '<div class="fixed">Fixed surface</div>';
        const fix = {
            url: ['*'], invert: [], ignoreInlineStyle: [], ignoreImageAnalysis: [], ignoreCSSUrl: [],
            disableStyleSheetsProxy: false, disableCustomElementRegistryProxy: false,
            css: '.fixed {background:${#ffffff} !important;color:${#000000} !important}',
        };
        await render({...base, mode: 0}, [fix]);
        expect(style('.fixed').backgroundColor).toBe('rgb(240, 232, 216)');
        expect(style('.fixed').color).toBe('rgb(32, 40, 48)');
    });

    it('reads a translucent canvas without enabling disabled sheets', () => {
        document.body.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        const sheet = document.createElement('style');
        sheet.className = 'darkreader';
        sheet.textContent = 'body {background:white !important}';
        document.head.append(sheet);
        sheet.sheet!.disabled = true;
        expect(readPaletteSource()).toBe('#808080');
        expect(sheet.sheet!.disabled).toBe(true);
        sheet.remove();
    });

    it('inverts small icons and keeps photos', () => {
        const icon: ImageDetails = {src: '', dataURL: '', width: 16, height: 16, isDark: true, isLight: false, isTransparent: true, isLarge: false, useViewBox: false};
        expect(paletteImageAction(icon, 1)).toBe('invert');
        expect(paletteImageAction(icon, 0)).toBe('keep');
        const whiteIcon = {...icon, isDark: false, isLight: true};
        expect(paletteImageAction(whiteIcon, 0)).toBe('invert');
        expect(paletteImageAction(whiteIcon, 1)).toBe('keep');
        expect(paletteImageAction({...whiteIcon, isLarge: true, isTransparent: false}, 1)).toBe('keep');
        expect(paletteImageAction({...icon, isTransparent: false, solidColor: {r: 0, g: 0, b: 0, a: 1}}, 0)).toBe('solid');
    });
});
