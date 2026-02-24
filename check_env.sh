#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "🔍 Checking development environment..."

# Function to check command existence
check_cmd() {
    if command -v "$1" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ $1 is installed: $($1 --version | head -n 1)${NC}"
        return 0
    else
        echo -e "${RED}❌ $1 is NOT installed.${NC}"
        return 1
    fi
}

ERRORS=0

# Check Node.js
check_cmd node || ERRORS=$((ERRORS+1))

# Check pnpm
check_cmd pnpm || ERRORS=$((ERRORS+1))

# Check Rust (for Tauri)
check_cmd rustc || ERRORS=$((ERRORS+1))
check_cmd cargo || ERRORS=$((ERRORS+1))

# Check if src-tauri exists
if [ -d "src-tauri" ]; then
    echo -e "${GREEN}✅ src-tauri directory found.${NC}"
else
    echo -e "${RED}❌ src-tauri directory NOT found. Are you in the project root?${NC}"
    ERRORS=$((ERRORS+1))
fi

if [ $ERRORS -gt 0 ]; then
    echo -e "
${RED}⚠️  Found $ERRORS issue(s). Please fix them before running the project.${NC}"
    exit 1
else
    echo -e "
${GREEN}🚀 Environment looks good!${NC}"
    exit 0
fi
