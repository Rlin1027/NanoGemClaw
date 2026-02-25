/**
 * Socket.IO event type definitions for the dashboard.
 * These mirror the backend types in src/socket-events.ts — keep in sync.
 */

export interface DashboardLogEntry {
    id: number;
    timestamp: string;
    level: string;
    message: string;
    data?: unknown;
}

export interface DashboardGroupData {
    id: string;
    name: string;
    status: string;
    messageCount: number;
    activeTasks: number;
}
