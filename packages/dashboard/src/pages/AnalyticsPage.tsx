import { useState } from 'react';
import { useApiQuery } from '../hooks/useApi';
import { useSocket } from '../hooks/useSocket';
import { UsageChart } from '../components/UsageChart';
import { StatsCards } from '../components/StatsCards';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, Area, AreaChart } from 'recharts';
import { BarChart3, TrendingUp, Clock, AlertTriangle } from 'lucide-react';

type Period = '1d' | '7d' | '30d';

export function AnalyticsPage() {
    const { groups } = useSocket();
    const [period, setPeriod] = useState<Period>('7d');
    const [groupFilter, setGroupFilter] = useState('');

    const days = period === '1d' ? 1 : period === '7d' ? 7 : 30;

    const timeseriesUrl = `/api/usage/timeseries?period=${period}${groupFilter ? `&groupFolder=${groupFilter}` : ''}`;
    const { data: timeseries } = useApiQuery<any[]>(timeseriesUrl);
    const { data: byGroup } = useApiQuery<any[]>('/api/usage/groups');
    const { data: usage } = useApiQuery<any>('/api/usage');
    const { data: recent } = useApiQuery<any[]>('/api/usage/recent');

    // New analytics endpoints
    const { data: dailyTimeseries } = useApiQuery<any[]>(`/api/analytics/timeseries?days=${days}`);
    const { data: tokenRanking } = useApiQuery<any[]>('/api/analytics/token-ranking?limit=10');
    const { data: responseTimes } = useApiQuery<any>('/api/analytics/response-times');
    const { data: errorRate } = useApiQuery<any[]>(`/api/analytics/error-rate?days=${days}`);

    const totalTokens = usage ? usage.total_prompt_tokens + usage.total_response_tokens : 0;
    const avgTime = usage && usage.total_requests > 0 ? (usage.avg_duration_ms / 1000).toFixed(1) + 's' : 'N/A';

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Analytics</h2>
                <div className="flex items-center gap-3">
                    <select
                        value={groupFilter}
                        onChange={e => setGroupFilter(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
                    >
                        <option value="">All Groups</option>
                        {groups.map(g => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                    <div className="flex bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                        {(['1d', '7d', '30d'] as Period[]).map(p => (
                            <button
                                key={p}
                                onClick={() => setPeriod(p)}
                                className={`px-3 py-2 text-sm font-medium transition-colors ${
                                    period === p ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                {p === '1d' ? 'Today' : p === '7d' ? '7 Days' : '30 Days'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Stats */}
            <StatsCards stats={[
                { label: 'Total Requests', value: usage?.total_requests ?? 0 },
                { label: 'Total Tokens', value: totalTokens.toLocaleString() },
                { label: 'Avg Response', value: avgTime },
                { label: 'Groups Active', value: (byGroup || []).length },
            ]} />

            {/* Usage Trend - Daily Requests & Tokens */}
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="w-5 h-5 text-emerald-500" />
                    <h3 className="text-sm font-medium text-white">Usage Trend</h3>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={dailyTimeseries || []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="date" stroke="#94a3b8" style={{ fontSize: '12px' }} />
                        <YAxis yAxisId="left" stroke="#10b981" style={{ fontSize: '12px' }} />
                        <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" style={{ fontSize: '12px' }} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                            labelStyle={{ color: '#e2e8f0' }}
                        />
                        <Legend />
                        <Line yAxisId="left" type="monotone" dataKey="request_count" stroke="#10b981" name="Requests" strokeWidth={2} />
                        <Line yAxisId="right" type="monotone" dataKey="total_tokens" stroke="#3b82f6" name="Tokens" strokeWidth={2} />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* Token Consumption by Group */}
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <div className="flex items-center gap-2 mb-4">
                    <BarChart3 className="w-5 h-5 text-blue-500" />
                    <h3 className="text-sm font-medium text-white">Token Consumption by Group</h3>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={tokenRanking || []} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis type="number" stroke="#94a3b8" style={{ fontSize: '12px' }} />
                        <YAxis type="category" dataKey="group_folder" stroke="#94a3b8" style={{ fontSize: '12px' }} width={120} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                            labelStyle={{ color: '#e2e8f0' }}
                        />
                        <Bar dataKey="total_tokens" fill="#3b82f6" name="Total Tokens" />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Response Time Percentiles */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                    <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-5 h-5 text-emerald-500" />
                        <h3 className="text-sm font-medium text-slate-400">P50 Response Time</h3>
                    </div>
                    <div className="text-3xl font-bold text-white">
                        {responseTimes ? `${(responseTimes.p50 / 1000).toFixed(2)}s` : 'N/A'}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">50th percentile</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                    <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-5 h-5 text-amber-500" />
                        <h3 className="text-sm font-medium text-slate-400">P95 Response Time</h3>
                    </div>
                    <div className="text-3xl font-bold text-white">
                        {responseTimes ? `${(responseTimes.p95 / 1000).toFixed(2)}s` : 'N/A'}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">95th percentile</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                    <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-5 h-5 text-blue-500" />
                        <h3 className="text-sm font-medium text-slate-400">Avg Response Time</h3>
                    </div>
                    <div className="text-3xl font-bold text-white">
                        {responseTimes ? `${(responseTimes.avg / 1000).toFixed(2)}s` : 'N/A'}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{responseTimes?.count || 0} requests</p>
                </div>
            </div>

            {/* Error Rate Trend */}
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                    <h3 className="text-sm font-medium text-white">Error Rate Trend</h3>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={errorRate || []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="date" stroke="#94a3b8" style={{ fontSize: '12px' }} />
                        <YAxis stroke="#ef4444" style={{ fontSize: '12px' }} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                            labelStyle={{ color: '#e2e8f0' }}
                        />
                        <Area type="monotone" dataKey="error_rate" stroke="#ef4444" fill="#ef4444" fillOpacity={0.3} name="Error Rate %" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Token Usage Over Time */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-medium text-slate-400 mb-4">Token Usage Over Time</h3>
                <UsageChart
                    data={timeseries || []}
                    type="line"
                    dataKeys={[
                        { key: 'prompt_tokens', color: '#60a5fa', name: 'Prompt Tokens' },
                        { key: 'response_tokens', color: '#34d399', name: 'Response Tokens' },
                    ]}
                />
            </div>

            {/* Requests by Group */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-medium text-slate-400 mb-4">Requests by Group</h3>
                <UsageChart
                    data={byGroup || []}
                    type="bar"
                    xKey="group_folder"
                    dataKeys={[
                        { key: 'requests', color: '#818cf8', name: 'Requests' },
                    ]}
                    height={250}
                />
            </div>

            {/* Recent Requests */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-medium text-slate-400 mb-4">Recent Requests</h3>
                <div className="space-y-2">
                    {(recent || []).map((entry: any, i: number) => (
                        <div key={i} className="flex items-center gap-4 text-sm py-2 border-b border-slate-800/50 last:border-0">
                            <span className="text-slate-500 w-40">{new Date(entry.timestamp).toLocaleString()}</span>
                            <span className="text-slate-300 flex-1">{entry.group_folder}</span>
                            <span className="text-slate-500 font-mono">{((entry.duration_ms || 0) / 1000).toFixed(1)}s</span>
                            <span className="text-slate-500 font-mono">
                                {(entry.prompt_tokens || 0) + (entry.response_tokens || 0)} tok
                            </span>
                        </div>
                    ))}
                    {(recent || []).length === 0 && (
                        <div className="text-slate-500 text-center py-4">No recent requests</div>
                    )}
                </div>
            </div>
        </div>
    );
}
