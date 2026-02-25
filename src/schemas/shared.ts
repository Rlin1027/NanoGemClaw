import { z } from 'zod';

/** Folder name: alphanumeric, underscore, hyphen only (path traversal protection) */
export const folderParam = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid folder name');

/** Safe filename: alphanumeric, underscore, hyphen, dot */
export const safeFileParam = z
  .string()
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid filename');

/** Numeric string param: parses to non-negative integer */
export const numericStringParam = z
  .string()
  .regex(/^\d+$/, 'Must be a non-negative integer')
  .transform((val) => parseInt(val, 10));

/** Pagination query params */
export const paginationQuery = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return 50;
      const n = parseInt(val, 10);
      return isNaN(n) ? 50 : Math.min(Math.max(1, n), 200);
    }),
  offset: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return 0;
      const n = parseInt(val, 10);
      return isNaN(n) ? 0 : Math.max(0, n);
    }),
});

/** Chat ID: optional negative sign followed by digits */
export const chatIdParam = z.string().regex(/^-?\d+$/, 'Invalid chat ID');

/** Knowledge document filename: alphanumeric/underscore/hyphen + .md extension */
export const knowledgeFilename = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+\.md$/, 'Invalid knowledge filename');

/** Raw regex for path traversal protection (for use in non-Zod contexts) */
export const SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/;
