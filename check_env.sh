#!/bin/bash

# Colors for output
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "🔍 Checking development environment..."

# Minimum versions. Keep these in sync with README.md "Requirements":
#   node   — Next 16 requires ^20.9 || >=22
#   pnpm   — pinned in package.json "packageManager"; the v9 lockfile needs >= 9
#   rustc  — src-tauri/Cargo.toml "rust-version"
MIN_NODE="20.9.0"
MIN_PNPM="9.0.0"
MIN_RUSTC="1.77.2"

ERRORS=0

# Is $1 >= $2, comparing dotted versions? Uses sort -V, so 1.10 > 1.9.
version_ge() {
    [ "$1" = "$2" ] && return 0
    [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" = "$2" ]
}

# Strip everything that is not part of a dotted version (v20.11.0, 1.77.2 (abc), …)
extract_version() {
    printf '%s' "$1" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -n 1
}

# check_version <command> <version-args> <minimum>
check_version() {
    local cmd="$1" version_args="$2" minimum="$3" raw found

    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo -e "${RED}❌ $cmd is NOT installed (need >= $minimum).${NC}"
        ERRORS=$((ERRORS + 1))
        return 1
    fi

    raw="$($cmd $version_args 2>&1 | head -n 1)"
    found="$(extract_version "$raw")"

    if [ -z "$found" ]; then
        echo -e "${YELLOW}⚠️  $cmd is installed but its version could not be read ('$raw'). Need >= $minimum.${NC}"
        return 0
    fi

    if version_ge "$found" "$minimum"; then
        echo -e "${GREEN}✅ $cmd $found (>= $minimum)${NC}"
    else
        echo -e "${RED}❌ $cmd $found is too old — need >= $minimum.${NC}"
        ERRORS=$((ERRORS + 1))
    fi
}

check_version node --version "$MIN_NODE"
check_version pnpm --version "$MIN_PNPM"
check_version rustc --version "$MIN_RUSTC"

# cargo ships with rustc; only its presence matters.
if command -v cargo >/dev/null 2>&1; then
    echo -e "${GREEN}✅ cargo is installed: $(cargo --version)${NC}"
else
    echo -e "${RED}❌ cargo is NOT installed.${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check if src-tauri exists
if [ -d "src-tauri" ]; then
    echo -e "${GREEN}✅ src-tauri directory found.${NC}"
else
    echo -e "${RED}❌ src-tauri directory NOT found. Are you in the project root?${NC}"
    ERRORS=$((ERRORS + 1))
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
