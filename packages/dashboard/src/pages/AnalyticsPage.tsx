import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../hooks/useApi';
import { useSocket } from '../hooks/useSocket';
import { useLocale } from '../hooks/useLocale';
import { UsageChart } from '../components/UsageChart';
import { StatsCards } from '../components/StatsCards';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, Area, AreaChart } from 'recharts';
import { BarChart3, TrendingUp, Clock, AlertTriangle } from 'lucide-react';

type Period = '1d' | '7d' | '30d';

export function AnalyticsPage() {
    const { t } = useTranslation('analytics');
    const locale = useLocale();
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
                <h2 className="text-xl font-bold text-white">{t('title')}</h2>
                <div className="flex items-center gap-3">
                    <select
                        value={groupFilter}
                        onChange={e => setGroupFilter(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
                    >
                        <option value="">{t('allGroups')}</option>
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
                                {p === '1d' ? t('today') : p === '7d' ? t('last7Days') : t('last30Days')}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Stats */}
            <StatsCards stats={[
                { label: t('totalRequests'), value: usage?.total_requests ?? 0 },
                { label: t('totalTokens'), value: totalTokens.toLocaleString(locale) },
                { label: t('avgResponseTime'), value: avgTime },
                { label: t('activeGroups'), value: (byGroup || []).length },
            ]} />

            {/* Usage Trend - Daily Requests & Tokens */}
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="w-5 h-5 text-emerald-500" />
                    <h3 className="text-sm font-medium text-white">{t('usageTrend')}</h3>
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
                        <Line yAxisId="left" type="monotone" dataKey="request_count" stroke="#10b981" name={t('requests')} strokeWidth={2} />
                        <Line yAxisId="right" type="monotone" dataKey="total_tokens" stroke="#3b82f6" name={t('tokens')} strokeWidth={2} />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* Token Consumption by Group */}
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <div className="flex items-center gap-2 mb-4">
                    <BarChart3 className="w-5 h-5 text-blue-500" />
                    <h3 className="text-sm font-medium text-white">{t('tokenConsumptionByGroup')}</h3>
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
                        <Bar dataKey="total_tokens" fill="#3b82f6" name={t('totalTokens')} />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Response Time Percentiles */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                    <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-5 h-5 text-emerald-500" />
                        <h3 className="text-sm font-medium text-slate-400">{t('p50ResponseTime')}</h3>
                    </div>
                    <div className="text-3xl font-bold text-white">
                        {responseTimes ? `${(responseTimes.p50 / 1000).toFixed(2)}s` : 'N/A'}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{t('p50Percentile')}</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                    <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-5 h-5 text-amber-500" />
                        <h3 className="text-sm font-medium text-slate-400">{t('p95ResponseTime')}</h3>
                    </div>
                    <div className="text-3xl font-bold text-white">
                        {responseTimes ? `${(responseTimes.p95 / 1000).toFixed(2)}s` : 'N/A'}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{t('p95Percentile')}</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                    <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-5 h-5 text-blue-500" />
                        <h3 className="text-sm font-medium text-slate-400">{t('avgResponseTime')}</h3>
                    </div>
                    <div className="text-3xl font-bold text-white">
                        {responseTimes ? `${(responseTimes.avg / 1000).toFixed(2)}s` : 'N/A'}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{responseTimes?.count || 0} {t('requests')}</p>
                </div>
            </div>

            {/* Error Rate Trend */}
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                    <h3 className="text-sm font-medium text-white">{t('errorRateTrend')}</h3>
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
                        <Area type="monotone" dataKey="error_rate" stroke="#ef4444" fill="#ef4444" fillOpacity={0.3} name={t('errorRatePercent')} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Token Usage Over Time */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-medium text-slate-400 mb-4">{t('tokenUsageOverTime')}</h3>
                <UsageChart
                    data={timeseries || []}
                    type="line"
                    dataKeys={[
                        { key: 'prompt_tokens', color: '#60a5fa', name: t('promptTokens') },
                        { key: 'response_tokens', color: '#34d399', name: t('responseTokens') },
                    ]}
                />
            </div>

            {/* Requests by Group */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-medium text-slate-400 mb-4">{t('requestsByGroup')}</h3>
                <UsageChart
                    data={byGroup || []}
                    type="bar"
                    xKey="group_folder"
                    dataKeys={[
                        { key: 'requests', color: '#818cf8', name: t('requests') },
                    ]}
                    height={250}
                />
            </div>

            {/* Recent Requests */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-medium text-slate-400 mb-4">{t('recentRequests')}</h3>
                <div className="space-y-2">
                    {(recent || []).map((entry: any, i: number) => (
                        <div key={i} className="flex items-center gap-4 text-sm py-2 border-b border-slate-800/50 last:border-0">
                            <span className="text-slate-500 w-40">{new Date(entry.timestamp).toLocaleString(locale)}</span>
                            <span className="text-slate-300 flex-1">{entry.group_folder}</span>
                            <span className="text-slate-500 font-mono">{((entry.duration_ms || 0) / 1000).toFixed(1)}s</span>
                            <span className="text-slate-500 font-mono">
                                {(entry.prompt_tokens || 0) + (entry.response_tokens || 0)} tok
                            </span>
                        </div>
                    ))}
                    {(recent || []).length === 0 && (
                        <div className="text-slate-500 text-center py-4">{t('noRecentRequests')}</div>
                    )}
                </div>
            </div>
        </div>
    );
}
