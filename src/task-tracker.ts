/**
 * Task Tracking Module
 * 
 * Manages multi-turn tasks where the agent needs to perform multiple steps
 * to complete a user request. Tracks state, turns, and context.
 */

import { TASK_TRACKING } from './config.js';
import { logger } from './logger.js';

export interface TaskState {
    id: string;
    chatId: string;
    description: string;
    status: 'active' | 'completed' | 'failed' | 'cancelled';
    turnCount: number;
    maxTurns: number;
    history: string[];
    createdAt: string;
    updatedAt: string;
}

const activeTasks = new Map<string, TaskState>();

/**
 * Create a new specific task tracking session
 */
export function createTask(chatId: string, description: string): TaskState {
    // Check for existing active task
    const existing = activeTasks.get(chatId);
    if (existing && existing.status === 'active') {
        // Fail the existing task before creating a new one
        existing.status = 'failed';
        existing.history.push(`${new Date().toISOString()}: Superseded by new task`);
        existing.updatedAt = new Date().toISOString();
        logger.warn({ chatId, oldTaskId: existing.id }, 'Existing task superseded by new task');
    }

    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const task: TaskState = {
        id,
        chatId,
        description,
        status: 'active',
        turnCount: 0,
        maxTurns: TASK_TRACKING.MAX_TURNS,
        history: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    activeTasks.set(chatId, task);
    logger.info({ chatId, taskId: id }, 'New multi-turn task created');
    return task;
}

/**
 * Get active task for a chat
 */
export function getActiveTask(chatId: string): TaskState | undefined {
    return activeTasks.get(chatId);
}

/**
 * Update task progress
 */
export function updateTask(chatId: string, action: string): TaskState | undefined {
    const task = activeTasks.get(chatId);
    if (!task) return undefined;

    task.turnCount++;
    task.history.push(`${new Date().toISOString()}: ${action}`);
    task.updatedAt = new Date().toISOString();

    if (task.turnCount >= task.maxTurns) {
        logger.warn({ chatId, taskId: task.id }, 'Task reached max turns');
    }

    return task;
}

/**
 * Complete a task
 */
export function completeTask(chatId: string): void {
    const task = activeTasks.get(chatId);
    if (task) {
        task.status = 'completed';
        logger.info({ chatId, taskId: task.id }, 'Task completed');
        activeTasks.delete(chatId);
    }
}

/**
 * Cancel/Fail a task
 */
/**
 * Cancel/Fail a task
 */
export function failTask(chatId: string, reason: string): void {
    const task = activeTasks.get(chatId);
    if (task) {
        task.status = 'failed';
        logger.info({ chatId, taskId: task.id, reason }, 'Task failed');
        activeTasks.delete(chatId);
    }
}

/**
 * Cleanup stale tasks
 */
export function cleanupStaleTasks(): void {
    const now = Date.now();
    const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
    let cleanupCount = 0;

    for (const [chatId, task] of activeTasks.entries()) {
        const lastUpdate = new Date(task.updatedAt).getTime();
        if (now - lastUpdate > STALE_THRESHOLD_MS) {
            activeTasks.delete(chatId);
            cleanupCount++;
            logger.info({ chatId, taskId: task.id }, 'Stale task cleaned up');
        }
    }

    if (cleanupCount > 0) {
        logger.info({ cleanupCount }, 'Task cleanup completed');
    }
}

/**
 * Start task cleanup scheduler
 */
export function startTaskCleanupScheduler(): NodeJS.Timeout {
    // Check every 10 minutes
    const intervalId = setInterval(cleanupStaleTasks, 10 * 60 * 1000);
    logger.info({}, 'Task cleanup scheduler started');
    return intervalId;
}
