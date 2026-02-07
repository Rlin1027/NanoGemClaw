import { DashboardLayout } from './components/DashboardLayout';
import { StatusCard } from './components/StatusCard';
import { Search, Loader2 } from 'lucide-react';
import { useSocket } from './hooks/useSocket';

function App() {
    const { groups, isConnected } = useSocket();

    return (
        <DashboardLayout>
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
        </DashboardLayout>
    );
}

export default App;
