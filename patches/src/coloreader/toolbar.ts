import type {Command} from '../definitions';

declare const __CHROMIUM_MV3__: boolean;
declare const browser: {
    browserAction: Pick<typeof chrome.action, 'setPopup' | 'openPopup'>;
};

const POPUP = 'ui/popup/index.html';
const POPUP_MENU = 'coloreader-popup';

async function openPopup() {
    const action = __CHROMIUM_MV3__ ? chrome.action : browser.browserAction;
    try {
        if (__CHROMIUM_MV3__) {
            await chrome.action.setPopup({popup: POPUP});
        } else {
            // Firefox requires openPopup in the context menu's user gesture
            browser.browserAction.setPopup({popup: POPUP});
        }
        await action.openPopup();
    } catch {
        chrome.windows.create({url: chrome.runtime.getURL(POPUP), type: 'popup', width: 420, height: 650});
    } finally {
        await action.setPopup({popup: ''});
    }
}

function createPopupMenu() {
    chrome.contextMenus.create({
        id: POPUP_MENU,
        title: 'Open popup',
        contexts: [__CHROMIUM_MV3__ ? 'action' : 'browser_action'],
    }, () => void chrome.runtime.lastError);
}

// Upstream clears every menu whenever it toggles the page menus
export function removeContextMenus(callback?: () => void) {
    chrome.contextMenus.removeAll(() => {
        createPopupMenu();
        callback?.();
    });
}

export function registerToolbar(onCommand: (command: Command, tabId: number | null, frameId: number | null, frameURL: string | null) => void) {
    if (!chrome.contextMenus) {
        // Firefox for Android has no toolbar context menu
        browser.browserAction.setPopup({popup: POPUP});
        return;
    }
    createPopupMenu();
    (__CHROMIUM_MV3__ ? chrome.action : chrome.browserAction).onClicked.addListener((tab) => onCommand('addSite', tab.id ?? null, 0, tab.url ?? null));
    chrome.contextMenus.onClicked.addListener(({menuItemId}) => {
        if (menuItemId === POPUP_MENU) {
            void openPopup();
        }
    });
}
