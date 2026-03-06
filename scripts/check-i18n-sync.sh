#!/usr/bin/env bash
# Verifies that the EN (root) and ZH-TW content directories have identical file trees.
# Fails with exit code 1 if they diverge — use in CI to catch missing translations.
set -euo pipefail

EN_DIRS="guide tutorials plugins reference deployment troubleshooting"
SITE_ROOT="docs-site"

EN_FILES=$(cd "$SITE_ROOT" && find $EN_DIRS -name '*.md' 2>/dev/null | sort)
ZH_FILES=$(cd "$SITE_ROOT/zh-TW" && find $EN_DIRS -name '*.md' 2>/dev/null | sort)

if diff <(echo "$EN_FILES") <(echo "$ZH_FILES") > /dev/null 2>&1; then
    echo "i18n sync check passed: EN and ZH-TW file trees match."
else
    echo "i18n sync check FAILED: EN and ZH-TW file trees differ."
    echo ""
    echo "--- EN files ---"
    echo "$EN_FILES"
    echo ""
    echo "--- ZH-TW files ---"
    echo "$ZH_FILES"
    echo ""
    diff <(echo "$EN_FILES") <(echo "$ZH_FILES") || true
    exit 1
fi
