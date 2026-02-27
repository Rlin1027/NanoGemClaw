import { useState, useEffect } from 'react';
import {
    Shield, Clock, Wifi, AlertTriangle, Trash2, RefreshCw, Key,
    Link2, Unlink, ExternalLink, Bell, Send, CheckCircle2, XCircle,
    CalendarClock, HardDrive, Database, Loader2, Calendar,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, apiFetch } from '../hooks/useApi';
import { showToast } from '../hooks/useToast';

interface ConfigData {
    maintenanceMode: boolean;
    logLevel: string;
    dashboardHost: string;
    dashboardPort: number;
    uptime: number;
    connectedClients: number;
}

interface SecretInfo {
    key: string;
    configured: boolean;
    masked: string | null;
}

interface GoogleAuthStatus {
    authenticated: boolean;
    hasCredentials: boolean;
    scopes: string[];
}

interface DiscordReporterConfig {
    webhookUrl: string;
    dailyTime: string;
    weeklyDay: number;
    weeklyTime: string;
    enabled: boolean;
}

interface GoogleTasksSyncState {
    lastSync: string | null;
    mappingCount: number;
    syncing: boolean;
}

interface RAGConfigSummary {
    knowledgeFolderIds: string[];
    scanIntervalMinutes: number;
}

export function SettingsPage() {
    const { t } = useTranslation('settings');
    const { data: config, isLoading, refetch } = useApiQuery<ConfigData>('/api/config');
    const { data: secrets } = useApiQuery<SecretInfo[]>('/api/config/secrets');
    const { mutate: updateConfig } = useApiMutation<any, Partial<ConfigData>>('/api/config', 'PUT');
    const { mutate: clearErrors, isLoading: clearingErrors } = useApiMutation<any, void>('/api/errors/clear', 'POST');

    const [maintenanceMode, setMaintenanceMode] = useState(false);
    const [logLevel, setLogLevel] = useState('info');

    // Google Auth
    const { data: googleAuth, refetch: refetchGoogleAuth } = useApiQuery<GoogleAuthStatus>(
        '/api/plugins/google-auth/status',
    );
    const [googleAuthLoading, setGoogleAuthLoading] = useState(false);

    // Discord Reporter
    const { data: discordConfig, refetch: refetchDiscordConfig } =
        useApiQuery<DiscordReporterConfig>('/api/plugins/discord-reporter/config');
    const { mutate: updateDiscordConfig } = useApiMutation<any, Partial<DiscordReporterConfig>>(
        '/api/plugins/discord-reporter/config',
        'PUT',
    );
    const [webhookUrl, setWebhookUrl] = useState('');
    const [discordEnabled, setDiscordEnabled] = useState(false);
    const [discordTestStatus, setDiscordTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');

    // Google Tasks
    const { data: tasksSyncState, refetch: refetchTasksSync } =
        useApiQuery<GoogleTasksSyncState>('/api/plugins/google-tasks/sync-state');
    const [tasksSyncing, setTasksSyncing] = useState(false);

    // Drive Knowledge RAG
    const { data: ragConfig } = useApiQuery<RAGConfigSummary>('/api/plugins/drive-knowledge-rag/config');
    const [ragReindexing, setRagReindexing] = useState(false);

    useEffect(() => {
        if (config) {
            setMaintenanceMode(config.maintenanceMode);
            setLogLevel(config.logLevel);
        }
    }, [config]);

    useEffect(() => {
        if (discordConfig) {
            setWebhookUrl(discordConfig.webhookUrl);
            setDiscordEnabled(discordConfig.enabled);
        }
    }, [discordConfig]);

    const toggleMaintenance = async () => {
        const newVal = !maintenanceMode;
        setMaintenanceMode(newVal);
        await updateConfig({ maintenanceMode: newVal });
    };

    const toggleDebugLog = async () => {
        const newLevel = logLevel === 'debug' ? 'info' : 'debug';
        setLogLevel(newLevel);
        await updateConfig({ logLevel: newLevel });
    };

    const handleGoogleConnect = async () => {
        setGoogleAuthLoading(true);
        try {
            const result = await apiFetch<{ authUrl?: string; message?: string }>(
                '/api/plugins/google-auth/authorize',
                { method: 'POST' },
            );
            if (result.authUrl) {
                window.open(result.authUrl, '_blank', 'noopener');
                // Poll for auth completion
                const poll = setInterval(async () => {
                    await refetchGoogleAuth();
                }, 3000);
                setTimeout(() => clearInterval(poll), 5 * 60 * 1000);
            }
        } finally {
            setGoogleAuthLoading(false);
        }
    };

    const handleGoogleDisconnect = async () => {
        setGoogleAuthLoading(true);
        try {
            await apiFetch('/api/plugins/google-auth/revoke', { method: 'POST' });
            await refetchGoogleAuth();
        } finally {
            setGoogleAuthLoading(false);
        }
    };

    const handleDiscordSave = async () => {
        await updateDiscordConfig({ webhookUrl, enabled: discordEnabled });
        await refetchDiscordConfig();
    };

    const handleDiscordTest = async () => {
        setDiscordTestStatus('sending');
        try {
            await apiFetch('/api/plugins/discord-reporter/test', { method: 'POST' });
            setDiscordTestStatus('success');
            setTimeout(() => setDiscordTestStatus('idle'), 3000);
        } catch {
            setDiscordTestStatus('error');
            setTimeout(() => setDiscordTestStatus('idle'), 3000);
        }
    };

    const handleTasksSync = async () => {
        setTasksSyncing(true);
        try {
            await apiFetch('/api/plugins/google-tasks/sync', { method: 'POST' });
            showToast('Sync started', 'success');
            setTimeout(() => refetchTasksSync(), 2000);
        } catch {
            showToast('Failed to start sync');
        } finally {
            setTasksSyncing(false);
        }
    };

    const handleRagReindex = async () => {
        setRagReindexing(true);
        try {
            await apiFetch('/api/plugins/drive-knowledge-rag/reindex', { method: 'POST' });
            showToast('Reindex started', 'success');
        } catch {
            showToast('Failed to start reindex');
        } finally {
            setRagReindexing(false);
        }
    };

    const formatUptime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${h}h ${m}m`;
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20 text-slate-500">
                {t('loadingSettings')}
            </div>
        );
    }

    return (
        <div className="max-w-3xl space-y-8">
            {/* Runtime Flags */}
            <section>
                <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                    <Shield size={20} className="text-blue-400" /> {t('runtimeFlags')}
                </h2>
                <div className="space-y-3">
                    {/* Maintenance Mode */}
                    <div className="flex items-center justify-between bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                        <div>
                            <div className="font-medium text-slate-200">{t('maintenanceMode')}</div>
                            <div className="text-xs text-slate-400 mt-0.5">{t('maintenanceModeDesc')}</div>
                        </div>
                        <button
                            onClick={toggleMaintenance}
                            className={`relative w-12 h-6 rounded-full transition-colors ${maintenanceMode ? 'bg-yellow-500' : 'bg-slate-700'}`}
                        >
                            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${maintenanceMode ? 'translate-x-6' : 'translate-x-0.5'}`} />
                        </button>
                    </div>

                    {/* Debug Logging */}
                    <div className="flex items-center justify-between bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                        <div>
                            <div className="font-medium text-slate-200">{t('debugLogging')}</div>
                            <div className="text-xs text-slate-400 mt-0.5">{t('debugLoggingDesc')}</div>
                        </div>
                        <button
                            onClick={toggleDebugLog}
                            className={`relative w-12 h-6 rounded-full transition-colors ${logLevel === 'debug' ? 'bg-blue-500' : 'bg-slate-700'}`}
                        >
                            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${logLevel === 'debug' ? 'translate-x-6' : 'translate-x-0.5'}`} />
                        </button>
                    </div>
                </div>
            </section>

            {/* Connection Info */}
            <section>
                <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                    <Wifi size={20} className="text-green-400" /> {t('connectionInfo')}
                </h2>
                <div className="grid grid-cols-3 gap-3">
                    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                        <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Clock size={12} /> {t('uptime')}</div>
                        <div className="text-slate-200 font-mono font-bold">{config ? formatUptime(config.uptime) : '-'}</div>
                    </div>
                    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                        <div className="text-xs text-slate-500 mb-1">{t('host')}</div>
                        <div className="text-slate-200 font-mono text-sm">{config?.dashboardHost}:{config?.dashboardPort}</div>
                    </div>
                    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                        <div className="text-xs text-slate-500 mb-1">{t('clients')}</div>
                        <div className="text-slate-200 font-mono font-bold">{config?.connectedClients ?? 0}</div>
                    </div>
                </div>
            </section>

            {/* Secrets Status */}
            <section>
                <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                    <Key size={20} className="text-purple-400" /> {t('secretsStatus')}
                </h2>
                <div className="bg-slate-900/50 border border-slate-800 rounded-lg divide-y divide-slate-800">
                    {secrets?.map(secret => (
                        <div key={secret.key} className="flex items-center justify-between p-3">
                            <span className="text-slate-300 font-mono text-sm">{secret.key}</span>
                            <div className="flex items-center gap-2">
                                {secret.configured ? (
                                    <>
                                        <span className="text-xs text-slate-500 font-mono">{secret.masked}</span>
                                        <span className="text-xs bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full">{t('configured')}</span>
                                    </>
                                ) : (
                                    <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full">{t('notSet')}</span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Google Account */}
            <section>
                <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                    <Link2 size={20} className="text-emerald-400" /> Google Account
                </h2>
                <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                    {!googleAuth?.hasCredentials ? (
                        <div className="text-sm text-slate-400">
                            <p>Google OAuth credentials not configured.</p>
                            <p className="mt-1 text-xs">
                                Set <code className="text-slate-300">GOOGLE_CLIENT_ID</code> and{' '}
                                <code className="text-slate-300">GOOGLE_CLIENT_SECRET</code> in{' '}
                                <code className="text-slate-300">.env</code> and restart.
                            </p>
                        </div>
                    ) : googleAuth?.authenticated ? (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <CheckCircle2 size={20} className="text-green-400" />
                                <div>
                                    <div className="font-medium text-slate-200">Connected</div>
                                    <div className="text-xs text-slate-400">
                                        Scopes: {googleAuth.scopes.map(s => s.split('/').pop()).join(', ')}
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={handleGoogleDisconnect}
                                disabled={googleAuthLoading}
                                className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-sm transition-colors disabled:opacity-50"
                            >
                                <Unlink size={14} /> Disconnect
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <XCircle size={20} className="text-slate-500" />
                                <div>
                                    <div className="font-medium text-slate-200">Not Connected</div>
                                    <div className="text-xs text-slate-400">
                                        Connect your Google account to enable Drive, Calendar, and Tasks.
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={handleGoogleConnect}
                                disabled={googleAuthLoading}
                                className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg text-sm transition-colors disabled:opacity-50"
                            >
                                <ExternalLink size={14} /> Connect Google
                            </button>
                        </div>
                    )}
                </div>
            </section>

            {/* Discord Reporter */}
            <section>
                <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                    <Bell size={20} className="text-indigo-400" /> Discord Reporter
                </h2>
                <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 space-y-4">
                    {/* Enable toggle */}
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-medium text-slate-200">Enable Reports</div>
                            <div className="text-xs text-slate-400">Send daily and weekly reports to Discord</div>
                        </div>
                        <button
                            onClick={async () => {
                                const newVal = !discordEnabled;
                                setDiscordEnabled(newVal);
                                await updateDiscordConfig({ enabled: newVal });
                            }}
                            className={`relative w-12 h-6 rounded-full transition-colors ${discordEnabled ? 'bg-indigo-500' : 'bg-slate-700'}`}
                        >
                            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${discordEnabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
                        </button>
                    </div>

                    {/* Webhook URL */}
                    <div>
                        <label className="text-xs text-slate-400 block mb-1">Webhook URL</label>
                        <div className="flex gap-2">
                            <input
                                type="url"
                                value={webhookUrl}
                                onChange={(e) => setWebhookUrl(e.target.value)}
                                placeholder="https://discord.com/api/webhooks/..."
                                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                            />
                            <button
                                onClick={handleDiscordSave}
                                className="px-3 py-2 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 rounded-lg text-sm transition-colors"
                            >
                                Save
                            </button>
                        </div>
                    </div>

                    {/* Test button */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleDiscordTest}
                            disabled={!webhookUrl || discordTestStatus === 'sending'}
                            className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition-colors disabled:opacity-50"
                        >
                            <Send size={14} /> Send Test
                        </button>
                        {discordTestStatus === 'success' && (
                            <span className="text-xs text-green-400 flex items-center gap-1">
                                <CheckCircle2 size={12} /> Test sent successfully
                            </span>
                        )}
                        {discordTestStatus === 'error' && (
                            <span className="text-xs text-red-400 flex items-center gap-1">
                                <XCircle size={12} /> Failed to send test
                            </span>
                        )}
                    </div>
                </div>
            </section>

            {/* Google Tasks */}
            <section>
                <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                    <CalendarClock size={20} className="text-blue-400" /> Google Tasks
                </h2>
                <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 space-y-4">
                    {!googleAuth?.authenticated ? (
                        <p className="text-sm text-slate-400">Connect your Google account above to enable Tasks sync.</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                                    <div className="text-xs text-slate-500 mb-1">Last Sync</div>
                                    <div className="text-sm text-slate-200 font-mono">
                                        {tasksSyncState?.lastSync
                                            ? new Date(tasksSyncState.lastSync).toLocaleString()
                                            : 'Never'}
                                    </div>
                                </div>
                                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                                    <div className="text-xs text-slate-500 mb-1">Mapped Tasks</div>
                                    <div className="text-sm text-slate-200 font-mono font-bold">
                                        {tasksSyncState?.mappingCount ?? 0}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-sm text-slate-300 font-medium">Auto-sync interval</div>
                                    <div className="text-xs text-slate-500 mt-0.5">Every 15 minutes (configured in plugin)</div>
                                </div>
                                <button
                                    onClick={handleTasksSync}
                                    disabled={tasksSyncing}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg text-sm transition-colors disabled:opacity-50"
                                >
                                    {tasksSyncing
                                        ? <Loader2 size={14} className="animate-spin" />
                                        : <RefreshCw size={14} />}
                                    Sync Now
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </section>

            {/* Drive Knowledge RAG */}
            <section>
                <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                    <Database size={20} className="text-purple-400" /> Drive Knowledge RAG
                </h2>
                <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 space-y-4">
                    {!googleAuth?.authenticated ? (
                        <p className="text-sm text-slate-400">Connect your Google account above to enable RAG indexing.</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                                    <div className="text-xs text-slate-500 mb-1">Knowledge Folders</div>
                                    <div className="text-sm text-slate-200 font-mono font-bold">
                                        {ragConfig?.knowledgeFolderIds?.length ?? 0}
                                    </div>
                                </div>
                                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                                    <div className="text-xs text-slate-500 mb-1">Scan Interval</div>
                                    <div className="text-sm text-slate-200 font-mono">
                                        {ragConfig?.scanIntervalMinutes ?? '—'} min
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleRagReindex}
                                    disabled={ragReindexing}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg text-sm transition-colors disabled:opacity-50"
                                >
                                    {ragReindexing
                                        ? <Loader2 size={14} className="animate-spin" />
                                        : <RefreshCw size={14} />}
                                    Quick Reindex
                                </button>
                                <span className="text-xs text-slate-500">
                                    Full RAG management available in the{' '}
                                    <span className="text-blue-400 font-medium">Drive → Knowledge RAG</span> tab
                                </span>
                            </div>
                        </>
                    )}
                </div>
            </section>

            {/* Google Calendar */}
            <section>
                <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                    <Calendar size={20} className="text-green-400" /> Google Calendar
                </h2>
                <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 space-y-3">
                    {!googleAuth?.authenticated ? (
                        <p className="text-sm text-slate-400">Connect your Google account above to enable Calendar tools.</p>
                    ) : (
                        <>
                            <div className="flex items-center gap-3">
                                <CheckCircle2 size={18} className="text-green-400 flex-shrink-0" />
                                <div>
                                    <div className="text-sm font-medium text-slate-200">Calendar access active</div>
                                    <div className="text-xs text-slate-500 mt-0.5">
                                        The bot can read and create calendar events via Gemini tools.
                                    </div>
                                </div>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                                <div className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wider">Available Tools</div>
                                <ul className="space-y-1 text-xs text-slate-400">
                                    <li className="flex items-center gap-2"><HardDrive size={11} className="text-slate-600" /> listCalendarEvents — fetch upcoming events</li>
                                    <li className="flex items-center gap-2"><HardDrive size={11} className="text-slate-600" /> createCalendarEvent — create new events</li>
                                    <li className="flex items-center gap-2"><HardDrive size={11} className="text-slate-600" /> updateCalendarEvent — modify existing events</li>
                                    <li className="flex items-center gap-2"><HardDrive size={11} className="text-slate-600" /> deleteCalendarEvent — remove events</li>
                                </ul>
                            </div>
                        </>
                    )}
                </div>
            </section>

            {/* Danger Zone */}
            <section>
                <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                    <AlertTriangle size={20} className="text-red-400" /> {t('dangerZone')}
                </h2>
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-medium text-slate-200">{t('clearErrorStates')}</div>
                            <div className="text-xs text-slate-400">{t('clearErrorStatesDesc')}</div>
                        </div>
                        <button
                            onClick={() => clearErrors(undefined as void)}
                            disabled={clearingErrors}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-sm transition-colors disabled:opacity-50"
                        >
                            <Trash2 size={14} /> {t('clearErrors')}
                        </button>
                    </div>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-medium text-slate-200">{t('forceRefreshGroups')}</div>
                            <div className="text-xs text-slate-400">{t('forceRefreshGroupsDesc')}</div>
                        </div>
                        <button
                            onClick={() => refetch()}
                            className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition-colors"
                        >
                            <RefreshCw size={14} /> {t('forceRefreshGroups', { ns: 'common' }) || 'Refresh'}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}
