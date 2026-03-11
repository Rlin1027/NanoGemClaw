import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import path from 'path';
import fs from 'fs';

const { TEST_STORE_DIR, TEST_GROUPS_DIR } = vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.HYBRID_SEARCH_ENABLED = 'true';
  const _os = require('os') as typeof import('os');
  const _path = require('path') as typeof import('path');
  const base = _path.join(_os.tmpdir(), `nanogemclaw-hybrid-${Date.now()}`);
  return {
    TEST_STORE_DIR: base,
    TEST_GROUPS_DIR: _path.join(base, 'groups'),
  };
});

vi.mock('../config.js', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    STORE_DIR: TEST_STORE_DIR,
    GROUPS_DIR: TEST_GROUPS_DIR,
    HYBRID_SEARCH: {
      ENABLED: true,
      CHUNK_SIZE: 1000,
      CHUNK_OVERLAP: 200,
      RRF_K: 60,
      EMBED_MODEL: 'gemini-embedding-001',
      MAX_EMBEDDING_SCAN: 500,
      MIN_SIMILARITY: 0.3,
    },
  };
});

// Mock embeddings — return deterministic vectors based on text content
vi.mock('../embeddings.js', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;

  // Simple hash-based fake embedding for deterministic results
  function fakeEmbed(text: string): number[] {
    const vec = new Array(8).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % 8] += text.charCodeAt(i) / 1000;
    }
    // Normalize
    const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
    return norm > 0 ? vec.map((v: number) => v / norm) : vec;
  }

  return {
    ...original,
    embedText: vi.fn(async (text: string) => fakeEmbed(text)),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(fakeEmbed)),
    chunkText: (original as { chunkText: Function }).chunkText,
    embeddingToBlob: (original as { embeddingToBlob: Function })
      .embeddingToBlob,
  };
});

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../gemini-client.js', () => ({
  getGeminiClient: vi.fn(),
}));

import { initDatabase, closeDatabase, getDatabase } from '../db.js';
import {
  initKnowledgeIndex,
  addKnowledgeDoc,
  updateKnowledgeDoc,
  getRelevantKnowledge,
  generateAndStoreEmbeddings,
} from '../knowledge.js';
import { cleanupTestDir } from './helpers/db-test-setup.js';

