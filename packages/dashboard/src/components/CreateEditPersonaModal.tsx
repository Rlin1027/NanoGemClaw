import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronDown, ChevronUp, Eye, Code } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCreatePersona, type PersonaWithMeta, type PersonaCategory, type CreatePersonaPayload } from '../hooks/usePersonas';

const CATEGORIES: Array<{ value: PersonaCategory; label: string }> = [
    { value: 'general', label: 'General' },
    { value: 'technical', label: 'Technical' },
    { value: 'productivity', label: 'Productivity' },
    { value: 'creative', label: 'Creative' },
    { value: 'learning', label: 'Learning' },
    { value: 'finance', label: 'Finance' },
    { value: 'lifestyle', label: 'Lifestyle' },
];

const PROMPT_GUIDE_TIPS = [
    'Start with "You are a..." to define the role clearly.',
    'Specify the tone: formal, casual, concise, detailed.',
    'List what the persona should focus on or avoid.',
    'Add examples of expected input/output if helpful.',
    'Keep it focused — shorter prompts are often more effective.',
];

interface CreateEditPersonaModalProps {
    /** When provided, the modal is in edit mode */
    editKey?: string;
    editPersona?: PersonaWithMeta;
    /** Available personas for "Start from template" dropdown */
    templates?: Record<string, PersonaWithMeta>;
    onClose: () => void;
    onSaved: () => void;
}

interface FormState {
    key: string;
    name: string;
    description: string;
    systemPrompt: string;
    category: PersonaCategory | '';
}

