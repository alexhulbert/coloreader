import type {HSLA} from '../utils/color';
import {hslToRGB, rgbToHSL} from '../utils/color';

type LinearRGB = [number, number, number];
type Role = 'background' | 'text' | 'border';

function linearize(value: number): number {
    value /= 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function encode(value: number): number {
    value = Math.max(0, Math.min(1, value));
    return 255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
}

function linearRGB(color: HSLA): LinearRGB {
    const {r, g, b} = hslToRGB(color);
    return [linearize(r), linearize(g), linearize(b)];
}

function luminance([r, g, b]: LinearRGB): number {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(a: LinearRGB, b: LinearRGB, amount: number): LinearRGB {
    return a.map((value, i) => value + (b[i] - value) * amount) as LinearRGB;
}

function contrast(a: number, b: number): number {
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Map neutral colors exactly to the palette so chromakey transparency still works.
// Fit colored accents to their CSS role while keeping their hue and alpha.
function recolor(source: HSLA, background: HSLA, foreground: HSLA, role: Role): HSLA {
    // Near black or white, high HSL saturation can still mean very little color.
    const chroma = (1 - Math.abs(2 * source.l - 1)) * source.s;
    const isChromatic = source.s >= 0.12 && chroma >= 0.08 && source.l > 0.02 && source.l < 0.98;
    if (!isChromatic && role !== 'border') {
        return {...(role === 'background' ? background : foreground), a: source.a};
    }
    const bg = linearRGB(background);
    const fg = linearRGB(foreground);
    const bgY = luminance(bg);
    const fgY = luminance(fg);
    const relief = 2 * Math.min(source.l, 1 - source.l);

    // Leave room for accents while keeping 4.5:1 text contrast where the palette allows it.
    let range = 0.08;
    while (range > 0.001 && contrast(bgY + (fgY - bgY) * range, fgY + (bgY - fgY) * range) < 4.5) {
        range /= 2;
    }
    if (contrast(bgY, fgY) < 4.5) {
        range = 0;
    }
    const amount = role === 'background' ? range * relief : role === 'text' ? 1 - range * relief : 0.25 + 0.2 * relief;
    let result = mix(bg, fg, amount);

    // Shift the source toward black or white to reach the target luminance.
    if (isChromatic) {
        const original = linearRGB(source);
        const current = luminance(original);
        const target = luminance(result);
        result = target < current
            ? mix([0, 0, 0], original, target / current)
            : mix(original, [1, 1, 1], (target - current) / (1 - current));
    }

    const [r, g, b] = result.map(encode);
    return rgbToHSL({r, g, b, a: source.a});
}

export function paletteBackground(source: HSLA, background: HSLA, foreground: HSLA): HSLA {
    return recolor(source, background, foreground, 'background');
}

export function paletteText(source: HSLA, background: HSLA, foreground: HSLA): HSLA {
    return recolor(source, background, foreground, 'text');
}

export function paletteBorder(source: HSLA, background: HSLA, foreground: HSLA): HSLA {
    return recolor(source, background, foreground, 'border');
}

// Shadows should stay dark even when the target palette is light.
export function paletteShadow(source: HSLA, background: HSLA, foreground: HSLA): HSLA {
    return luminance(linearRGB(background)) < luminance(linearRGB(foreground))
        ? recolor(source, background, foreground, 'background')
        : recolor(source, foreground, background, 'background');
}
