import { useState, useEffect } from 'react';
import { DashboardLayout } from './components/DashboardLayout';
import { StatusCard } from './components/StatusCard';
import { Terminal } from './components/Terminal';
import { MemoryEditor } from './components/MemoryEditor';
import { LoginScreen } from './components/LoginScreen';
import { SettingsPage } from './pages/SettingsPage';
import { GroupDetailPage } from './pages/GroupDetailPage';
import { TasksPage } from './pages/TasksPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { CalendarPage } from './pages/CalendarPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/ToastContainer';
import { SearchOverlay } from './components/SearchOverlay';
import { AddGroupModal } from './components/AddGroupModal';
import { Search, Loader2, Bot, ChevronRight } from 'lucide-react';
import { useSocket } from './hooks/useSocket';
import { useApiQuery } from './hooks/useApi';

function App() {
    const { groups, logs, isConnected } = useSocket();
    const [activeTab, setActiveTab] = useState('overview');
    const [selectedGroupForMemory, setSelectedGroupForMemory] = useState<string | null>(null);
    const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [addGroupOpen, setAddGroupOpen] = useState(false);

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

                    {groups.length === 0 && isConnected ? (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                            <p className="mb-2">No active groups found.</p>
                            <button className="text-blue-500 hover:text-blue-400">Discover Groups</button>
                        </div>
                    ) : groups.length === 0 && !isConnected ? (
                        <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
                            <Loader2 className="animate-spin" /> Connecting to server...
                        </div>
                    ) : (
                        /* Grid Layout */
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                            {groups.map(group => (
                                <StatusCard
                                    key={group.id}
                                    {...group}
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
                            <button className="border-2 border-dashed border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center text-slate-500 hover:text-slate-300 hover:border-slate-700 hover:bg-slate-900/30 transition-all group min-h-[220px]">
                                <div className="w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                                    <span className="text-2xl">+</span>
                                </div>
                                <span className="font-medium">Discover Group</span>
                            </button>
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
                <div className="h-[calc(100vh-12rem)] flex gap-6">
                    {/* Sidebar Group List */}
                    <div className="w-64 flex flex-col gap-2">
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">Select Group</h3>
                        {groups.map(group => (
                            <button
                                key={group.id}
                                onClick={() => setSelectedGroupForMemory(group.id)}
                                className={`flex items-center justify-between p-3 rounded-lg text-left transition-all ${selectedGroupForMemory === group.id
                                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                                        : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                                    }`}
                            >
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <Bot size={16} />
                                    <span className="truncate font-medium text-sm">{group.name}</span>
                                </div>
                                {selectedGroupForMemory === group.id && <ChevronRight size={14} />}
                            </button>
                        ))}
                    </div>

                    {/* Editor Area */}
                    <div className="flex-1 min-w-0">
                        {selectedGroupForMemory ? (
                            <MemoryEditor groupFolder={selectedGroupForMemory} />
                        ) : (
                            <div className="h-full flex items-center justify-center text-slate-600 bg-slate-900/30 rounded-xl border-2 border-dashed border-slate-800">
                                Select a group to edit memory
                            </div>
                        )}
                    </div>
                </div>
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

            {/* CALENDAR TAB */}
            {activeTab === 'calendar' && <CalendarPage />}

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
