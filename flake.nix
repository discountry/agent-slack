{
  description = "slack: Slack automation CLI for AI agents";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {inherit system;};
      slack = pkgs.callPackage ./nix/package.nix {};
    in {
      packages = {
        inherit slack;
        default = slack;
      };

      apps = {
        default = flake-utils.lib.mkApp {
          drv = slack;
          name = "slack";
        };
      };
    });
}
