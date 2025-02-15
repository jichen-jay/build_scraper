npx esbuild src/index.js --bundle --platform=node --outfile=dist/bundle.cjs --external:express --external:chromium-bidi


nix-build -E 'with import <nixpkgs> {}; callPackage ./default.nix {}'


nix run github:nix-community/nixos-anywhere -- --flake .#sv-nix root@43.130.1.178


npm config get cache

npm cache clean --force
npm install --cache /home/jaykchen/.npm   --prefer-offlin

npm cache add playwright@latest
export PLAYWRIGHT_BROWSERS_PATH=/home/jaykchen/.npm
npx playwright install chromium --force

npm cache add esbuild express playwright-core

npm install --package-lock-only

nix build --option sandbox false


nix build --show-trace --log-format internal-json


rm -rf /home/jaykchen/.playwright-chromium-data/sessionstore-backups
rm -f /home/jaykchen/.playwright-chromium-data/sessionstore.jsonlz4


echo '/scrape/https://example.com' | websocat -v --no-close ws://localhost:3000

chromium --enable-quic --quic-version=h3 --origin-to-force-quic-on=localhost:4433 --allow-insecure-localhost
google-chrome-stable --origin-to-force-quic-on=localhost:4433

//For local development with self-signed certificates, you'll typically also need additional flags like 
--ignore-certificate-errors-spki-list

lsof -ti :3000 | xargs kill -9

