import {DEFAULT_SETTINGS, DEFAULT_THEME} from '../src/defaults';
import type {Theme, UserSettings} from '../src/definitions';
import {parseBridgePalette, startBridgePalette} from '../src/coloreader/bridge';
import {browserTheme, startPaletteIntegration} from '../src/coloreader/integration';
import {AutomationMode} from '../src/utils/automation';

const palette = {v: 1, bgDark: '#401714', fgDark: '#ffefed', bgLight: '#fcd5d0', fgLight: '#4a201c'};
const parsed = {
    darkSchemeBackgroundColor: '#401714', darkSchemeTextColor: '#ffefed',
    lightSchemeBackgroundColor: '#fcd5d0', lightSchemeTextColor: '#4a201c',
};

class Socket {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 1;
    onmessage: ((event: {data: string}) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    send = jest.fn();
    close = jest.fn(() => {
        this.readyState = 3;
        this.onclose?.();
    });
    constructor(readonly url: string) {
        Socket.instances.push(this);
    }
    receive(value: unknown) {
        this.onmessage?.({data: typeof value === 'string' ? value : JSON.stringify(value)});
    }
}

const onActivated = {addListener: jest.fn()};
const getPlatformInfo = jest.fn();
const createTab = jest.fn();
const removeTab = jest.fn();
const activate = () => onActivated.addListener.mock.calls[0][0]();
const originals = {chrome: globalThis.chrome, WebSocket: globalThis.WebSocket};

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    getPlatformInfo.mockImplementation((callback) => callback({os: 'linux'}));
    createTab.mockImplementation((_options, callback) => callback({id: 9}));
    Socket.instances = [];
    Object.assign(globalThis, {chrome: {runtime: {getPlatformInfo}, tabs: {onActivated, create: createTab, remove: removeTab}}, WebSocket: Socket});
});
afterEach(() => {
    jest.useRealTimers();
    Object.assign(globalThis, originals);
});

it('accepts only complete version 1 palettes', () => {
    expect(parseBridgePalette(palette)).toEqual(parsed);
    expect(parseBridgePalette({...palette, mode: 'light', accent: '#dc9884'})).toEqual({...parsed, mode: 0, selectionColor: '#dc9884'});
    for (const bad of [null, 'text', {...palette, v: 2}, {...palette, bgLight: null}, {...palette, fgLight: 'url(bad)'}, {...palette, mode: 1}, {...palette, mode: 'smart'}, {...palette, accent: 'red'}]) {
        expect(parseBridgePalette(bad)).toBeNull();
    }
});

it('applies palettes from the local bridge and reconnects with backoff', () => {
    const apply = jest.fn();
    startBridgePalette(() => DEFAULT_THEME, apply);
    expect(Socket.instances[0].url).toBe('ws://127.0.0.1:7521');
    Socket.instances[0].receive(palette);
    expect(apply).toHaveBeenCalledWith(parsed);
    Socket.instances[0].close();
    jest.advanceTimersByTime(1000);
    expect(Socket.instances).toHaveLength(2);
    Socket.instances[1].close();
    jest.advanceTimersByTime(1000);
    expect(Socket.instances).toHaveLength(2);
    jest.advanceTimersByTime(1000);
    expect(Socket.instances).toHaveLength(3);
});

it('drops anything that is not a palette', () => {
    const apply = jest.fn();
    startBridgePalette(() => DEFAULT_THEME, apply);
    Socket.instances[0].receive({v: 1, bgDark: 'bad'});
    expect(Socket.instances[0].close).toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    Socket.instances[1].receive('not json');
    expect(Socket.instances[1].close).toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
});

it('keeps desktop reconnection free of Android launch attempts', () => {
    startBridgePalette(() => DEFAULT_THEME, jest.fn());
    Socket.instances[0].onerror?.();
    jest.advanceTimersByTime(1000);
    expect(Socket.instances).toHaveLength(2);
    expect(createTab).not.toHaveBeenCalled();
});

