/**
 * Drive Knowledge RAG Plugin
 *
 * Provides a two-layer retrieval-augmented-generation (RAG) search over
 * Google Drive documents:
 *
 *   Layer 1 — local embedding index (pre-indexed, zero latency)
 *   Layer 2 — live Drive full-text search (fallback, broader coverage)
 *
 * Dependencies: nanogemclaw-plugin-google-auth, nanogemclaw-plugin-google-drive
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import type { NanoPlugin, PluginApi } from '@nanogemclaw/plugin-api';
import { isAuthenticated } from 'nanogemclaw-plugin-google-auth';
import { loadIndex, saveIndex, emptyIndex, scanAndIndex } from './indexer.js';
import type { KnowledgeIndex } from './indexer.js';
import { searchKnowledge } from './search.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface RAGConfig {
  knowledgeFolderIds: string[];
  scanIntervalMinutes: number;
  similarityThreshold: number;
  maxChunkChars: number;
  maxResults: number;
}

const DEFAULT_CONFIG: RAGConfig = {
  knowledgeFolderIds: [],
  scanIntervalMinutes: 30,
  similarityThreshold: 0.7,
  maxChunkChars: 1000,
  maxResults: 5,
};

async function loadConfig(dataDir: string): Promise<RAGConfig> {
  const configPath = path.join(dataDir, 'rag-config.json');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<RAGConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function saveConfig(dataDir: string, config: RAGConfig): Promise<void> {
  const configPath = path.join(dataDir, 'rag-config.json');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Module-level state (shared between lifecycle methods, services, tools, routes)
// ---------------------------------------------------------------------------

let pluginApi: PluginApi | null = null;
let ragConfig: RAGConfig = { ...DEFAULT_CONFIG };
let knowledgeIndex: KnowledgeIndex = emptyIndex();
let scanTimer: ReturnType<typeof setInterval> | null = null;
let scanInProgress = false;

// ---------------------------------------------------------------------------
// Background indexer service
// ---------------------------------------------------------------------------

async function runScan(): Promise<void> {
  if (scanInProgress) return;
  if (!isAuthenticated()) {
    pluginApi?.logger.debug(
      'drive-knowledge-rag: skipping scan — Google not authenticated',
    );
    return;
  }
  if (!pluginApi) return;

  scanInProgress = true;
  try {
    await scanAndIndex(
      ragConfig.knowledgeFolderIds,
      knowledgeIndex,
      ragConfig.maxChunkChars,
      pluginApi,
    );
  } catch (err) {
    pluginApi.logger.error(`drive-knowledge-rag: scan failed — ${err}`);
  } finally {
    scanInProgress = false;
  }
}

const indexerService = {
  name: 'knowledge-indexer',

  async start(api: PluginApi): Promise<void> {
    pluginApi = api;
    const intervalMs = ragConfig.scanIntervalMinutes * 60 * 1000;

    // Run initial scan immediately (non-blocking)
    void runScan();

    scanTimer = setInterval(() => {
      void runScan();
    }, intervalMs);

    api.logger.info(
      `drive-knowledge-rag: indexer started (interval=${ragConfig.scanIntervalMinutes} min)`,
    );
  },

  async stop(): Promise<void> {
    if (scanTimer !== null) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    pluginApi?.logger.info('drive-knowledge-rag: indexer stopped');
  },
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function createRouter(): Router {
  const router = Router();

  // GET /config
  router.get('/config', (_req, res) => {
    res.json({ data: ragConfig });
  });

  // PUT /config
  router.put('/config', async (req, res) => {
    const body = req.body as Partial<RAGConfig>;

    // Validate individual fields if present
    if (
      body.knowledgeFolderIds !== undefined &&
      !Array.isArray(body.knowledgeFolderIds)
    ) {
      res.status(400).json({ error: 'knowledgeFolderIds must be an array' });
      return;
    }
    if (
      body.scanIntervalMinutes !== undefined &&
      (typeof body.scanIntervalMinutes !== 'number' ||
        body.scanIntervalMinutes < 1)
    ) {
      res
        .status(400)
        .json({ error: 'scanIntervalMinutes must be a positive number' });
      return;
    }
    if (
      body.similarityThreshold !== undefined &&
      (typeof body.similarityThreshold !== 'number' ||
        body.similarityThreshold < 0 ||
        body.similarityThreshold > 1)
    ) {
      res
        .status(400)
        .json({ error: 'similarityThreshold must be between 0 and 1' });
      return;
    }
    if (
      body.maxChunkChars !== undefined &&
      (typeof body.maxChunkChars !== 'number' || body.maxChunkChars < 100)
    ) {
      res.status(400).json({ error: 'maxChunkChars must be >= 100' });
      return;
    }
    if (
      body.maxResults !== undefined &&
      (typeof body.maxResults !== 'number' || body.maxResults < 1)
    ) {
      res.status(400).json({ error: 'maxResults must be >= 1' });
      return;
    }

    ragConfig = { ...ragConfig, ...body };

    // Restart scan timer if interval changed
    if (
      body.scanIntervalMinutes !== undefined &&
      scanTimer !== null &&
      pluginApi
    ) {
      clearInterval(scanTimer);
      const intervalMs = ragConfig.scanIntervalMinutes * 60 * 1000;
      scanTimer = setInterval(() => {
        void runScan();
      }, intervalMs);
    }

    if (!pluginApi) {
      res.status(503).json({ error: 'Plugin not yet started' });
      return;
    }
    try {
      await saveConfig(pluginApi.dataDir, ragConfig);
      res.json({ data: ragConfig });
    } catch {
      res.status(500).json({ error: 'Failed to persist config' });
    }
  });

  // GET /indexed-files
  router.get('/indexed-files', (_req, res) => {
    const docs = Object.values(knowledgeIndex.documents).map((doc) => ({
      fileId: doc.fileId,
      name: doc.name,
      mimeType: doc.mimeType,
      modifiedTime: doc.modifiedTime,
      chunkCount: doc.chunks.length,
    }));
    res.json({
      data: {
        files: docs,
        totalDocuments: docs.length,
        lastScanAt: knowledgeIndex.lastScanAt,
      },
    });
  });

  // POST /reindex — trigger an immediate scan
  router.post('/reindex', async (_req, res) => {
    if (!pluginApi) {
      res.status(503).json({ error: 'Plugin not yet started' });
      return;
    }
    if (scanInProgress) {
      res.status(409).json({ error: 'Scan already in progress' });
      return;
    }
    if (!isAuthenticated()) {
      res.status(401).json({ error: 'Google account not authenticated' });
      return;
    }

    // Fire-and-forget; respond immediately
    void runScan();
    res.json({ data: { message: 'Re-index started' } });
  });

  // DELETE /index — wipe the index
  router.delete('/index', async (_req, res) => {
    if (!pluginApi) {
      res.status(503).json({ error: 'Plugin not yet started' });
      return;
    }
    knowledgeIndex = emptyIndex();
    try {
      await saveIndex(pluginApi.dataDir, knowledgeIndex);
      res.json({ data: { message: 'Index cleared' } });
    } catch {
      res.status(500).json({ error: 'Failed to clear index' });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin: NanoPlugin = {
  id: 'drive-knowledge-rag',
  name: 'Drive Knowledge RAG',
  version: '0.1.0',
  description:
    'Two-layer RAG search over Google Drive: pre-indexed embeddings + live Drive fallback',

  async init(api: PluginApi): Promise<void | false> {
    pluginApi = api;

    // google-auth dependency is validated at import time (ESM).
    // If the import at the top of this file fails, this code never runs.
    if (!isAuthenticated()) {
      api.logger.info(
        'drive-knowledge-rag: Google not yet authenticated — will index when authorized',
      );
    }

    // Load persisted config
    try {
      ragConfig = await loadConfig(api.dataDir);
    } catch {
      api.logger.warn(
        'drive-knowledge-rag: failed to load config, using defaults',
      );
      ragConfig = { ...DEFAULT_CONFIG };
    }

    // Load persisted index
    try {
      knowledgeIndex = await loadIndex(api.dataDir);
      const docCount = Object.keys(knowledgeIndex.documents).length;
      api.logger.info(
        `drive-knowledge-rag: loaded index with ${docCount} document(s)`,
      );
    } catch {
      api.logger.warn(
        'drive-knowledge-rag: failed to load index, starting fresh',
      );
      knowledgeIndex = emptyIndex();
    }

    if (!process.env.GEMINI_API_KEY) {
      api.logger.warn(
        'drive-knowledge-rag: GEMINI_API_KEY not set — embeddings will fail at runtime',
      );
    }

    api.logger.info('drive-knowledge-rag: initialized');
  },

  async stop(): Promise<void> {
    await indexerService.stop();
  },

  geminiTools: [
    {
      name: 'search_knowledge',
      description:
        'Search the knowledge base (indexed Google Drive documents) for relevant information. ' +
        'Use when user asks questions that might be answered by their documents.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: {
            type: 'STRING',
            description: 'Search query describing what information to find',
          },
          max_results: {
            type: 'NUMBER',
            description: 'Maximum results to return (default: 5)',
          },
        },
        required: ['query'],
      },
      permission: 'any',

      async execute(args, _context): Promise<string> {
        const query = args['query'];
        if (typeof query !== 'string' || query.trim().length === 0) {
          return 'Error: query must be a non-empty string.';
        }

        const maxResults =
          typeof args['max_results'] === 'number'
            ? Math.min(Math.max(1, Math.floor(args['max_results'])), 20)
            : ragConfig.maxResults;

        if (!isAuthenticated()) {
          return 'Google account is not authenticated. Please connect via the dashboard Settings.';
        }

        let results;
        try {
          results = await searchKnowledge(query, knowledgeIndex, {
            maxResults,
            similarityThreshold: ragConfig.similarityThreshold,
          });
        } catch (err) {
          return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
        }

        if (results.length === 0) {
          return 'No relevant documents found for that query.';
        }

        const formatted = results
          .map((r, i) => {
            const sourceLabel =
              r.source === 'index' ? 'indexed' : 'live search';
            const scoreLabel =
              r.source === 'index' ? ` (score: ${r.score.toFixed(2)})` : '';
            return (
              `[${i + 1}] **${r.fileName}** — ${sourceLabel}${scoreLabel}\n` +
              `${r.snippet.trim()}`
            );
          })
          .join('\n\n');

        return `Found ${results.length} result(s):\n\n${formatted}`;
      },
    },
  ],

  services: [indexerService],

  routes: [
    {
      prefix: '',
      createRouter,
    },
  ],
};

export default plugin;
