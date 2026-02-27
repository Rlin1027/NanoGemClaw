/**
 * Google Tasks API wrapper
 *
 * All functions check authentication before making API calls and throw
 * descriptive errors if the user is not authenticated.
 */

import { google } from 'googleapis';
import { getOAuth2Client } from 'nanogemclaw-plugin-google-auth';

// ============================================================================
// Types
// ============================================================================

export interface TaskList {
  id: string;
  title: string;
  updated: string;
}

export interface Task {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  status: 'needsAction' | 'completed';
  completed?: string;
  updated: string;
  selfLink: string;
}

export interface CreateTaskInput {
  title: string;
  notes?: string;
  /** ISO 8601 date string (YYYY-MM-DD or full datetime) */
  due?: string;
}

export interface ListTasksOptions {
  showCompleted?: boolean;
  dueMin?: string;
  dueMax?: string;
  maxResults?: number;
}

// ============================================================================
// Helpers
// ============================================================================

function getAuthenticatedClient() {
  const auth = getOAuth2Client();
  if (!auth) {
    throw new Error(
      'Google Tasks: not authenticated. Authorize via dashboard Settings → Google Account.',
    );
  }
  return google.tasks({ version: 'v1', auth });
}

function normalizeTask(raw: Record<string, unknown>): Task {
  const rawStatus = String(raw['status'] ?? 'needsAction');
  const status: Task['status'] =
    rawStatus === 'completed' ? 'completed' : 'needsAction';
  return {
    id: String(raw['id'] ?? ''),
    title: String(raw['title'] ?? ''),
    notes: raw['notes'] != null ? String(raw['notes']) : undefined,
    due: raw['due'] != null ? String(raw['due']) : undefined,
    status,
    completed: raw['completed'] != null ? String(raw['completed']) : undefined,
    updated: String(raw['updated'] ?? ''),
    selfLink: String(raw['selfLink'] ?? ''),
  };
}

function normalizeTaskList(raw: Record<string, unknown>): TaskList {
  return {
    id: String(raw['id'] ?? ''),
    title: String(raw['title'] ?? ''),
    updated: String(raw['updated'] ?? ''),
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * List all task lists for the authenticated user.
 */
export async function listTaskLists(): Promise<TaskList[]> {
  const tasks = getAuthenticatedClient();
  const res = await tasks.tasklists.list({ maxResults: 100 });
  const items = res.data.items ?? [];
  return items.map((item) =>
    normalizeTaskList(item as Record<string, unknown>),
  );
}

/**
 * Get the "@default" task list (primary list).
 *
 * Uses the Google Tasks API's built-in "@default" alias which always
 * resolves to the user's primary task list, regardless of list ordering.
 */
export async function getDefaultTaskList(): Promise<TaskList> {
  const tasks = getAuthenticatedClient();
  const res = await tasks.tasklists.get({ tasklist: '@default' });
  if (!res.data || !res.data.id) {
    throw new Error(
      'Google Tasks: no default task list found for this account',
    );
  }
  return normalizeTaskList(res.data as Record<string, unknown>);
}

/**
 * List tasks in a specific task list with optional filters.
 */
export async function listTasks(
  tasklistId: string,
  options: ListTasksOptions = {},
): Promise<Task[]> {
  const tasks = getAuthenticatedClient();
  const res = await tasks.tasks.list({
    tasklist: tasklistId,
    showCompleted: options.showCompleted ?? false,
    showHidden: false,
    dueMin: options.dueMin,
    dueMax: options.dueMax,
    maxResults: options.maxResults ?? 100,
  });
  const items = res.data.items ?? [];
  return items.map((item) => normalizeTask(item as Record<string, unknown>));
}

/**
 * Create a new task in the given task list.
 */
export async function createTask(
  tasklistId: string,
  input: CreateTaskInput,
): Promise<Task> {
  const tasks = getAuthenticatedClient();

  // Google Tasks API requires due dates as RFC 3339 timestamps
  let dueValue: string | undefined;
  if (input.due) {
    // Accept YYYY-MM-DD and convert to RFC 3339 at midnight UTC
    if (/^\d{4}-\d{2}-\d{2}$/.test(input.due)) {
      dueValue = `${input.due}T00:00:00.000Z`;
    } else {
      dueValue = input.due;
    }
  }

  const res = await tasks.tasks.insert({
    tasklist: tasklistId,
    requestBody: {
      title: input.title,
      notes: input.notes,
      due: dueValue,
    },
  });

  return normalizeTask(res.data as Record<string, unknown>);
}

/**
 * Mark a task as completed.
 */
export async function completeTask(
  tasklistId: string,
  taskId: string,
): Promise<Task> {
  const tasks = getAuthenticatedClient();
  const res = await tasks.tasks.patch({
    tasklist: tasklistId,
    task: taskId,
    requestBody: {
      status: 'completed',
      completed: new Date().toISOString(),
    },
  });
  return normalizeTask(res.data as Record<string, unknown>);
}

/**
 * Delete a task permanently.
 */
export async function deleteTask(
  tasklistId: string,
  taskId: string,
): Promise<void> {
  const tasks = getAuthenticatedClient();
  await tasks.tasks.delete({ tasklist: tasklistId, task: taskId });
}

/**
 * Find a task list by name (case-insensitive). Returns null if not found.
 */
export async function findTaskListByName(
  name: string,
): Promise<TaskList | null> {
  const lists = await listTaskLists();
  const lower = name.toLowerCase();
  return lists.find((l) => l.title.toLowerCase() === lower) ?? null;
}
