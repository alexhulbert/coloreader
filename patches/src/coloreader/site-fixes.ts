import type {DynamicThemeFix} from '../definitions';
import {parseDynamicThemeFixes} from '../generators/dynamic-theme';
import {combineFixes} from '../inject/dynamic-theme/fixes';
import {isURLInList} from '../utils/url';

import text from './site-fixes.config';

const fixes = parseDynamicThemeFixes(text);

export function applySiteFixes(url: string, fix: DynamicThemeFix | null): DynamicThemeFix | null {
    const matches = fixes.filter((entry) => isURLInList(url, entry.url));
    return matches.length ? combineFixes([{...fix, url: ['*']} as DynamicThemeFix, ...matches]) : fix;
}
