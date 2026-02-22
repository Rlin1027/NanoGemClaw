import { Terminal, Brain, EyeOff, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

export type AgentStatus = 'idle' | 'thinking' | 'syncing' | 'error';

interface StatusCardProps {
    id: string;
    name: string;
    status: AgentStatus;
    messageCount: number;
    activeTasks: number;
    persona?: string;
    requireTrigger?: boolean;
    enableWebSearch?: boolean;
    folder?: string;
    onHide?: () => void;
    onOpenTerminal?: () => void;
    onViewMemory?: () => void;
    onClick?: () => void;
}

const statusColors: Record<AgentStatus, string> = {
    idle: "border-green-400 shadow-[0_0_15px_-3px_rgba(74,222,128,0.4)]",
    thinking: "border-blue-400 shadow-[0_0_15px_-3px_rgba(96,165,250,0.6)] animate-pulse",
    syncing: "border-yellow-400 shadow-[0_0_15px_-3px_rgba(250,204,21,0.4)]",
    error: "border-red-500 shadow-[0_0_15px_-3px_rgba(239,68,68,0.6)]",
};

const statusLabels: Record<AgentStatus, string> = {
    idle: "Idle",
    thinking: "Thinking...",
    syncing: "Syncing",
    error: "Error",
};

export function StatusCard({
    name,
    status,
    messageCount,
    activeTasks,
    persona,
    requireTrigger,
    enableWebSearch,
    onHide,
    onOpenTerminal,
    onViewMemory,
    onClick,
}: StatusCardProps) {
    return (
        <div
            className={cn(
                "relative bg-slate-900/50 backdrop-blur-sm border rounded-xl p-5 transition-all duration-300 hover:-translate-y-1",
                "border-slate-800",
                statusColors[status],
                onClick && "cursor-pointer"
            )}
            onClick={(e) => {
                // Don't trigger onClick if clicking on buttons
                if ((e.target as HTMLElement).closest('button')) return;
                onClick?.();
            }}
        >
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-lg bg-slate-800 ring-1 ring-slate-700")}>
                        <Bot className="w-6 h-6 text-slate-200" />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-100 text-lg leading-tight">{name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={cn(
                                "text-xs font-mono px-2 py-0.5 rounded-full inline-block",
                                status === 'error' ? "bg-red-500/20 text-red-300" :
                                    status === 'thinking' ? "bg-blue-500/20 text-blue-300" :
                                        "bg-green-500/20 text-green-300"
                            )}>
                                {statusLabels[status]}
                            </span>
                            {persona && persona !== 'default' && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
                                    🎭 {persona}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-1.5">
                    {requireTrigger === false && (
                        <span className="text-xs" title="Responds to all messages">📢</span>
                    )}
                    {enableWebSearch !== false && (
                        <span className="text-xs" title="Web Search enabled">🔍</span>
                    )}
                    <button
                        onClick={onHide}
                        className="text-slate-500 hover:text-slate-300 transition-colors"
                        title="Hide Card"
                    >
                        <EyeOff size={18} />
                    </button>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                    <div className="text-slate-500 text-xs mb-1">Messages</div>
                    <div className="text-slate-200 font-mono font-bold text-lg">{messageCount}</div>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                    <div className="text-slate-500 text-xs mb-1">Active Tasks</div>
                    <div className="text-slate-200 font-mono font-bold text-lg">{activeTasks}</div>
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
                <button
                    onClick={onOpenTerminal}
                    className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2 rounded-lg transition-colors border border-slate-700"
                >
                    <Terminal size={16} /> Console
                </button>
                <button
                    onClick={onViewMemory}
                    className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2 rounded-lg transition-colors border border-slate-700"
                >
                    <Brain size={16} /> Memory
                </button>
            </div>
        </div>
    );
}
