#!/bin/sh
# Zip the extension for the Chrome Web Store: ./scripts/pack.sh → garabato-<version>.zip
set -e
cd "$(dirname "$0")/../extension"
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
out="../garabato-$version.zip"
rm -f "$out"
zip -qr "$out" . -x '.*'
echo "$out"
