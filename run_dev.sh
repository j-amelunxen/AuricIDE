#!/bin/bash
set -e

echo "🔍 Checking environment..."
./check_env.sh

echo "📦 Installing dependencies..."
pnpm install

echo "🚀 Starting Tauri dev environment..."
pnpm run tauri:dev
