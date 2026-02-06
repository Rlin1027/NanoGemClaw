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
export function failTask(chatId: string, reason: string): void {
    const task = activeTasks.get(chatId);
    if (task) {
        task.status = 'failed';
        logger.info({ chatId, taskId: task.id, reason }, 'Task failed');
        activeTasks.delete(chatId);
    }
}
