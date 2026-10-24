import type {Theme} from '../definitions';
import type {RGBA} from '../utils/color';
import {parseColorWithCache, hslToRGB, rgbToHSL, rgbToHexString} from '../utils/color';
import {mapPaletteColor, sourceTextPole} from './colors';

let pageCanvas: Element | null = null;

// Map generated colors from a white background to the page's original background
export function paletteSourceColor(color: RGBA, theme: Theme): RGBA {
    if (!theme.paletteMode || !theme.paletteSourceBackground) {
        return color;
    }
    const background = rgbToHSL(parseColorWithCache(theme.paletteSourceBackground)!);
    const source = rgbToHSL(color);
    return hslToRGB(mapPaletteColor(source, background, sourceTextPole(background), {h: 0, s: 0, l: 1}, true));
}

export function readPaletteSource(): string {
    // Disable our styles while reading the original colors
    const sheets = Array.from(document.querySelectorAll<HTMLStyleElement>('style.darkreader')).map((node) => node.sheet).filter((sheet): sheet is CSSStyleSheet => sheet != null && !sheet.disabled);
    const adopted = (document.adoptedStyleSheets as any)?.wrappedJSObject ?? document.adoptedStyleSheets ?? [];
    for (const sheet of adopted as CSSStyleSheet[]) {
        if (!sheet.disabled && (sheet.cssRules[0] as CSSStyleRule)?.selectorText === '#__darkreader__adoptedOverride') {
            sheets.push(sheet);
        }
    }
    try {
        sheets.forEach((sheet) => sheet.disabled = true);
        const width = document.documentElement.clientWidth;
        const height = document.documentElement.clientHeight;
        const canvasColor = (element: Element): RGBA | null => {
            const rect = element.getBoundingClientRect();
            const visibleWidth = Math.min(width, rect.right) - Math.max(0, rect.left);
            const visibleHeight = Math.min(height, rect.bottom) - Math.max(0, rect.top);
            if (width <= 0 || height <= 0 || visibleWidth * visibleHeight <= width * height * 0.5 || element.closest('dialog, [role="dialog"]')) {
                return null;
            }
            const color = parseColorWithCache(getComputedStyle(element).backgroundColor);
            return color?.a === 1 ? color : null;
        };
        const previous = pageCanvas?.isConnected && canvasColor(pageCanvas);
        const canvases = new Map<Element, {color: RGBA; count: number}>();
        for (const [x, y] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.9]]) {
            for (const element of document.elementsFromPoint(width * x, height * y)) {
                if (element === document.body || element === document.documentElement) {
                    continue;
                }
                const color = canvasColor(element);
                if (color) {
                    const candidate = canvases.get(element) ?? {color, count: 0};
                    candidate.count++;
                    canvases.set(element, candidate);
                    break;
                }
            }
        }
        for (const [element, candidate] of canvases) {
            if (candidate.count >= 2) {
                pageCanvas = element;
                return rgbToHexString(candidate.color);
            }
        }
        // Keep using the page background when a dialog covers it
        if (previous) {
            return rgbToHexString(previous);
        }
        pageCanvas = null;
        const rootStyle = getComputedStyle(document.documentElement);
        const schemes = rootStyle.colorScheme.split(' ');
        const dark = schemes.includes('dark') && (!schemes.includes('light') || matchMedia('(prefers-color-scheme: dark)').matches);
        const fallback = dark ? 0 : 255;
        let result: RGBA = {r: fallback, g: fallback, b: fallback, a: 1};
        const root = parseColorWithCache(rootStyle.backgroundColor);
        const body = document.body && parseColorWithCache(getComputedStyle(document.body).backgroundColor);
        for (const color of [root, body]) {
            if (color) {
                const alpha = color.a ?? 1;
                result = {r: color.r * alpha + result.r * (1 - alpha), g: color.g * alpha + result.g * (1 - alpha), b: color.b * alpha + result.b * (1 - alpha), a: 1};
            }
        }
        return rgbToHexString({r: Math.round(result.r), g: Math.round(result.g), b: Math.round(result.b), a: 1});
    } finally {
        sheets.forEach((sheet) => sheet.disabled = false);
    }
}

export function watchPaletteSource(onChange: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
        if (timer == null) {
            timer = setTimeout(() => {
                timer = null;
                onChange();
            }, 50);
        }
    };
    const isOwn = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('.darkreader') != null;
    const isStyle = (node: Node) => (node instanceof Element ? node : node.parentElement)?.matches('style, link[rel~="stylesheet"]');
    const observer = new MutationObserver((records) => {
        if (records.some((record) => {
            if (isOwn(record.target)) {
                return false;
            }
            if (record.type === 'attributes') {
                if (record.attributeName?.startsWith('data-darkreader')) {
                    return false;
                }
                return record.target === document.documentElement || record.target === document.body || record.target === pageCanvas || (pageCanvas != null && record.target instanceof Element && record.target.contains(pageCanvas)) || isStyle(record.target);
            }
            if (isStyle(record.target)) {
                return true;
            }
            const nodes = [...record.addedNodes, ...record.removedNodes].filter((node) => !isOwn(node));
            return nodes.some(isStyle) || nodes.some((node) => node instanceof Element) && (record.target === document.documentElement || record.target === document.body || record.target === pageCanvas);
        })) {
            schedule();
        }
    });
    observer.observe(document.documentElement, {subtree: true, childList: true, characterData: true, attributes: true});
    const loaded = (event: Event) => {
        if (isStyle(event.target as Node) && !isOwn(event.target as Node)) {
            schedule();
        }
    };
    document.addEventListener('load', loaded, true);
    document.addEventListener('readystatechange', schedule);
    const sheetEvents = ['__darkreader__updateSheet', '__darkreader__adoptedStyleSheetsChange', '__darkreader__adoptedStyleSheetChange', '__darkreader__adoptedStyleDeclarationChange'];
    sheetEvents.forEach((event) => document.addEventListener(event, schedule, true));
    window.addEventListener('resize', schedule);
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', schedule);
    schedule();
    return () => {
        observer.disconnect();
        if (timer != null) {
            clearTimeout(timer);
        }
        document.removeEventListener('load', loaded, true);
        document.removeEventListener('readystatechange', schedule);
        sheetEvents.forEach((event) => document.removeEventListener(event, schedule, true));
        window.removeEventListener('resize', schedule);
        scheme.removeEventListener('change', schedule);
        pageCanvas = null;
    };
}
