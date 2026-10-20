{ lib, buildNpmPackage, importNpmLock, nodejs_24, autoPatchelfHook, stdenv }:

let
  pin = lib.importJSON ../upstream.json;
  upstream = (builtins.fetchGit {
    url = pin.repository;
    rev = pin.commit;
    shallow = true;
  }).outPath;
  stdlib = (builtins.fetchGit {
    url = "https://github.com/getgrit/stdlib.git";
    rev = "42d432f2f70efe8935ec702cf4399770aad8b521";
    shallow = true;
  }).outPath;
in buildNpmPackage {
  pname = "coloreader-electron-injector";
  version = lib.removePrefix "v" pin.tag;
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json ../package-lock.json ../upstream.json
      ../scripts ../patches ../site-fixes ../electron-injector ../LICENSE
    ];
  };
  nodejs = nodejs_24;
  npmDeps = importNpmLock { npmRoot = ../.; };
  npmConfigHook = importNpmLock.npmConfigHook;
  npmRebuildFlags = [ "--ignore-scripts" ];
  nativeBuildInputs = [ autoPatchelfHook ];
  buildInputs = [ stdenv.cc.cc.lib ];
  autoPatchelfIgnoreMissingDeps = [ "libc.musl-x86_64.so.1" ];
  env.COLOREADER_UPSTREAM_SOURCE = upstream;

  preBuild = ''
    mkdir -p .work
    mkdir -p .work/grit/.gritmodules/github.com/getgrit
    ln -s ${stdlib} .work/grit/.gritmodules/github.com/getgrit/stdlib
    cp -R ${upstream} .work/darkreader
    chmod -R u+w .work/darkreader
    pushd .work/darkreader
    npmDeps=${importNpmLock { npmRoot = upstream; }} npmConfigHook
    popd
    autoPatchelf node_modules .work/darkreader/node_modules
  '';
  buildPhase = ''
    runHook preBuild
    node scripts/upstream.mjs patch
    node electron-injector/build.mjs
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    node --test electron-injector/tests/*.test.mjs
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    install -Dm755 .work/electron-injector/libcoloreader.so $out/lib/libcoloreader.so
    runHook postInstall
  '';
  meta = {
    description = "Coloreader renderer injected into selected Electron applications";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
  };
}
