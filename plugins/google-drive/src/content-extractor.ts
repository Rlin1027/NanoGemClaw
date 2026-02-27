/**
 * Content extraction utilities for Google Drive files.
 *
 * Provides a unified `extractContent()` entry point that handles all supported
 * MIME types and returns structured output ready for Gemini context injection.
 */

import { getFileContent } from './drive-api.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTENT_CHARS = 100_000;
const TRUNCATION_MARKER = '... [truncated]';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedContent {
  content: string;
  mimeType: string;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Unified content extraction for any supported Google Drive file.
 *
 * - Google Docs   → exported as text/plain
 * - Google Sheets → exported as text/csv
 * - Google Slides → exported as text/plain
 * - PDF           → downloaded as text (best-effort; no layout preservation)
 * - text/*        → downloaded directly
 *
 * Returns the content capped at MAX_CONTENT_CHARS with a truncation marker.
 */
export async function extractContent(
  fileId: string,
  mimeType: string,
): Promise<ExtractedContent> {
  const effectiveMime = resolveEffectiveMime(mimeType);
  const raw = await getFileContent(fileId, mimeType);
  return truncateContent(raw, MAX_CONTENT_CHARS, effectiveMime);
}

/**
 * Truncate content to `maxChars`, appending a marker when truncation occurs.
 * Exported for unit testing and external use.
 */
export function truncateContent(
  content: string,
  maxChars: number,
  mimeType = 'text/plain',
): ExtractedContent {
  if (content.length <= maxChars) {
    return { content, mimeType, truncated: false };
  }
  return {
    content: content.slice(0, maxChars) + TRUNCATION_MARKER,
    mimeType,
    truncated: true,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Maps a Google Drive MIME type to the format that will be returned after
 * extraction (for metadata purposes — the actual conversion is done in
 * drive-api.ts via the export endpoint).
 */
function resolveEffectiveMime(mimeType: string): string {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
      return 'text/plain';
    case 'application/vnd.google-apps.spreadsheet':
      return 'text/csv';
    case 'application/vnd.google-apps.presentation':
      return 'text/plain';
    case 'application/pdf':
      return 'text/plain';
    default:
      // text/plain, text/markdown, text/html, etc.
      return mimeType.startsWith('text/') ? mimeType : 'text/plain';
  }
}
