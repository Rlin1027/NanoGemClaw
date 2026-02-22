import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { AgentStatus } from '../components/StatusCard';

const SERVER_URL = import.meta.env.VITE_API_URL || window.location.origin;

export interface GroupData {
    id: string;
    name: string;
    status: AgentStatus;
    messageCount: number;
    activeTasks: number;
}

// ANSI color codes for xterm display
const LEVEL_ANSI: Record<string, string> = {
    debug: '\x1b[90m',  // gray
    info:  '\x1b[36m',  // cyan
    warn:  '\x1b[33m',  // yellow
    error: '\x1b[31m',  // red
};
const RESET = '\x1b[0m';
const DIM = '\x1b[90m';

function formatLogEntry(entry: any): string {
    if (typeof entry === 'string') return entry;
    const ts = entry.timestamp
        ? new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '';
    const level = (entry.level || 'info').toUpperCase().padEnd(5);
    const color = LEVEL_ANSI[entry.level] || '';
    return `${DIM}${ts}${RESET} ${color}${level}${RESET} ${entry.message || ''}`;
}

export function useSocket() {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [groups, setGroups] = useState<GroupData[]>([]);
    const [logs, setLogs] = useState<string[]>([]);

    useEffect(() => {
        const socketInstance = io(SERVER_URL);

        socketInstance.on('connect', () => {
            console.log('Connected to Dashboard Server');
            setIsConnected(true);
        });

        socketInstance.on('disconnect', () => {
            console.log('Disconnected from Dashboard Server');
            setIsConnected(false);
        });

        socketInstance.on('groups:update', (data: GroupData[]) => {
            console.log('Received groups update:', data);
            setGroups(data);
        });

        socketInstance.on('logs:history', (history: any[]) => {
            setLogs(history.map(formatLogEntry));
        });

        socketInstance.on('logs:entry', (entry: any) => {
            setLogs(prev => [...prev, formatLogEntry(entry)]);
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.disconnect();
        };
    }, []);

    return { socket, isConnected, groups, logs };
}
