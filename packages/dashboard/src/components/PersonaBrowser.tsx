import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, Eye, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersonas, type PersonaWithMeta, type PersonaCategory } from '../hooks/usePersonas';

const CATEGORIES: Array<{ key: PersonaCategory | 'all'; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'general', label: 'General' },
    { key: 'technical', label: 'Technical' },
    { key: 'productivity', label: 'Productivity' },
    { key: 'creative', label: 'Creative' },
    { key: 'learning', label: 'Learning' },
    { key: 'finance', label: 'Finance' },
    { key: 'lifestyle', label: 'Lifestyle' },
];

const CATEGORY_COLORS: Record<PersonaCategory, string> = {
    general: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    technical: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    productivity: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    creative: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
    learning: 'bg-green-500/20 text-green-300 border-green-500/30',
    finance: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    lifestyle: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
};

interface PersonaBrowserProps {
    selectedKey?: string;
    onSelect: (key: string) => void;
    onCreateNew: () => void;
    onEdit?: (key: string, persona: PersonaWithMeta) => void;
    disabled?: boolean;
}

export function PersonaBrowser({ selectedKey, onSelect, onCreateNew, onEdit, disabled }: PersonaBrowserProps) {
    const { t } = useTranslation('groups');
    const { data: personas, loading, error } = usePersonas();
    const [activeCategory, setActiveCategory] = useState<PersonaCategory | 'all'>('all');
    const [search, setSearch] = useState('');
    const [previewKey, setPreviewKey] = useState<string | null>(null);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-10 text-slate-500 text-sm">
                {t('loading')}
            </div>
        );
    }

    if (error || !personas) {
        return (
            <div className="flex items-center justify-center py-10 text-red-400 text-sm">
                {t('failedToLoad', 'Failed to load personas')}
            </div>
        );
    }

    const entries = Object.entries(personas);

    const filtered = entries.filter(([_key, p]) => {
        const matchesCategory = activeCategory === 'all' || p.category === activeCategory;
        const matchesSearch =
            !search ||
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.description.toLowerCase().includes(search.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    const previewPersona = previewKey ? { key: previewKey, persona: personas[previewKey] } : null;

    return (
        <div className="space-y-3">
            {/* Search + Create */}
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={t('searchPersonas', 'Search personas...')}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                    {search && (
                        <button
                            onClick={() => setSearch('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                        >
                            <X size={12} />
                        </button>
                    )}
                </div>
                <button
                    onClick={onCreateNew}
                    disabled={disabled}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                >
                    + {t('createPersona', 'Create')}
                </button>
            </div>

            {/* Category Tabs */}
            <div className="flex gap-1.5 flex-wrap">
                {CATEGORIES.map(cat => (
                    <button
                        key={cat.key}
                        onClick={() => setActiveCategory(cat.key)}
                        className={cn(
                            'px-3 py-1 rounded-full text-xs font-medium transition-colors border',
                            activeCategory === cat.key
                                ? 'bg-blue-600 text-white border-blue-500'
                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                        )}
                    >
                        {cat.label}
                    </button>
                ))}
            </div>

            {/* Card Grid */}
            {filtered.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                    {t('noPersonasFound', 'No personas found')}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filtered.map(([key, persona]) => (
                        <PersonaCard
                            key={key}
                            personaKey={key}
                            persona={persona}
                            isSelected={selectedKey === key}
                            onPreview={() => setPreviewKey(key)}
                            onApply={() => { onSelect(key); }}
                            onEdit={onEdit ? () => onEdit(key, persona) : undefined}
                            disabled={disabled}
                        />
                    ))}
                </div>
            )}

            {/* Preview Modal */}
            {previewPersona && (
                <PersonaPreviewModal
                    personaKey={previewPersona.key}
                    persona={previewPersona.persona}
                    isSelected={selectedKey === previewPersona.key}
                    onApply={() => { onSelect(previewPersona.key); setPreviewKey(null); }}
                    onUseAsTemplate={() => { onCreateNew(); setPreviewKey(null); }}
                    onClose={() => setPreviewKey(null)}
                />
            )}
        </div>
    );
}

interface PersonaCardProps {
    personaKey?: string;
    persona: PersonaWithMeta;
    isSelected: boolean;
    onPreview: () => void;
    onApply: () => void;
    onEdit?: () => void;
    disabled?: boolean;
}

function PersonaCard({ persona, isSelected, onPreview, onApply, onEdit, disabled }: PersonaCardProps) {
    return (
        <div
            className={cn(
                'relative p-4 rounded-xl border transition-all bg-slate-900/60 hover:bg-slate-900/80',
                isSelected
                    ? 'ring-2 ring-blue-500 border-blue-500/50'
                    : 'border-slate-800 hover:border-slate-700'
            )}
        >
            {/* Selected indicator */}
            {isSelected && (
                <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
                    <Check size={12} className="text-white" />
                </div>
            )}

            <div className="space-y-2 pr-6">
                {/* Category Badge */}
                {persona.category && (
                    <span className={cn(
                        'inline-block text-xs px-2 py-0.5 rounded-full border font-medium',
                        CATEGORY_COLORS[persona.category]
                    )}>
                        {persona.category}
                    </span>
                )}

                {/* Name */}
                <div className="text-sm font-semibold text-slate-100">{persona.name}</div>

                {/* Description */}
                <div className="text-xs text-slate-400 line-clamp-2">{persona.description}</div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-3">
                <button
                    onClick={onPreview}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                >
                    <Eye size={12} /> Preview
                </button>
                <button
                    onClick={onApply}
                    disabled={disabled || isSelected}
                    className={cn(
                        'flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition-colors font-medium',
                        isSelected
                            ? 'bg-blue-600/30 text-blue-400 cursor-default'
                            : 'bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50'
                    )}
                >
                    {isSelected ? 'Active' : 'Apply'}
                </button>
                {onEdit && !persona.builtIn && (
                    <button
                        onClick={onEdit}
                        disabled={disabled}
                        className="ml-auto px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-md transition-colors"
                    >
                        Edit
                    </button>
                )}
            </div>
        </div>
    );
}

interface PersonaPreviewModalProps {
    personaKey?: string;
    persona: PersonaWithMeta;
    isSelected: boolean;
    onApply: () => void;
    onUseAsTemplate: () => void;
    onClose: () => void;
}

function PersonaPreviewModal({ persona, isSelected, onApply, onUseAsTemplate, onClose }: PersonaPreviewModalProps) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg mx-4 shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between p-5 border-b border-slate-800">
                    <div className="space-y-1">
                        {persona.category && (
                            <span className={cn(
                                'inline-block text-xs px-2 py-0.5 rounded-full border font-medium',
                                CATEGORY_COLORS[persona.category]
                            )}>
                                {persona.category}
                            </span>
                        )}
                        <h2 className="text-lg font-bold text-slate-100">{persona.name}</h2>
                        <p className="text-sm text-slate-400">{persona.description}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-300 ml-4 mt-0.5">
                        <X size={20} />
                    </button>
                </div>

                {/* Prompt */}
                <div className="p-5">
                    <div className="text-xs text-slate-500 mb-2 uppercase tracking-wider font-medium">System Prompt</div>
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-sm text-slate-300 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
                        {persona.systemPrompt}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 px-5 pb-5">
                    <button
                        onClick={onUseAsTemplate}
                        className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
                    >
                        Use as Template
                    </button>
                    <button
                        onClick={onApply}
                        disabled={isSelected}
                        className={cn(
                            'flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                            isSelected
                                ? 'bg-blue-600/30 text-blue-400 cursor-default'
                                : 'bg-blue-600 hover:bg-blue-500 text-white'
                        )}
                    >
                        {isSelected ? 'Already Active' : 'Apply Persona'}
                    </button>
                </div>
            </div>
        </div>
    );
}
