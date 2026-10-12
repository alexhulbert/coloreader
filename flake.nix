{
  description = "Coloreader palette bridge and Electron injector";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }: let
    pkgs = nixpkgs.legacyPackages.x86_64-linux;
  in {
    packages.x86_64-linux = {
      bridge = pkgs.callPackage ./nix/bridge.nix {};
      electron-injector = pkgs.callPackage ./nix/electron-injector.nix {};
      default = self.packages.x86_64-linux.bridge;
    };
    homeModules.default = import ./nix/home-manager.nix;
    checks.x86_64-linux = {
      inherit (self.packages.x86_64-linux) bridge electron-injector;
    };
  };
}
