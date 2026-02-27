/**
 * Tests for google-tasks/tasks-api.ts
 *
 * ~20 tests covering normalizeTask, getDefaultTaskList, listTaskLists,
 * listTasks, createTask, completeTask, deleteTask, findTaskListByName,
 * and unauthenticated error paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before any imports; only vi.fn() allowed.
// ---------------------------------------------------------------------------

const mockGetOAuth2Client = vi.hoisted(() => vi.fn());
const mockIsAuthenticated = vi.hoisted(() => vi.fn().mockReturnValue(true));

const mockTasksClient = vi.hoisted(() => ({
    tasklists: {
        list: vi.fn().mockResolvedValue({ data: { items: [] } }),
        get: vi.fn().mockResolvedValue({
            data: {
                id: 'default-list-id',
                title: 'My Tasks',
                updated: '2026-01-01T00:00:00.000Z',
            },
        }),
    },
    tasks: {
        list: vi.fn().mockResolvedValue({ data: { items: [] } }),
        insert: vi.fn().mockResolvedValue({
            data: {
                id: 'new-task-id',
                title: 'New Task',
                status: 'needsAction',
                updated: '2026-01-01T00:00:00.000Z',
                selfLink: 'https://www.googleapis.com/tasks/v1/lists/default/tasks/new-task-id',
            },
        }),
        patch: vi.fn().mockResolvedValue({
            data: {
                id: 'task-id',
                title: 'Task',
                status: 'completed',
                completed: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-01T00:00:00.000Z',
                selfLink: 'https://www.googleapis.com/tasks/v1/lists/default/tasks/task-id',
            },
        }),
        delete: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('googleapis', () => ({
    google: {
        tasks: vi.fn(() => mockTasksClient),
    },
}));

vi.mock('nanogemclaw-plugin-google-auth', () => ({
    getOAuth2Client: mockGetOAuth2Client,
    isAuthenticated: mockIsAuthenticated,
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks are in place
// ---------------------------------------------------------------------------

import {
    listTaskLists,
    getDefaultTaskList,
    listTasks,
    createTask,
    completeTask,
    deleteTask,
    findTaskListByName,
} from '../tasks-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupAuth(authenticated = true) {
    mockIsAuthenticated.mockReturnValue(authenticated);
    if (authenticated) {
        mockGetOAuth2Client.mockReturnValue({
            credentials: { access_token: 'test-access-token' },
        });
    } else {
        mockGetOAuth2Client.mockReturnValue(null);
    }
}

function makeRawTask(overrides: Record<string, unknown> = {}) {
    return {
        id: 'task-1',
        title: 'My Task',
        status: 'needsAction',
        updated: '2026-01-01T00:00:00.000Z',
        selfLink: 'https://www.googleapis.com/tasks/v1/lists/list-1/tasks/task-1',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('google-tasks/tasks-api', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupAuth(true);
        // Restore default mock return values after clearAllMocks
        mockTasksClient.tasklists.list.mockResolvedValue({ data: { items: [] } });
        mockTasksClient.tasklists.get.mockResolvedValue({
            data: { id: 'default-list-id', title: 'My Tasks', updated: '2026-01-01T00:00:00.000Z' },
        });
        mockTasksClient.tasks.list.mockResolvedValue({ data: { items: [] } });
        mockTasksClient.tasks.insert.mockResolvedValue({
            data: {
                id: 'new-task-id',
                title: 'New Task',
                status: 'needsAction',
                updated: '2026-01-01T00:00:00.000Z',
                selfLink: 'https://www.googleapis.com/tasks/v1/lists/default/tasks/new-task-id',
            },
        });
        mockTasksClient.tasks.patch.mockResolvedValue({
            data: {
                id: 'task-id',
                title: 'Task',
                status: 'completed',
                completed: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-01T00:00:00.000Z',
                selfLink: 'https://www.googleapis.com/tasks/v1/lists/default/tasks/task-id',
            },
        });
        mockTasksClient.tasks.delete.mockResolvedValue({});
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    // -----------------------------------------------------------------------
    // Not authenticated
    // -----------------------------------------------------------------------

    describe('when not authenticated', () => {
        beforeEach(() => {
            setupAuth(false);
        });

        it('listTaskLists throws a descriptive error', async () => {
            await expect(listTaskLists()).rejects.toThrow('Google Tasks: not authenticated');
        });

        it('getDefaultTaskList throws a descriptive error', async () => {
            await expect(getDefaultTaskList()).rejects.toThrow('Google Tasks: not authenticated');
        });

        it('listTasks throws a descriptive error', async () => {
            await expect(listTasks('list-1')).rejects.toThrow('Google Tasks: not authenticated');
        });

        it('createTask throws a descriptive error', async () => {
            await expect(createTask('list-1', { title: 'Test' })).rejects.toThrow(
                'Google Tasks: not authenticated',
            );
        });

        it('completeTask throws a descriptive error', async () => {
            await expect(completeTask('list-1', 'task-1')).rejects.toThrow(
                'Google Tasks: not authenticated',
            );
        });

        it('deleteTask throws a descriptive error', async () => {
            await expect(deleteTask('list-1', 'task-1')).rejects.toThrow(
                'Google Tasks: not authenticated',
            );
        });
    });

    // -----------------------------------------------------------------------
    // normalizeTask (exercised through listTasks)
    // -----------------------------------------------------------------------

    describe('normalizeTask (via listTasks)', () => {
        it('maps status "completed" to completed', async () => {
            mockTasksClient.tasks.list.mockResolvedValueOnce({
                data: { items: [makeRawTask({ status: 'completed' })] },
            });
            const [task] = await listTasks('list-1');
            expect(task.status).toBe('completed');
        });

        it('maps status "needsAction" to needsAction', async () => {
            mockTasksClient.tasks.list.mockResolvedValueOnce({
                data: { items: [makeRawTask({ status: 'needsAction' })] },
            });
            const [task] = await listTasks('list-1');
            expect(task.status).toBe('needsAction');
        });

        it('maps unknown status to needsAction', async () => {
            mockTasksClient.tasks.list.mockResolvedValueOnce({
                data: { items: [makeRawTask({ status: 'someUnknownStatus' })] },
            });
            const [task] = await listTasks('list-1');
            expect(task.status).toBe('needsAction');
        });

        it('maps null notes to undefined', async () => {
            mockTasksClient.tasks.list.mockResolvedValueOnce({
                data: { items: [makeRawTask({ notes: null })] },
            });
            const [task] = await listTasks('list-1');
            expect(task.notes).toBeUndefined();
        });

        it('maps null due to undefined', async () => {
            mockTasksClient.tasks.list.mockResolvedValueOnce({
                data: { items: [makeRawTask({ due: null })] },
            });
            const [task] = await listTasks('list-1');
            expect(task.due).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // getDefaultTaskList
    // -----------------------------------------------------------------------

    describe('getDefaultTaskList', () => {
        it('calls tasklists.get with @default alias', async () => {
            await getDefaultTaskList();
            expect(mockTasksClient.tasklists.get).toHaveBeenCalledWith({
                tasklist: '@default',
            });
        });

        it('returns a mapped TaskList on success', async () => {
            const result = await getDefaultTaskList();
            expect(result).toMatchObject({
                id: 'default-list-id',
                title: 'My Tasks',
            });
        });

        it('throws when API returns no data', async () => {
            mockTasksClient.tasklists.get.mockResolvedValueOnce({ data: {} });
            await expect(getDefaultTaskList()).rejects.toThrow(
                'Google Tasks: no default task list found',
            );
        });

        it('throws when API returns null id', async () => {
            mockTasksClient.tasklists.get.mockResolvedValueOnce({
                data: { id: null, title: 'My Tasks', updated: '2026-01-01T00:00:00.000Z' },
            });
            await expect(getDefaultTaskList()).rejects.toThrow(
                'Google Tasks: no default task list found',
            );
        });
    });

    // -----------------------------------------------------------------------
    // listTaskLists
    // -----------------------------------------------------------------------

    describe('listTaskLists', () => {
        it('returns empty array when items is empty', async () => {
            const result = await listTaskLists();
            expect(result).toEqual([]);
        });

        it('returns mapped TaskList[] from API', async () => {
            mockTasksClient.tasklists.list.mockResolvedValueOnce({
                data: {
                    items: [
                        { id: 'list-1', title: 'Work', updated: '2026-01-01T00:00:00.000Z' },
                        { id: 'list-2', title: 'Personal', updated: '2026-02-01T00:00:00.000Z' },
                    ],
                },
            });
            const result = await listTaskLists();
            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({ id: 'list-1', title: 'Work' });
            expect(result[1]).toMatchObject({ id: 'list-2', title: 'Personal' });
        });

        it('handles null items gracefully', async () => {
            mockTasksClient.tasklists.list.mockResolvedValueOnce({
                data: { items: null },
            });
            const result = await listTaskLists();
            expect(result).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // listTasks
    // -----------------------------------------------------------------------

    describe('listTasks', () => {
        it('passes showCompleted=false by default', async () => {
            await listTasks('list-1');
            expect(mockTasksClient.tasks.list).toHaveBeenCalledWith(
                expect.objectContaining({ showCompleted: false }),
            );
        });

        it('passes showCompleted=true when specified', async () => {
            await listTasks('list-1', { showCompleted: true });
            expect(mockTasksClient.tasks.list).toHaveBeenCalledWith(
                expect.objectContaining({ showCompleted: true }),
            );
        });

        it('defaults maxResults to 100', async () => {
            await listTasks('list-1');
            expect(mockTasksClient.tasks.list).toHaveBeenCalledWith(
                expect.objectContaining({ maxResults: 100 }),
            );
        });

        it('passes explicit maxResults', async () => {
            await listTasks('list-1', { maxResults: 50 });
            expect(mockTasksClient.tasks.list).toHaveBeenCalledWith(
                expect.objectContaining({ maxResults: 50 }),
            );
        });

        it('passes dueMin and dueMax options', async () => {
            await listTasks('list-1', {
                dueMin: '2026-01-01T00:00:00Z',
                dueMax: '2026-01-31T23:59:59Z',
            });
            expect(mockTasksClient.tasks.list).toHaveBeenCalledWith(
                expect.objectContaining({
                    dueMin: '2026-01-01T00:00:00Z',
                    dueMax: '2026-01-31T23:59:59Z',
                }),
            );
        });

        it('returns empty array when items is null/undefined', async () => {
            mockTasksClient.tasks.list.mockResolvedValueOnce({ data: {} });
            const result = await listTasks('list-1');
            expect(result).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // createTask
    // -----------------------------------------------------------------------

    describe('createTask', () => {
        it('converts YYYY-MM-DD date to RFC 3339 with T00:00:00.000Z', async () => {
            await createTask('list-1', { title: 'Task', due: '2026-03-15' });
            expect(mockTasksClient.tasks.insert).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestBody: expect.objectContaining({
                        due: '2026-03-15T00:00:00.000Z',
                    }),
                }),
            );
        });

        it('passes full ISO datetime through unchanged', async () => {
            const iso = '2026-03-15T09:00:00.000Z';
            await createTask('list-1', { title: 'Task', due: iso });
            expect(mockTasksClient.tasks.insert).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestBody: expect.objectContaining({ due: iso }),
                }),
            );
        });

        it('passes undefined due when no date provided', async () => {
            await createTask('list-1', { title: 'Task' });
            expect(mockTasksClient.tasks.insert).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestBody: expect.objectContaining({ due: undefined }),
                }),
            );
        });

        it('returns a normalized Task from API response', async () => {
            const result = await createTask('list-1', { title: 'New Task' });
            expect(result).toMatchObject({ id: 'new-task-id', title: 'New Task' });
        });

        it('passes tasklist ID, title, and notes correctly', async () => {
            await createTask('my-list', { title: 'Hello', notes: 'World' });
            expect(mockTasksClient.tasks.insert).toHaveBeenCalledWith(
                expect.objectContaining({
                    tasklist: 'my-list',
                    requestBody: expect.objectContaining({ title: 'Hello', notes: 'World' }),
                }),
            );
        });
    });

    // -----------------------------------------------------------------------
    // completeTask
    // -----------------------------------------------------------------------

    describe('completeTask', () => {
        it('sends status "completed" in the patch body', async () => {
            await completeTask('list-1', 'task-1');
            expect(mockTasksClient.tasks.patch).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestBody: expect.objectContaining({ status: 'completed' }),
                }),
            );
        });

        it('sends a completed timestamp in the patch body', async () => {
            await completeTask('list-1', 'task-1');
            const call = mockTasksClient.tasks.patch.mock.calls[0][0] as {
                requestBody: { completed: string };
            };
            expect(call.requestBody.completed).toBeDefined();
            expect(() => new Date(call.requestBody.completed)).not.toThrow();
        });

        it('passes the correct tasklist and task IDs', async () => {
            await completeTask('list-abc', 'task-xyz');
            expect(mockTasksClient.tasks.patch).toHaveBeenCalledWith(
                expect.objectContaining({ tasklist: 'list-abc', task: 'task-xyz' }),
            );
        });

        it('returns a normalized Task', async () => {
            const result = await completeTask('list-1', 'task-1');
            expect(result.status).toBe('completed');
        });
    });

    // -----------------------------------------------------------------------
    // deleteTask
    // -----------------------------------------------------------------------

    describe('deleteTask', () => {
        it('calls tasks.delete with correct tasklist and task params', async () => {
            await deleteTask('list-1', 'task-2');
            expect(mockTasksClient.tasks.delete).toHaveBeenCalledWith({
                tasklist: 'list-1',
                task: 'task-2',
            });
        });

        it('returns undefined (void)', async () => {
            const result = await deleteTask('list-1', 'task-1');
            expect(result).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // findTaskListByName
    // -----------------------------------------------------------------------

    describe('findTaskListByName', () => {
        const lists = [
            { id: 'list-1', title: 'Work', updated: '2026-01-01T00:00:00.000Z' },
            { id: 'list-2', title: 'Personal', updated: '2026-01-01T00:00:00.000Z' },
        ];

        beforeEach(() => {
            mockTasksClient.tasklists.list.mockResolvedValue({ data: { items: lists } });
        });

        it('returns the matching task list (exact case)', async () => {
            const result = await findTaskListByName('Work');
            expect(result).toMatchObject({ id: 'list-1', title: 'Work' });
        });

        it('performs case-insensitive search (lowercase input)', async () => {
            const result = await findTaskListByName('personal');
            expect(result).toMatchObject({ id: 'list-2', title: 'Personal' });
        });

        it('performs case-insensitive search (uppercase input)', async () => {
            const result = await findTaskListByName('WORK');
            expect(result).toMatchObject({ id: 'list-1', title: 'Work' });
        });

        it('returns null when name is not found', async () => {
            const result = await findTaskListByName('NonExistent');
            expect(result).toBeNull();
        });

        it('returns null on empty task list', async () => {
            mockTasksClient.tasklists.list.mockResolvedValueOnce({ data: { items: [] } });
            const result = await findTaskListByName('Work');
            expect(result).toBeNull();
        });
    });
});
