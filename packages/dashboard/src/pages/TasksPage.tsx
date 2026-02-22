import { useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { useApiQuery } from '../hooks/useApi';
import { useSocket } from '../hooks/useSocket';
import { TaskList } from '../components/TaskList';
import { TaskFormModal } from '../components/TaskFormModal';

interface TaskData {
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

export function TasksPage() {
    const { groups } = useSocket();
    const { data: tasks, isLoading, refetch } = useApiQuery<TaskData[]>('/api/tasks');
    const [showForm, setShowForm] = useState(false);
    const [editingTask, setEditingTask] = useState<TaskData | null>(null);
    const [filterGroup, setFilterGroup] = useState('');
    const [filterStatus, setFilterStatus] = useState('');

    const filteredTasks = (tasks || [])
        .filter(t => !filterGroup || t.group_folder === filterGroup)
        .filter(t => !filterStatus || t.status === filterStatus);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Scheduled Tasks</h2>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => refetch()}
                        className="p-2 text-slate-400 hover:text-slate-200 transition-colors"
                    >
                        <RefreshCw size={18} />
                    </button>
                    <button
                        onClick={() => setShowForm(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        <Plus size={16} /> New Task
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex gap-3">
                <select
                    value={filterGroup}
                    onChange={e => setFilterGroup(e.target.value)}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
                >
                    <option value="">All Groups</option>
                    {groups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                </select>
                <select
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value)}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
                >
                    <option value="">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                </select>
            </div>

            {isLoading ? (
                <div className="text-slate-500 text-center py-8">Loading tasks...</div>
            ) : (
                <TaskList
                    tasks={filteredTasks}
                    onRefresh={refetch}
                    onEdit={task => setEditingTask(task)}
                />
            )}

            {showForm && (
                <TaskFormModal
                    groups={groups.map(g => ({ id: g.id, name: g.name }))}
                    onClose={() => setShowForm(false)}
                    onCreated={refetch}
                />
            )}

            {editingTask && (
                <TaskFormModal
                    groups={groups.map(g => ({ id: g.id, name: g.name }))}
                    editTask={editingTask}
                    onClose={() => setEditingTask(null)}
                    onCreated={() => { setEditingTask(null); refetch(); }}
                />
            )}
        </div>
    );
}
