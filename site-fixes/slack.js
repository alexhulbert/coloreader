// @match https://*.slack.com/*
// @electron slack-desktop

(() => {
  let theme;
  let modules;
  let baseKey;
  const sources = {};
  const colors = document.createElement('span').style;
  const overrides = document.createElement('style');
  const channels = (value) => {
    colors.color = '';
    colors.color = /^\s*\d/.test(value) ? `rgb(${value})` : value;
    return colors.color.match(/[\d.]+/g);
  };
  const rgbKey = (value) => channels(value)?.slice(0, 3).join(',');
  const themeBase = (mode, background, foreground) => {
    const key = JSON.stringify([mode, background, foreground]);
    if (key === baseKey || !document.body?.classList.contains(`sk-client-theme--${mode}`)) return;
    const computed = getComputedStyle(document.body);
    const source = sources[mode] ??= Object.fromEntries(Array.from(computed)
      .filter(name => /^--(?:dt_color-|sk_)/.test(name)).map(name => [name, computed.getPropertyValue(name)]));
    const palette = new Map(modules('iJEa').zK({hex: background, name: 'gray'})[mode]
      .map(({property, value}) => [rgbKey(source[property]), value]));
    for (const [name, value] of Object.entries({
      '--dt_color-base-pry': background, '--sk_primary_background': background,
      '--dt_color-content-pry': foreground, '--sk_primary_foreground': foreground,
    })) palette.set(rgbKey(source[name]), rgbKey(value));
    const declarations = Object.entries(source).flatMap(([name, value]) => {
      if (!/^--(?:dt_color-(?!theme-|plt-)|sk_)/.test(name)) return [];
      const rgb = channels(value);
      if (!rgb) return [];
      const target = palette.get(rgb.slice(0, 3).join(','));
      return target ? [`${name}:${/^\s*\d/.test(value) ? target : `rgba(${target},${rgb[3] ?? 1})`} !important`] : [];
    });
    overrides.textContent = `body.sk-client-theme--${mode}{${declarations.join(';')}}`;
    if (!overrides.isConnected) document.head.append(overrides);
    baseKey = key;
  };
  const chunks = globalThis.rspackChunkGantryV2 ??= [];
  chunks.push([['coloreader'], {}, (require) => { modules = require; }]);
  const apply = () => {
    if (document.head && !document.querySelector('meta[name="darkreader-lock"]')) {
      document.head.append(Object.assign(document.createElement('meta'), {name: 'darkreader-lock'}));
    }
    if (!theme || !modules) return;
    const mode = theme.mode === 1 ? 'dark' : 'light';
    const background = mode === 'dark' ? theme.darkSchemeBackgroundColor : theme.lightSchemeBackgroundColor;
    const foreground = mode === 'dark' ? theme.darkSchemeTextColor : theme.lightSchemeTextColor;
    const accent = theme.selectionColor?.startsWith('#') ? theme.selectionColor : foreground;
    const iaTheme = {
      ...Object.fromEntries(Object.entries({primary: background, highlight1: accent, highlight2: accent, important: accent})
        .map(([key, custom]) => [key, {palette: 'gray', custom}])),
      brightness: 5,
      useCustomHex: true,
      sidebarInverted: false,
      windowGradient: false,
    };
    for (const element of document.querySelectorAll('.p-client_workspace')) {
      let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
      while (fiber) {
        const store = fiber.memoizedProps?.value?.store || fiber.memoizedProps?.store;
        fiber = fiber.return;
        if (!store?.getState) continue;
        const state = store.getState();
        if (!state.prefs?.user || !Object.keys(state.prefs.user).length) continue;
        if (JSON.stringify(state.prefs.user.ia_theme) !== JSON.stringify(iaTheme)) {
          store.dispatch(modules('Nt5j').it({ia_theme: iaTheme}));
        }
        if (state.clientTheme?.clientTheme !== mode) store.dispatch(modules('hmOt').yg(mode));
        break;
      }
    }
    themeBase(mode, background, foreground);
  };
  document.addEventListener('coloreader:theme', ({detail}) => { theme = JSON.parse(detail); apply(); });
  new MutationObserver(apply).observe(document, {childList: true, subtree: true});
})();
