import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface TerminalProps {
    logs: string[];
    isLoading?: boolean;
    className?: string;
    autoScroll?: boolean;
}

const TERMINAL_THEME = {
    background: '#0f172a', // slate-950
    foreground: '#e2e8f0', // slate-200
    cursor: '#3b82f6',     // blue-500
    selectionBackground: 'rgba(59, 130, 246, 0.3)',
    black: '#000000',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#ffffff',
    brightBlack: '#475569',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#f1f5f9',
};

export function Terminal({ logs, isLoading, className, autoScroll = true }: TerminalProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const prevLogsLengthRef = useRef(0);

    // Initialize Terminal
    useEffect(() => {
        if (!containerRef.current) return;

        const term = new XTerm({
            cursorBlink: true,
            fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
            fontSize: 13,
            lineHeight: 1.2,
            theme: TERMINAL_THEME,
            disableStdin: true, // Read-only logs
            convertEol: true,
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);

        term.open(containerRef.current);
        fitAddon.fit();

        terminalRef.current = term;
        fitAddonRef.current = fitAddon;
        prevLogsLengthRef.current = 0;

        // Handle resize
        const handleResize = () => fitAddon.fit();
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            term.dispose();
        };
    }, []);

    // Write logs (delta only; full clear only when logs shrink)
    useEffect(() => {
        const term = terminalRef.current;
        if (!term) return;

        if (logs.length < prevLogsLengthRef.current) {
            // Logs were cleared — redraw from scratch
            term.clear();
            logs.forEach(log => term.writeln(log));
        } else {
            // Append only new entries
            const newEntries = logs.slice(prevLogsLengthRef.current);
            newEntries.forEach(log => term.writeln(log));
        }

        prevLogsLengthRef.current = logs.length;

        if (autoScroll) {
            term.scrollToBottom();
        }
    }, [logs, autoScroll]);

    // Handle loading state overlay
    return (
        <div className={cn("relative w-full h-full min-h-[400px] bg-slate-950 rounded-lg overflow-hidden border border-slate-800 shadow-inner", className)}>
            <div ref={containerRef} className="w-full h-full" />

            {isLoading && (
                <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center z-10">
                    <div className="flex flex-col items-center gap-2 text-blue-400">
                        <Loader2 className="animate-spin w-8 h-8" />
                        <span className="text-xs font-mono">Connecting to stream...</span>
                    </div>
                </div>
            )}
        </div>
    );
}
