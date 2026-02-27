import { useState } from 'react';
import { Plus, RefreshCw, CheckSquare, Square, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiQuery, apiFetch } from '../hooks/useApi';
import { useSocket } from '../hooks/useSocket';
import { TaskList } from '../components/TaskList';
import { TaskFormModal } from '../components/TaskFormModal';
import { showToast } from '../hooks/useToast';
import { cn } from '@/lib/utils';

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

interface GoogleAuthStatus {
    authenticated: boolean;
    hasCredentials: boolean;
    scopes: string[];
}

interface GoogleTaskList {
    id: string;
    title: string;
    updated: string;
}

interface GoogleTask {
    id: string;
    title: string;
    notes?: string;
    due?: string;
    status: 'needsAction' | 'completed';
    updated: string;
}

interface GoogleSyncState {
    lastSync: string | null;
    syncing: boolean;
}

interface CreateGoogleTaskBody {
    title: string;
    notes?: string;
    due?: string;
}

export function TasksPage() {
    const { t } = useTranslation('tasks');
    const { groups } = useSocket();
    const { data: tasks, isLoading, refetch } = useApiQuery<TaskData[]>('/api/tasks');
    const [showForm, setShowForm] = useState(false);
    const [editingTask, setEditingTask] = useState<TaskData | null>(null);
    const [filterGroup, setFilterGroup] = useState('');
    const [filterStatus, setFilterStatus] = useState('');

    // Google Auth
    const { data: googleAuth } = useApiQuery<GoogleAuthStatus>('/api/plugins/google-auth/status');
    const isGoogleAuthenticated = googleAuth?.authenticated === true;

    const filteredTasks = (tasks || [])
        .filter(t => !filterGroup || t.group_folder === filterGroup)
        .filter(t => !filterStatus || t.status === filterStatus);

    return (
        <div className="space-y-6">
            {/* Scheduled Tasks Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">{t('title')}</h2>
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
                        <Plus size={16} /> {t('newTask')}
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
                    <option value="">{t('allGroups')}</option>
                    {groups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                </select>
                <select
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value)}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
                >
                    <option value="">{t('allStatuses')}</option>
                    <option value="active">{t('active')}</option>
                    <option value="paused">{t('paused')}</option>
                    <option value="completed">{t('completed')}</option>
                </select>
            </div>

            {isLoading ? (
                <div className="text-slate-500 text-center py-8">{t('loadingTasks')}</div>
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

            {/* Google Tasks Section */}
            {isGoogleAuthenticated && <GoogleTasksSection t={t} />}

            {/* Hint to connect Google if credentials exist but not authenticated */}
            {!isGoogleAuthenticated && googleAuth?.hasCredentials && (
                <div className="flex items-center gap-3 px-4 py-3 bg-slate-900/50 border border-slate-800 rounded-lg text-sm text-slate-400">
                    <CheckSquare size={14} className="text-slate-500 flex-shrink-0" />
                    <span>
                        {t('googleTasksHint')}{' '}
                        <a
                            href="/settings"
                            className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
                        >
                            {t('connectInSettings')}
                        </a>
                    </span>
                </div>
            )}
        </div>
    );
}

