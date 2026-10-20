# Electron injector

Theme Electron apps on Linux x86-64 without changing their files. The injector
includes the color engine and checks for updates daily. Downloaded updates take
effect next time the app starts.

Run the [palette bridge](../README.md#system-colors) first.

## Build and run

```sh
npm ci --ignore-scripts
npm run prepare:upstream  # once
npm run build:electron
LD_PRELOAD="$PWD/.work/electron-injector/libcoloreader.so${LD_PRELOAD:+:$LD_PRELOAD}" slack
```

| Variable | Behavior |
| --- | --- |
| `COLOREADER_DISABLE=1` | Skip injection |
| `COLOREADER_UPDATES=0` | Disable downloads; cached JS and the fallback still work |
| `COLOREADER_DEBUG=1` | Log cache selection and errors |
| `COLOREADER_BRIDGE_PORT` | Override port 7521 |
| `COLOREADER_UPDATE_BASE` | Override the GitHub releases base URL |
| `XDG_CACHE_HOME` | Cache base; defaults to `~/.cache` |
| `XDG_RUNTIME_DIR` | Temporary preload directory |

The injector also supports inject custom userscripts into applications
with a `~/.config/coloreader/<package-name>.js` file.
Scripts receive initial and live palettes through the document's `coloreader:theme`
event (`JSON.parse(event.detail)`). Adding `<meta name="darkreader-lock">` disables recoloring
while keeping palette events.
