npx esbuild src/index.js --bundle --platform=node --outfile=dist/bundle.cjs --external:express --external:chromium-bidi


nix-build -E 'with import <nixpkgs> {}; callPackage ./default.nix {}'


nix run github:nix-community/nixos-anywhere -- --flake .#sv-nix root@43.130.1.178



