import { useState, useEffect } from 'react';
import { DashboardLayout } from './components/DashboardLayout';
import { StatusCard } from './components/StatusCard';
import { Terminal } from './components/Terminal';
import { MemoryPage } from './pages/MemoryPage';
import { LoginScreen } from './components/LoginScreen';
import { SettingsPage } from './pages/SettingsPage';
import { GroupDetailPage } from './pages/GroupDetailPage';
import { TasksPage } from './pages/TasksPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { DrivePage } from './pages/DrivePage';
import { CalendarPage } from './pages/CalendarPage';
import { ActivityLogsPage } from './pages/ActivityLogsPage';
import { SchedulePage } from './pages/SchedulePage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/ToastContainer';
import { SearchOverlay } from './components/SearchOverlay';
import { AddGroupModal } from './components/AddGroupModal';
import { Search, Loader2, Eye, EyeOff } from 'lucide-react';
import { useSocket } from './hooks/useSocket';
import { useApiQuery } from './hooks/useApi';

function App() {
    const { groups, logs, isConnected } = useSocket();
    const [activeTab, setActiveTab] = useState('overview');
    const [selectedGroupForMemory, setSelectedGroupForMemory] = useState<string | null>(null);
    const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [addGroupOpen, setAddGroupOpen] = useState(false);
    const [hiddenGroups, setHiddenGroups] = useState<string[]>(() => {
        try { return JSON.parse(localStorage.getItem('hiddenGroups') || '[]'); } catch { return []; }
    });
    const [showHidden, setShowHidden] = useState(false);
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
    const visibleGroups = groups.filter(g => !hiddenGroups.includes(g.id));
    const hiddenGroupsList = groups.filter(g => hiddenGroups.includes(g.id));

    // Cmd+K global shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setSearchOpen(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Auth State
    const { data: config } = useApiQuery<{ authRequired: boolean }>('/api/config');
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    useEffect(() => {
        // Check if we have a stored code
        const stored = localStorage.getItem('nanogemclaw_access_code');
        if (stored) setIsAuthenticated(true);
    }, []);

    // Auto-select first group for memory view if none selected
    useEffect(() => {
        if (activeTab === 'memory' && !selectedGroupForMemory && groups.length > 0) {
            setSelectedGroupForMemory(groups[0].id);
        }
    }, [activeTab, selectedGroupForMemory, groups]);

    if (config?.authRequired && !isAuthenticated) {
        return <LoginScreen onSuccess={() => setIsAuthenticated(true)} />;
    }

    return (
        <>
            <DashboardLayout activeTab={activeTab} onTabChange={setActiveTab} onSearchOpen={() => setSearchOpen(true)} onAddGroup={() => setAddGroupOpen(true)}>
                <ErrorBoundary>
                    {/* OVERVIEW TAB */}
                    {activeTab === 'overview' && (
                <>
                    {/* Filters & Actions */}
                    <div className="flex gap-4 mb-6">
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                            <input
                                type="text"
                                placeholder="Filter groups..."
                                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-10 pr-4 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            />
                        </div>

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

                    {visibleGroups.length === 0 && isConnected ? (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                            <p className="mb-2">No active groups found.</p>
                            <button className="text-blue-500 hover:text-blue-400" onClick={() => setAddGroupOpen(true)}>Discover Groups</button>
                        </div>
                    ) : visibleGroups.length === 0 && !isConnected ? (
                        <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
                            <Loader2 className="animate-spin" /> Connecting to server...
                        </div>
                    ) : (
                        /* Grid Layout */
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                            {visibleGroups.map(group => (
                                <StatusCard
                                    key={group.id}
                                    {...group}
                                    onHide={() => hideGroup(group.id)}
                                    onOpenTerminal={() => setActiveTab('logs')}
                                    onViewMemory={() => {
                                        setSelectedGroupForMemory(group.id);
                                        setActiveTab('memory');
                                    }}
                                    onClick={() => {
                                        setSelectedGroup(group.id);
                                        setActiveTab('group-detail');
                                    }}
                                />
                            ))}

                            {/* Add Card Button (Placeholder) */}
                            <button onClick={() => setAddGroupOpen(true)} className="border-2 border-dashed border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center text-slate-500 hover:text-slate-300 hover:border-slate-700 hover:bg-slate-900/30 transition-all group min-h-[220px]">
                                <div className="w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                                    <span className="text-2xl">+</span>
                                </div>
                                <span className="font-medium">Discover Group</span>
                            </button>
                        </div>
                    )}

                    {/* Hidden Groups Toggle & List */}
                    {hiddenGroupsList.length > 0 && (
                        <div className="mt-4">
                            <button
                                onClick={() => setShowHidden(!showHidden)}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
                            >
                                {showHidden ? <Eye size={16} /> : <EyeOff size={16} />}
                                {hiddenGroupsList.length} hidden group{hiddenGroupsList.length > 1 ? 's' : ''}
                            </button>
                            {showHidden && (
                                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6 opacity-60">
                                    {hiddenGroupsList.map(group => (
                                        <div key={group.id} className="relative">
                                            <StatusCard {...group} />
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
                            )}
                        </div>
                    )}
                </>
            )}

            {/* LOGS TAB */}
            {activeTab === 'logs' && (
                <div className="h-[calc(100vh-12rem)] flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-slate-200">Universal Log Stream</h2>
                        <div className="flex gap-2">
                            <span className="text-xs text-slate-500 font-mono py-1 px-2 bg-slate-900 rounded border border-slate-800">
                                {logs.length} events
                            </span>
                        </div>
                    </div>
                    <div className="flex-1 overflow-hidden rounded-xl border border-slate-800 shadow-2xl">
                        <Terminal logs={logs} isLoading={!isConnected} className="h-full" />
                    </div>
                </div>
            )}

            {/* MEMORY TAB */}
            {activeTab === 'memory' && (
                <MemoryPage groups={groups} />
            )}

            {/* GROUP DETAIL TAB */}
            {activeTab === 'group-detail' && selectedGroup && (
                <GroupDetailPage
                    groupFolder={selectedGroup}
                    onBack={() => setActiveTab('overview')}
                />
            )}

            {/* SETTINGS TAB */}
            {activeTab === 'settings' && <SettingsPage />}

            {/* TASKS AND ANALYTICS TABS */}
            {activeTab === 'tasks' && <TasksPage />}
            {activeTab === 'analytics' && <AnalyticsPage />}

            {/* KNOWLEDGE TAB */}
            {activeTab === 'knowledge' && <KnowledgePage />}

            {/* DRIVE TAB */}
            {activeTab === 'drive' && <DrivePage />}

            {/* CALENDAR TAB */}
            {activeTab === 'calendar' && <CalendarPage />}

            {/* ACTIVITY LOGS TAB */}
            {activeTab === 'activity-logs' && <ActivityLogsPage />}

            {/* SCHEDULE TAB */}
            {activeTab === 'schedule' && <SchedulePage />}

                </ErrorBoundary>
            </DashboardLayout>
            <SearchOverlay isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
            {addGroupOpen && (
                <AddGroupModal
                    registeredIds={new Set(groups.map(g => g.id))}
                    onClose={() => setAddGroupOpen(false)}
                    onAdded={() => setAddGroupOpen(false)}
                />
            )}
            <ToastContainer />
        </>
    );
}

export default App;
