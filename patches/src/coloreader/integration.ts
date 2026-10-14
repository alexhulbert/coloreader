import type {Theme, UserSettings} from '../definitions';
import {startBridgePalette} from './bridge';

interface Store {
    settings: Readonly<UserSettings>;
}

export function startPaletteIntegration(store: Store, apply: (theme: Partial<Theme>) => void, changeSettings: (settings: Partial<UserSettings>) => Promise<void>): void {
    startBridgePalette(() => store.settings.theme, (theme) => {
        const {automation} = store.settings;
        if (theme.mode != null && automation.enabled) {
            void changeSettings({automation: {...automation, enabled: false}, theme: {...store.settings.theme, ...theme}});
        } else {
            apply(theme);
        }
    });
}

// Apply the same automated mode to Firefox's UI and page themes.
export function browserTheme(theme: Theme, automation: string): Theme {
    if (automation === 'scheme-light') {
        return {...theme, mode: 0};
    }
    if (automation === 'scheme-dark') {
        return {...theme, mode: 1};
    }
    return theme;
}

export function browserPaletteColors(theme: Theme, colors: Record<string, string>): Record<string, string> {
    if (!theme.paletteMode) {
        return colors;
    }
    const background = theme.mode === 1 ? theme.darkSchemeBackgroundColor : theme.lightSchemeBackgroundColor;
    const foreground = theme.mode === 1 ? theme.darkSchemeTextColor : theme.lightSchemeTextColor;
    return {
        ...colors,
        accentcolor: background,
        frame: background,
        frame_inactive: background,
        toolbar: background,
        tab_selected: background,
        tab_text: foreground,
        tab_background_text: foreground,
        textcolor: foreground,
        toolbar_text: foreground,
        icons: foreground,
    };
}
