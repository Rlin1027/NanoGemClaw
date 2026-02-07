import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, Plus, Eye, EyeOff } from 'lucide-react';
import { StatusCard } from '../components/StatusCard';
import { GroupDiscoveryModal } from '../components/GroupDiscoveryModal';
import { GroupData } from '../hooks/useSocket';

interface OverviewPageProps {
    groups: GroupData[];
    isConnected: boolean;
}

export function OverviewPage({ groups, isConnected }: OverviewPageProps) {
    const navigate = useNavigate();
    const [filter, setFilter] = useState('');
    const [hiddenGroups, setHiddenGroups] = useState<string[]>(() => {
        try {
            return JSON.parse(localStorage.getItem('hiddenGroups') || '[]');
        } catch { return []; }
    });
    const [showDiscovery, setShowDiscovery] = useState(false);
    const [showHidden, setShowHidden] = useState(false);

    const filteredGroups = groups
        .filter(g => !hiddenGroups.includes(g.id))
        .filter(g => !filter || g.name.toLowerCase().includes(filter.toLowerCase()));

    const hiddenGroupsList = groups.filter(g => hiddenGroups.includes(g.id));

    const hideGroup = (id: string) => {
        const updated = [...hiddenGroups, id];
        setHiddenGroups(updated);
        localStorage.setItem('hiddenGroups', JSON.stringify(updated));
    };

    const unhideGroup = (id: string) => {
        const updated = hiddenGroups.filter(gid => gid !== id);
        setHiddenGroups(updated);
        localStorage.setItem('hiddenGroups', JSON.stringify(updated));
    };

    return (
        <>
            {/* Filters & Actions */}
            <div className="flex gap-4 mb-6">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                    <input
                        type="text"
                        placeholder="Filter groups..."
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-10 pr-4 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                </div>

                <button
                    onClick={() => setShowDiscovery(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                    <Plus size={16} /> Discover
                </button>

                {hiddenGroupsList.length > 0 && (
                    <button
                        onClick={() => setShowHidden(!showHidden)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            showHidden
                                ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-300'
                        }`}
                    >
                        <EyeOff size={16} />
                        {hiddenGroupsList.length} Hidden
                    </button>
                )}

                {/* Connection Status Indicator */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${isConnected ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                    {isConnected ? (
                        <>
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            Connected
                        </>
                    ) : (
                        <>
                            <div className="w-2 h-2 rounded-full bg-red-500" />
                            Reconnecting...
                        </>
                    )}
                </div>
            </div>

            {filteredGroups.length === 0 && isConnected ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                    <p className="mb-2">No active groups found.</p>
                    <button onClick={() => setShowDiscovery(true)} className="text-blue-500 hover:text-blue-400">Discover Groups</button>
                </div>
            ) : filteredGroups.length === 0 && !isConnected ? (
                <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
                    <Loader2 className="animate-spin" /> Connecting to server...
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                    {filteredGroups.map(group => (
                        <StatusCard
                            key={group.id}
                            {...group}
                            onHide={() => hideGroup(group.id)}
                            onOpenTerminal={() => navigate(`/logs?group=${group.id}`)}
                            onViewMemory={() => navigate(`/memory?group=${group.id}`)}
                        />
                    ))}

                    <button
                        onClick={() => setShowDiscovery(true)}
                        className="border-2 border-dashed border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center text-slate-500 hover:text-slate-300 hover:border-slate-700 hover:bg-slate-900/30 transition-all group min-h-[220px]"
                    >
                        <div className="w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                            <span className="text-2xl">+</span>
                        </div>
                        <span className="font-medium">Discover Group</span>
                    </button>
                </div>
            )}

            {/* Hidden Groups Section */}
            {showHidden && hiddenGroupsList.length > 0 && (
                <div className="mt-8">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="h-px flex-1 bg-slate-800" />
                        <span className="text-sm text-slate-500 font-medium">Hidden Groups</span>
                        <div className="h-px flex-1 bg-slate-800" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6 opacity-60">
                        {hiddenGroupsList.map(group => (
                            <div key={group.id} className="relative">
                                <StatusCard
                                    {...group}
                                    onOpenTerminal={() => navigate(`/logs?group=${group.id}`)}
                                    onViewMemory={() => navigate(`/memory?group=${group.id}`)}
                                />
                                <button
                                    onClick={() => unhideGroup(group.id)}
                                    className="absolute top-3 right-3 p-1.5 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
                                    title="Show group"
                                >
                                    <Eye size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {showDiscovery && (
                <GroupDiscoveryModal
                    registeredIds={groups.map(g => g.id)}
                    onClose={() => setShowDiscovery(false)}
                />
            )}
        </>
    );
}
