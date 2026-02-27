/**
 * Tests for google-tasks/sync.ts
 *
 * ~22 tests covering loadSyncState, saveSyncState, upsertTaskMapping,
 * removeTaskMapping, syncTasks, markGoogleTaskComplete, and findGoogleTaskByTitle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before any imports; only vi.fn() allowed.
// ---------------------------------------------------------------------------

const mockGetOAuth2Client = vi.hoisted(() => vi.fn());
const mockIsAuthenticated = vi.hoisted(() => vi.fn().mockReturnValue(true));

const mockFs = vi.hoisted(() => ({
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
}));

const mockListTaskLists = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockListTasks = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockCompleteTask = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('fs', () => ({ default: mockFs, ...mockFs }));

vi.mock('../tasks-api.js', () => ({
    listTaskLists: mockListTaskLists,
    listTasks: mockListTasks,
    completeTask: mockCompleteTask,
}));

vi.mock('googleapis', () => ({
    google: { tasks: vi.fn() },
}));

vi.mock('nanogemclaw-plugin-google-auth', () => ({
    getOAuth2Client: mockGetOAuth2Client,
    isAuthenticated: mockIsAuthenticated,
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import {
    loadSyncState,
    saveSyncState,
    upsertTaskMapping,
    removeTaskMapping,
    syncTasks,
    markGoogleTaskComplete,
    findGoogleTaskByTitle,
} from '../sync.js';
import type { SyncState, TaskMapping } from '../sync.js';

// Helper imports for plugin API mock
import { createMockLogger, createMockPluginApi } from '../../../__tests__/helpers/plugin-api-mock';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DATA_DIR = '/tmp/test-sync-data';

function makeState(overrides: Partial<SyncState> = {}): SyncState {
    return { lastSync: null, taskMappings: [], ...overrides };
}

function makeMapping(overrides: Partial<TaskMapping> = {}): TaskMapping {
    return {
        localId: 'local-task-1',
        googleTaskId: 'google-task-1',
        googleListId: 'list-1',
        ...overrides,
    };
}

function setupAuth(authenticated = true) {
    mockIsAuthenticated.mockReturnValue(authenticated);
    if (authenticated) {
        mockGetOAuth2Client.mockReturnValue({ credentials: { access_token: 'test-token' } });
    } else {
        mockGetOAuth2Client.mockReturnValue(null);
    }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('google-tasks/sync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupAuth(true);
        mockFs.existsSync.mockReturnValue(false);
        mockFs.mkdirSync.mockReturnValue(undefined);
        mockFs.writeFileSync.mockReturnValue(undefined);
        mockFs.renameSync.mockReturnValue(undefined);
        mockListTaskLists.mockResolvedValue([]);
        mockListTasks.mockResolvedValue([]);
        mockCompleteTask.mockResolvedValue({});
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    // -----------------------------------------------------------------------
    // loadSyncState
    // -----------------------------------------------------------------------

    describe('loadSyncState', () => {
        it('returns default state when file does not exist', () => {
            mockFs.existsSync.mockReturnValue(false);
            const state = loadSyncState(DATA_DIR);
            expect(state).toEqual({ lastSync: null, taskMappings: [] });
        });

        it('parses and returns valid JSON from disk', () => {
            const stored = makeState({
                lastSync: '2026-01-01T00:00:00.000Z',
                taskMappings: [makeMapping()],
            });
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(stored));
            const state = loadSyncState(DATA_DIR);
            expect(state.lastSync).toBe('2026-01-01T00:00:00.000Z');
            expect(state.taskMappings).toHaveLength(1);
        });

        it('returns default state when file contains corrupt JSON', () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue('{corrupt json{{');
            const state = loadSyncState(DATA_DIR);
            expect(state).toEqual({ lastSync: null, taskMappings: [] });
        });

        it('reads from the correct file path (sync-state.json)', () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(makeState()));
            loadSyncState('/custom/dir');
            expect(mockFs.readFileSync).toHaveBeenCalledWith(
                expect.stringContaining('sync-state.json'),
                'utf-8',
            );
        });
    });

    // -----------------------------------------------------------------------
    // saveSyncState
    // -----------------------------------------------------------------------

    describe('saveSyncState', () => {
        it('creates the parent directory', () => {
            saveSyncState(DATA_DIR, makeState());
            expect(mockFs.mkdirSync).toHaveBeenCalledWith(DATA_DIR, { recursive: true });
        });

        it('writes to a tmp file first (atomic write pattern)', () => {
            saveSyncState(DATA_DIR, makeState());
            const tmpArg = mockFs.writeFileSync.mock.calls[0]?.[0] as string;
            expect(tmpArg).toContain('.tmp.');
        });

        it('renames tmp file to final sync-state.json path', () => {
            saveSyncState(DATA_DIR, makeState());
            const tmpArg = mockFs.writeFileSync.mock.calls[0]?.[0] as string;
            const finalArg = mockFs.renameSync.mock.calls[0]?.[1] as string;
            expect(finalArg).toContain('sync-state.json');
            expect(tmpArg).not.toBe(finalArg);
        });

        it('serializes state to JSON', () => {
            const state = makeState({ lastSync: '2026-01-01T00:00:00.000Z' });
            saveSyncState(DATA_DIR, state);
            const written = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
            const parsed = JSON.parse(written);
            expect(parsed.lastSync).toBe('2026-01-01T00:00:00.000Z');
        });
    });

    // -----------------------------------------------------------------------
    // upsertTaskMapping
    // -----------------------------------------------------------------------

    describe('upsertTaskMapping', () => {
        it('adds a new mapping when none exists', () => {
            mockFs.existsSync.mockReturnValue(false);
            upsertTaskMapping(DATA_DIR, makeMapping());
            const written = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
            const state: SyncState = JSON.parse(written);
            expect(state.taskMappings).toHaveLength(1);
            expect(state.taskMappings[0].localId).toBe('local-task-1');
        });

        it('updates an existing mapping matched by localId', () => {
            const existing = makeState({
                taskMappings: [makeMapping({ googleTaskId: 'old-google-id' })],
            });
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(existing));

            upsertTaskMapping(DATA_DIR, makeMapping({ googleTaskId: 'new-google-id' }));
            const written = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
            const state: SyncState = JSON.parse(written);
            expect(state.taskMappings).toHaveLength(1);
            expect(state.taskMappings[0].googleTaskId).toBe('new-google-id');
        });

        it('adds a second mapping when localIds are different', () => {
            const existing = makeState({ taskMappings: [makeMapping({ localId: 'task-a' })] });
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(existing));

            upsertTaskMapping(DATA_DIR, makeMapping({ localId: 'task-b' }));
            const written = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
            const state: SyncState = JSON.parse(written);
            expect(state.taskMappings).toHaveLength(2);
        });
    });

    // -----------------------------------------------------------------------
    // removeTaskMapping
    // -----------------------------------------------------------------------

    describe('removeTaskMapping', () => {
        it('removes the mapping with the matching localId', () => {
            const existing = makeState({ taskMappings: [makeMapping()] });
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(existing));

            removeTaskMapping(DATA_DIR, 'local-task-1');
            const written = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
            const state: SyncState = JSON.parse(written);
            expect(state.taskMappings).toHaveLength(0);
        });

        it('is a no-op when localId is not found', () => {
            const existing = makeState({ taskMappings: [makeMapping()] });
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(existing));

            removeTaskMapping(DATA_DIR, 'non-existent-id');
            const written = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
            const state: SyncState = JSON.parse(written);
            expect(state.taskMappings).toHaveLength(1);
        });

        it('leaves unrelated mappings intact', () => {
            const existing = makeState({
                taskMappings: [
                    makeMapping({ localId: 'task-a' }),
                    makeMapping({ localId: 'task-b' }),
                ],
            });
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(existing));

            removeTaskMapping(DATA_DIR, 'task-a');
            const written = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
            const state: SyncState = JSON.parse(written);
            expect(state.taskMappings).toHaveLength(1);
            expect(state.taskMappings[0].localId).toBe('task-b');
        });
    });

    // -----------------------------------------------------------------------
    // syncTasks
    // -----------------------------------------------------------------------

    describe('syncTasks', () => {
        it('skips sync when not authenticated', async () => {
            setupAuth(false);
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            await syncTasks(api);
            expect(mockListTaskLists).not.toHaveBeenCalled();
        });

        it('updates lastSync timestamp after successful sync', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            mockFs.existsSync.mockReturnValue(false);
            await syncTasks(api);
            const written = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
            const state: SyncState = JSON.parse(written);
            expect(state.lastSync).not.toBeNull();
            expect(() => new Date(state.lastSync!)).not.toThrow();
        });

        it('removes stale mappings for tasks deleted externally', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            const existingState = makeState({
                taskMappings: [makeMapping({ googleListId: 'list-1', googleTaskId: 'deleted-task' })],
            });
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(existingState));

            mockListTaskLists.mockResolvedValueOnce([
                { id: 'list-1', title: 'My Tasks', updated: '2026-01-01T00:00:00.000Z' },
            ]);
            // Task is NOT in the fetched list — it was deleted externally
            mockListTasks.mockResolvedValueOnce([]);

            await syncTasks(api);

            const written = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
            const state: SyncState = JSON.parse(written);
            expect(state.taskMappings).toHaveLength(0);
        });

        it('keeps mappings for tasks still present in Google Tasks', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            const existingState = makeState({
                taskMappings: [makeMapping({ googleListId: 'list-1', googleTaskId: 'alive-task' })],
            });
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(existingState));

            mockListTaskLists.mockResolvedValueOnce([
                { id: 'list-1', title: 'My Tasks', updated: '2026-01-01T00:00:00.000Z' },
            ]);
            mockListTasks.mockResolvedValueOnce([
                { id: 'alive-task', title: 'Still Here', status: 'needsAction', updated: '', selfLink: '' },
            ]);

            await syncTasks(api);

            const written = mockFs.writeFileSync.mock.calls[0]?.[1] as string;
            const state: SyncState = JSON.parse(written);
            expect(state.taskMappings).toHaveLength(1);
        });

        it('logs an error and does not throw on API failure', async () => {
            const api = createMockPluginApi({ dataDir: DATA_DIR });
            mockListTaskLists.mockRejectedValueOnce(new Error('Network error'));
            await expect(syncTasks(api)).resolves.not.toThrow();
            expect(api.logger.error).toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // markGoogleTaskComplete
    // -----------------------------------------------------------------------

    describe('markGoogleTaskComplete', () => {
        it('does nothing when not authenticated', async () => {
            setupAuth(false);
            const logger = createMockLogger();
            await markGoogleTaskComplete(DATA_DIR, 'local-task-1', logger);
            expect(mockCompleteTask).not.toHaveBeenCalled();
        });

        it('does nothing when no mapping found for localId', async () => {
            const logger = createMockLogger();
            mockFs.existsSync.mockReturnValue(false);
            await markGoogleTaskComplete(DATA_DIR, 'unknown-task', logger);
            expect(mockCompleteTask).not.toHaveBeenCalled();
        });

        it('calls completeTask with the mapped list and task IDs', async () => {
            const logger = createMockLogger();
            const state = makeState({
                taskMappings: [makeMapping({ localId: 'my-task', googleListId: 'list-x', googleTaskId: 'gtask-y' })],
            });
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(state));

            await markGoogleTaskComplete(DATA_DIR, 'my-task', logger);
            expect(mockCompleteTask).toHaveBeenCalledWith('list-x', 'gtask-y');
        });

        it('logs a warning on completeTask failure without throwing', async () => {
            const logger = createMockLogger();
            const state = makeState({ taskMappings: [makeMapping()] });
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(state));
            mockCompleteTask.mockRejectedValueOnce(new Error('API down'));

            await expect(
                markGoogleTaskComplete(DATA_DIR, 'local-task-1', logger),
            ).resolves.not.toThrow();
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // findGoogleTaskByTitle
    // -----------------------------------------------------------------------

    describe('findGoogleTaskByTitle', () => {
        it('returns null when not authenticated', async () => {
            setupAuth(false);
            const logger = createMockLogger();
            const result = await findGoogleTaskByTitle('My Task', logger);
            expect(result).toBeNull();
        });

        it('returns null when no task with that title exists', async () => {
            const logger = createMockLogger();
            mockListTaskLists.mockResolvedValueOnce([
                { id: 'list-1', title: 'Work', updated: '' },
            ]);
            mockListTasks.mockResolvedValueOnce([
                { id: 'task-1', title: 'Other Task', status: 'needsAction', updated: '', selfLink: '' },
            ]);
            const result = await findGoogleTaskByTitle('My Task', logger);
            expect(result).toBeNull();
        });

        it('performs case-insensitive title matching', async () => {
            const logger = createMockLogger();
            mockListTaskLists.mockResolvedValueOnce([
                { id: 'list-1', title: 'Work', updated: '' },
            ]);
            mockListTasks.mockResolvedValueOnce([
                { id: 'task-1', title: 'Buy Milk', status: 'needsAction', updated: '', selfLink: '' },
            ]);
            const result = await findGoogleTaskByTitle('BUY MILK', logger);
            expect(result).not.toBeNull();
            expect(result!.task.id).toBe('task-1');
            expect(result!.listId).toBe('list-1');
        });

        it('returns first match and logs a warning when duplicates found', async () => {
            const logger = createMockLogger();
            mockListTaskLists.mockResolvedValueOnce([
                { id: 'list-1', title: 'Work', updated: '' },
                { id: 'list-2', title: 'Personal', updated: '' },
            ]);
            mockListTasks
                .mockResolvedValueOnce([
                    { id: 'task-a', title: 'Buy Milk', status: 'needsAction', updated: '', selfLink: '' },
                ])
                .mockResolvedValueOnce([
                    { id: 'task-b', title: 'Buy Milk', status: 'needsAction', updated: '', selfLink: '' },
                ]);

            const result = await findGoogleTaskByTitle('Buy Milk', logger);
            expect(result!.task.id).toBe('task-a');
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('2 tasks named'));
        });

        it('returns null and logs a warning on API failure', async () => {
            const logger = createMockLogger();
            mockListTaskLists.mockRejectedValueOnce(new Error('Network error'));
            const result = await findGoogleTaskByTitle('Any Task', logger);
            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalled();
        });
    });
});
