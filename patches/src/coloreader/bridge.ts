import type {Theme} from '../definitions';

const BRIDGE = 'ws://127.0.0.1:7521';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Reject incomplete palettes before they reach the renderer.
export function parseBridgePalette(data: unknown): Partial<Theme> | null {
    const {v, mode, bgDark, fgDark, bgLight, fgLight, accent} = (data ?? {}) as Record<string, unknown>;
    const hex = (value: unknown) => typeof value === 'string' && HEX_COLOR.test(value) ? value : null;
    const colors = [bgDark, fgDark, bgLight, fgLight].map(hex);
    if (v !== 1 || colors.includes(null) || (mode != null && mode !== 'dark' && mode !== 'light') || (accent != null && !hex(accent))) {
        return null;
    }
    const [darkSchemeBackgroundColor, darkSchemeTextColor, lightSchemeBackgroundColor, lightSchemeTextColor] = colors as string[];
    const theme: Partial<Theme> = {darkSchemeBackgroundColor, darkSchemeTextColor, lightSchemeBackgroundColor, lightSchemeTextColor};
    if (mode != null) {
        theme.mode = mode === 'dark' ? 1 : 0;
    }
    if (accent != null) {
        theme.selectionColor = accent as string;
    }
    return theme;
}

// The bridge pushes changes. Ask again on tab activation to catch up after sleep.
export function startBridgePalette(getTheme: () => Theme, apply: (theme: Partial<Theme>) => void): void {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let deadline: ReturnType<typeof setTimeout>;
    let delay = 1000;
    let triedLaunch = false;
    let launchTab: number | null = null;

    const closeLaunchTab = () => {
        if (launchTab == null) {
            return;
        }
        chrome.tabs.remove(launchTab, () => void chrome.runtime.lastError);
        launchTab = null;
    };

    const launch = () => chrome.runtime.getPlatformInfo(({os}) => {
        if (os !== 'android') {
            return;
        }
        chrome.tabs.create({url: 'intent://start#Intent;scheme=coloreader;package=com.alexhulbert.coloreader.bridge;end'}, (tab) => {
            if (chrome.runtime.lastError) {
                return;
            }
            launchTab = tab.id ?? null;
            if (socket?.readyState === WebSocket.OPEN) {
                closeLaunchTab();
            }
        });
    });

    const expectReply = (ws: WebSocket) => {
        clearTimeout(deadline);
        deadline = setTimeout(() => ws.close(), 10_000);
    };

    const connect = () => {
        clearTimeout(retry);
        const ws = new WebSocket(BRIDGE);
        socket = ws;
        expectReply(ws);
        ws.onerror = () => {
            ws.close();
            if (!triedLaunch) {
                triedLaunch = true;
                launch();
            }
        };
        ws.onmessage = ({data}) => {
            let palette: Partial<Theme> | null = null;
            try {
                palette = parseBridgePalette(JSON.parse(data));
            } catch {}
            if (!palette) {
                ws.close();
                return;
            }
            clearTimeout(deadline);
            delay = 1000;
            triedLaunch = false;
            closeLaunchTab();
            const current = getTheme();
            if ((Object.keys(palette) as Array<keyof Theme>).some((key) => current[key] !== palette![key])) {
                apply(palette);
            }
        };
        ws.onclose = () => {
            socket = null;
            clearTimeout(deadline);
            retry = setTimeout(connect, delay);
            delay = Math.min(delay * 2, 30_000);
        };
    };

    chrome.tabs.onActivated.addListener(() => {
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send('get');
            expectReply(socket);
        } else if (!socket) {
            connect();
        }
    });
    connect();
}
