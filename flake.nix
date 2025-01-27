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
            rev = "a8b98dc864571f175ad9024cd31a0e50ad8282d0";
            hash = "sha256-VJZ+C90eGzJOmYayrYhOonvyYD/pZbU7Pi9a/uMeCu8=";
          };

          # npmDepsHash = pkgs.lib.fakeHash;
          # npmDepsHash = "sha256-VJZ+C90eGzJOmYayrYhOonvyYD/pZbU7Pi9a/uMeCu8=";

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
