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

/**
 * MIME types that cannot be meaningfully extracted as text.
 * These are binary formats — downloading with responseType:'text' yields garbage.
 */
const BINARY_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/msword', // .doc
  'application/vnd.ms-excel', // .xls
  'application/vnd.ms-powerpoint', // .ppt
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'audio/mpeg',
  'audio/ogg',
  'video/mp4',
]);

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
  // Reject known binary formats — downloading them as text yields garbage
  if (BINARY_MIME_TYPES.has(mimeType)) {
    return {
      content: `[Binary file — cannot extract text from ${mimeType}]`,
      mimeType: 'text/plain',
      truncated: false,
    };
  }

  const effectiveMime = resolveEffectiveMime(mimeType);
  const raw = await getFileContent(fileId, mimeType);

  // Safety check: detect binary content that slipped through
  // (e.g. unknown MIME types that are actually binary)
  if (looksLikeBinary(raw)) {
    return {
      content: `[Binary content detected — cannot extract text from ${mimeType}]`,
      mimeType: 'text/plain',
      truncated: false,
    };
  }

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
 * Heuristic check for binary content that was incorrectly decoded as text.
 * Looks for null bytes and common binary file signatures (ZIP/PK, PDF header).
 */
function looksLikeBinary(content: string): boolean {
  // Check first 512 chars for signs of binary data
  const head = content.slice(0, 512);
  // Null bytes are a strong indicator of binary content
  if (head.includes('\0')) return true;
  // ZIP magic bytes (PK\x03\x04) — covers .docx, .xlsx, .pptx, .zip
  if (head.startsWith('PK')) return true;
  return false;
}

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
