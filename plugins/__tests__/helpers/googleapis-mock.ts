/**
 * Shared googleapis client mock factories — used by tests for
 * google-tasks, google-drive, and google-calendar-rw.
 *
 * Each factory returns a mock client with vi.fn() methods that
 * resolve to sensible defaults.  Override individual method
 * responses per-test with `.mockResolvedValueOnce(...)`.
 */
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Google Tasks
// ---------------------------------------------------------------------------

export function createMockTasksClient() {
  return {
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
  };
}

// ---------------------------------------------------------------------------
// Google Drive
// ---------------------------------------------------------------------------

export function createMockDriveClient() {
  return {
    files: {
      list: vi.fn().mockResolvedValue({ data: { files: [] } }),
      get: vi.fn().mockResolvedValue({
        data: {
          id: 'file-id',
          name: 'Test File',
          mimeType: 'text/plain',
          modifiedTime: '2026-01-01T00:00:00.000Z',
          size: '1024',
          webViewLink: 'https://drive.google.com/file/d/file-id/view',
        },
      }),
      export: vi.fn().mockResolvedValue({ data: 'exported content' }),
    },
  };
}

// ---------------------------------------------------------------------------
// Google Calendar
// ---------------------------------------------------------------------------

export function createMockCalendarClient() {
  return {
    events: {
      list: vi.fn().mockResolvedValue({ data: { items: [] } }),
      insert: vi.fn().mockResolvedValue({
        data: {
          id: 'event-id',
          summary: 'New Event',
          start: { dateTime: '2026-01-01T10:00:00Z' },
          end: { dateTime: '2026-01-01T11:00:00Z' },
        },
      }),
      patch: vi.fn().mockResolvedValue({
        data: {
          id: 'event-id',
          summary: 'Updated Event',
          start: { dateTime: '2026-01-01T10:00:00Z' },
          end: { dateTime: '2026-01-01T11:00:00Z' },
        },
      }),
      delete: vi.fn().mockResolvedValue({}),
    },
    freebusy: {
      query: vi.fn().mockResolvedValue({
        data: { calendars: { primary: { busy: [] } } },
      }),
    },
  };
}
