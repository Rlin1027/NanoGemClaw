import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { useSearch, type SearchResult } from '../hooks/useSearch';
import { useSocket } from '../hooks/useSocket';

interface SearchOverlayProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SearchOverlay({ isOpen, onClose }: SearchOverlayProps) {
    const { groups } = useSocket();
    const { search, results, total, isLoading, clear } = useSearch();
    const [query, setQuery] = useState('');
    const [groupFilter, setGroupFilter] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 50);
            setQuery('');
            setGroupFilter('');
            setSelectedIndex(0);
            clear();
        }
    }, [isOpen, clear]);

    // Debounced search
    const handleQueryChange = useCallback((value: string) => {
        setQuery(value);
        setSelectedIndex(0);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            if (value.trim().length >= 2) {
                search(value, groupFilter || undefined);
            } else {
                clear();
            }
        }, 300);
    }, [search, clear, groupFilter]);

    // Re-search when group filter changes
    useEffect(() => {
        if (query.trim().length >= 2) {
            search(query, groupFilter || undefined);
        }
    }, [groupFilter]); // eslint-disable-line react-hooks/exhaustive-deps

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            onClose();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(i => Math.min(i + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(i => Math.max(i - 1, 0));
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Search Panel */}
            <div
                className="relative w-full max-w-2xl mx-4 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/50 overflow-hidden"
                onKeyDown={handleKeyDown}
            >
                {/* Search Input */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
                    {isLoading ? (
                        <Loader2 size={18} className="text-blue-400 animate-spin flex-shrink-0" />
                    ) : (
                        <Search size={18} className="text-slate-500 flex-shrink-0" />
                    )}
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => handleQueryChange(e.target.value)}
                        placeholder="Search messages..."
                        className="flex-1 bg-transparent text-slate-200 text-sm placeholder:text-slate-500 focus:outline-none"
                    />
                    {query && (
                        <button onClick={() => handleQueryChange('')} className="text-slate-500 hover:text-slate-300">
                            <X size={16} />
                        </button>
                    )}
                </div>

                {/* Group Filter */}
                {groups.length > 1 && (
                    <div className="px-4 py-2 border-b border-slate-800/50 flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">Group:</span>
                        <select
                            value={groupFilter}
                            onChange={e => setGroupFilter(e.target.value)}
                            className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-300 focus:outline-none"
                        >
                            <option value="">All groups</option>
                            {groups.map(g => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Results */}
                <div className="max-h-[50vh] overflow-y-auto">
                    {query.length < 2 ? (
                        <div className="px-4 py-8 text-center text-slate-500 text-sm">
                            Type at least 2 characters to search
                        </div>
                    ) : results.length === 0 && !isLoading ? (
                        <div className="px-4 py-8 text-center text-slate-500 text-sm">
                            No results found for &quot;{query}&quot;
                        </div>
                    ) : (
                        results.map((result, index) => (
                            <SearchResultItem
                                key={result.id}
                                result={result}
                                isSelected={index === selectedIndex}
                            />
                        ))
                    )}
                </div>

                {/* Footer */}
                {results.length > 0 && (
                    <div className="px-4 py-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500">
                        <span>{total} result{total !== 1 ? 's' : ''}</span>
                        <div className="flex items-center gap-3">
                            <span><kbd className="px-1 py-0.5 bg-slate-800 rounded border border-slate-700">↑↓</kbd> navigate</span>
                            <span><kbd className="px-1 py-0.5 bg-slate-800 rounded border border-slate-700">esc</kbd> close</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function SearchResultItem({ result, isSelected }: { result: SearchResult; isSelected: boolean }) {
    const time = new Date(result.timestamp).toLocaleString();

    return (
        <div
            className={`px-4 py-3 border-b border-slate-800/50 transition-colors ${
                isSelected ? 'bg-slate-800/80' : 'hover:bg-slate-800/40'
            }`}
        >
            <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-slate-300">{result.sender}</span>
                <span className="text-[10px] text-slate-600">{time}</span>
                {result.chatJid && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded text-slate-500 border border-slate-700">
                        {result.chatJid.split('@')[0]}
                    </span>
                )}
            </div>
            <div
                className="text-sm text-slate-400 line-clamp-2 [&_mark]:bg-yellow-500/30 [&_mark]:text-yellow-200 [&_mark]:rounded-sm [&_mark]:px-0.5"
                dangerouslySetInnerHTML={{ __html: result.snippet || result.content }}
            />
        </div>
    );
}
