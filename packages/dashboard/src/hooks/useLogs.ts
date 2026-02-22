import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_API_URL || '';
const MAX_LOG_ENTRIES = 2000;

export interface LogEntry {
    id: number;
    timestamp: string;
    level: string;
    message: string;
    data?: unknown;
}

export function useLogs() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [paused, setPaused] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const bufferRef = useRef<LogEntry[]>([]);
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        const socket = io(SERVER_URL || window.location.origin);
        socketRef.current = socket;

        socket.on('connect', () => setIsConnected(true));
        socket.on('disconnect', () => setIsConnected(false));

        // Receive initial log history
        socket.on('logs:history', (history: LogEntry[]) => {
            setLogs(history);
            bufferRef.current = history;
        });

        // Receive streaming log entries
        socket.on('logs:entry', (entry: LogEntry) => {
            bufferRef.current = [...bufferRef.current, entry].slice(-MAX_LOG_ENTRIES);
            if (!paused) {
                setLogs(bufferRef.current);
            }
        });

        return () => {
            socket.disconnect();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // When unpausing, flush buffer
    useEffect(() => {
        if (!paused) {
            setLogs(bufferRef.current);
        }
    }, [paused]);

    const togglePause = useCallback(() => {
        setPaused(prev => !prev);
    }, []);

    const clearLogs = useCallback(() => {
        setLogs([]);
        bufferRef.current = [];
    }, []);

    return { logs, paused, togglePause, clearLogs, isConnected };
}