function GoogleTasksSection({ t }: { t: (key: string, opts?: Record<string, unknown>) => string }) {
    const { data: taskLists, isLoading: loadingLists, refetch: refetchLists } = useApiQuery<GoogleTaskList[]>(
        '/api/plugins/google-tasks/lists',
    );
    const { data: syncState, refetch: refetchSyncState } = useApiQuery<GoogleSyncState>(
        '/api/plugins/google-tasks/sync-state',
    );
    const [syncing, setSyncing] = useState(false);
    const [activeListId, setActiveListId] = useState<string | null>(null);
    const [showCreateForm, setShowCreateForm] = useState(false);

    const lists = taskLists || [];
    const currentListId = activeListId ?? (lists[0]?.id || null);

    const handleSync = async () => {
        setSyncing(true);
        try {
            await apiFetch('/api/plugins/google-tasks/sync', { method: 'POST' });
            await Promise.all([refetchLists(), refetchSyncState()]);
            showToast(t('syncComplete'), 'success');
        } catch {
            showToast(t('syncFailed'));
        } finally {
            setSyncing(false);
        }
    };

    const lastSyncLabel = syncState?.lastSync
        ? new Date(syncState.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : t('never');

    return (
        <div className="space-y-4">
            {/* Section header */}
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <CheckSquare size={20} className="text-emerald-400" />
                    {t('googleTasksTitle')}
                    <span className="text-xs font-normal px-2 py-0.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-full">
                        Google
                    </span>
                </h3>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">
                        {t('lastSync')}: {lastSyncLabel}
                    </span>
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                        {t('sync')}
                    </button>
                    {currentListId && (
                        <button
                            onClick={() => setShowCreateForm(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors"
                        >
                            <Plus size={12} /> {t('addTask')}
                        </button>
                    )}
                </div>
            </div>

            {loadingLists ? (
                <div className="flex items-center justify-center py-8 text-slate-500 gap-2">
                    <Loader2 className="animate-spin" size={16} /> {t('loadingGoogleTasks')}
                </div>
            ) : lists.length === 0 ? (
                <div className="text-center py-8 text-slate-500 bg-slate-900/30 rounded-xl border-2 border-dashed border-slate-800">
                    {t('noGoogleTaskLists')}
                </div>
            ) : (
                <>
                    {/* Tab bar for lists */}
                    {lists.length > 1 && (
                        <div className="flex gap-1 border-b border-slate-800 overflow-x-auto pb-0">
                            {lists.map(list => (
                                <button
                                    key={list.id}
                                    onClick={() => setActiveListId(list.id)}
                                    className={cn(
                                        "px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                                        currentListId === list.id
                                            ? "border-emerald-500 text-emerald-400"
                                            : "border-transparent text-slate-400 hover:text-slate-200"
                                    )}
                                >
                                    {list.title}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Task list content */}
                    {currentListId && (
                        <GoogleTaskListPanel
                            listId={currentListId}
                            t={t}
                            showCreateForm={showCreateForm}
                            onCloseCreateForm={() => setShowCreateForm(false)}
                        />
                    )}
                </>
            )}
        </div>
    );
}

function GoogleTaskListPanel({
    listId,
    t,
    showCreateForm,
    onCloseCreateForm,
}: {
    listId: string;
    t: (key: string, opts?: Record<string, unknown>) => string;
    showCreateForm: boolean;
    onCloseCreateForm: () => void;
}) {
    const { data: taskItems, isLoading, refetch } = useApiQuery<GoogleTask[]>(
        `/api/plugins/google-tasks/lists/${encodeURIComponent(listId)}/tasks`,
    );
    const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());

    const tasks = taskItems || [];
    const pending = tasks.filter(t => t.status === 'needsAction');
    const completed = tasks.filter(t => t.status === 'completed');
    const [showCompleted, setShowCompleted] = useState(false);

    const handleComplete = async (taskId: string) => {
        setCompletingIds(prev => new Set(prev).add(taskId));
        try {
            const accessCode = localStorage.getItem('nanogemclaw_access_code') || '';
            const API_BASE = import.meta.env.VITE_API_URL || window.location.origin;
            const res = await fetch(
                `${API_BASE}/api/plugins/google-tasks/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/complete`,
                {
                    method: 'PATCH',
                    headers: { 'x-access-code': accessCode, 'Content-Type': 'application/json' },
                },
            );
            if (!res.ok) throw new Error('Failed');
            await refetch();
            showToast(t('taskCompleted'), 'success');
        } catch {
            showToast(t('failedToCompleteTask'));
        } finally {
            setCompletingIds(prev => { const s = new Set(prev); s.delete(taskId); return s; });
        }
    };

    const handleCreate = async (body: CreateGoogleTaskBody) => {
        try {
            const accessCode = localStorage.getItem('nanogemclaw_access_code') || '';
            const API_BASE = import.meta.env.VITE_API_URL || window.location.origin;
            const res = await fetch(
                `${API_BASE}/api/plugins/google-tasks/lists/${encodeURIComponent(listId)}/tasks`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-access-code': accessCode,
                    },
                    body: JSON.stringify(body),
                },
            );
            if (!res.ok) throw new Error('Failed');
            await refetch();
            onCloseCreateForm();
            showToast(t('taskCreated'), 'success');
        } catch {
            showToast(t('failedToCreateTask'));
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-8 text-slate-500 gap-2">
                <Loader2 className="animate-spin" size={16} /> {t('loadingGoogleTasks')}
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {/* Create task inline form */}
            {showCreateForm && (
                <CreateGoogleTaskForm
                    onSubmit={handleCreate}
                    onCancel={onCloseCreateForm}
                    t={t}
                />
            )}

            {/* Pending tasks */}
            {pending.length === 0 && !showCreateForm && (
                <div className="text-center py-6 text-slate-500 text-sm">
                    {t('noGoogleTasks')}
                </div>
            )}
            {pending.map(task => (
                <GoogleTaskRow
                    key={task.id}
                    task={task}
                    completing={completingIds.has(task.id)}
                    onComplete={() => handleComplete(task.id)}
                    t={t}
                />
            ))}

            {/* Completed tasks toggle */}
            {completed.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowCompleted(v => !v)}
                        className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors mt-3 mb-1"
                    >
                        {showCompleted ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {t('completedCount', { count: completed.length })}
                    </button>
                    {showCompleted && completed.map(task => (
                        <GoogleTaskRow
                            key={task.id}
                            task={task}
                            completing={false}
                            onComplete={() => {}}
                            t={t}
                            dimmed
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function GoogleTaskRow({
    task,
    completing,
    onComplete,
    t,
    dimmed = false,
}: {
    task: GoogleTask;
    completing: boolean;
    onComplete: () => void;
    t: (key: string) => string;
    dimmed?: boolean;
}) {
    const isDone = task.status === 'completed';
    const dueDate = task.due ? new Date(task.due).toLocaleDateString([], { month: 'short', day: 'numeric' }) : null;
    const isOverdue = task.due && !isDone && new Date(task.due) < new Date();

    return (
        <div className={cn(
            "flex items-start gap-3 p-3 bg-slate-900/50 border border-slate-800 rounded-lg transition-colors",
            dimmed ? "opacity-50" : "hover:bg-slate-800/50",
        )}>
            <button
                onClick={onComplete}
                disabled={isDone || completing}
                className="mt-0.5 flex-shrink-0 text-slate-500 hover:text-emerald-400 transition-colors disabled:cursor-default"
                title={isDone ? t('completed') : t('markComplete')}
            >
                {completing ? (
                    <Loader2 size={16} className="animate-spin text-emerald-400" />
                ) : isDone ? (
                    <CheckSquare size={16} className="text-emerald-500" />
                ) : (
                    <Square size={16} />
                )}
            </button>
            <div className="flex-1 min-w-0">
                <div className={cn("text-sm font-medium", isDone ? "line-through text-slate-500" : "text-slate-200")}>
                    {task.title}
                </div>
                {task.notes && (
                    <div className="text-xs text-slate-500 mt-0.5 truncate">{task.notes}</div>
                )}
            </div>
            {dueDate && (
                <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0",
                    isOverdue
                        ? "bg-red-500/15 text-red-400 border-red-500/30"
                        : "bg-slate-800 text-slate-400 border-slate-700"
                )}>
                    {dueDate}
                </span>
            )}
        </div>
    );
}

function CreateGoogleTaskForm({
    onSubmit,
    onCancel,
    t,
}: {
    onSubmit: (body: CreateGoogleTaskBody) => void;
    onCancel: () => void;
    t: (key: string) => string;
}) {
    const [title, setTitle] = useState('');
    const [notes, setNotes] = useState('');
    const [due, setDue] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;
        setSubmitting(true);
        await onSubmit({
            title: title.trim(),
            notes: notes.trim() || undefined,
            due: due ? new Date(due).toISOString() : undefined,
        });
        setSubmitting(false);
    };

    return (
        <form
            onSubmit={handleSubmit}
            className="p-3 bg-slate-800/50 border border-emerald-500/30 rounded-lg space-y-2"
        >
            <input
                autoFocus
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                placeholder={t('taskTitlePlaceholder')}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
            <input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={t('taskNotesPlaceholder')}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
            <div className="flex items-center gap-2">
                <input
                    type="date"
                    value={due}
                    onChange={e => setDue(e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm transition-colors"
                >
                    {t('cancel')}
                </button>
                <button
                    type="submit"
                    disabled={!title.trim() || submitting}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
                >
                    {submitting ? t('adding') : t('addTask')}
                </button>
            </div>
        </form>
    );
}
