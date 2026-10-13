import './inject/support/polyfills';
import {DEFAULT_THEME} from '../src/defaults';
import {createOrUpdateDynamicTheme, removeDynamicTheme} from '../src/inject/dynamic-theme';
import {paletteImageAction} from '../src/coloreader/images';
import {modifyBackgroundColor, modifyForegroundColor} from '../src/inject/dynamic-theme/modify-colors';
import type {ImageDetails} from '../src/inject/dynamic-theme/image';
import {parseColorWithCache, rgbToString} from '../src/utils/color';
import {timeout} from './inject/support/test-utils';

describe('COLOREADER', () => {
    const base = {...DEFAULT_THEME, darkSchemeBackgroundColor: '#182030', darkSchemeTextColor: '#e8e0d0', lightSchemeBackgroundColor: '#f0e8d8', lightSchemeTextColor: '#202830'};
    afterEach(() => {
        removeDynamicTheme();
        document.body.innerHTML = '';
        document.body.removeAttribute('style');
    });
    for (const mode of [0, 1] as const) {
        it(`recolors mixed surfaces, variables, inline styles and native controls to target ${mode}`, async () => {
            document.body.innerHTML = `
                <style>
                    :root { --surface: #101418; --text: #eaecf0; color-scheme: dark; }
                    .dark { background: var(--surface); color: var(--text); }
                    .light { background: #fff; color: #000; }
                </style>
                <div class="dark">Dark source <input value="Native control"></div>
                <div class="light">Light source</div>
                <div class="inline" style="background: #000; color: #fff">Inline</div>`;
            const target = {...base, mode};
            createOrUpdateDynamicTheme(target, null, false);
            await timeout(100);
            const bg = mode ? 'rgb(24, 32, 48)' : 'rgb(240, 232, 216)';
            const fg = mode ? 'rgb(232, 224, 208)' : 'rgb(32, 40, 48)';
            const styleColor = (color: string) => rgbToString(parseColorWithCache(color)!);
            const darkStyle = getComputedStyle(document.querySelector('.dark')!);
            expect(darkStyle.backgroundColor).toBe(styleColor(modifyBackgroundColor(parseColorWithCache('#101418')!, target, false)));
            expect(darkStyle.color).toBe(styleColor(modifyForegroundColor(parseColorWithCache('#eaecf0')!, target, false)));
            expect(darkStyle.backgroundColor).not.toBe(bg);
            expect(darkStyle.color).not.toBe(fg);
            for (const selector of ['.light', '.inline']) {
                const style = getComputedStyle(document.querySelector(selector)!);
                expect(style.backgroundColor).withContext(selector).toBe(bg);
                expect(style.color).withContext(selector).toBe(fg);
            }
            expect(getComputedStyle(document.documentElement).colorScheme).toBe(mode ? 'dark' : 'light');
            document.querySelector<HTMLElement>('.inline')!.style.color = '#000';
            await timeout(100);
            expect(getComputedStyle(document.querySelector('.inline')!).color).toBe(fg);
        });
    }
    it('updates an already themed page from dark to light and restores originals on disable', async () => {
        document.body.innerHTML = '<div style="background: #000; color: #fff">Switch me</div>';
        createOrUpdateDynamicTheme({...base, mode: 1}, null, false);
        await timeout(50);
        createOrUpdateDynamicTheme({...base, mode: 0}, null, false);
        await timeout(50);
        expect(getComputedStyle(document.querySelector('div')!).backgroundColor).toBe('rgb(240, 232, 216)');
        removeDynamicTheme();
        expect(getComputedStyle(document.querySelector('div')!).backgroundColor).toBe('rgb(0, 0, 0)');
        expect(getComputedStyle(document.querySelector('div')!).color).toBe('rgb(255, 255, 255)');
    });
    it('updates inline colors when the palette changes without changing mode', async () => {
        document.body.innerHTML = '<div style="background: #000; color: #fff">New palette</div>';
        createOrUpdateDynamicTheme({...base, mode: 1}, null, false);
        await timeout(50);
        createOrUpdateDynamicTheme({...base, mode: 1, darkSchemeBackgroundColor: '#302018'}, null, false);
        await timeout(50);
        expect(getComputedStyle(document.querySelector('div')!).backgroundColor).toBe('rgb(48, 32, 24)');
    });
    it('themes shadow DOM and preserves source alpha', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        const shadow = host.attachShadow({mode: 'open'});
        shadow.innerHTML = '<style>span {background: rgba(0, 0, 0, 0.25); color: #fff;}</style><span>Shadow</span>';
        createOrUpdateDynamicTheme({...base, mode: 0}, null, false);
        await timeout(100);
        expect(getComputedStyle(shadow.querySelector('span')!).backgroundColor).toBe('rgba(240, 232, 216, 0.25)');
        expect(getComputedStyle(shadow.querySelector('span')!).color).toBe('rgb(32, 40, 48)');
    });
    it('inverts small transparent icons in either direction while keeping photographs', () => {
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