it('tries the Android bridge once per outage and closes the handoff tab on connection', () => {
    getPlatformInfo.mockImplementation((callback) => callback({os: 'android'}));
    startBridgePalette(() => DEFAULT_THEME, jest.fn());
    Socket.instances[0].onerror?.();
    expect(createTab).toHaveBeenCalledWith({url: 'intent://start#Intent;scheme=coloreader;package=com.alexhulbert.coloreader.bridge;end'}, expect.any(Function));
    jest.advanceTimersByTime(1000);
    Socket.instances[1].onerror?.();
    expect(createTab).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2000);
    Socket.instances[2].receive(palette);
    expect(removeTab).toHaveBeenCalledWith(9, expect.any(Function));
    Socket.instances[2].onerror?.();
    expect(createTab).toHaveBeenCalledTimes(2);
});

it('closes a handoff tab whose creation finishes after the bridge connects', () => {
    getPlatformInfo.mockImplementation((callback) => callback({os: 'android'}));
    createTab.mockImplementation(() => {});
    startBridgePalette(() => DEFAULT_THEME, jest.fn());
    Socket.instances[0].onerror?.();
    jest.advanceTimersByTime(1000);
    Socket.instances[1].receive(palette);
    createTab.mock.calls[0][1]({id: 9});
    expect(removeTab).toHaveBeenCalledWith(9, expect.any(Function));
});

it('keeps reconnecting when Firefox rejects the launch URL', () => {
    getPlatformInfo.mockImplementation((callback) => callback({os: 'android'}));
    Object.assign(chrome.runtime, {lastError: {message: 'Launch rejected'}});
    createTab.mockImplementation((_options, callback) => callback());
    startBridgePalette(() => DEFAULT_THEME, jest.fn());
    Socket.instances[0].onerror?.();
    jest.advanceTimersByTime(1000);
    expect(Socket.instances).toHaveLength(2);
    expect(removeTab).not.toHaveBeenCalled();
});

it('asks for the palette on tab activation and replaces a socket that stops answering', () => {
    startBridgePalette(() => DEFAULT_THEME, jest.fn());
    Socket.instances[0].receive(palette);
    jest.advanceTimersByTime(60_000);
    expect(Socket.instances).toHaveLength(1);
    activate();
    expect(Socket.instances[0].send).toHaveBeenCalledWith('get');
    jest.advanceTimersByTime(10_000);
    expect(Socket.instances[0].close).toHaveBeenCalled();
    activate();
    expect(Socket.instances).toHaveLength(2);
});

it('applies a mode change even when the colors stay the same', () => {
    let theme = {...DEFAULT_THEME};
    startBridgePalette(() => theme, (patch) => {
        theme = {...theme, ...patch};
    });
    for (const mode of ['dark', 'light', 'dark'] as const) {
        Socket.instances[0].receive({...palette, mode});
        expect(theme.mode).toBe(mode === 'dark' ? 1 : 0);
    }
});

it('lets the system mode override a conflicting Firefox automation rule', () => {
    const store = {settings: {...DEFAULT_SETTINGS, automation: {enabled: true, mode: AutomationMode.SYSTEM, behavior: 'Scheme'}} as UserSettings};
    const apply = jest.fn((patch: Partial<Theme>) => {
        store.settings = {...store.settings, theme: {...store.settings.theme, ...patch}};
    });
    const changeSettings = jest.fn(async (patch: Partial<UserSettings>) => {
        store.settings = {...store.settings, ...patch};
    });
    startPaletteIntegration(store, apply, changeSettings);
    Socket.instances[0].receive({...palette, mode: 'light'});
    expect(store.settings.automation.enabled).toBe(false);
    expect(store.settings.theme).toMatchObject({...parsed, mode: 0});
    Socket.instances[0].receive({...palette, mode: 'dark'});
    expect(changeSettings).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({...parsed, mode: 1});
});

it('applies the automated scheme to the browser theme', () => {
    expect(browserTheme(DEFAULT_THEME, 'scheme-light').mode).toBe(0);
    expect(browserTheme({...DEFAULT_THEME, mode: 0}, 'scheme-dark').mode).toBe(1);
});
