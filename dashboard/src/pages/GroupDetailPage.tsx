import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useGroupDetail } from '../hooks/useGroupDetail';
import { PersonaSelector } from '../components/PersonaSelector';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { StatsCards } from '../components/StatsCards';
import { TaskList } from '../components/TaskList';
import { TaskFormModal } from '../components/TaskFormModal';
import { useAvailableSkills, useGroupSkills, useToggleSkill } from '../hooks/useSkills';

function SkillsPanel({ groupFolder }: { groupFolder: string }) {
    const { data: allSkills, isLoading: loadingAll } = useAvailableSkills();
    const { data: enabledSkills, isLoading: loadingEnabled, refetch } = useGroupSkills(groupFolder);
    const { mutate: toggleSkill } = useToggleSkill(groupFolder);

    if (loadingAll || loadingEnabled) {
        return <div className="text-slate-500 text-sm">Loading skills...</div>;
    }

    if (!allSkills || allSkills.length === 0) {
        return <div className="text-slate-500 text-sm">No skills available</div>;
    }

    const enabledSet = new Set(enabledSkills || []);

    const handleToggle = async (skillId: string, currentlyEnabled: boolean) => {
        await toggleSkill({ skillId, enabled: !currentlyEnabled });
        refetch();
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {allSkills.map(skill => {
                const isEnabled = enabledSet.has(skill.id);
                return (
                    <div
                        key={skill.id}
                        className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                            isEnabled
                                ? 'bg-blue-500/10 border-blue-500/30'
                                : 'bg-slate-800/50 border-slate-700/50'
                        }`}
                    >
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-white truncate">{skill.name}</div>
                            <div className="text-xs text-slate-400 truncate">{skill.description}</div>
                        </div>
                        <button
                            onClick={() => handleToggle(skill.id, isEnabled)}
                            className={`ml-3 px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                                isEnabled
                                    ? 'bg-blue-600 text-white hover:bg-blue-500'
                                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                            }`}
                        >
                            {isEnabled ? 'Enabled' : 'Disabled'}
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

export function GroupDetailPage() {
    const { folder } = useParams<{ folder: string }>();
    const navigate = useNavigate();
    const { group, loading, error, refetch, updateSettings } = useGroupDetail(folder);
    const [showTaskForm, setShowTaskForm] = useState(false);
    const [saving, setSaving] = useState(false);

    const handleSettingChange = async (updates: Record<string, any>) => {
        setSaving(true);
        try {
            await updateSettings(updates);
        } catch {} finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-slate-500">
                <Loader2 className="animate-spin mr-2" /> Loading...
            </div>
        );
    }

    if (error || !group) {
        return (
            <div className="text-center py-20">
                <p className="text-red-400 mb-4">{error || 'Group not found'}</p>
                <button onClick={() => navigate('/')} className="text-blue-400 hover:text-blue-300">
                    Back to Overview
                </button>
            </div>
        );
    }

    const avgResponseTime = group.usage.total_requests > 0
        ? (group.usage.avg_duration_ms / 1000).toFixed(1) + 's'
        : 'N/A';

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button
                    onClick={() => navigate('/')}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h2 className="text-xl font-bold text-white">{group.name}</h2>
                    <span className="text-sm text-slate-500">📁 {group.folder}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-2 ${
                    group.status === 'error' ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'
                }`}>
                    {group.status}
                </span>
            </div>

            {/* Stats */}
            <StatsCards stats={[
                { label: 'Total Requests', value: group.usage.total_requests },
                { label: 'Avg Response', value: avgResponseTime },
                { label: 'Total Tokens', value: (group.usage.total_prompt_tokens + group.usage.total_response_tokens).toLocaleString() },
                { label: 'Messages', value: group.messageCount },
            ]} />

            {/* Settings */}
            <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Settings</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <PersonaSelector
                        value={group.persona}
                        onChange={persona => handleSettingChange({ persona })}
                        disabled={saving}
                    />
                    <ToggleSwitch
                        label="Trigger Mode"
                        description="Require @trigger prefix"
                        enabled={group.requireTrigger !== false}
                        onChange={val => handleSettingChange({ requireTrigger: val })}
                        disabled={saving}
                    />
                    <ToggleSwitch
                        label="Web Search"
                        description="Enable Google Search"
                        enabled={group.enableWebSearch !== false}
                        onChange={val => handleSettingChange({ enableWebSearch: val })}
                        disabled={saving}
                    />
                    {/* Model Selector */}
                    <div className="p-3 bg-slate-800/50 rounded-lg">
                        <label className="block text-xs font-medium text-slate-400 mb-1">AI Model</label>
                        <select
                            value={(group as any).geminiModel || 'gemini-3-flash-preview'}
                            onChange={e => handleSettingChange({ geminiModel: e.target.value })}
                            disabled={saving}
                            className="w-full bg-slate-900 text-white text-sm rounded-md border border-slate-700 px-2 py-1.5 focus:border-blue-500 focus:outline-none"
                        >
                            <option value="gemini-3-flash-preview">Gemini 3 Flash (Fast)</option>
                            <option value="gemini-3-pro-preview">Gemini 3 Pro (Smart)</option>
                            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Skills */}
            <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Skills</h3>
                <SkillsPanel groupFolder={folder!} />
            </div>

            {/* Scheduled Tasks */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Scheduled Tasks</h3>
                    <button
                        onClick={() => setShowTaskForm(true)}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        + New Task
                    </button>
                </div>
                <TaskList
                    tasks={group.tasks}
                    onRefresh={refetch}
                    showGroup={false}
                />
            </div>

            {/* Errors */}
            {group.errorState && group.errorState.consecutiveFailures > 0 && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <h3 className="text-sm font-medium text-red-400 mb-2">Recent Errors</h3>
                    <div className="text-sm text-red-300">
                        {group.errorState.consecutiveFailures} consecutive failures
                    </div>
                    {group.errorState.lastError && (
                        <div className="text-xs text-red-400/70 mt-1 font-mono truncate">
                            {group.errorState.lastError}
                        </div>
                    )}
                </div>
            )}

            {showTaskForm && (
                <TaskFormModal
                    groups={[{ id: group.folder, name: group.name }]}
                    defaultGroup={group.folder}
                    onClose={() => setShowTaskForm(false)}
                    onCreated={refetch}
                />
            )}
        </div>
    );
}
