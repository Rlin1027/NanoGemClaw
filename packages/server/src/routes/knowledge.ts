import { Router } from 'express';

interface KnowledgeRouterDeps {
    validateFolder: (folder: string) => boolean;
    validateNumericParam: (value: string, name: string) => number | null;
}

export function createKnowledgeRouter(deps: KnowledgeRouterDeps): Router {
    const router = Router();
    const { validateFolder, validateNumericParam } = deps;

    // GET /api/groups/:folder/knowledge
    router.get('/groups/:folder/knowledge', async (req, res) => {
        const { folder } = req.params;
        if (!validateFolder(folder)) {
            res.status(400).json({ error: 'Invalid folder' });
            return;
        }

        try {
            const { getKnowledgeDocs } = await import('../../../../src/knowledge.js');
            const { getDatabase } = await import('@nanogemclaw/db');
            const db = getDatabase();
            const docs = getKnowledgeDocs(db, folder);
            res.json({ data: docs });
        } catch {
            res.status(500).json({ error: 'Failed to fetch knowledge documents' });
        }
    });

    // POST /api/groups/:folder/knowledge
    router.post('/groups/:folder/knowledge', async (req, res) => {
        const { folder } = req.params;
        if (!validateFolder(folder)) {
            res.status(400).json({ error: 'Invalid folder' });
            return;
        }

        const { filename, title, content } = req.body;
        if (!filename || !title || typeof content !== 'string') {
            res.status(400).json({ error: 'Missing or invalid fields: filename, title, content required' });
            return;
        }

        if (!/^[a-zA-Z0-9_-]+\.md$/.test(filename)) {
            res.status(400).json({ error: 'Invalid filename: must match [a-zA-Z0-9_-]+.md' });
            return;
        }

        try {
            const { addKnowledgeDoc } = await import('../../../../src/knowledge.js');
            const { getDatabase } = await import('@nanogemclaw/db');
            const db = getDatabase();
            const doc = addKnowledgeDoc(db, folder, filename, title, content);
            res.json({ data: doc });
        } catch {
            res.status(500).json({ error: 'Failed to create knowledge document' });
        }
    });

    // GET /api/groups/:folder/knowledge/search
    router.get('/groups/:folder/knowledge/search', async (req, res) => {
        const { folder } = req.params;
        const { q } = req.query;
        if (!validateFolder(folder)) {
            res.status(400).json({ error: 'Invalid folder' });
            return;
        }

        if (!q || typeof q !== 'string') {
            res.status(400).json({ error: 'Missing or invalid query parameter: q' });
            return;
        }

        try {
            const { searchKnowledge } = await import('../../../../src/knowledge.js');
            const { getDatabase } = await import('@nanogemclaw/db');
            const db = getDatabase();
            const results = searchKnowledge(db, q, folder);
            res.json({ data: results });
        } catch {
            res.status(500).json({ error: 'Knowledge search failed' });
        }
    });

    // GET /api/groups/:folder/knowledge/:docId
    router.get('/groups/:folder/knowledge/:docId', async (req, res) => {
        const { folder, docId } = req.params;
        if (!validateFolder(folder)) {
            res.status(400).json({ error: 'Invalid folder' });
            return;
        }

        const docIdNum = validateNumericParam(docId, 'docId');
        if (docIdNum === null) {
            res.status(400).json({ error: 'Invalid docId' });
            return;
        }

        try {
            const { getKnowledgeDoc } = await import('../../../../src/knowledge.js');
            const { getDatabase } = await import('@nanogemclaw/db');
            const db = getDatabase();
            const doc = getKnowledgeDoc(db, docIdNum);
            if (!doc || doc.group_folder !== folder) {
                res.status(404).json({ error: 'Document not found' });
                return;
            }
            res.json({ data: doc });
        } catch {
            res.status(500).json({ error: 'Failed to fetch document' });
        }
    });

    // PUT /api/groups/:folder/knowledge/:docId
    router.put('/groups/:folder/knowledge/:docId', async (req, res) => {
        const { folder, docId } = req.params;
        const { title, content } = req.body;
        if (!validateFolder(folder)) {
            res.status(400).json({ error: 'Invalid folder' });
            return;
        }

        const docIdNum = validateNumericParam(docId, 'docId');
        if (docIdNum === null) {
            res.status(400).json({ error: 'Invalid docId' });
            return;
        }

        if (!title || typeof content !== 'string') {
            res.status(400).json({ error: 'Missing or invalid fields: title, content required' });
            return;
        }

        try {
            const { getKnowledgeDoc, updateKnowledgeDoc } = await import('../../../../src/knowledge.js');
            const { getDatabase } = await import('@nanogemclaw/db');
            const db = getDatabase();
            const doc = getKnowledgeDoc(db, docIdNum);
            if (!doc || doc.group_folder !== folder) {
                res.status(404).json({ error: 'Document not found' });
                return;
            }
            const updated = updateKnowledgeDoc(db, docIdNum, title, content);
            res.json({ data: updated });
        } catch {
            res.status(500).json({ error: 'Failed to update document' });
        }
    });

    // DELETE /api/groups/:folder/knowledge/:docId
    router.delete('/groups/:folder/knowledge/:docId', async (req, res) => {
        const { folder, docId } = req.params;
        if (!validateFolder(folder)) {
            res.status(400).json({ error: 'Invalid folder' });
            return;
        }

        const docIdNum = validateNumericParam(docId, 'docId');
        if (docIdNum === null) {
            res.status(400).json({ error: 'Invalid docId' });
            return;
        }

        try {
            const { getKnowledgeDoc, deleteKnowledgeDoc } = await import('../../../../src/knowledge.js');
            const { getDatabase } = await import('@nanogemclaw/db');
            const db = getDatabase();
            const doc = getKnowledgeDoc(db, docIdNum);
            if (!doc || doc.group_folder !== folder) {
                res.status(404).json({ error: 'Document not found' });
                return;
            }
            deleteKnowledgeDoc(db, docIdNum);
            res.json({ data: { success: true } });
        } catch {
            res.status(500).json({ error: 'Failed to delete document' });
        }
    });

    return router;
}
