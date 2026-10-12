import type {Theme} from '../definitions';
import type {ImageDetails} from '../inject/dynamic-theme/image';
import {getFilteredImageURL, getSolidColorImageURL} from '../inject/dynamic-theme/image';
import {modifyBackgroundColor} from '../inject/dynamic-theme/modify-colors';

// Recolor flat fills and keep small icons visible without changing photos.
export function paletteImageAction(image: ImageDetails, mode: 0 | 1): 'solid' | 'invert' | 'keep' {
    if (image.solidColor && !image.isTransparent) {
        return 'solid';
    }
    if (image.isTransparent && !image.isLarge && image.width > 2 && (mode === 1 ? image.isDark : image.isLight)) {
        return 'invert';
    }
    return 'keep';
}

export function paletteImageValue(image: ImageDetails, theme: Theme, canFilter: boolean): string | null {
    const action = paletteImageAction(image, theme.mode);
    if (action === 'solid') {
        return `url("${getSolidColorImageURL(image, modifyBackgroundColor(image.solidColor!, theme, false))}")`;
    }
    if (action === 'invert' && canFilter) {
        return `url("${getFilteredImageURL(image, {...theme, mode: 1})}")`;
    }
    return null;
}
