{ lib, rustPlatform }:

rustPlatform.buildRustPackage {
  pname = "coloreader-bridge";
  version = (lib.importTOML ../bridge/linux/Cargo.toml).package.version;
  src = lib.fileset.toSource {
    root = ../bridge/linux;
    fileset = lib.fileset.unions [
      ../bridge/linux/Cargo.toml ../bridge/linux/Cargo.lock ../bridge/linux/src
    ];
  };
  cargoLock.lockFile = ../bridge/linux/Cargo.lock;
  meta = {
    description = "Coloreader WebSocket bridge";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux;
    mainProgram = "coloreader-bridge";
  };
}
