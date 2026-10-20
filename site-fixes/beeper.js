// @electron BeeperTexts

(() => {
  const palette = document.createElement('style');
  const grays = document.createElement('style');
  const hue = (hex) => {
    const [r, g, b] = hex.match(/[\da-f]{2}/gi).map((value) => parseInt(value, 16));
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    return delta ? ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360 : 0;
  };
  const apply = () => {
    const {classList} = document.body;
    if (classList.contains('theme-rich')) classList.remove('theme-rich');
    if (!classList.contains('theme-monochrome')) classList.add('theme-monochrome');
    const computed = getComputedStyle(document.body);
    const tinted = Array.from(computed).filter((name) => /^--color-base-gray-\d+$/.test(name));
    grays.textContent = `:root {${tinted.map((name) => `${name}: ${computed.getPropertyValue(name)} !important`).join(';')}}`;
  };
  document.addEventListener('coloreader:theme', ({detail}) => {
    const theme = JSON.parse(detail);
    const dark = theme.mode === 1;
    const background = dark ? theme.darkSchemeBackgroundColor : theme.lightSchemeBackgroundColor;
    const foreground = dark ? theme.darkSchemeTextColor : theme.lightSchemeTextColor;
    const accent = theme.selectionColor?.startsWith('#') ? theme.selectionColor : foreground;
    const colors = {
      bg: background, fg: foreground, surface: background, 'surface-dim': background,
      'base-black': dark ? background : foreground, 'base-white': dark ? foreground : background,
      'surface-dark': foreground, 'on-surface': foreground, primary: accent, 'on-primary': background,
      'text-neutrals': foreground, 'text-neutrals-strong': foreground,
      'primary-container': 'var(--color-base-gray-20)', 'tertiary-container': 'var(--color-base-gray-20)',
      'container-inside-secondary-container': 'var(--color-base-gray-50)',
    };
    const declarations = [
      `--theme-hue: ${hue(accent)}`, `--theme-background-gradient: ${background}`,
      `--palette-base-black: ${colors['base-black']}`, `--palette-base-white: ${colors['base-white']}`,
      ...Object.entries(colors).flatMap(([name, value]) => [`--color-${name}: ${value}`, `--color-${name}-rgb: from var(--color-${name}) r g b`]),
    ];
    palette.textContent = `:root, body {${declarations.map((declaration) => `${declaration} !important`).join(';')}}`;
    if (!palette.isConnected) {
      document.head.append(Object.assign(document.createElement('meta'), {name: 'darkreader-lock'}), palette, grays);
      new MutationObserver(apply).observe(document.body, {attributes: true, attributeFilter: ['class']});
    }
    apply();
  });
})();
