import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { logger } from '@nanogemclaw/core/logger';
import type { DashboardGroup } from '../server.js';

const SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/;

interface GroupsRouterDeps {
    groupsProvider: () => DashboardGroup[];
    groupRegistrar: ((chatId: string, name: string) => DashboardGroup) | null;
    groupUpdater: ((folder: string, updates: Record<string, unknown>) => DashboardGroup | null) | null;
    chatJidResolver: ((folder: string) => string | null) | null;
    validateFolder: (folder: string) => boolean;
    validateNumericParam: (value: string, name: string) => number | null;
    emitDashboardEvent: (event: string, data: unknown) => void;
    groupsDir: string;
}

export function createGroupsRouter(deps: GroupsRouterDeps): Router {
    const router = Router();
    const {
        validateFolder,
        validateNumericParam,
        emitDashboardEvent,
        groupsDir,
    } = deps;

    // GET /api/groups
    router.get('/groups', (_req, res) => {
        const groups = deps.groupsProvider ? deps.groupsProvider() : [];
        res.json({ data: groups });
    });

    // GET /api/groups/discover
    router.get('/groups/discover', async (_req, res) => {
        try {
            const { getAllChats } = await import('@nanogemclaw/db');
            const chats = getAllChats();
            res.json({ data: chats });
        } catch {
            res.status(500).json({ error: 'Failed to discover groups' });
        }
    });

    // POST /api/groups/:chatId/register
    router.post('/groups/:chatId/register', async (req, res) => {
        try {
            const { chatId } = req.params;
            const { name } = req.body;

            if (!chatId || !/^-?\d+$/.test(chatId)) {
                res.status(400).json({ error: 'Invalid chatId format' });
                return;
            }

            if (!name || typeof name !== 'string') {
                res.status(400).json({ error: 'Name is required' });
                return;
            }
            if (!deps.groupRegistrar) {
                res.status(503).json({ error: 'Group registration not available' });
                return;
            }
            const result = deps.groupRegistrar(chatId, name);
            emitDashboardEvent('groups:update', deps.groupsProvider());
            res.json({ data: result });
        } catch {
            res.status(500).json({ error: 'Registration failed' });
        }
    });

    // GET /api/groups/:folder/detail
    router.get('/groups/:folder/detail', async (req, res) => {
        const { folder } = req.params;
        if (!validateFolder(folder)) {
            res.status(400).json({ error: 'Invalid folder' });
            return;
        }
        try {
            const { getTasksForGroup, getUsageStats, getErrorState } = await import('@nanogemclaw/db');
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
    });

    // PUT /api/groups/:folder
    router.put('/groups/:folder', async (req, res) => {
        const { folder } = req.params;
        if (!validateFolder(folder)) {
            res.status(400).json({ error: 'Invalid folder' });
            return;
        }

        if (!deps.groupUpdater) {
            res.status(503).json({ error: 'Group updater not available' });
            return;
        }

        const { persona, enableWebSearch, requireTrigger, name, geminiModel } = req.body;

        if (persona !== undefined) {
            const { getAllPersonas } = await import('../../../../src/personas.js');
            if (!getAllPersonas()[persona]) {
                res.status(400).json({ error: `Invalid persona: ${persona}` });
                return;
            }
        }

        if (geminiModel !== undefined) {
            const validModels = ['gemini-3-flash-preview', 'gemini-3-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-pro'];
            if (!validModels.includes(geminiModel)) {
                res.status(400).json({ error: `Invalid model: ${geminiModel}` });
                return;
            }
        }

        const updates: Record<string, unknown> = {};
        if (persona !== undefined) updates.persona = persona;
        if (enableWebSearch !== undefined) updates.enableWebSearch = enableWebSearch;
        if (requireTrigger !== undefined) updates.requireTrigger = requireTrigger;
        if (name !== undefined) updates.name = name;
        if (geminiModel !== undefined) updates.geminiModel = geminiModel;

        try {
            const result = deps.groupUpdater(folder, updates);
            if (!result) {
                res.status(404).json({ error: 'Group not found' });
                return;
            }
            emitDashboardEvent('groups:update', deps.groupsProvider());
            res.json({ data: result });
        } catch {
            res.status(500).json({ error: 'Failed to update group' });
        }
    });

    // GET /api/personas
    router.get('/personas', async (_req, res) => {
        try {
            const { getAllPersonas } = await import('../../../../src/personas.js');
            res.json({ data: getAllPersonas() });
        } catch {
            res.status(500).json({ error: 'Failed to fetch personas' });
        }
    });

    // POST /api/personas
    router.post('/personas', async (req, res) => {
        try {
            const { key, name, description, systemPrompt } = req.body;
            if (!key || !name || !systemPrompt) {
                res.status(400).json({ error: 'Missing required fields: key, name, systemPrompt' });
                return;
            }
            if (!SAFE_FOLDER_RE.test(key)) {
                res.status(400).json({ error: 'Invalid persona key (alphanumeric, dash, underscore only)' });
                return;
            }
            const { saveCustomPersona } = await import('../../../../src/personas.js');
            saveCustomPersona(key, { name, description: description || '', systemPrompt });
            res.json({ data: { key } });
        } catch (err) {
            logger.error({ err }, 'Failed to create persona');
            res.status(400).json({ error: 'Failed to create persona' });
        }
    });

    // DELETE /api/personas/:key
    router.delete('/personas/:key', async (req, res) => {
        try {
            const { key } = req.params;
            if (!SAFE_FOLDER_RE.test(key)) {
                res.status(400).json({ error: 'Invalid persona key' });
                return;
            }
            const { deleteCustomPersona } = await import('../../../../src/personas.js');
            const deleted = deleteCustomPersona(key);
            if (!deleted) {
                res.status(404).json({ error: 'Persona not found' });
                return;
            }
            res.json({ data: { success: true } });
        } catch (err) {
            logger.error({ err }, 'Failed to delete persona');
            res.status(400).json({ error: 'Failed to delete persona' });
        }
    });

    // GET /api/groups/:folder/preferences
    router.get('/groups/:folder/preferences', async (req, res) => {
        const folder = req.params.folder;
        if (!SAFE_FOLDER_RE.test(folder)) {
            res.status(400).json({ error: 'Invalid folder' });
            return;
        }
        try {
            const { getPreferences } = await import('@nanogemclaw/db');
            const prefs = getPreferences(folder);
            res.json({ data: prefs });
        } catch {
            res.status(500).json({ error: 'Failed to fetch preferences' });
        }
    });

    // PUT /api/groups/:folder/preferences
    router.put('/groups/:folder/preferences', async (req, res) => {
        const folder = req.params.folder;
        if (!SAFE_FOLDER_RE.test(folder)) {
            res.status(400).json({ error: 'Invalid folder' });
            return;
        }
        const { key, value } = req.body;
        if (!key || typeof key !== 'string') {
            res.status(400).json({ error: 'Key required' });
            return;
        }
        const ALLOWED_KEYS = ['language', 'nickname', 'response_style', 'interests', 'timezone', 'custom_instructions'];
        if (!ALLOWED_KEYS.includes(key)) {
            res.status(400).json({ error: `Invalid key. Allowed: ${ALLOWED_KEYS.join(', ')}` });
            return;
        }
        try {
            const { setPreference } = await import('@nanogemclaw/db');
            setPreference(folder, key, String(value));
            res.json({ data: { key, value } });
        } catch {
            res.status(500).json({ error: 'Failed to save preference' });
        }
    });

    // GET /api/groups/:folder/export
    router.get('/groups/:folder/export', async (req, res) => {
        const { folder } = req.params;
        if (!validateFolder(folder)) {
            res.status(400).json({ error: 'Invalid folder' });
            return;
        }

        try {
            const { getConversationExport, formatExportAsMarkdown } = await import('@nanogemclaw/db');
            const format = (req.query.format as string) || 'json';
            const since = req.query.since as string | undefined;

            if (!deps.chatJidResolver) {
                res.status(503).json({ error: 'Chat resolver not available' });
                return;
            }
            const chatJid = deps.chatJidResolver(folder);
            if (!chatJid) {
                res.status(404).json({ error: 'Could not resolve chat for this group' });
                return;
            }

            const exportData = getConversationExport(chatJid, since);

            if (format === 'md' || format === 'markdown') {
                const md = formatExportAsMarkdown(exportData);
                res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="${folder}-export.md"`);
                res.send(md);
            } else {
                res.json({ data: exportData });
            }
        } catch {
            res.status(500).json({ error: 'Failed to export conversation' });
        }
    });

    // GET /api/prompt/:groupFolder
    router.get('/prompt/:groupFolder', (req, res) => {
        const { groupFolder } = req.params;
        if (!validateFolder(groupFolder)) {
            res.status(400).json({ error: 'Invalid group folder' });
            return;
        }
        const filePath = path.join(groupsDir, groupFolder, 'GEMINI.md');
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
    });

    // PUT /api/prompt/:groupFolder
    router.put('/prompt/:groupFolder', (req, res) => {
        const { groupFolder } = req.params;
        if (!validateFolder(groupFolder)) {
            res.status(400).json({ error: 'Invalid group folder' });
            return;
        }
        const { content, expectedMtime } = req.body;
        if (typeof content !== 'string') {
            res.status(400).json({ error: 'Content is required' });
            return;
        }
        const filePath = path.join(groupsDir, groupFolder, 'GEMINI.md');
        const groupDir = path.join(groupsDir, groupFolder);
        try {
            if (expectedMtime && fs.existsSync(filePath)) {
                const currentMtime = fs.statSync(filePath).mtimeMs;
                if (Math.abs(currentMtime - expectedMtime) > 1) {
                    res.status(409).json({
                        error: 'File was modified by another process. Please reload and try again.',
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
    });

    // GET /api/memory/:groupFolder
    router.get('/memory/:groupFolder', async (req, res) => {
        const { groupFolder } = req.params;
        if (!validateFolder(groupFolder)) {
            res.status(400).json({ error: 'Invalid group folder' });
            return;
        }
        try {
            const { getMemorySummary } = await import('@nanogemclaw/db');
            const summary = getMemorySummary(groupFolder);
            res.json({ data: summary ?? null });
        } catch {
            res.status(500).json({ error: 'Failed to fetch memory' });
        }
    });

    // GET /api/search
    router.get('/search', async (req, res) => {
        try {
            const q = req.query.q as string;
            const group = req.query.group as string | undefined;

            if (!q || q.trim().length === 0) {
                res.status(400).json({ error: 'Query parameter "q" is required' });
                return;
            }

            let limit = 20;
            if (req.query.limit) {
                const parsedLimit = validateNumericParam(req.query.limit as string, 'limit');
                if (parsedLimit === null) {
                    res.status(400).json({ error: 'Invalid limit parameter' });
                    return;
                }
                limit = parsedLimit;
            }

            let offset = 0;
            if (req.query.offset) {
                const parsedOffset = validateNumericParam(req.query.offset as string, 'offset');
                if (parsedOffset === null) {
                    res.status(400).json({ error: 'Invalid offset parameter' });
                    return;
                }
                offset = parsedOffset;
            }

            const { searchMessages } = await import('../../../../src/search.js');
            const { getDatabase } = await import('@nanogemclaw/db');
            const db = getDatabase();
            const results = searchMessages(db, q, { group, limit, offset });
            res.json({ data: results });
        } catch {
            res.status(500).json({ error: 'Search failed' });
        }
    });

    return router;
}
