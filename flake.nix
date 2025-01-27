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
            rev = "c92b8276f2b7987f9edc93a8d05a8ed2d22b3c86";
            hash = "sha256-PKIO/yA3NuNVoQv/jBkV8DD3kUg3bMMUzEEaFn0t0hg=";
          };

          npmDepsHash = "sha256-m1nSJ1MGYOOBZIFmZrwWak8rXkfV4Xig8HuSaMUebfc=";

          # Skip the playwright browser download during install
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";

          # Set npm to offline mode after dependencies are cached
          npmFlags = [
            "--ignore-scripts"
            "--offline"
          ];

          # Ensure package-lock.json is consistent
          postPatch = ''
            cp ${./package-lock.json} package-lock.json

            # Use a prepopulated cache directory for NPM
            export npm_config_cache=/home/jaykchen/.npm
            npm install --prefer-offline
          '';

          nativeBuildInputs = with pkgs; [
            makeWrapper
          ];

          buildInputs = with pkgs; [
            nodejs
          ];

          # Allow network access during installation
          NODE_OPTIONS = "--dns-result-order=ipv4first";

          # Set Playwright to install browsers locally
          PLAYWRIGHT_BROWSERS_PATH = "0";

          postInstall = ''
            # Build the project
            npm run build

            # Install Playwright browsers locally
            export HOME=$TMPDIR
            npx playwright install chromium

            # Create necessary directories
            mkdir -p $out/lib/node_modules/js_scraper/dist
            mkdir -p $out/lib/node_modules/js_scraper/.cache/ms-playwright

            # Copy the built bundle and browsers
            cp dist/bundle.cjs $out/lib/node_modules/js_scraper/dist/
            cp -r $TMPDIR/.cache/ms-playwright/* $out/lib/node_modules/js_scraper/.cache/ms-playwright/

            # Create the bin directory and wrapper
            mkdir -p $out/bin
            makeWrapper ${pkgs.nodejs}/bin/node $out/bin/js_scraper \
              --add-flags "$out/lib/node_modules/js_scraper/dist/bundle.cjs" \
              --set NODE_ENV "production" \
              --set PLAYWRIGHT_BROWSERS_PATH "$out/lib/node_modules/js_scraper/.cache/ms-playwright" \
              --set NODE_PATH $out/lib/node_modules
          '';

          meta = with pkgs.lib; {
            description = "JavaScript web scraper using Playwright";
            license = licenses.mit;
            platforms = [ "x86_64-linux" ];
          };
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
          ];

          shellHook = ''
            export PLAYWRIGHT_BROWSERS_PATH="0"
            export NODE_OPTIONS="--dns-result-order=ipv4first"
            export NODE_PATH="$PWD/node_modules"
          '';
        };
      }
    );
}
