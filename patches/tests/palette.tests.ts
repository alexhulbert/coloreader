import {DEFAULT_THEME} from '../src/defaults';
import {setWindowTheme} from '../src/background/window-theme';
import {paletteModifier} from '../src/coloreader/colors';
import {paletteSourceColor} from '../src/coloreader/source';
import {modifyBackgroundColor, modifyForegroundColor, modifyBorderColor, modifyShadowColor} from '../src/inject/dynamic-theme/modify-colors';
import {parseColorWithCache, rgbToHSL} from '../src/utils/color';

jest.mock('@plus/utils/theme', () => ({extendThemeCacheKeys: () => {}}));

const rgb = (color: string) => parseColorWithCache(color)!;

function luminance(color: string): number {
    const {r, g, b} = rgb(color);
    const [lr, lg, lb] = [r, g, b].map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: string, b: string): number {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const theme = {...DEFAULT_THEME, darkSchemeBackgroundColor: '#160c00', darkSchemeTextColor: '#ffe1b6', lightSchemeBackgroundColor: '#fff5eb', lightSchemeTextColor: '#402a00'};

describe.each([0, 1] as const)('mapping to target %i', (mode) => {
    const palette = {...theme, mode};
    const bg = mode ? palette.darkSchemeBackgroundColor : palette.lightSchemeBackgroundColor;
    const fg = mode ? palette.darkSchemeTextColor : palette.lightSchemeTextColor;

    it.each([
        ['#ffffff', '#000000', '#202124', '#5f6368', '#dee6f2'],
        ['#0f0f0f', '#ffffff', '#202020', '#aaaaaa', '#f1f1f1'],
        ['#f8fafd', '#000000', '#202124', '#5f6368', '#f2f6fc'],
        ['#808080', '#000000', '#111111', '#333333', '#555555'],
    ])('anchors a %s canvas and scales contrast', (canvas, pole, ...colors) => {
        const target = {...palette, paletteSourceBackground: canvas};
        const convert = (source: string) => modifyBackgroundColor(rgb(source), target, false);
        expect(convert(canvas)).toBe(bg);
        expect(modifyForegroundColor(rgb(pole), target, false)).toBe(fg);
        const scale = Math.log(contrast(bg, fg)) / Math.log(contrast(canvas, pole));
        const sources = [canvas, pole, ...colors];
        for (let i = 0; i < sources.length; i++) {
            for (let j = i + 1; j < sources.length; j++) {
                // Allow for 8-bit rounding
                const expected = Math.log(contrast(sources[i], sources[j])) * scale;
                expect(Math.abs(Math.log(contrast(convert(sources[i]), convert(sources[j]))) - expected)).toBeLessThan(0.04);
            }
        }
        for (const source of ['#111111', '#777777', '#eeeeee']) {
            const results = [modifyBackgroundColor, modifyForegroundColor, modifyBorderColor].map((modify) => modify(rgb(source), target, false));
            expect(new Set(results).size).toBe(1);
        }
    });

    it('keeps gray text gray', () => {
        const target = {...palette, paletteSourceBackground: '#ffffff'};
        for (const source of ['#59636e', '#9198a1', '#a4aea6']) {
            expect(rgbToHSL(rgb(modifyForegroundColor(rgb(source), target, false))).s).toBeLessThan(0.5);
        }
    });

    it('keeps icon hues at any lightness', () => {
        const target = {...palette, paletteSourceBackground: '#ffffff'};
        for (const sources of [['#201010', '#102010', '#101020'], ['#ff0000', '#00ff00', '#0000ff'], ['#fff0f0', '#f0fff0', '#f0f0ff']]) {
            const colors = sources.map((source) => modifyForegroundColor(rgb(source), target, false));
            const [red, green, blue] = colors.map(rgb);
            expect(red.r).toBeGreaterThan(red.g);
            expect(green.g).toBeGreaterThan(green.r);
            expect(blue.b).toBeGreaterThan(blue.r);
            expect(new Set(colors).size).toBe(3);
        }
    });

    it('tints pale surfaces and keeps colored controls', () => {
        const target = {...palette, paletteSourceBackground: '#f8fafd'};
        for (const source of ['#f2f6fc', '#dee6f2']) {
            const color = rgb(modifyBackgroundColor(rgb(source), target, false));
            expect(color.r).toBeGreaterThan(color.g);
            expect(color.g).toBeGreaterThan(color.b);
        }
        for (const source of ['#c2e7ff', '#0000ff', '#201030', '#f0f0ff']) {
            const color = rgb(modifyForegroundColor(rgb(source), target, false));
            expect(color.b).toBeGreaterThan(color.r);
        }
        const surfaceTint = modifyBackgroundColor(rgb('#dee6f2'), target, false);
        const iconTint = modifyForegroundColor(rgb('#dee6f2'), target, false);
        expect(Math.abs(luminance(surfaceTint) - luminance(iconTint))).toBeLessThan(0.005);
        const surface = modifyBackgroundColor(rgb('#f2f6fc'), target, false);
        const text = modifyForegroundColor(rgb('#202124'), target, false);
        const muted = modifyForegroundColor(rgb('#5f6368'), target, false);
        expect(contrast(surface, text)).toBeGreaterThan(7);
        expect(contrast(surface, muted)).toBeGreaterThan(3.8);
        expect(contrast(surface, text)).toBeGreaterThan(contrast(surface, muted));
    });

    it('keeps alpha and keeps shadows dark', () => {
        const target = {...palette, paletteSourceBackground: '#ffffff'};
        expect(rgb(modifyBackgroundColor(rgb('rgba(255, 255, 255, 0.25)'), target, false)).a).toBe(0.25);
        expect(rgb(modifyForegroundColor(rgb('transparent'), target, false)).a).toBe(0);
        const shadow = modifyShadowColor(rgb('rgba(0, 0, 0, 0.25)'), target);
        expect(rgb(shadow).a).toBe(0.25);
        expect(luminance(shadow)).toBeLessThan(0.1);
    });

    it('keeps the Firefox tab bar on the palette and controls distinct', () => {
        const update = jest.fn();
        Object.assign(globalThis, {browser: {theme: {update}}});
        setWindowTheme(palette);
        const {colors} = update.mock.calls[0][0];
        for (const key of ['frame', 'frame_inactive', 'toolbar', 'tab_selected']) {
            expect(colors[key]).toBe(bg);
        }
        expect(new Set([colors.frame, colors.toolbar_field, colors.popup]).size).toBe(3);
        expect(colors.sidebar).toBe(colors.popup);
        for (const key of ['tab_text', 'tab_background_text', 'toolbar_text', 'icons', 'toolbar_field_text', 'popup_text', 'sidebar_text']) {
            expect(colors[key]).toBe(fg);
        }
        expect(contrast(colors.tab_selected, colors.tab_text)).toBeGreaterThan(5);
    });
});

it('reads generated defaults on a white plane and recomputes when the theme changes', () => {
    for (const canvas of ['#ffffff', '#0f0f0f', '#f8fafd']) {
        const target = {...theme, paletteSourceBackground: canvas};
        expect(modifyBackgroundColor(paletteSourceColor(rgb('#ffffff'), target), target, false)).toBe(theme.darkSchemeBackgroundColor);
        expect(modifyForegroundColor(paletteSourceColor(rgb('#000000'), target), target, false)).toBe(theme.darkSchemeTextColor);
    }
    const source = rgb('#333333');
    const target = {...theme, paletteSourceBackground: '#ffffff'};
    const first = modifyForegroundColor(source, target, false);
    const changed = [{paletteSourceBackground: '#0f0f0f'}, {mode: 0 as const}, {darkSchemeTextColor: '#f9d1ea'}].map((patch) => modifyForegroundColor(source, {...target, ...patch}, false));
    expect(new Set([first, ...changed]).size).toBe(4);
    expect(modifyForegroundColor(source, target, false)).toBe(first);
});

it('uses upstream tone conversion only without a page source', () => {
    const fallback = jest.fn((source) => source);
    const modifier = paletteModifier(fallback);
    const source = rgbToHSL(rgb('#555555'));
    const background = rgbToHSL(rgb(theme.darkSchemeBackgroundColor));
    const foreground = rgbToHSL(rgb(theme.darkSchemeTextColor));
    modifier(source, background, foreground, rgbToHSL(rgb('#ffffff')));
    expect(fallback).not.toHaveBeenCalled();
    modifier(source, background, foreground);
    expect(fallback).toHaveBeenCalledTimes(1);
});
