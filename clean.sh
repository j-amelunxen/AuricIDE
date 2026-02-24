#!/usr/bin/env bash
set -euo pipefail

echo "Cleaning node_modules..."
rm -rf "node_modules"

echo "Cleaning src-tauri/target..."
rm -rf "src-tauri/target"

echo "Cleaning nextJS..."
rm -rf ".next"

echo "Cleaning out..."
rm -rf "out"

echo "Done."
