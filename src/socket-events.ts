/**
 * Centralized Socket.IO event type definitions.
 * Keep in sync with packages/dashboard/src/types/socket-events.ts
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

export interface ServerToClientEvents {
    'groups:update': (groups: DashboardGroupData[]) => void;
    'logs:history': (logs: DashboardLogEntry[]) => void;
    'logs:entry': (entry: DashboardLogEntry) => void;
}

export interface ClientToServerEvents {
    // Currently no custom client→server events; reserved for future use
}
