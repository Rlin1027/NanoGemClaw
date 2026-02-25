import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import {
  folderOnlyParams,
  folderDocIdParams,
  knowledgePaginationQuery,
  knowledgeSearchQuery,
  knowledgeCreateBody,
  knowledgeUpdateBody,
} from '../schemas/knowledge.js';
import type { z } from 'zod';

interface KnowledgeRouterDeps {
  // validateFolder and validateNumericParam removed — handled by Zod middleware
}

export function createKnowledgeRouter(_deps: KnowledgeRouterDeps = {}): Router {
  const router = Router();

  // GET /api/groups/:folder/knowledge
  router.get(
    '/groups/:folder/knowledge',
    validate({ params: folderOnlyParams, query: knowledgePaginationQuery }),
    async (req, res) => {
      const { folder } = req.params as unknown as z.infer<
        typeof folderOnlyParams
      >;
      try {
        const { getKnowledgeDocsPaginated } = await import('../knowledge.js');
        const { getDatabase } = await import('../db.js');
        const db = getDatabase();
        const { limit, offset } = req.query as unknown as z.infer<
          typeof knowledgePaginationQuery
        >;
        const { rows, total } = getKnowledgeDocsPaginated(
          db,
          folder,
          limit,
          offset,
        );
        res.json({
          data: rows,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + rows.length < total,
          },
        });
      } catch {
        res.status(500).json({ error: 'Failed to fetch knowledge documents' });
      }
    },
  );

  // POST /api/groups/:folder/knowledge
  router.post(
    '/groups/:folder/knowledge',
    validate({ params: folderOnlyParams, body: knowledgeCreateBody }),
    async (req, res) => {
      const { folder } = req.params as unknown as z.infer<
        typeof folderOnlyParams
      >;
      const { filename, title, content } = req.body as z.infer<
        typeof knowledgeCreateBody
      >;
      try {
        const { addKnowledgeDoc } = await import('../knowledge.js');
        const { getDatabase } = await import('../db.js');
        const db = getDatabase();
        const doc = addKnowledgeDoc(db, folder, filename, title, content);
        res.status(201).json({ data: doc });
      } catch {
        res.status(500).json({ error: 'Failed to create knowledge document' });
      }
    },
  );

  // GET /api/groups/:folder/knowledge/search
  router.get(
    '/groups/:folder/knowledge/search',
    validate({ params: folderOnlyParams, query: knowledgeSearchQuery }),
    async (req, res) => {
      const { folder } = req.params as unknown as z.infer<
        typeof folderOnlyParams
      >;
      const { q } = req.query as unknown as z.infer<
        typeof knowledgeSearchQuery
      >;
      try {
        const { searchKnowledge } = await import('../knowledge.js');
        const { getDatabase } = await import('../db.js');
        const db = getDatabase();
        const results = searchKnowledge(db, q, folder);
        res.json({ data: results });
      } catch {
        res.status(500).json({ error: 'Knowledge search failed' });
      }
    },
  );

  // GET /api/groups/:folder/knowledge/:docId
  router.get(
    '/groups/:folder/knowledge/:docId',
    validate({ params: folderDocIdParams }),
    async (req, res) => {
      const { folder, docId } = req.params as unknown as z.infer<
        typeof folderDocIdParams
      >;
      try {
        const { getKnowledgeDoc } = await import('../knowledge.js');
        const { getDatabase } = await import('../db.js');
        const db = getDatabase();
        const doc = getKnowledgeDoc(db, docId);
        if (!doc || doc.group_folder !== folder) {
          res.status(404).json({ error: 'Document not found' });
          return;
        }
        res.json({ data: doc });
      } catch {
        res.status(500).json({ error: 'Failed to fetch document' });
      }
    },
  );

  // PUT /api/groups/:folder/knowledge/:docId
  router.put(
    '/groups/:folder/knowledge/:docId',
    validate({ params: folderDocIdParams, body: knowledgeUpdateBody }),
    async (req, res) => {
      const { folder, docId } = req.params as unknown as z.infer<
        typeof folderDocIdParams
      >;
      const { title, content } = req.body as z.infer<
        typeof knowledgeUpdateBody
      >;
      try {
        const { getKnowledgeDoc, updateKnowledgeDoc } =
          await import('../knowledge.js');
        const { getDatabase } = await import('../db.js');
        const db = getDatabase();
        const doc = getKnowledgeDoc(db, docId);
        if (!doc || doc.group_folder !== folder) {
          res.status(404).json({ error: 'Document not found' });
          return;
        }
        const updated = updateKnowledgeDoc(db, docId, title, content);
        res.json({ data: updated });
      } catch {
        res.status(500).json({ error: 'Failed to update document' });
      }
    },
  );

  // DELETE /api/groups/:folder/knowledge/:docId
  router.delete(
    '/groups/:folder/knowledge/:docId',
    validate({ params: folderDocIdParams }),
    async (req, res) => {
      const { folder, docId } = req.params as unknown as z.infer<
        typeof folderDocIdParams
      >;
      try {
        const { getKnowledgeDoc, deleteKnowledgeDoc } =
          await import('../knowledge.js');
        const { getDatabase } = await import('../db.js');
        const db = getDatabase();
        const doc = getKnowledgeDoc(db, docId);
        if (!doc || doc.group_folder !== folder) {
          res.status(404).json({ error: 'Document not found' });
          return;
        }
        deleteKnowledgeDoc(db, docId);
        res.json({ data: { success: true } });
      } catch {
        res.status(500).json({ error: 'Failed to delete document' });
      }
    },
  );

  return router;
}
