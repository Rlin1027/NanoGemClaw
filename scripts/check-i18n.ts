/**
 * CI i18n Key Completeness Checker
 *
 * Validates that all locale JSON files have the same set of keys.
 * Reports missing keys and exits with non-zero status on failure.
 *
 * Usage:
 *   npx tsx scripts/check-i18n.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ============================================================================
// Backend locale checking
// ============================================================================

const BACKEND_LOCALES_DIR = path.join(ROOT, 'src', 'i18n', 'locales');
const REFERENCE_LANG = 'en';

function checkBackendLocales(): boolean {
  console.log('\n=== Backend i18n Locale Check ===');

  if (!fs.existsSync(BACKEND_LOCALES_DIR)) {
    console.error(`ERROR: Backend locales directory not found: ${BACKEND_LOCALES_DIR}`);
    return false;
  }

  const files = fs.readdirSync(BACKEND_LOCALES_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('ERROR: No locale JSON files found in backend locales directory.');
    return false;
  }

  const referencePath = path.join(BACKEND_LOCALES_DIR, `${REFERENCE_LANG}.json`);
  if (!fs.existsSync(referencePath)) {
    console.error(`ERROR: Reference locale file not found: ${referencePath}`);
    return false;
  }

  const referenceKeys = new Set(
    Object.keys(JSON.parse(fs.readFileSync(referencePath, 'utf-8'))),
  );
  console.log(`Reference (${REFERENCE_LANG}): ${referenceKeys.size} keys`);

  let allPassed = true;

  for (const file of files) {
    const lang = file.replace('.json', '');
    if (lang === REFERENCE_LANG) continue;

    const filePath = path.join(BACKEND_LOCALES_DIR, file);
    let keys: Set<string>;
    try {
      keys = new Set(Object.keys(JSON.parse(fs.readFileSync(filePath, 'utf-8'))));
    } catch (err) {
      console.error(`ERROR: Failed to parse ${file}: ${err}`);
      allPassed = false;
      continue;
    }

    const missing = [...referenceKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !referenceKeys.has(k));

    if (missing.length === 0 && extra.length === 0) {
      console.log(`  ✓ ${lang}: ${keys.size} keys (complete)`);
    } else {
      allPassed = false;
      if (missing.length > 0) {
        console.error(`  ✗ ${lang}: MISSING keys: ${missing.join(', ')}`);
      }
      if (extra.length > 0) {
        console.warn(`  ! ${lang}: EXTRA keys (not in ${REFERENCE_LANG}): ${extra.join(', ')}`);
      }
    }
  }

  return allPassed;
}

// ============================================================================
// Dashboard locale checking
// ============================================================================

const DASHBOARD_LOCALES_DIR = path.join(
  ROOT,
  'packages',
  'dashboard',
  'src',
  'i18n',
  'locales',
);

function checkDashboardLocales(): boolean {
  console.log('\n=== Dashboard i18n Locale Check ===');

  if (!fs.existsSync(DASHBOARD_LOCALES_DIR)) {
    console.log('Dashboard locales directory not found — skipping.');
    return true;
  }

  const langDirs = fs
    .readdirSync(DASHBOARD_LOCALES_DIR)
    .filter((d) => fs.statSync(path.join(DASHBOARD_LOCALES_DIR, d)).isDirectory());

  if (langDirs.length === 0) {
    console.log('No language directories found in dashboard locales — skipping.');
    return true;
  }

  if (!langDirs.includes(REFERENCE_LANG)) {
    console.error(`ERROR: Reference language '${REFERENCE_LANG}' not found in dashboard locales.`);
    return false;
  }

  const refLangDir = path.join(DASHBOARD_LOCALES_DIR, REFERENCE_LANG);
  const namespaces = fs
    .readdirSync(refLangDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));

  console.log(`Reference (${REFERENCE_LANG}): ${namespaces.length} namespaces`);

  let allPassed = true;

  for (const ns of namespaces) {
    const refPath = path.join(refLangDir, `${ns}.json`);
    const refKeys = new Set(Object.keys(JSON.parse(fs.readFileSync(refPath, 'utf-8'))));

    for (const lang of langDirs) {
      if (lang === REFERENCE_LANG) continue;

      const nsPath = path.join(DASHBOARD_LOCALES_DIR, lang, `${ns}.json`);
      if (!fs.existsSync(nsPath)) {
        console.error(`  ✗ ${lang}/${ns}.json: FILE MISSING`);
        allPassed = false;
        continue;
      }

      let keys: Set<string>;
      try {
        keys = new Set(Object.keys(JSON.parse(fs.readFileSync(nsPath, 'utf-8'))));
      } catch (err) {
        console.error(`  ✗ ${lang}/${ns}.json: PARSE ERROR: ${err}`);
        allPassed = false;
        continue;
      }

      const missing = [...refKeys].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !refKeys.has(k));

      if (missing.length === 0 && extra.length === 0) {
        console.log(`  ✓ ${lang}/${ns}: ${keys.size} keys (complete)`);
      } else {
        allPassed = false;
        if (missing.length > 0) {
          console.error(`  ✗ ${lang}/${ns}: MISSING keys: ${missing.join(', ')}`);
        }
        if (extra.length > 0) {
          console.warn(`  ! ${lang}/${ns}: EXTRA keys: ${extra.join(', ')}`);
        }
      }
    }
  }

  return allPassed;
}

// ============================================================================
// Main
// ============================================================================

const backendOk = checkBackendLocales();
const dashboardOk = checkDashboardLocales();

if (backendOk && dashboardOk) {
  console.log('\n✓ All i18n locale checks passed.\n');
  process.exit(0);
} else {
  console.error('\n✗ i18n locale checks FAILED. Fix missing keys above.\n');
  process.exit(1);
}
