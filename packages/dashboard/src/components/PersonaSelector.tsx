import { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import { cn } from '@/lib/utils';
import { Plus, Trash2, X } from 'lucide-react';

interface Persona {
    name: string;
    description: string;
    systemPrompt: string;
}

interface PersonaSelectorProps {
    value?: string;
    onChange: (key: string) => void;
    disabled?: boolean;
}

const BUILT_IN_KEYS = ['default', 'coder', 'translator', 'writer', 'analyst'];

export function PersonaSelector({ value, onChange, disabled }: PersonaSelectorProps) {
    const [personas, setPersonas] = useState<Record<string, Persona>>({});
    const [showCreate, setShowCreate] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    const fetchPersonas = () => {
        apiFetch<Record<string, Persona>>('/api/personas')
            .then(res => setPersonas(res))
            .catch(() => {});
    };

    useEffect(() => {
        fetchPersonas();
    }, []);

    const handleDelete = async (key: string) => {
        if (!confirm(`Delete persona "${personas[key]?.name}"?`)) return;
        setDeleting(key);
        try {
            await apiFetch(`/api/personas/${key}`, { method: 'DELETE' });
            fetchPersonas();
            if (value === key) onChange('default');
        } catch {} finally {
            setDeleting(null);
        }
    };

    return (
        <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-800 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-slate-200">Persona</label>
                <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                    <Plus size={14} /> Create
                </button>
            </div>
            <div className="flex gap-2 min-w-0">
                <select
                    value={value || 'default'}
                    onChange={e => onChange(e.target.value)}
                    disabled={disabled}
                    className={cn(
                        "flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 truncate",
                        "focus:outline-none focus:ring-2 focus:ring-blue-500/50",
                        disabled && "opacity-50 cursor-not-allowed"
                    )}
                >
                    {Object.entries(personas).map(([key, p]) => (
                        <option key={key} value={key}>
                            {p.name} — {p.description}
                        </option>
                    ))}
                </select>
                {value && !BUILT_IN_KEYS.includes(value) && (
                    <button
                        onClick={() => handleDelete(value)}
                        disabled={deleting === value}
                        className="p-2 text-slate-400 hover:text-red-400 transition-colors"
                        title="Delete custom persona"
                    >
                        <Trash2 size={16} />
                    </button>
                )}
            </div>

            {showCreate && (
                <CreatePersonaModal
                    onClose={() => setShowCreate(false)}
                    onCreated={() => { fetchPersonas(); setShowCreate(false); }}
                />
            )}
        </div>
    );
}

function CreatePersonaModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
    const [form, setForm] = useState({ key: '', name: '', description: '', systemPrompt: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.key || !form.name || !form.systemPrompt) {
            setError('Key, name, and system prompt are required');
            return;
        }
        // Validate key format
        if (!/^[a-z][a-z0-9_-]*$/.test(form.key)) {
            setError('Key must start with lowercase letter and contain only a-z, 0-9, _, -');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            await apiFetch('/api/personas', {
                method: 'POST',
                body: JSON.stringify({
                    key: form.key,
                    name: form.name,
                    description: form.description || form.name,
                    systemPrompt: form.systemPrompt,
                }),
            });
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create persona');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg mx-4 shadow-2xl">
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                    <h2 className="text-lg font-bold text-slate-100">Create Custom Persona</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">Key (unique identifier)</label>
                        <input
                            value={form.key}
                            onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
                            placeholder="my-persona"
                            required
                        />
                    </div>
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">Name</label>
                        <input
                            value={form.name}
                            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
                            placeholder="My Custom Persona"
                            required
                        />
                    </div>
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">Description</label>
                        <input
                            value={form.description}
                            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
                            placeholder="Brief description of this persona"
                        />
                    </div>
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">System Prompt</label>
                        <textarea
                            value={form.systemPrompt}
                            onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
                            rows={4}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 resize-none"
                            placeholder="You are a..."
                            required
                        />
                    </div>
                    {error && <div className="text-red-400 text-sm">{error}</div>}
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-sm font-medium transition-colors">
                            Cancel
                        </button>
                        <button type="submit" disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                            {loading ? 'Creating...' : 'Create Persona'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
