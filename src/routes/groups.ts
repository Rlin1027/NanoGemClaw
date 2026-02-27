import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from '../config.js';
import type { DashboardGroup } from '../server.js';
import { validate } from '../middleware/validate.js';
import {
  folderParams,
  groupFolderParams,
  chatIdParams,
  personaKeyParams,
  groupsPaginationQuery,
  registerGroupBody,
  updateGroupBody,
  createPersonaBody,
  updatePreferencesBody,
  updatePromptBody,
  exportQuery,
  searchQuery,
} from '../schemas/groups.js';
import type { z } from 'zod';

interface GroupsRouterDeps {
  groupsProvider: () => DashboardGroup[];
  groupRegistrar: ((chatId: string, name: string) => DashboardGroup) | null;
  groupUpdater:
    | ((
        folder: string,
        updates: Record<string, unknown>,
      ) => DashboardGroup | null)
    | null;
  chatJidResolver: ((folder: string) => string | null) | null;
  emitDashboardEvent: (event: string, data: unknown) => void;
}

export function createGroupsRouter(deps: GroupsRouterDeps): Router {
  const router = Router();

  // GET /api/groups
  router.get('/groups', (_req, res) => {
    const groups = deps.groupsProvider ? deps.groupsProvider() : [];
    res.json({ data: groups });
  });

  // GET /api/groups/discover
  router.get(
    '/groups/discover',
    validate({ query: groupsPaginationQuery }),
    async (req, res) => {
      try {
        const { getAllChatsPaginated } = await import('../db.js');
        const { limit, offset } = req.query as unknown as z.infer<
          typeof groupsPaginationQuery
        >;
        const { rows, total } = getAllChatsPaginated(limit, offset);
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
        res.status(500).json({ error: 'Failed to discover groups' });
      }
    },
  );

  // POST /api/groups/:chatId/register
  router.post(
    '/groups/:chatId/register',
    validate({ params: chatIdParams, body: registerGroupBody }),
    async (req, res) => {
      try {
        const { chatId } = req.params as unknown as z.infer<
          typeof chatIdParams
        >;
        const { name } = req.body as z.infer<typeof registerGroupBody>;

        if (!deps.groupRegistrar) {
          res.status(503).json({ error: 'Group registration not available' });
          return;
        }
        const result = deps.groupRegistrar(chatId, name);
        // Broadcast updated groups to all dashboard clients
        deps.emitDashboardEvent('groups:update', deps.groupsProvider());
        res.json({ data: result });
      } catch {
        res.status(500).json({ error: 'Registration failed' });
      }
    },
  );

  // GET /api/groups/:folder/detail
  router.get(
    '/groups/:folder/detail',
    validate({ params: folderParams }),
    async (req, res) => {
      const { folder } = req.params as unknown as z.infer<typeof folderParams>;
      try {
        const { getTasksForGroup, getUsageStats, getErrorState } =
          await import('../db.js');
        const groups = deps.groupsProvider();
        const group = groups.find(
          (g) => g.id === folder || g.folder === folder,
        );
        if (!group) {
          res.status(404).json({ error: 'Group not found' });
          return;
        }
        const tasks = getTasksForGroup(folder);
        const usage = getUsageStats(folder);
        const errorState = getErrorState(folder);

        res.json({
          data: {
            ...group,
            tasks,
            usage,
            errorState,
          },
        });
      } catch {
        res.status(500).json({ error: 'Failed to fetch group detail' });
      }
    },
  );

  // PUT /api/groups/:folder
  router.put(
    '/groups/:folder',
    validate({ params: folderParams, body: updateGroupBody }),
    async (req, res) => {
      const { folder } = req.params as unknown as z.infer<typeof folderParams>;

      if (!deps.groupUpdater) {
        res.status(503).json({ error: 'Group updater not available' });
        return;
      }

      const { persona, enableWebSearch, requireTrigger, name, geminiModel } =
        req.body as z.infer<typeof updateGroupBody>;

      // Validate persona if provided (dynamic DB lookup stays in handler)
      if (persona !== undefined) {
        const { getAllPersonas } = await import('../personas.js');
        if (!getAllPersonas()[persona]) {
          res.status(400).json({ error: `Invalid persona: ${persona}` });
          return;
        }
      }

      // Validate geminiModel if provided
      if (geminiModel !== undefined) {
        // "auto" is always valid — means "use the latest auto-detected model"
        if (geminiModel !== 'auto') {
          const { getAvailableModels } = await import('@nanogemclaw/gemini');
          const validModels = getAvailableModels().map((m) => m.id);
          if (!validModels.includes(geminiModel)) {
            res.status(400).json({ error: `Invalid model: ${geminiModel}` });
            return;
          }
        }
      }

      const updates: Record<string, unknown> = {};
      if (persona !== undefined) updates.persona = persona;
      if (enableWebSearch !== undefined)
        updates.enableWebSearch = enableWebSearch;
      if (requireTrigger !== undefined) updates.requireTrigger = requireTrigger;
      if (name !== undefined) updates.name = name;
      if (geminiModel !== undefined) updates.geminiModel = geminiModel;

      try {
        const result = deps.groupUpdater(folder, updates);
        if (!result) {
          res.status(404).json({ error: 'Group not found' });
          return;
        }

        // Broadcast update to all dashboard clients
        deps.emitDashboardEvent('groups:update', deps.groupsProvider());
        res.json({ data: result });
      } catch {
        res.status(500).json({ error: 'Failed to update group' });
      }
    },
  );

  // GET /api/personas
  router.get('/personas', async (_req, res) => {
    try {
      const { getAllPersonas } = await import('../personas.js');
      res.json({ data: getAllPersonas() });
    } catch {
      res.status(500).json({ error: 'Failed to fetch personas' });
    }
  });

  // POST /api/personas
  router.post(
    '/personas',
    validate({ body: createPersonaBody }),
    async (req, res) => {
      try {
        const { key, name, description, systemPrompt } = req.body as z.infer<
          typeof createPersonaBody
        >;
        const { saveCustomPersona } = await import('../personas.js');
        saveCustomPersona(key, {
          name,
          description: description || '',
          systemPrompt,
        });
        res.json({ data: { key } });
      } catch (err) {
        const { logger } = await import('../logger.js');
        logger.error({ err }, 'Persona operation failed');
        res.status(500).json({ error: 'Failed to create persona' });
      }
    },
  );

  // DELETE /api/personas/:key
  router.delete(
    '/personas/:key',
    validate({ params: personaKeyParams }),
    async (req, res) => {
      try {
        const { key } = req.params as unknown as z.infer<
          typeof personaKeyParams
        >;
        const { deleteCustomPersona } = await import('../personas.js');
        const deleted = deleteCustomPersona(key);
        if (!deleted) {
          res.status(404).json({ error: 'Persona not found' });
          return;
        }
        res.json({ data: { success: true } });
      } catch (err) {
        const { logger } = await import('../logger.js');
        logger.error({ err }, 'Persona operation failed');
        res.status(500).json({ error: 'Failed to delete persona' });
      }
    },
  );

  // GET /api/groups/:folder/preferences
  router.get(
    '/groups/:folder/preferences',
    validate({ params: folderParams }),
    async (req, res) => {
      const { folder } = req.params as unknown as z.infer<typeof folderParams>;
      try {
        const db = await import('../db.js');
        const prefs = db.getPreferences(folder);
        res.json({ data: prefs });
      } catch {
        res.status(500).json({ error: 'Failed to fetch preferences' });
      }
    },
  );

  // PUT /api/groups/:folder/preferences
  router.put(
    '/groups/:folder/preferences',
    validate({ params: folderParams, body: updatePreferencesBody }),
    async (req, res) => {
      const { folder } = req.params as unknown as z.infer<typeof folderParams>;
      const { key, value } = req.body as z.infer<typeof updatePreferencesBody>;
      try {
        const db = await import('../db.js');
        db.setPreference(folder, key, String(value));
        res.json({ data: { key, value } });
      } catch {
        res.status(500).json({ error: 'Failed to save preference' });
      }
    },
  );

  // GET /api/groups/:folder/export
  router.get(
    '/groups/:folder/export',
    validate({ params: folderParams, query: exportQuery }),
    async (req, res) => {
      const { folder } = req.params as unknown as z.infer<typeof folderParams>;
      try {
        const { getConversationExport, formatExportAsMarkdown } =
          await import('../db.js');
        const { format, since } = req.query as unknown as z.infer<
          typeof exportQuery
        >;

        // Resolve chatJid from folder using the injected resolver
        if (!deps.chatJidResolver) {
          res.status(503).json({ error: 'Chat resolver not available' });
          return;
        }
        const chatJid = deps.chatJidResolver(folder);
        if (!chatJid) {
          res
            .status(404)
            .json({ error: 'Could not resolve chat for this group' });
          return;
        }

        const exportData = getConversationExport(chatJid, since);

        if (format === 'md' || format === 'markdown') {
          const md = formatExportAsMarkdown(exportData);
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          const safeFilename = folder.replace(/[^a-zA-Z0-9_-]/g, '_');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${safeFilename}-export.md"`,
          );
          res.send(md);
        } else {
          res.json({ data: exportData });
        }
      } catch {
        res.status(500).json({ error: 'Failed to export conversation' });
      }
    },
  );

  // GET /api/prompt/:groupFolder
  router.get(
    '/prompt/:groupFolder',
    validate({ params: groupFolderParams }),
    (req, res) => {
      const { groupFolder } = req.params as unknown as z.infer<
        typeof groupFolderParams
      >;
      const filePath = path.join(GROUPS_DIR, groupFolder, 'GEMINI.md');
      try {
        if (!fs.existsSync(filePath)) {
          res.json({ data: { content: '', mtime: 0 } });
          return;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const stat = fs.statSync(filePath);
        res.json({ data: { content, mtime: stat.mtimeMs } });
      } catch {
        res.status(500).json({ error: 'Failed to read prompt' });
      }
    },
  );

  // PUT /api/prompt/:groupFolder
  router.put(
    '/prompt/:groupFolder',
    validate({ params: groupFolderParams, body: updatePromptBody }),
    (req, res) => {
      const { groupFolder } = req.params as unknown as z.infer<
        typeof groupFolderParams
      >;
      const { content, expectedMtime } = req.body as z.infer<
        typeof updatePromptBody
      >;
      const filePath = path.join(GROUPS_DIR, groupFolder, 'GEMINI.md');
      const groupDir = path.join(GROUPS_DIR, groupFolder);
      try {
        // Optimistic locking: check mtime
        if (expectedMtime && fs.existsSync(filePath)) {
          const currentMtime = fs.statSync(filePath).mtimeMs;
          if (Math.abs(currentMtime - expectedMtime) > 1) {
            res.status(409).json({
              error:
                'File was modified by another process. Please reload and try again.',
            });
            return;
          }
        }
        fs.mkdirSync(groupDir, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
        const newStat = fs.statSync(filePath);
        res.json({ data: { mtime: newStat.mtimeMs } });
      } catch {
        res.status(500).json({ error: 'Failed to save prompt' });
      }
    },
  );

  // GET /api/memory/:groupFolder
  router.get(
    '/memory/:groupFolder',
    validate({ params: groupFolderParams }),
    async (req, res) => {
      const { groupFolder } = req.params as unknown as z.infer<
        typeof groupFolderParams
      >;
      try {
        const { getMemorySummary } = await import('../db.js');
        const summary = getMemorySummary(groupFolder);
        res.json({ data: summary ?? null });
      } catch {
        res.status(500).json({ error: 'Failed to fetch memory' });
      }
    },
  );

  // GET /api/search
  router.get('/search', validate({ query: searchQuery }), async (req, res) => {
    try {
      const { q, group, limit, offset } = req.query as unknown as z.infer<
        typeof searchQuery
      >;

      if (limit === null || offset === null) {
        res.status(400).json({ error: 'Invalid limit or offset parameter' });
        return;
      }

      const { searchMessages } = await import('../search.js');
      const { getDatabase } = await import('../db.js');
      const db = getDatabase();
      const results = searchMessages(db, q, { group, limit, offset });
      res.json({ data: results });
    } catch {
      res.status(500).json({ error: 'Search failed' });
    }
  });

  return router;
}
