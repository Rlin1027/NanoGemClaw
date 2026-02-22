import { useState, useCallback } from 'react';

export interface Toast {
    id: string;
    message: string;
    type: 'error' | 'success' | 'info';
}

// Global toast state (simple singleton pattern)
let toastListeners: Array<(toasts: Toast[]) => void> = [];
let currentToasts: Toast[] = [];

function notify() {
    toastListeners.forEach(fn => fn([...currentToasts]));
}

export function showToast(message: string, type: Toast['type'] = 'error') {
    const id = Date.now().toString();
    currentToasts.push({ id, message, type });
    notify();
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        currentToasts = currentToasts.filter(t => t.id !== id);
        notify();
    }, 5000);
}

export function useToast() {
    const [toasts, setToasts] = useState<Toast[]>(currentToasts);

    useState(() => {
        toastListeners.push(setToasts);
        return () => {
            toastListeners = toastListeners.filter(fn => fn !== setToasts);
        };
    });

    const dismiss = useCallback((id: string) => {
        currentToasts = currentToasts.filter(t => t.id !== id);
        notify();
    }, []);

    return { toasts, dismiss, showToast };
}