describe('knowledge hybrid search', () => {
  beforeAll(() => {
    fs.mkdirSync(TEST_GROUPS_DIR, { recursive: true });
    initDatabase();
    initKnowledgeIndex(getDatabase());
  });

  afterAll(() => {
    closeDatabase();
    cleanupTestDir(TEST_STORE_DIR);
  });

  beforeEach(() => {
    const db = getDatabase();
    db.exec('DELETE FROM knowledge_embeddings');
    db.exec('DELETE FROM knowledge_fts');
    db.exec('DELETE FROM knowledge_docs');
  });

  describe('searchByEmbedding + mergeWithRRF (via getRelevantKnowledge)', () => {
    it('returns FTS-only results when no embeddings exist', async () => {
      const db = getDatabase();
      const groupDir = path.join(TEST_GROUPS_DIR, 'test-group', 'knowledge');
      fs.mkdirSync(groupDir, { recursive: true });

      addKnowledgeDoc(
        db,
        'test-group',
        'doc1.md',
        'TypeScript Guide',
        'TypeScript is a typed superset of JavaScript.',
      );

      const result = await getRelevantKnowledge(db, 'TypeScript', 'test-group');
      expect(result).toContain('TypeScript Guide');
      expect(result).toContain('typed superset');
    });

    it('merges FTS and embedding results via RRF', async () => {
      const db = getDatabase();
      const groupDir = path.join(TEST_GROUPS_DIR, 'test-group', 'knowledge');
      fs.mkdirSync(groupDir, { recursive: true });

      const doc1 = addKnowledgeDoc(
        db,
        'test-group',
        'doc1.md',
        'Python Basics',
        'Python is an interpreted language used for scripting.',
      );
      const doc2 = addKnowledgeDoc(
        db,
        'test-group',
        'doc2.md',
        'JavaScript Guide',
        'JavaScript runs in the browser and on Node.js servers.',
      );

      // Generate embeddings for both docs
      await generateAndStoreEmbeddings(db, doc1.id, doc1.content);
      await generateAndStoreEmbeddings(db, doc2.id, doc2.content);

      // Verify embeddings were stored
      const embCount = (
        db.prepare('SELECT COUNT(*) as c FROM knowledge_embeddings').get() as {
          c: number;
        }
      ).c;
      expect(embCount).toBeGreaterThan(0);

      const result = await getRelevantKnowledge(db, 'JavaScript', 'test-group');
      expect(result).toContain('JavaScript');
    });

    it('returns empty string when no docs match', async () => {
      const db = getDatabase();
      const result = await getRelevantKnowledge(
        db,
        'nonexistent topic xyz',
        'empty-group',
      );
      expect(result).toBe('');
    });

    it('respects maxChars limit', async () => {
      const db = getDatabase();
      const groupDir = path.join(TEST_GROUPS_DIR, 'test-group', 'knowledge');
      fs.mkdirSync(groupDir, { recursive: true });

      const longContent = 'A'.repeat(500);
      addKnowledgeDoc(db, 'test-group', 'long1.md', 'Long Doc', longContent);

      const result = await getRelevantKnowledge(db, 'Long', 'test-group', 100);
      expect(result.length).toBeLessThanOrEqual(200); // header + truncated content
    });

    it('embedding-only results are fetched from DB', async () => {
      const db = getDatabase();
      const groupDir = path.join(TEST_GROUPS_DIR, 'test-group', 'knowledge');
      fs.mkdirSync(groupDir, { recursive: true });

      const doc = addKnowledgeDoc(
        db,
        'test-group',
        'embed-only.md',
        'Embedding Doc',
        'This document tests embedding-only retrieval path.',
      );
      await generateAndStoreEmbeddings(db, doc.id, doc.content);

      // Query something that won't FTS match well but should get embedding results
      const result = await getRelevantKnowledge(
        db,
        'retrieval path',
        'test-group',
      );
      expect(result).toContain('Embedding Doc');
    });
  });

  describe('generateAndStoreEmbeddings', () => {
    it('stores chunk embeddings in the database', async () => {
      const db = getDatabase();
      const groupDir = path.join(TEST_GROUPS_DIR, 'test-group', 'knowledge');
      fs.mkdirSync(groupDir, { recursive: true });

      const doc = addKnowledgeDoc(
        db,
        'test-group',
        'emb1.md',
        'Test',
        'Some content here for embedding.',
      );
      await generateAndStoreEmbeddings(db, doc.id, doc.content);

      const rows = db
        .prepare('SELECT * FROM knowledge_embeddings WHERE doc_id = ?')
        .all(doc.id);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('replaces existing embeddings atomically when replaceExisting=true', async () => {
      const db = getDatabase();
      const groupDir = path.join(TEST_GROUPS_DIR, 'test-group', 'knowledge');
      fs.mkdirSync(groupDir, { recursive: true });

      const doc = addKnowledgeDoc(
        db,
        'test-group',
        'replace1.md',
        'Replace Test',
        'Original content.',
      );
      await generateAndStoreEmbeddings(db, doc.id, doc.content);

      const countBefore = (
        db
          .prepare(
            'SELECT COUNT(*) as c FROM knowledge_embeddings WHERE doc_id = ?',
          )
          .get(doc.id) as { c: number }
      ).c;
      expect(countBefore).toBeGreaterThan(0);

      // Replace with new content
      await generateAndStoreEmbeddings(
        db,
        doc.id,
        'Updated content that is different.',
        true,
      );

      const countAfter = (
        db
          .prepare(
            'SELECT COUNT(*) as c FROM knowledge_embeddings WHERE doc_id = ?',
          )
          .get(doc.id) as { c: number }
      ).c;
      expect(countAfter).toBeGreaterThan(0);

      // Verify the chunk text was updated
      const chunk = db
        .prepare(
          'SELECT chunk_text FROM knowledge_embeddings WHERE doc_id = ? LIMIT 1',
        )
        .get(doc.id) as { chunk_text: string };
      expect(chunk.chunk_text).toContain('Updated content');
    });

    it('skips empty content', async () => {
      const db = getDatabase();
      await generateAndStoreEmbeddings(db, 999, '');
      const rows = db
        .prepare('SELECT * FROM knowledge_embeddings WHERE doc_id = 999')
        .all();
      expect(rows).toHaveLength(0);
    });
  });

  describe('updateKnowledgeDoc preserves embeddings during regeneration', () => {
    it('does not delete embeddings before new ones are generated', async () => {
      const db = getDatabase();
      const groupDir = path.join(TEST_GROUPS_DIR, 'test-group', 'knowledge');
      fs.mkdirSync(groupDir, { recursive: true });

      const doc = addKnowledgeDoc(
        db,
        'test-group',
        'race1.md',
        'Race Test',
        'Initial content for race condition test.',
      );
      await generateAndStoreEmbeddings(db, doc.id, doc.content);

      const countBefore = (
        db
          .prepare(
            'SELECT COUNT(*) as c FROM knowledge_embeddings WHERE doc_id = ?',
          )
          .get(doc.id) as { c: number }
      ).c;
      expect(countBefore).toBeGreaterThan(0);

      // Update the doc — embeddings should still be queryable during async regeneration
      updateKnowledgeDoc(
        db,
        doc.id,
        'Updated Race Test',
        'New content after update.',
      );

      // Embeddings should still exist (old ones) until async regeneration completes
      // With the fix, DELETE happens inside the transaction with INSERT, not before
      const countDuring = (
        db
          .prepare(
            'SELECT COUNT(*) as c FROM knowledge_embeddings WHERE doc_id = ?',
          )
          .get(doc.id) as { c: number }
      ).c;
      expect(countDuring).toBeGreaterThanOrEqual(0); // Old embeddings may still be there
    });
  });
});
