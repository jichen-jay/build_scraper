{
  description = "JavaScript web scraper with Playwright";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {

        packages.default = pkgs.buildNpmPackage {
          pname = "js_scraper";
          version = "1.0.0";
          src = pkgs.fetchFromGitHub {
            owner = "jichen-jay";
            repo = "build_scraper";
            rev = "5fe9926ac158ea3090d8a5afe8a423e6d2e3c740";
            hash = "sha256-SwD56+ZuxNSHHEERACokII5fs6zJwqaYCHxOFJnapoQ=";
          };

          npmDepsHash = "sha256-m1nSJ1MGYOOBZIFmZrwWak8rXkfV4Xig8HuSaMUebfc=";

          nativeBuildInputs = with pkgs; [
            makeWrapper
          ];

          buildInputs = with pkgs; [
            nodejs
            playwright-driver
          ];

          npmFlags = [ "--ignore-scripts" ];

          postInstall = ''
            # Build the project
            npm run build

            # Create necessary directories
            mkdir -p $out/lib/node_modules/js_scraper/dist

            # Copy the built bundle
            cp dist/bundle.cjs $out/lib/node_modules/js_scraper/dist/

            # Create the bin directory and wrapper
            mkdir -p $out/bin
            makeWrapper ${pkgs.nodejs}/bin/node $out/bin/js_scraper \
              --add-flags "$out/lib/node_modules/js_scraper/dist/bundle.cjs" \
              --set NODE_ENV "production" \
              --set PLAYWRIGHT_BROWSERS_PATH "${pkgs.playwright-driver.browsers}" \
              --set NODE_PATH $out/lib/node_modules
          '';

          meta = with pkgs.lib; {
            description = "JavaScript web scraper using Playwright";
            license = licenses.mit;
            platforms = platforms.all;
          };
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            playwright-driver
          ];

          shellHook = ''
            export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
            export NODE_PATH="$PWD/node_modules"
          '';
        };
      }
    );
}
