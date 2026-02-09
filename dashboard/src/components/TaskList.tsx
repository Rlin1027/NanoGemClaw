import { useState } from 'react';
import { Play, Pause, Trash2, Pencil, ChevronDown, ChevronRight, Loader2, Clock, Zap, CalendarClock } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { showToast } from '../hooks/useToast';
import { cn } from '@/lib/utils';

interface Task {
    id: string;
    group_folder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    context_mode: string;
    status: string;
    next_run: string | null;
    last_run: string | null;
    created_at: string;
}

interface TaskRunLog {
    task_id: string;
    run_at: string;
    duration_ms: number;
    status: string;
    result: string | null;
    error: string | null;
}

interface TaskListProps {
    tasks: Task[];
    onRefresh: () => void;
    onEdit?: (task: Task) => void;
    showGroup?: boolean;
}

export function TaskList({ tasks, onRefresh, onEdit, showGroup = true }: TaskListProps) {
    const [expandedTask, setExpandedTask] = useState<string | null>(null);
    const [runLogs, setRunLogs] = useState<Record<string, TaskRunLog[]>>({});
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const toggleExpand = async (taskId: string) => {
        if (expandedTask === taskId) {
            setExpandedTask(null);
            return;
        }
        setExpandedTask(taskId);
        if (!runLogs[taskId]) {
            try {
                const res = await apiFetch<TaskRunLog[]>(`/api/tasks/${taskId}/runs`);
                setRunLogs(prev => ({ ...prev, [taskId]: res }));
            } catch (err) {
                showToast(err instanceof Error ? err.message : 'Failed to load run logs');
            }
        }
    };

    const handleStatusChange = async (taskId: string, status: string) => {
        setActionLoading(taskId);
        try {
            await apiFetch(`/api/tasks/${taskId}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status }),
            });
            onRefresh();
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to update task status');
        } finally {
            setActionLoading(null);
        }
    };

    const handleDelete = async (taskId: string) => {
        if (!confirm('Delete this task?')) return;
        setActionLoading(taskId);
        try {
            await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
            onRefresh();
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to delete task');
        } finally {
            setActionLoading(null);
        }
    };

    const scheduleIcon = (type: string) => {
        switch (type) {
            case 'cron': return <Clock size={12} />;
            case 'interval': return <Zap size={12} />;
            case 'once': return <CalendarClock size={12} />;
            default: return <Clock size={12} />;
        }
    };

    if (tasks.length === 0) {
        return <div className="text-slate-500 text-sm text-center py-8">No tasks found</div>;
    }

    return (
        <div className="space-y-2">
            {tasks.map(task => (
                <div key={task.id} className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden">
                    <div
                        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-800/30 transition-colors"
                        onClick={() => toggleExpand(task.id)}
                    >
                        {expandedTask === task.id ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronRight size={16} className="text-slate-500" />}

                        <div className="flex-1 min-w-0">
                            <div className="text-sm text-slate-200 truncate">{task.prompt}</div>
                            <div className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                                {showGroup && <span>📁 {task.group_folder}</span>}
                                <span className="flex items-center gap-1">{scheduleIcon(task.schedule_type)} {task.schedule_type}: {task.schedule_value}</span>
                                {task.next_run && <span>Next: {new Date(task.next_run).toLocaleString()}</span>}
                            </div>
                        </div>

                        <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full font-medium",
                            task.status === 'active' ? "bg-green-500/20 text-green-300" :
                            task.status === 'paused' ? "bg-yellow-500/20 text-yellow-300" :
                            "bg-slate-700 text-slate-400"
                        )}>
                            {task.status}
                        </span>

                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            {actionLoading === task.id ? (
                                <span className="p-1.5"><Loader2 size={16} className="animate-spin text-slate-500" /></span>
                            ) : (
                                <>
                                    {onEdit && (
                                        <button
                                            onClick={() => onEdit(task)}
                                            className="p-1.5 text-slate-400 hover:text-blue-400 transition-colors"
                                            title="Edit"
                                        >
                                            <Pencil size={16} />
                                        </button>
                                    )}
                                    {task.status === 'active' ? (
                                        <button
                                            onClick={() => handleStatusChange(task.id, 'paused')}
                                            className="p-1.5 text-slate-400 hover:text-yellow-400 transition-colors"
                                            title="Pause"
                                        >
                                            <Pause size={16} />
                                        </button>
                                    ) : task.status === 'paused' ? (
                                        <button
                                            onClick={() => handleStatusChange(task.id, 'active')}
                                            className="p-1.5 text-slate-400 hover:text-green-400 transition-colors"
                                            title="Resume"
                                        >
                                            <Play size={16} />
                                        </button>
                                    ) : null}
                                    <button
                                        onClick={() => handleDelete(task.id)}
                                        className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                                        title="Delete"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Expanded: Task Details + Run Logs */}
                    {expandedTask === task.id && (
                        <div className="border-t border-slate-800 bg-slate-950/50">
                            {/* Task Details */}
                            <div className="p-4 border-b border-slate-800/50">
                                <div className="text-xs font-medium text-slate-400 mb-2">Task Details</div>
                                <div className="grid grid-cols-2 gap-3 text-xs">
                                    <div>
                                        <span className="text-slate-500">Schedule:</span>
                                        <span className="ml-2 text-slate-300 font-mono">{task.schedule_type}: {task.schedule_value}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Context:</span>
                                        <span className="ml-2 text-slate-300">{task.context_mode}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Created:</span>
                                        <span className="ml-2 text-slate-300">{new Date(task.created_at).toLocaleString()}</span>
                                    </div>
                                    {task.last_run && (
                                        <div>
                                            <span className="text-slate-500">Last run:</span>
                                            <span className="ml-2 text-slate-300">{new Date(task.last_run).toLocaleString()}</span>
                                        </div>
                                    )}
                                    {task.next_run && (
                                        <div>
                                            <span className="text-slate-500">Next run:</span>
                                            <span className="ml-2 text-slate-300">{new Date(task.next_run).toLocaleString()}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="mt-3">
                                    <span className="text-slate-500 text-xs">Prompt:</span>
                                    <div className="mt-1 text-sm text-slate-300 bg-slate-900 rounded-lg p-3 whitespace-pre-wrap break-words">
                                        {task.prompt}
                                    </div>
                                </div>
                            </div>

                            {/* Run History */}
                            <div className="p-4">
                                <div className="text-xs font-medium text-slate-400 mb-3">Run History</div>
                                {(runLogs[task.id] || []).length === 0 ? (
                                    <div className="text-xs text-slate-600">No runs yet</div>
                                ) : (
                                    <div className="space-y-1.5">
                                        {(runLogs[task.id] || []).slice(0, 10).map((log, i) => (
                                            <div key={i} className={cn(
                                                "flex items-center gap-3 text-xs px-2.5 py-1.5 rounded-md",
                                                log.status === 'success' ? 'bg-green-500/5' : 'bg-red-500/5'
                                            )}>
                                                <span className={cn(
                                                    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0",
                                                    log.status === 'success'
                                                        ? 'bg-green-500/20 text-green-400'
                                                        : 'bg-red-500/20 text-red-400'
                                                )}>
                                                    {log.status === 'success' ? '✓' : '✗'}
                                                </span>
                                                <span className="text-slate-400">{new Date(log.run_at).toLocaleString()}</span>
                                                <span className="text-slate-600 font-mono">{(log.duration_ms / 1000).toFixed(1)}s</span>
                                                {log.result && !log.error && (
                                                    <span className="text-slate-500 truncate flex-1">{log.result.slice(0, 80)}</span>
                                                )}
                                                {log.error && <span className="text-red-400 truncate flex-1">{log.error}</span>}
                                            </div>
                                        ))}
                                        {(runLogs[task.id] || []).length > 10 && (
                                            <div className="text-[10px] text-slate-600 px-2.5">
                                                +{(runLogs[task.id] || []).length - 10} more runs
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
