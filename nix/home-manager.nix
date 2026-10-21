{ config, lib, pkgs, ... }:

let
  cfg = config.services.coloreader;
in {
  options.services.coloreader = {
    enable = lib.mkEnableOption "the Coloreader palette bridge";
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ./bridge.nix {};
      description = "The Coloreader bridge package.";
    };
    paletteFile = lib.mkOption {
      type = lib.types.str;
      default = "${config.xdg.cacheHome}/coloreader.json";
      description = "Palette JSON file written by Matugen or another palette generator.";
    };
    allowedOrigins = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      description = "Additional WebSocket origins allowed to receive palettes, matched exactly.";
    };
    electron = {
      enable = lib.mkEnableOption "the opt-in Coloreader Electron launcher";
      package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.callPackage ./electron-injector.nix {};
        description = "The Coloreader Electron injector package.";
      };
      launcher = lib.mkOption {
        type = lib.types.package;
        readOnly = true;
        default = pkgs.writeShellScriptBin "coloreader-electron" ''
          export LD_PRELOAD=${lib.escapeShellArg "${cfg.electron.package}/lib/libcoloreader.so"}"''${LD_PRELOAD:+:$LD_PRELOAD}"
          exec "$@"
        '';
        description = "Launcher to use in selected GUI applications' desktop entries and shortcuts.";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.user.services.coloreader = {
      Unit = {
        Description = "Coloreader palette bridge";
        PartOf = [ "graphical-session.target" ];
        After = [ "graphical-session.target" ];
      };
      Service = {
        ExecStart = lib.escapeShellArgs (
          [ (lib.getExe cfg.package) cfg.paletteFile ]
          ++ lib.concatMap (origin: [ "--allow-origin" origin ]) cfg.allowedOrigins
        );
        Restart = "on-failure";
        RestartSec = 1;
      };
      Install.WantedBy = [ "graphical-session.target" ];
    };
    home.packages = lib.mkIf cfg.electron.enable [ cfg.electron.launcher ];
  };
}
