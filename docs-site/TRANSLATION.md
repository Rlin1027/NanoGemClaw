# Translation Guide

This document describes the workflow for maintaining bilingual content in the NanoGemClaw documentation site.

## Directory Structure

- **English (EN)**: Content lives at the root of `docs-site/` (e.g., `guide/quickstart.md`)
- **Traditional Chinese (ZH-TW)**: Content lives under `docs-site/zh-TW/` (e.g., `zh-TW/guide/quickstart.md`)

## Adding a New Page

1. Create the English page first under the appropriate directory (e.g., `guide/new-page.md`)
2. Create the matching ZH-TW page at `zh-TW/guide/new-page.md`
3. Add sidebar entries for both locales in `.vitepress/config.ts`
4. Run `bash scripts/check-i18n-sync.sh` to verify the file trees match

## Translation Conventions

- **Code blocks**: Keep all code in English (variable names, commands, file paths)
- **Code comments**: Translate to ZH-TW
- **Technical terms**: Keep English in parentheses on first use (e.g., "外掛程式 (Plugin)")
- **Internal links**: ZH-TW pages must use `/zh-TW/` prefix (e.g., `/zh-TW/guide/quickstart`)
- **Frontmatter**: Translate `title` and `description` fields
- **VitePress features**: Keep identical structure (`:::tip`, `:::warning`, `:::code-group`, `:::details`)

## Verification

```bash
# Check that EN and ZH-TW file trees are in sync
bash scripts/check-i18n-sync.sh

# Build the site (catches broken links)
npm --prefix docs-site run docs:build
```

The CI workflow (`.github/workflows/docs.yml`) runs the sync check automatically before building.
