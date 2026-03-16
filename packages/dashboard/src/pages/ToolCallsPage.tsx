import { useState, useEffect, useRef } from 'react';
import { Activity, Shield, RefreshCw, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToolCalls, useToolCallStats, ToolCallFilters } from '../hooks/useToolCalls';
import { useSocket } from '../hooks/useSocket';

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
    return (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className={cn('text-2xl font-bold', accent ?? 'text-white')}>{value}</div>
            <div className="text-xs text-slate-500 mt-1">{label}</div>
        </div>
    );
}

function statusBadge(status: string) {
    if (status === 'success') {
        return (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30">
                success
            </span>
        );
    }
    if (status === 'error') {
        return (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30">
                error
            </span>
        );
    }
    return (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-400 border border-slate-600">
            {status}
        </span>
    );
}

const PAGE_SIZE = 50;

export function ToolCallsPage() {
    const { groups } = useSocket();
    const { stats } = useToolCallStats();

    const [filters, setFilters] = useState<ToolCallFilters>({
        page: 1,
        pageSize: PAGE_SIZE,
    });
    const [toolNameSearch, setToolNameSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => {
        debounceRef.current = setTimeout(() => setDebouncedSearch(toolNameSearch), 300);
        return () => clearTimeout(debounceRef.current);
    }, [toolNameSearch]);

    const activeFilters: ToolCallFilters = {
        ...filters,
        toolName: debouncedSearch.trim() || undefined,
    };

    const { records, total, page, isLoading, refetch } = useToolCalls(activeFilters);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const setFilter = <K extends keyof ToolCallFilters>(key: K, value: ToolCallFilters[K]) => {
        setFilters(prev => ({ ...prev, [key]: value, page: 1 }));
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Activity size={22} className="text-blue-400" />
                        Tool Call Audit
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">Monitor and audit all tool invocations</p>
                </div>
                <button
                    onClick={() => refetch()}
                    className="p-2 text-slate-400 hover:text-slate-200 transition-colors"
                    title="Refresh"
                >
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
                <StatCard label="Total Calls" value={stats.totalCalls.toLocaleString()} />
                <StatCard
                    label="Success Rate"
                    value={`${(stats.successRate * 100).toFixed(1)}%`}
                    accent={stats.successRate >= 0.9 ? 'text-green-400' : stats.successRate >= 0.7 ? 'text-amber-400' : 'text-red-400'}
                />
                <StatCard
                    label="Injection Alerts"
                    value={stats.injectionAlerts}
                    accent={stats.injectionAlerts > 0 ? 'text-amber-400' : 'text-white'}
                />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center">
                <select
                    value={filters.groupFolder ?? ''}
                    onChange={e => setFilter('groupFolder', e.target.value || undefined)}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
                >
                    <option value="">All Groups</option>
                    {groups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                </select>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                    <input
                        type="text"
                        value={toolNameSearch}
                        onChange={e => setToolNameSearch(e.target.value)}
                        placeholder="Tool name..."
                        className="pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-44"
                    />
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={filters.injectionOnly === true}
                        onChange={e => setFilter('injectionOnly', e.target.checked || undefined)}
                        className="w-4 h-4 accent-amber-500"
                    />
                    <Shield size={14} className="text-amber-400" />
                    Injection alerts only
                </label>

                <div className="flex gap-2 items-center">
                    <input
                        type="date"
                        value={filters.dateFrom ?? ''}
                        onChange={e => {
                            const newFrom = e.target.value || undefined;
                            setFilters(prev => {
                                const newTo = prev.dateTo && newFrom && prev.dateTo < newFrom
                                    ? newFrom
                                    : prev.dateTo;
                                return { ...prev, dateFrom: newFrom, dateTo: newTo, page: 1 };
                            });
                        }}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
                    />
                    <span className="text-slate-600 text-xs">to</span>
                    <input
                        type="date"
                        value={filters.dateTo ?? ''}
                        onChange={e => {
                            const newTo = e.target.value || undefined;
                            setFilters(prev => {
                                const correctedTo = prev.dateFrom && newTo && newTo < prev.dateFrom
                                    ? prev.dateFrom
                                    : newTo;
                                return { ...prev, dateTo: correctedTo, page: 1 };
                            });
                        }}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
                    />
                </div>
            </div>

            {/* Table */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-700">
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Timestamp</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Group</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Tool</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Duration</th>
                                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Injection</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-12 text-slate-500">
                                        Loading...
                                    </td>
                                </tr>
                            ) : records.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-12 text-slate-500">
                                        No tool calls found.
                                    </td>
                                </tr>
                            ) : (
                                records.map(record => (
                                    <tr
                                        key={record.id}
                                        className={cn(
                                            'border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors',
                                            record.injectionDetected && 'bg-amber-500/5',
                                        )}
                                    >
                                        <td className="px-4 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">
                                            {new Date(record.timestamp).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-slate-300 text-xs font-mono truncate max-w-[120px]">
                                            {record.groupFolder}
                                        </td>
                                        <td className="px-4 py-3 text-slate-200 font-mono text-xs">
                                            {record.toolName}
                                        </td>
                                        <td className="px-4 py-3">
                                            {statusBadge(record.status)}
                                            {record.errorMessage && (
                                                <div className="text-xs text-red-400/70 mt-0.5 truncate max-w-[200px]" title={record.errorMessage}>
                                                    {record.errorMessage}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-400">
                                            {record.durationMs}ms
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {record.injectionDetected ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                                    <Shield size={10} />
                                                    alert
                                                </span>
                                            ) : (
                                                <span className="text-slate-700 text-xs">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {!isLoading && total > 0 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700">
                        <span className="text-xs text-slate-500">
                            {total.toLocaleString()} total results
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setFilter('page', Math.max(1, page - 1))}
                                disabled={page <= 1}
                                className="p-1.5 text-slate-400 hover:text-slate-200 disabled:opacity-30 transition-colors"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <span className="text-xs text-slate-400 font-mono">
                                {page} / {totalPages}
                            </span>
                            <button
                                onClick={() => setFilter('page', Math.min(totalPages, page + 1))}
                                disabled={page >= totalPages}
                                className="p-1.5 text-slate-400 hover:text-slate-200 disabled:opacity-30 transition-colors"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
