import { useState } from 'react';
import { Server, RefreshCw, ChevronDown, ChevronRight, Plus, Trash2, RotateCcw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMcp, AddMcpServerPayload, McpServer } from '../hooks/useMcp';
import { showToast } from '../hooks/useToast';

function statusBadge(status: McpServer['status']) {
    if (status === 'connected') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Connected
            </span>
        );
    }
    if (status === 'error') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                Error
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700/50 text-slate-400 border border-slate-600/30">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
            Disconnected
        </span>
    );
}

interface ServerCardProps {
    server: McpServer;
    onToggle: (enabled: boolean) => Promise<void>;
    onReconnect: () => Promise<void>;
    onRemove: () => Promise<void>;
    onToggleTool: (toolName: string, enabled: boolean) => Promise<void>;
}

function ServerCard({ server, onToggle, onReconnect, onRemove, onToggleTool }: ServerCardProps) {
    const [expanded, setExpanded] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [togglingTools, setTogglingTools] = useState<Set<string>>(new Set());
    const [bulkToggling, setBulkToggling] = useState(false);

    const handleToggle = async () => {
        setToggling(true);
        try {
            await onToggle(!server.enabled);
            showToast(server.enabled ? 'Server disabled' : 'Server enabled', 'success');
        } catch {
            showToast('Failed to update server');
        } finally {
            setToggling(false);
        }
    };

    const handleReconnect = async () => {
        setReconnecting(true);
        try {
            await onReconnect();
            showToast('Reconnecting...', 'success');
        } catch {
            showToast('Failed to reconnect');
        } finally {
            setReconnecting(false);
        }
    };

    const handleRemove = async () => {
        if (!confirm(`Remove MCP server "${server.name}"?`)) return;
        setRemoving(true);
        try {
            await onRemove();
            showToast('Server removed', 'success');
        } catch {
            showToast('Failed to remove server');
        } finally {
            setRemoving(false);
        }
    };

    const handleToggleTool = async (toolName: string, enabled: boolean) => {
        setTogglingTools(prev => new Set(prev).add(toolName));
        try {
            await onToggleTool(toolName, enabled);
            showToast(enabled ? `${toolName} enabled` : `${toolName} disabled`, 'success');
        } catch {
            showToast(`Failed to update ${toolName}`);
        } finally {
            setTogglingTools(prev => { const next = new Set(prev); next.delete(toolName); return next; });
        }
    };

    const handleEnableAll = async () => {
        setBulkToggling(true);
        try {
            await Promise.all(server.tools.filter(t => !t.enabled).map(t => onToggleTool(t.name, true)));
            showToast('All tools enabled', 'success');
        } catch {
            showToast('Failed to enable all tools');
        } finally {
            setBulkToggling(false);
        }
    };

    const handleDisableAll = async () => {
        setBulkToggling(true);
        try {
            await Promise.all(server.tools.filter(t => t.enabled).map(t => onToggleTool(t.name, false)));
            showToast('All tools disabled', 'success');
        } catch {
            showToast('Failed to disable all tools');
        } finally {
            setBulkToggling(false);
        }
    };

    return (
        <div className={cn(
            'bg-slate-800 border rounded-xl overflow-hidden transition-colors',
            server.enabled ? 'border-slate-700' : 'border-slate-700/50 opacity-60',
        )}>
            <div className="p-4 flex items-center gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-slate-900 flex items-center justify-center">
                    <Server size={20} className="text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white truncate">{server.name}</span>
                        {statusBadge(server.status)}
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 border border-slate-600">
                            {server.transport}
                        </span>
                        <span className="text-xs text-slate-500">
                            {server.toolCount} {server.toolCount === 1 ? 'tool' : 'tools'}
                        </span>
                    </div>
                    {server.errorMessage && (
                        <div className="text-xs text-red-400 mt-0.5 truncate">{server.errorMessage}</div>
                    )}
                    <div className="text-xs text-slate-500 mt-0.5 font-mono truncate">
                        {server.command || server.url || server.id}
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                        onClick={() => setExpanded(v => !v)}
                        className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors"
                        title="Toggle tools list"
                        disabled={server.toolCount === 0}
                    >
                        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <button
                        onClick={handleReconnect}
                        disabled={reconnecting}
                        className="p-1.5 text-slate-400 hover:text-blue-400 transition-colors disabled:opacity-50"
                        title="Reconnect"
                    >
                        {reconnecting ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                    </button>
                    <button
                        onClick={handleToggle}
                        disabled={toggling}
                        className={cn(
                            'px-2.5 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50',
                            server.enabled
                                ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                : 'bg-blue-600 text-white hover:bg-blue-500',
                        )}
                    >
                        {toggling ? '...' : server.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                        onClick={handleRemove}
                        disabled={removing}
                        className="p-1.5 text-slate-500 hover:text-red-400 transition-colors disabled:opacity-50"
                        title="Remove server"
                    >
                        {removing ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    </button>
                </div>
            </div>

            {expanded && server.tools.length > 0 && (
                <div className="border-t border-slate-700 px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-500">
                            {server.tools.filter(t => t.enabled).length}/{server.tools.length} enabled
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={handleEnableAll}
                                disabled={bulkToggling || server.tools.every(t => t.enabled)}
                                className="px-2 py-0.5 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors disabled:opacity-40"
                            >
                                Enable All
                            </button>
                            <button
                                onClick={handleDisableAll}
                                disabled={bulkToggling || server.tools.every(t => !t.enabled)}
                                className="px-2 py-0.5 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors disabled:opacity-40"
                            >
                                Disable All
                            </button>
                        </div>
                    </div>
                    <div className="space-y-1">
                        {server.tools.map(tool => (
                            <div key={tool.name} className="flex items-center justify-between gap-2 py-1">
                                <div className="flex-1 min-w-0">
                                    <span className="text-xs font-mono text-blue-300">{tool.name}</span>
                                    {tool.description && (
                                        <span className="text-xs text-slate-500 ml-2">{tool.description}</span>
                                    )}
                                </div>
                                <button
                                    onClick={() => handleToggleTool(tool.name, !tool.enabled)}
                                    disabled={togglingTools.has(tool.name) || bulkToggling}
                                    className={cn(
                                        'relative flex-shrink-0 w-8 h-4 rounded-full transition-colors disabled:opacity-50',
                                        tool.enabled ? 'bg-blue-600' : 'bg-slate-600',
                                    )}
                                    title={tool.enabled ? 'Disable tool' : 'Enable tool'}
                                >
                                    <span className={cn(
                                        'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform',
                                        tool.enabled ? 'translate-x-4' : 'translate-x-0.5',
                                    )} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

const defaultForm: AddMcpServerPayload = {
    id: '',
    name: '',
    transport: 'stdio',
    command: '',
    url: '',
    permission: 'any',
    enabled: true,
};

interface AddServerModalProps {
    onClose: () => void;
    onAdd: (payload: AddMcpServerPayload) => Promise<void>;
}

function AddServerModal({ onClose, onAdd }: AddServerModalProps) {
    const [form, setForm] = useState<AddMcpServerPayload>(defaultForm);
    const [submitting, setSubmitting] = useState(false);

    const set = (key: keyof AddMcpServerPayload, value: unknown) =>
        setForm(prev => ({ ...prev, [key]: value }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.id.trim() || !form.name.trim()) return;
        setSubmitting(true);
        try {
            await onAdd(form);
            onClose();
            showToast('MCP server added', 'success');
        } catch {
            showToast('Failed to add server');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
                <div className="flex items-center justify-between p-5 border-b border-slate-800">
                    <h3 className="text-base font-semibold text-white">Add MCP Server</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors text-lg leading-none">&times;</button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">ID *</label>
                            <input
                                required
                                value={form.id}
                                onChange={e => set('id', e.target.value)}
                                placeholder="my-mcp-server"
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Name *</label>
                            <input
                                required
                                value={form.name}
                                onChange={e => set('name', e.target.value)}
                                placeholder="My MCP Server"
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Transport</label>
                            <select
                                value={form.transport}
                                onChange={e => set('transport', e.target.value)}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            >
                                <option value="stdio">stdio</option>
                                <option value="sse">SSE</option>
                                <option value="http">HTTP</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Permission</label>
                            <select
                                value={form.permission}
                                onChange={e => set('permission', e.target.value)}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            >
                                <option value="any">any</option>
                                <option value="main">main</option>
                            </select>
                        </div>
                    </div>
                    {(form.transport === 'stdio') && (
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Command</label>
                            <input
                                value={form.command}
                                onChange={e => set('command', e.target.value)}
                                placeholder="npx -y @modelcontextprotocol/server-example"
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-mono"
                            />
                        </div>
                    )}
                    {(form.transport === 'sse' || form.transport === 'http') && (
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">URL</label>
                            <input
                                value={form.url}
                                onChange={e => set('url', e.target.value)}
                                placeholder="http://localhost:3001/sse"
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-mono"
                            />
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="enabled-toggle"
                            checked={form.enabled}
                            onChange={e => set('enabled', e.target.checked)}
                            className="w-4 h-4 accent-blue-500"
                        />
                        <label htmlFor="enabled-toggle" className="text-sm text-slate-300">Enable immediately</label>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting || !form.id.trim() || !form.name.trim()}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                        >
                            {submitting && <Loader2 size={14} className="animate-spin" />}
                            Add Server
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export function McpPage() {
    const { servers, isLoading, refetch, addServer, updateServer, removeServer, reconnectServer, updateToolPermission } = useMcp();
    const [showAddModal, setShowAddModal] = useState(false);

    const connected = servers.filter(s => s.status === 'connected').length;
    const total = servers.length;
    const totalTools = servers.reduce((acc, s) => acc + s.tools.length, 0);
    const enabledTools = servers.reduce((acc, s) => acc + s.tools.filter(t => t.enabled).length, 0);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Server size={22} className="text-blue-400" />
                        MCP Servers
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                        {connected}/{total} connected
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => refetch()}
                        className="p-2 text-slate-400 hover:text-slate-200 transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw size={18} />
                    </button>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        <Plus size={16} /> Add MCP Server
                    </button>
                </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4">
                {[
                    { label: 'Total Servers', value: total },
                    { label: 'Connected', value: connected },
                    { label: 'Tools Enabled', value: `${enabledTools}/${totalTools}` },
                ].map(stat => (
                    <div key={stat.label} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                        <div className="text-2xl font-bold text-white">{stat.value}</div>
                        <div className="text-xs text-slate-500 mt-1">{stat.label}</div>
                    </div>
                ))}
            </div>

            {/* Server list */}
            {isLoading ? (
                <div className="flex items-center justify-center py-12 text-slate-500 gap-2">
                    <Loader2 className="animate-spin" size={20} /> Loading servers...
                </div>
            ) : servers.length === 0 ? (
                <div className="text-center py-16 text-slate-500 bg-slate-900/30 border-2 border-dashed border-slate-800 rounded-xl">
                    <Server size={40} className="mx-auto mb-3 text-slate-700" />
                    <p className="font-medium mb-1">No MCP servers configured</p>
                    <p className="text-sm">Add a server to extend bot capabilities with external tools.</p>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        Add First Server
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    {servers.map(server => (
                        <ServerCard
                            key={server.id}
                            server={server}
                            onToggle={enabled => updateServer(server.id, { enabled })}
                            onReconnect={() => reconnectServer(server.id)}
                            onRemove={() => removeServer(server.id)}
                            onToggleTool={(toolName, enabled) => updateToolPermission(server.id, toolName, enabled)}
                        />
                    ))}
                </div>
            )}

            {showAddModal && (
                <AddServerModal
                    onClose={() => setShowAddModal(false)}
                    onAdd={addServer}
                />
            )}
        </div>
    );
}
