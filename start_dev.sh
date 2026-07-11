#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "🔍 Checking environment..."
./check_env.sh

echo "📦 Installing dependencies..."
pnpm install

echo "🚀 Starting Tauri dev environment..."
pnpm run tauri:dev
