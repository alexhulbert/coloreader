# Coloreader

Make websites match your system colors, in light or dark mode. Based on
[Dark Reader](https://github.com/darkreader/darkreader), with a palette-based
color engine. This extension also themes the firefox UI similar to Pywalfox as well.

## Install

Download your browser's package from [Releases](https://github.com/alexhulbert/coloreader/releases/latest).

- **Firefox:** install the `.xpi`. On Android,
  [install it from a file](https://extensionworkshop.com/documentation/publish/install-self-distributed/#install-add-on-from-file-on-android).
- **Chrome:** unzip the Chrome `.zip`, enable Developer mode at
  `chrome://extensions`, then choose **Load unpacked**.

Then, run the correct coloreader bridge for your operating system.

Click the toolbar icon to toggle Coloreader for the current site. Right-click the
icon and choose **Open popup** to access its controls. The icon reflects whether
Coloreader is enabled for the current site.

## System colors

**Android 12+:** install the [bridge APK](https://github.com/alexhulbert/coloreader/releases/download/bridge/coloreader-bridge.apk)
before starting the Firefox addon. The addon tries to start the bridge when needed;
Firefox may ask you to confirm. The bridge has no launcher icon or screen.

**Linux:**

```sh
cargo install --path bridge/linux
coloreader-bridge ~/.cache/coloreader.json
```

Allow additional WebSocket origins with repeatable `--allow-origin <origin>` arguments,
or Home Manager's `services.coloreader.allowedOrigins` list.

Coloreader-bridge must be running in the background for your web browser / application to receive updates.

Configure your palette generator (marugen, etc.) to write `~/.cache/coloreader.json` in this format:

```json
{"v":1,"mode":"dark","bgDark":"#182030","fgDark":"#e8e0d0","bgLight":"#f0e8d8","fgLight":"#202830"}
```

For Electron apps on Linux x86-64, see the [injector](electron-injector/README.md).