export function CreateEditPersonaModal({
    editKey,
    editPersona,
    templates,
    onClose,
    onSaved,
}: CreateEditPersonaModalProps) {
    const { t } = useTranslation('groups');
    const isEdit = !!editKey;

    const [form, setForm] = useState<FormState>({
        key: editKey ?? '',
        name: editPersona?.name ?? '',
        description: editPersona?.description ?? '',
        systemPrompt: editPersona?.systemPrompt ?? '',
        category: editPersona?.category ?? '',
    });
    const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
    const [showGuide, setShowGuide] = useState(false);
    const [templateKey, setTemplateKey] = useState('');
    const [error, setError] = useState<string | null>(null);

    const { mutate: createPersona, isLoading } = useCreatePersona();

    // When a template is selected, populate the form (except key)
    useEffect(() => {
        if (!templateKey || !templates) return;
        const tpl = templates[templateKey];
        if (!tpl) return;
        setForm(f => ({
            ...f,
            name: f.name || tpl.name,
            description: f.description || tpl.description,
            systemPrompt: tpl.systemPrompt,
            category: f.category || tpl.category || '',
        }));
        setTemplateKey('');
    }, [templateKey, templates]);

    const set = (field: keyof FormState) => (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ) => setForm(f => ({ ...f, [field]: e.target.value }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!form.key || !form.name || !form.systemPrompt) {
            setError('Key, name, and system prompt are required.');
            return;
        }
        if (!/^[a-z][a-z0-9_-]*$/.test(form.key)) {
            setError('Key must start with a lowercase letter and contain only a-z, 0-9, _, -');
            return;
        }

        const payload: CreatePersonaPayload = {
            key: form.key,
            name: form.name,
            description: form.description || form.name,
            systemPrompt: form.systemPrompt,
            ...(form.category ? { category: form.category as PersonaCategory } : {}),
        };

        const result = await createPersona(payload);
        if (result) {
            onSaved();
        } else {
            setError('Failed to save persona. The key may already exist.');
        }
    };

    const charCount = form.systemPrompt.length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl mx-4 shadow-2xl flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
                    <h2 className="text-lg font-bold text-slate-100">
                        {isEdit ? t('editPersona', 'Edit Persona') : t('createPersona', 'Create Persona')}
                    </h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
                        <X size={20} />
                    </button>
                </div>

                {/* Tab Bar */}
                <div className="flex border-b border-slate-800 flex-shrink-0">
                    <button
                        onClick={() => setActiveTab('edit')}
                        className={cn(
                            'flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors',
                            activeTab === 'edit'
                                ? 'border-blue-500 text-blue-400'
                                : 'border-transparent text-slate-500 hover:text-slate-300'
                        )}
                    >
                        <Code size={14} /> Edit
                    </button>
                    <button
                        onClick={() => setActiveTab('preview')}
                        className={cn(
                            'flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors',
                            activeTab === 'preview'
                                ? 'border-blue-500 text-blue-400'
                                : 'border-transparent text-slate-500 hover:text-slate-300'
                        )}
                    >
                        <Eye size={14} /> Preview
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                        {activeTab === 'edit' ? (
                            <>
                                {/* Start from template */}
                                {templates && Object.keys(templates).length > 0 && (
                                    <div>
                                        <label className="text-xs text-slate-500 block mb-1 uppercase tracking-wider">
                                            Start from template
                                        </label>
                                        <select
                                            value={templateKey}
                                            onChange={e => setTemplateKey(e.target.value)}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                        >
                                            <option value="">— select a template —</option>
                                            {Object.entries(templates).map(([k, p]) => (
                                                <option key={k} value={k}>{p.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {/* Key */}
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1 uppercase tracking-wider">
                                        Key <span className="text-red-400">*</span>
                                    </label>
                                    <input
                                        value={form.key}
                                        onChange={set('key')}
                                        disabled={isEdit}
                                        placeholder="my-persona"
                                        className={cn(
                                            "w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50",
                                            isEdit && "opacity-50 cursor-not-allowed"
                                        )}
                                    />
                                    <p className="text-xs text-slate-600 mt-1">Lowercase letters, digits, hyphens, underscores. Cannot be changed after creation.</p>
                                </div>

                                {/* Name */}
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1 uppercase tracking-wider">
                                        Name <span className="text-red-400">*</span>
                                    </label>
                                    <input
                                        value={form.name}
                                        onChange={set('name')}
                                        placeholder="My Custom Persona"
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                    />
                                </div>

                                {/* Category */}
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1 uppercase tracking-wider">Category</label>
                                    <select
                                        value={form.category}
                                        onChange={set('category')}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                    >
                                        <option value="">— none —</option>
                                        {CATEGORIES.map(c => (
                                            <option key={c.value} value={c.value}>{c.label}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1 uppercase tracking-wider">Description</label>
                                    <input
                                        value={form.description}
                                        onChange={set('description')}
                                        placeholder="Brief description of this persona"
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                    />
                                </div>

                                {/* System Prompt */}
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-xs text-slate-500 uppercase tracking-wider">
                                            System Prompt <span className="text-red-400">*</span>
                                        </label>
                                        <span className={cn(
                                            'text-xs tabular-nums',
                                            charCount > 2000 ? 'text-amber-400' : 'text-slate-600'
                                        )}>
                                            {charCount} chars
                                        </span>
                                    </div>
                                    <textarea
                                        value={form.systemPrompt}
                                        onChange={set('systemPrompt')}
                                        rows={14}
                                        placeholder="You are a..."
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-mono leading-relaxed"
                                    />
                                </div>

                                {/* Prompt Writing Guide */}
                                <div className="border border-slate-800 rounded-lg overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => setShowGuide(g => !g)}
                                        className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
                                    >
                                        <span className="font-medium">Prompt Writing Guide</span>
                                        {showGuide ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                    </button>
                                    {showGuide && (
                                        <div className="px-4 pb-4 bg-slate-950/50">
                                            <ul className="space-y-1.5 mt-2">
                                                {PROMPT_GUIDE_TIPS.map((tip, i) => (
                                                    <li key={i} className="flex gap-2 text-xs text-slate-400">
                                                        <span className="text-blue-500 flex-shrink-0">•</span>
                                                        {tip}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            /* Preview Tab */
                            <div className="space-y-4">
                                <div>
                                    <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Name</div>
                                    <div className="text-slate-100 font-semibold">{form.name || '—'}</div>
                                </div>
                                {form.category && (
                                    <div>
                                        <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Category</div>
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                            {form.category}
                                        </span>
                                    </div>
                                )}
                                {form.description && (
                                    <div>
                                        <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Description</div>
                                        <div className="text-sm text-slate-300">{form.description}</div>
                                    </div>
                                )}
                                <div>
                                    <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">System Prompt</div>
                                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-sm text-slate-300 font-mono whitespace-pre-wrap leading-relaxed min-h-32">
                                        {form.systemPrompt || <span className="text-slate-600 italic">No prompt entered yet</span>}
                                    </div>
                                </div>
                            </div>
                        )}

                        {error && (
                            <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                                {error}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex gap-3 px-6 py-4 border-t border-slate-800 flex-shrink-0">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                            {isLoading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Persona'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
