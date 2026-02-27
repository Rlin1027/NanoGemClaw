/**
 * Google Drive Plugin
 *
 * Provides Gemini tools and dashboard routes for Google Drive integration.
 * Depends on the google-auth plugin for OAuth2 credentials.
 *
 * Gemini tools:
 *   - search_drive       — full-text search across Drive
 *   - read_file_content  — read a specific file by ID
 *   - summarize_file     — alias for read_file_content (returns content for Gemini to summarize)
 *
 * Dashboard routes (prefix: /api/plugins/google-drive/files):
 *   GET /recent          — list recently modified files
 *   GET /search?q=...    — search files by keyword
 *   GET /:id/metadata    — get file metadata
 *   GET /:id/content     — get file content
 */

import type {
  NanoPlugin,
  PluginApi,
  GeminiToolContribution,
  RouteContribution,
} from '@nanogemclaw/plugin-api';
import { Router } from 'express';
import { isAuthenticated } from 'nanogemclaw-plugin-google-auth';
import {
  searchFiles,
  listRecentFiles,
  getFileMetadata,
  getFileContent,
  listFolderContents,
} from './drive-api.js';
import { extractContent } from './content-extractor.js';

// Re-export for drive-knowledge-rag plugin and other consumers
export {
  searchFiles,
  getFileContent,
  listFolderContents,
} from './drive-api.js';
export { extractContent } from './content-extractor.js';
export type { DriveFile } from './drive-api.js';

// ---------------------------------------------------------------------------
// Gemini Tools
// ---------------------------------------------------------------------------

/** Shared implementation for read_file_content and summarize_file. */
async function readFileContentImpl(
  args: Record<string, unknown>,
): Promise<string> {
  if (!isAuthenticated()) {
    return 'Google Drive is not connected. Please authorize via Settings → Google Account.';
  }

  const fileId = String(args['file_id'] ?? '');
  if (!fileId.trim()) {
    return 'Please provide a file_id.';
  }

  try {
    const meta = await getFileMetadata(fileId);
    const extracted = await extractContent(fileId, meta.mimeType);

    const header =
      `**${meta.name}**\n` +
      `Type: ${meta.mimeType}\n` +
      (meta.modifiedTime
        ? `Modified: ${new Date(meta.modifiedTime).toLocaleString()}\n`
        : '') +
      (extracted.truncated
        ? '_[Content truncated to 100,000 characters]_\n'
        : '') +
      '\n---\n\n';

    return header + extracted.content;
  } catch (err) {
    return `Failed to read file: ${err instanceof Error ? err.message : String(err)}`;
  }
}

