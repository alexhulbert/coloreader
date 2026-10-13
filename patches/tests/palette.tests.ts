import {DEFAULT_THEME} from '../src/defaults';
import {setWindowTheme} from '../src/background/window-theme';
import {browserTheme} from '../src/coloreader/integration';
import {modifyBackgroundColor, modifyForegroundColor, modifyBorderColor, modifyShadowColor} from '../src/inject/dynamic-theme/modify-colors';
import {parseColorWithCache} from '../src/utils/color';

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

const theme = {...DEFAULT_THEME, darkSchemeBackgroundColor: '#182030', darkSchemeTextColor: '#e8e0d0', lightSchemeBackgroundColor: '#f0e8d8', lightSchemeTextColor: '#202830'};

describe.each([0, 1] as const)('palette mapping to target %i', (mode) => {
    const target = {...theme, mode};
    const bg = mode ? target.darkSchemeBackgroundColor : target.lightSchemeBackgroundColor;
    const fg = mode ? target.darkSchemeTextColor : target.lightSchemeTextColor;

    it('maps black and white surfaces and text to the palette poles', () => {
        for (const source of ['#000000', '#ffffff']) {
            expect(modifyBackgroundColor(rgb(source), target, false)).toBe(bg);
            expect(modifyForegroundColor(rgb(source), target, false)).toBe(fg);
        }
    });

    it('preserves neutral surface and muted text distinctions within the palette', () => {
        const sources = ['#000000', '#111111', '#303030', '#707070'];
        const backgrounds = sources.map((source) => modifyBackgroundColor(rgb(source), target, false));
        const texts = sources.map((source) => modifyForegroundColor(rgb(source), target, false));
        expect(new Set(backgrounds).size).toBe(sources.length);
        expect(new Set(texts).size).toBe(sources.length);
        for (let i = 1; i < sources.length; i++) {
            if (mode) {
                expect(luminance(backgrounds[i])).toBeGreaterThan(luminance(backgrounds[i - 1]));
                expect(luminance(texts[i])).toBeLessThan(luminance(texts[i - 1]));
            } else {
                expect(luminance(backgrounds[i])).toBeLessThan(luminance(backgrounds[i - 1]));
                expect(luminance(texts[i])).toBeGreaterThan(luminance(texts[i - 1]));
            }
        }
    });

    it('keeps opaque text readable on opaque surfaces across source hues', () => {
        const sources = ['#000000', '#ffffff', '#808080', '#202020', '#eeeeee', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff'];
        for (const background of sources) {
            for (const text of sources) {
                expect(contrast(modifyBackgroundColor(rgb(background), target, false), modifyForegroundColor(rgb(text), target, false))).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it('keeps borders distinct and preserves transparency', () => {
        const border = modifyBorderColor(rgb('#808080'), target, false);
        expect(border).not.toBe(bg);
        expect(border).not.toBe(fg);
        expect(rgb(modifyBackgroundColor(rgb('rgba(255, 255, 255, 0.25)'), target, false)).a).toBe(0.25);
        expect(rgb(modifyForegroundColor(rgb('transparent'), target, false)).a).toBe(0);
        const shadow = modifyShadowColor(rgb('rgba(0, 0, 0, 0.25)'), target);
        expect(rgb(shadow).a).toBe(0.25);
        expect(luminance(shadow)).toBeLessThan(0.1);
    });
});

it('tints near-neutral page colors without flattening them to the palette poles', () => {
    const target = {...theme, darkSchemeBackgroundColor: '#23001e', darkSchemeTextColor: '#f9d1ea'};
    // Colors from Wikipedia's dark theme and Firefox's UI.
    const sources = ['#101418', '#111111', '#707070', '#d3d3d3', '#cccccc', '#faf8f7'];
    for (const mode of [0, 1] as const) {
        for (const modify of [modifyBackgroundColor, modifyForegroundColor]) {
            const colors = sources.map((source) => modify(rgb(source), {...target, mode}, false));
            // Very small differences can round to the same 8-bit color.
            expect(new Set(colors).size).toBeGreaterThan(1);
        }
    }
    expect(rgb(modifyBackgroundColor(rgb('rgba(16, 20, 24, 0.4)'), target, false)).a).toBe(0.4);
});

it('keeps Firefox chrome surfaces distinct within the palette', () => {
    const update = jest.fn();
    Object.assign(globalThis, {browser: {theme: {update}}});
    setWindowTheme({...theme, darkSchemeBackgroundColor: '#23001e', darkSchemeTextColor: '#f9d1ea'});
    const {colors} = update.mock.calls[0][0];
    expect(new Set([colors.frame, colors.toolbar, colors.toolbar_field, colors.popup]).size).toBe(4);
    expect(colors.sidebar).toBe(colors.popup);
    for (const key of ['tab_background_text', 'toolbar_field_text', 'popup_text', 'sidebar_text']) {
        expect(colors[key]).toBe('#f9d1ea');
    }
    expect(browserTheme(DEFAULT_THEME, 'scheme-light').mode).toBe(0);
    expect(browserTheme({...DEFAULT_THEME, mode: 0}, 'scheme-dark').mode).toBe(1);
});

it('tints near-neutral surfaces with the palette while keeping accent hues', () => {
    const target = {...theme, mode: 0 as const, lightSchemeBackgroundColor: '#fff8ee', lightSchemeTextColor: '#28232d'};
    for (const source of ['#141218', '#0d1117', '#f7f7fa']) {
        const {r, g, b} = rgb(modifyBackgroundColor(rgb(source), target, false));
        expect(r).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(b);
    }
    const blue = rgb(modifyForegroundColor(rgb('#0000ff'), target, false));
    expect(blue.b).toBeGreaterThan(blue.r);
});

it('invalidates the conversion cache when the mode or palette changes', () => {
    const white = rgb('#ffffff');
    expect(modifyBackgroundColor(white, theme, false)).toBe('#182030');
    expect(modifyBackgroundColor(white, {...theme, darkSchemeBackgroundColor: '#302018'}, false)).toBe('#302018');
    expect(modifyBackgroundColor(white, {...theme, mode: 0}, false)).toBe('#f0e8d8');
});
