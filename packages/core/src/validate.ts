/**
 * Unified Input Validation Helpers
 *
 * Central place for all shared validation patterns used across the codebase.
 * Prevents path traversal, FTS5 injection, and control character attacks.
 */

/** Safe folder name: alphanumeric, underscore, hyphen only (path traversal protection) */
export const SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate a group folder name. Returns the folder name if valid.
 * Throws an error with a descriptive message if invalid.
 */
export function validateFolderName(folder: string): string {
    if (!SAFE_FOLDER_RE.test(folder)) {
        throw new Error(`Invalid folder name: ${JSON.stringify(folder)}`);
    }
    return folder;
}

/**
 * Sanitize a user-provided query for safe use in FTS5 MATCH expressions.
 * Strips special FTS5 operators, splits into tokens, and joins with OR
 * for better recall with the trigram tokenizer.
 */
export function escapeFts5Query(query: string): string {
    const stripped = query.replace(/[*^{}():\-+]/g, '');
    const tokens = stripped.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) return '""';
    if (tokens.length === 1) return `"${tokens[0].replace(/"/g, '""')}"`;
    return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

/**
 * Remove control characters from a string.
 * Strips NUL (0x00), BEL (0x07), BS (0x08), DEL (0x7F),
 * and C0/C1 control chars (0x00-0x1F, 0x80-0x9F).
 */
export function stripControlChars(input: string): string {
    // eslint-disable-next-line no-control-regex
    return input.replace(/[\x00-\x1F\x7F\x80-\x9F]/g, '');
}
