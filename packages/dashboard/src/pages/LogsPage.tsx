import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Pause, Play, Trash2, Search } from 'lucide-react';
import { useLogs } from '../hooks/useLogs';
import { useLocale } from '../hooks/useLocale';

const LEVEL_COLORS: Record<string, string> = {
    debug: 'text-slate-400 bg-slate-800',
    info: 'text-blue-300 bg-blue-500/20',
    warn: 'text-yellow-300 bg-yellow-500/20',
    error: 'text-red-300 bg-red-500/20',
};

export function LogsPage() {
    const { t } = useTranslation('logs');
    const locale = useLocale();
    const { logs, paused, togglePause, clearLogs, isConnected } = useLogs();
    const [searchParams] = useSearchParams();
    const [search, setSearch] = useState(searchParams.get('group') || '');
    const [levels, setLevels] = useState<Set<string>>(new Set(['debug', 'info', 'warn', 'error']));
    const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
    const bottomRef = useRef<HTMLDivElement>(null);

    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            if (!levels.has(log.level)) return false;
            if (search && !log.message.toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        });
    }, [logs, levels, search]);

    // Auto-scroll to bottom when not paused
    useEffect(() => {
        if (!paused && bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [filteredLogs, paused]);

    const toggleLevel = (level: string) => {
        setLevels(prev => {
            const next = new Set(prev);
            if (next.has(level)) next.delete(level);
            else next.add(level);
            return next;
        });
    };

    const toggleExpand = (id: number) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const formatTime = (ts: string) => {
        try {
            return new Date(ts).toLocaleTimeString(locale, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions);
        } catch { return ts; }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-8rem)]">
            {/* Filter Bar */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
                {/* Level toggles */}
                {['debug', 'info', 'warn', 'error'].map(level => (
                    <button
                        key={level}
                        onClick={() => toggleLevel(level)}
                        className={`px-3 py-1 rounded-full text-xs font-mono font-medium transition-all ${
                            levels.has(level)
                                ? LEVEL_COLORS[level]
                                : 'text-slate-600 bg-slate-900 opacity-50'
                        }`}
                    >
                        {t(level)}
                    </button>
                ))}

                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                    <input
                        type="text"
                        placeholder={t('searchLogs')}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                </div>

                <div className="flex items-center gap-2 ml-auto">
                    <button
                        onClick={togglePause}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            paused ? 'bg-yellow-500/20 text-yellow-300' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                    >
                        {paused ? <Play size={14} /> : <Pause size={14} />}
                        {paused ? t('resumeLive') : t('pauseLive')}
                    </button>
                    <button
                        onClick={clearLogs}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                    >
                        <Trash2 size={14} /> {t('clearLogs')}
                    </button>
                </div>
            </div>

            {/* Log Entries */}
            <div className="flex-1 overflow-y-auto bg-slate-900/50 rounded-lg border border-slate-800 font-mono text-sm">
                {filteredLogs.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-500">
                        {logs.length === 0 ? t('waitingForLogs') : t('noLogsFound')}
                    </div>
                ) : (
                    <div className="divide-y divide-slate-800/50">
                        {filteredLogs.map(log => (
                            <div
                                key={log.id}
                                className="px-4 py-1.5 hover:bg-slate-800/30 cursor-pointer transition-colors"
                                onClick={() => log.data && toggleExpand(log.id)}
                            >
                                <div className="flex items-start gap-3">
                                    <span className="text-slate-500 text-xs whitespace-nowrap pt-0.5">
                                        {formatTime(log.timestamp)}
                                    </span>
                                    <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${LEVEL_COLORS[log.level] || 'text-slate-400'}`}>
                                        {log.level.toUpperCase().padEnd(5)}
                                    </span>
                                    <span className="text-slate-200 break-all flex-1">
                                        {log.message}
                                    </span>
                                </div>
                                {expandedIds.has(log.id) && log.data ? (
                                    <pre className="mt-1 ml-24 text-xs text-slate-400 bg-slate-950 rounded p-2 overflow-x-auto">
                                        {JSON.stringify(log.data as Record<string, unknown>, null, 2)}
                                    </pre>
                                ) : null}
                            </div>
                        ))}
                        <div ref={bottomRef} />
                    </div>
                )}
            </div>

            {/* Status Bar */}
            <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                <div className={`flex items-center gap-1.5 ${isConnected ? 'text-green-500' : 'text-red-500'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                    {isConnected ? t('connected') : t('disconnected')}
                </div>
                <span>{filteredLogs.length} {t('entries')}</span>
                {paused && <span className="text-yellow-400">{t('paused')}</span>}
                {!paused && isConnected && <span>{t('streaming')}</span>}
            </div>
        </div>
    );
}
