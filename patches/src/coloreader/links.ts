import type {Theme} from '../definitions';
import {parseColorWithCache, parseToHSLWithCache, rgbToHSL} from '../utils/color';
import {linearRGB, luminance} from './colors';

let support: boolean | undefined;
const supported = () => support ??= CSS.supports('color', 'color(from red srgb-linear calc(min(r / 0.5, 1) * 0.5 + max((g - 0.5) / 0.5, 0)) g b)');

// Changing text luminance here can reduce contrast on filled buttons
export function linkScope(theme: Theme): string {
    if (!supported() || !theme.paletteMode || theme.selectionColor === 'auto') {
        return '';
    }
    const accent = linearRGB(parseToHSLWithCache(theme.selectionColor)!);
    const target = luminance(accent);
    const y = '(0.2126 * r + 0.7152 * g + 0.0722 * b)';
    const channel = (a: number) => [
        a > 0 && `${a} * min(${y} / ${target}, 1)`,
        a < 1 && `${1 - a} * max((${y} - ${target}) / ${1 - target}, 0)`,
    ].filter(Boolean).join(' + ');
    return `a:any-link { ${['r', 'g', 'b'].map((name, i) => `--coloreader-link-${name}: calc(${channel(accent[i])});`).join(' ')} }`;
}

export function linkColor(color: string): string {
    return supported() ? `color(from ${color} srgb-linear var(--coloreader-link-r, r) var(--coloreader-link-g, g) var(--coloreader-link-b, b))` : color;
}

export function isLinkColor(value: string): boolean {
    const source = parseColorWithCache(value);
    if (!source) {
        return value.startsWith('var(');
    }
    const {s, l} = rgbToHSL(source);
    return s >= 0.3 && (1 - Math.abs(2 * l - 1)) * s > 0.01;
}