const geminiTools: GeminiToolContribution[] = [
  {
    name: 'search_drive',
    description:
      'Search for files in Google Drive by keyword. Use when user asks about their files or documents.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search keywords' },
        max_results: {
          type: 'NUMBER',
          description: 'Maximum results (default: 10)',
        },
      },
      required: ['query'],
    },
    permission: 'any',

    async execute(args, _context): Promise<string> {
      if (!isAuthenticated()) {
        return 'Google Drive is not connected. Please authorize via Settings → Google Account.';
      }

      const query = String(args['query'] ?? '');
      const maxResults =
        typeof args['max_results'] === 'number' ? args['max_results'] : 10;

      if (!query.trim()) {
        return 'Please provide a search query.';
      }

      try {
        const result = await searchFiles(query, { maxResults });

        if (result.files.length === 0) {
          return `No files found for query: "${query}"`;
        }

        const lines = result.files.map((f, i) => {
          const modified = f.modifiedTime
            ? new Date(f.modifiedTime).toLocaleDateString()
            : 'unknown date';
          const size = f.size ? ` (${formatBytes(Number(f.size))})` : '';
          return `${i + 1}. **${f.name}**${size}\n   ID: ${f.id}\n   Type: ${f.mimeType}\n   Modified: ${modified}`;
        });

        return `Found ${result.totalResults} file(s) for "${query}":\n\n${lines.join('\n\n')}`;
      } catch (err) {
        return `Failed to search Drive: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },

  {
    name: 'read_file_content',
    description:
      'Read the content of a specific Google Drive file. Use after searching to read a particular file.',
    parameters: {
      type: 'OBJECT',
      properties: {
        file_id: { type: 'STRING', description: 'Google Drive file ID' },
      },
      required: ['file_id'],
    },
    permission: 'any',

    async execute(args, _context): Promise<string> {
      return readFileContentImpl(args);
    },
  },

  {
    name: 'summarize_file',
    description:
      'Read and return the content of a Google Drive file so you can summarize it. Use when the user asks to summarize a document.',
    parameters: {
      type: 'OBJECT',
      properties: {
        file_id: { type: 'STRING', description: 'Google Drive file ID' },
      },
      required: ['file_id'],
    },
    permission: 'any',

    async execute(args, _context): Promise<string> {
      return readFileContentImpl(args);
    },
  },
];

// ---------------------------------------------------------------------------
// Dashboard Routes
// ---------------------------------------------------------------------------

function createFilesRouter(): Router {
  const router = Router();

  // GET /recent — list recently modified files
  router.get('/recent', async (req, res) => {
    try {
      if (!isAuthenticated()) {
        res.status(401).json({ error: 'Google Drive not authenticated' });
        return;
      }

      const rawLimit = Number(req.query['limit'] ?? 20);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(1, rawLimit), 100)
        : 20;
      const files = await listRecentFiles(limit);
      res.json({ data: files });
    } catch {
      res.status(500).json({ error: 'Failed to list recent files' });
    }
  });

  // GET /search?q=... — search files
  router.get('/search', async (req, res) => {
    try {
      if (!isAuthenticated()) {
        res.status(401).json({ error: 'Google Drive not authenticated' });
        return;
      }

      const q = String(req.query['q'] ?? '').trim();
      if (!q) {
        res.status(400).json({ error: 'Query parameter "q" is required' });
        return;
      }

      const rawMax = Number(req.query['limit'] ?? 20);
      const maxResults = Number.isFinite(rawMax)
        ? Math.min(Math.max(1, rawMax), 100)
        : 20;
      const result = await searchFiles(q, { maxResults });
      res.json({ data: result });
    } catch {
      res.status(500).json({ error: 'Failed to search files' });
    }
  });

  // GET /:id/metadata — file metadata
  router.get('/:id/metadata', async (req, res) => {
    try {
      if (!isAuthenticated()) {
        res.status(401).json({ error: 'Google Drive not authenticated' });
        return;
      }

      const fileId = req.params['id'];
      if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
        res.status(400).json({ error: 'Invalid file ID' });
        return;
      }

      const metadata = await getFileMetadata(fileId);
      res.json({ data: metadata });
    } catch {
      res.status(500).json({ error: 'Failed to get file metadata' });
    }
  });

  // GET /:id/content — file content (extracted as text)
  router.get('/:id/content', async (req, res) => {
    try {
      if (!isAuthenticated()) {
        res.status(401).json({ error: 'Google Drive not authenticated' });
        return;
      }

      const fileId = req.params['id'];
      if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
        res.status(400).json({ error: 'Invalid file ID' });
        return;
      }

      const meta = await getFileMetadata(fileId);
      const extracted = await extractContent(fileId, meta.mimeType);
      res.json({ data: { ...extracted, file: meta } });
    } catch {
      res.status(500).json({ error: 'Failed to get file content' });
    }
  });

  return router;
}

const routes: RouteContribution[] = [
  {
    prefix: 'files',
    createRouter: createFilesRouter,
  },
];

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const googleDrivePlugin: NanoPlugin = {
  id: 'google-drive',
  name: 'Google Drive',
  version: '0.1.0',
  description:
    'Search and read Google Drive files from Gemini and the dashboard',

  async init(api: PluginApi): Promise<void | false> {
    if (!isAuthenticated()) {
      api.logger.warn(
        'Google Drive: not authenticated — tools are registered but will return an ' +
          'error until the user authorizes via Settings → Google Account.',
      );
    } else {
      api.logger.info('Google Drive: authenticated and ready');
    }
  },

  geminiTools,
  routes,
};

export default googleDrivePlugin;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
