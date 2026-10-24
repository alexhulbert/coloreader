import type {Theme} from '../definitions';
import type {HSLA, RGBA} from '../utils/color';
import {getRGBValues, hslToRGB, parseColorWithCache, parseToHSLWithCache, rgbToHSL} from '../utils/color';
import {getParenthesesRange} from '../utils/text';

// Selector and media overrides require a variable reference here
export function scopedTupleColor(value: string, wrapVariable: (variable: string) => string): string | null {
    const start = value.indexOf('var(');
    const range = start >= 0 ? getParenthesesRange(value, start + 3) : null;
    if (!range) {
        return null;
    }
    const prefix = value.slice(0, start);
    const suffix = value.slice(range.end);
    const tuple = /^\s*rgba?\(\s*$/.test(prefix) && /^\s*([,/][^,]*)?\)\s*$/.test(suffix);
    const relative = /^\s*rgba?\(\s*from\s+$/i.test(prefix) && /^\s+r\s+g\s+b\s*(?:\/[\s\S]+)?\)\s*$/i.test(suffix);
    if (!tuple && !relative) {
        return null;
    }
    return prefix + wrapVariable(value.slice(start, range.end)) + suffix;
}

export function rawColorValues(input: string): number[] | null {
    const relative = /^\s*from\s/i.test(input) && parseColorWithCache(`rgb(${input.trim()})`);
    return relative ? [relative.r, relative.g, relative.b, relative.a ?? 1] : getRGBValues(input);
}

// Comma-separated tuples would make rgb(var(--tuple) / alpha) invalid
export function rawColorTuple(source: string, {r, g, b, a}: RGBA): string {
    const comma = !/^\s*from\s/i.test(source) && source.includes(',');
    const rgb = [r, g, b].join(comma ? ', ' : ' ');
    return Number.isNaN(a) || a === 1 ? rgb : `${rgb}${comma ? ', ' : ' / '}${a}`;
}

type LinearRGB = [number, number, number];

function linearize(value: number): number {
    value /= 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function encode(value: number): number {
    value = Math.max(0, Math.min(1, value));
    return 255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
}

export function linearRGB(color: HSLA): LinearRGB {
    const {r, g, b} = hslToRGB(color);
    return [linearize(r), linearize(g), linearize(b)];
}

export function luminance([r, g, b]: LinearRGB): number {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(a: LinearRGB, b: LinearRGB, amount: number): LinearRGB {
    return a.map((value, i) => value + (b[i] - value) * amount) as LinearRGB;
}

export function sourceTextPole(background: HSLA): HSLA {
    // Use black or white, whichever contrasts more with the page background
    const light = luminance(linearRGB(background)) < Math.sqrt(0.05 * 1.05) - 0.05;
    return {h: 0, s: 0, l: light ? 1 : 0, a: 1};
}

function fitHue(source: HSLA, target: number): HSLA {
    let low = 0;
    let high = 1;
    let best = source;
    let error = Math.abs(luminance(linearRGB(best)) - target);
    for (let i = 0; i < 16; i++) {
        const candidate = {...source, l: (low + high) / 2};
        const value = luminance(linearRGB(candidate));
        if (Math.abs(value - target) < error) {
            best = candidate;
            error = Math.abs(value - target);
        }
        if (value < target) {
            low = candidate.l;
        } else {
            high = candidate.l;
        }
    }
    return best;
}

// Scale contrast ratios with one log luminance curve until colors clip
export function mapPaletteColor(source: HSLA, background: HSLA, foreground: HSLA, sourceBackground: HSLA, keepHue: boolean): HSLA {
    if (source.h === sourceBackground.h && source.s === sourceBackground.s && source.l === sourceBackground.l) {
        return {...background, a: source.a};
    }
    const bg = linearRGB(background);
    const fg = linearRGB(foreground);
    const bgY = luminance(bg);
    const fgY = luminance(fg);
    const sourceBgY = luminance(linearRGB(sourceBackground));
    const sourceY = luminance(linearRGB(source));
    const sourceFgY = sourceTextPole(sourceBackground).l;
    const progress = Math.log((sourceY + 0.05) / (sourceBgY + 0.05)) / Math.log((sourceFgY + 0.05) / (sourceBgY + 0.05));
    const target = Math.max(0, Math.min(1, Math.exp(Math.log(bgY + 0.05) + progress * Math.log((fgY + 0.05) / (bgY + 0.05))) - 0.05));
    if (keepHue) {
        return fitHue(source, target);
    }
    const amount = bgY === fgY ? 0 : Math.max(0, Math.min(1, (target - bgY) / (fgY - bgY)));
    let result = mix(bg, fg, amount);
    const current = luminance(result);
    // Keep colors outside the palette range distinct
    if (target < current) {
        result = mix([0, 0, 0], result, target / current);
    } else if (target > current) {
        result = mix(result, [1, 1, 1], (target - current) / (1 - current));
    }
    const [r, g, b] = result.map(encode);
    return rgbToHSL({r, g, b, a: source.a});
}

export function paletteColor(source: HSLA, modified: HSLA, background: HSLA, foreground: HSLA, sourceBackground?: HSLA, surface = false): HSLA {
    // Near black or white, high HSL saturation can still mean little color
    const chroma = (1 - Math.abs(2 * source.l - 1)) * source.s;
    const keepHue = source.s >= 0.3 && chroma > (surface ? 0.15 : 0.01);
    if (sourceBackground) {
        return mapPaletteColor(source, background, foreground, sourceBackground, keepHue);
    }
    // Use Dark Reader's tone conversion for Firefox's UI
    if (source.s >= 0.3 && chroma > 0.01) {
        return {...modified, h: source.h, s: source.s};
    }
    if (background.l === foreground.l) {
        return modified;
    }
    const bg = hslToRGB(background);
    const fg = hslToRGB(foreground);
    const amount = Math.max(0, Math.min(1, (modified.l - background.l) / (foreground.l - background.l)));
    const {h, s} = rgbToHSL({r: bg.r + (fg.r - bg.r) * amount, g: bg.g + (fg.g - bg.g) * amount, b: bg.b + (fg.b - bg.b) * amount, a: source.a});
    return {...modified, h, s};
}

type PaletteModifier = (source: HSLA, background: HSLA, foreground: HSLA, canvas?: HSLA) => HSLA;

// Reuse callbacks so Dark Reader can cache their results
export function paletteModifier(fallback: PaletteModifier, surface = false): PaletteModifier {
    return (source, background, foreground, canvas) => paletteColor(source, canvas ? source : fallback(source, background, foreground), background, foreground, canvas, surface);
}

export function withPaletteSource(modify: PaletteModifier, source: HSLA, background: HSLA, foreground: HSLA, theme: Theme): HSLA {
    const canvas = theme.paletteMode && theme.paletteSourceBackground ? parseToHSLWithCache(theme.paletteSourceBackground)! : undefined;
    return modify(source, background, foreground, canvas);
}

// Shadows should stay dark even when the target palette is light
export function paletteShadow(source: HSLA, background: HSLA, foreground: HSLA): HSLA {
    const pole = background.l < foreground.l ? background : foreground;
    return {...pole, l: Math.min(source.l, pole.l), a: source.a};
}
