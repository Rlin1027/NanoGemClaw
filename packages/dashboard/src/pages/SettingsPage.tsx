import { useState, useEffect } from 'react';
import { Shield, Clock, Wifi, AlertTriangle, Trash2, RefreshCw, Key } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation } from '../hooks/useApi';

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

export function SettingsPage() {
    const { t } = useTranslation('settings');
    const { data: config, isLoading, refetch } = useApiQuery<ConfigData>('/api/config');
    const { data: secrets } = useApiQuery<SecretInfo[]>('/api/config/secrets');
    const { mutate: updateConfig } = useApiMutation<any, Partial<ConfigData>>('/api/config', 'PUT');
    const { mutate: clearErrors, isLoading: clearingErrors } = useApiMutation<any, void>('/api/errors/clear', 'POST');

    const [maintenanceMode, setMaintenanceMode] = useState(false);
    const [logLevel, setLogLevel] = useState('info');

    useEffect(() => {
        if (config) {
            setMaintenanceMode(config.maintenanceMode);
            setLogLevel(config.logLevel);
        }
    }, [config]);

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
