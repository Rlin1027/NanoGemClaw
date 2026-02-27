import { useState, useEffect, useRef, useCallback } from 'react';
import {
    HardDrive, Search, ExternalLink, FileText, FileImage, FileVideo, FileAudio,
    File, RefreshCw, Trash2, Database, FolderSearch, Plus, X, Loader2,
    ChevronRight, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApiQuery, useApiMutation, apiFetch } from '../hooks/useApi';
import { showToast } from '../hooks/useToast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    size?: number;
    webViewLink?: string;
}

interface RAGConfig {
    knowledgeFolderIds: string[];
    scanIntervalMinutes: number;
    similarityThreshold: number;
    maxChunkChars: number;
    maxResults: number;
}

interface IndexedFile {
    id: string;
    name: string;
    chunkCount: number;
    lastIndexed: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMimeIcon(mimeType: string) {
    if (mimeType.startsWith('image/')) return <FileImage size={16} className="text-purple-400" />;
    if (mimeType.startsWith('video/')) return <FileVideo size={16} className="text-pink-400" />;
    if (mimeType.startsWith('audio/')) return <FileAudio size={16} className="text-yellow-400" />;
    if (mimeType.includes('document') || mimeType.includes('text')) return <FileText size={16} className="text-blue-400" />;
    if (mimeType.includes('spreadsheet')) return <FileText size={16} className="text-green-400" />;
    if (mimeType.includes('presentation')) return <FileText size={16} className="text-orange-400" />;
    return <File size={16} className="text-slate-400" />;
}

function formatSize(bytes?: number): string {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
    });
}

// ─── File Preview Modal ───────────────────────────────────────────────────────

function FilePreviewModal({ file, onClose }: { file: DriveFile; onClose: () => void }) {
    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(false);
        apiFetch<string>(`/api/plugins/google-drive/files/${file.id}/content`)
            .then(data => { if (!cancelled) setContent(data); })
            .catch(() => { if (!cancelled) setError(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [file.id]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl mx-4 shadow-2xl flex flex-col max-h-[80vh]">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800 flex-shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        {getMimeIcon(file.mimeType)}
                        <span className="font-semibold text-slate-100 truncate">{file.name}</span>
                    </div>
                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                        {file.webViewLink && (
                            <a
                                href={file.webViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                            >
                                <ExternalLink size={12} /> Open in Drive
                            </a>
                        )}
                        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                </div>
                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4">
                    {loading && (
                        <div className="flex items-center justify-center py-12 text-slate-500 gap-2">
                            <Loader2 size={18} className="animate-spin" /> Loading content...
                        </div>
                    )}
                    {error && (
                        <div className="flex items-center justify-center py-12 text-slate-500 gap-2">
                            <AlertCircle size={18} /> Could not load file content.
                        </div>
                    )}
                    {!loading && !error && content != null && (
                        <pre className="text-sm text-slate-300 font-mono whitespace-pre-wrap break-words">
                            {content}
                        </pre>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Drive File Browser ───────────────────────────────────────────────────────

function DriveFileBrowser({ isAuthenticated }: { isAuthenticated: boolean }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [page, setPage] = useState(0);
    const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const PAGE_SIZE = 20;

    // Debounce search input
    const handleSearchChange = useCallback((val: string) => {
        setSearchQuery(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setDebouncedQuery(val);
            setPage(0);
        }, 400);
    }, []);

    const isSearching = debouncedQuery.trim().length >= 2;

    const { data: recentData, isLoading: loadingRecent, refetch: refetchRecent } =
        useApiQuery<DriveFile[]>(`/api/plugins/google-drive/files/recent?maxResults=${PAGE_SIZE + page * PAGE_SIZE}`);

    const [searchResults, setSearchResults] = useState<DriveFile[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);

    useEffect(() => {
        if (!isSearching) { setSearchResults([]); return; }
        let cancelled = false;
        setSearchLoading(true);
        apiFetch<{ files: DriveFile[]; totalResults: number }>(
            `/api/plugins/google-drive/files/search?q=${encodeURIComponent(debouncedQuery)}`
        )
            .then(d => { if (!cancelled) setSearchResults(d.files); })
            .catch(() => { if (!cancelled) setSearchResults([]); })
            .finally(() => { if (!cancelled) setSearchLoading(false); });
        return () => { cancelled = true; };
    }, [debouncedQuery, isSearching]);

    const files = isSearching ? searchResults : (recentData ?? []);
    const loading = isSearching ? searchLoading : loadingRecent;

    if (!isAuthenticated) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-3 bg-slate-900/30 rounded-xl border-2 border-dashed border-slate-800">
                <HardDrive size={32} className="text-slate-600" />
                <p className="text-sm font-medium">Google account not connected</p>
                <p className="text-xs text-slate-600">Go to Settings to connect your Google account.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-md">
                    {(loading && isSearching) ? (
                        <Loader2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400 animate-spin" />
                    ) : (
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    )}
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => handleSearchChange(e.target.value)}
                        placeholder="Search Drive files..."
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                </div>
                {!isSearching && (
                    <button
                        onClick={() => refetchRecent()}
                        className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition-colors"
                    >
                        <RefreshCw size={14} /> Refresh
                    </button>
                )}
            </div>

            {/* File List */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-x-4 px-4 py-2 border-b border-slate-800 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <span />
                    <span>Name</span>
                    <span className="text-right">Modified</span>
                    <span className="text-right">Size</span>
                    <span />
                </div>

                {loading && files.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-slate-500 gap-2">
                        <Loader2 size={18} className="animate-spin" /> Loading files...
                    </div>
                ) : files.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
                        {isSearching ? 'No files match your search.' : 'No recent files.'}
                    </div>
                ) : (
                    <div className="divide-y divide-slate-800/60">
                        {files.map(file => (
                            <div
                                key={file.id}
                                className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-x-4 px-4 py-2.5 hover:bg-slate-800/40 transition-colors group"
                            >
                                <span className="flex-shrink-0">{getMimeIcon(file.mimeType)}</span>
                                <button
                                    onClick={() => setPreviewFile(file)}
                                    className="text-sm text-slate-200 hover:text-blue-400 truncate text-left transition-colors"
                                >
                                    {file.name}
                                </button>
                                <span className="text-xs text-slate-500 text-right whitespace-nowrap">
                                    {formatDate(file.modifiedTime)}
                                </span>
                                <span className="text-xs text-slate-500 text-right whitespace-nowrap">
                                    {formatSize(file.size)}
                                </span>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {file.webViewLink && (
                                        <a
                                            href={file.webViewLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-1 text-slate-500 hover:text-blue-400 transition-colors"
                                            title="Open in Drive"
                                        >
                                            <ExternalLink size={13} />
                                        </a>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Pagination — only in recent mode */}
            {!isSearching && (recentData?.length ?? 0) >= PAGE_SIZE + page * PAGE_SIZE && (
                <div className="flex justify-center">
                    <button
                        onClick={() => setPage(p => p + 1)}
                        className="flex items-center gap-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition-colors"
                    >
                        <ChevronRight size={14} /> Load more
                    </button>
                </div>
            )}

            {previewFile && (
                <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
            )}
        </div>
    );
}

// ─── RAG Panel ────────────────────────────────────────────────────────────────

function KnowledgeRAGPanel({ isAuthenticated }: { isAuthenticated: boolean }) {
    const { data: config, refetch: refetchConfig } = useApiQuery<RAGConfig>('/api/plugins/drive-knowledge-rag/config');
    const { data: indexedFiles, isLoading: loadingFiles, refetch: refetchFiles } =
        useApiQuery<IndexedFile[]>('/api/plugins/drive-knowledge-rag/indexed-files');
    const { mutate: updateConfig, isLoading: savingConfig } =
        useApiMutation<any, Partial<RAGConfig>>('/api/plugins/drive-knowledge-rag/config', 'PUT');

    const [folderIds, setFolderIds] = useState<string[]>([]);
    const [scanInterval, setScanInterval] = useState(60);
    const [newFolderId, setNewFolderId] = useState('');
    const [reindexing, setReindexing] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (config) {
            setFolderIds(config.knowledgeFolderIds ?? []);
            setScanInterval(config.scanIntervalMinutes ?? 60);
            setDirty(false);
        }
    }, [config]);

    const addFolder = () => {
        const trimmed = newFolderId.trim();
        if (!trimmed || folderIds.includes(trimmed)) return;
        setFolderIds(prev => [...prev, trimmed]);
        setNewFolderId('');
        setDirty(true);
    };

    const removeFolder = (id: string) => {
        setFolderIds(prev => prev.filter(f => f !== id));
        setDirty(true);
    };

    const handleSave = async () => {
        await updateConfig({ knowledgeFolderIds: folderIds, scanIntervalMinutes: scanInterval });
        await refetchConfig();
        setDirty(false);
        showToast('RAG configuration saved', 'success');
    };

    const handleReindex = async () => {
        setReindexing(true);
        try {
            await apiFetch('/api/plugins/drive-knowledge-rag/reindex', { method: 'POST' });
            showToast('Reindex started', 'success');
            setTimeout(() => refetchFiles(), 2000);
        } catch {
            showToast('Failed to start reindex');
        } finally {
            setReindexing(false);
        }
    };

    const handleClearIndex = async () => {
        if (!confirm('Clear all indexed data? This cannot be undone.')) return;
        setClearing(true);
        try {
            await apiFetch('/api/plugins/drive-knowledge-rag/index', { method: 'DELETE' });
            showToast('Index cleared', 'success');
            await refetchFiles();
        } catch {
            showToast('Failed to clear index');
        } finally {
            setClearing(false);
        }
    };

    if (!isAuthenticated) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-3 bg-slate-900/30 rounded-xl border-2 border-dashed border-slate-800">
                <Database size={32} className="text-slate-600" />
                <p className="text-sm font-medium">Google account not connected</p>
                <p className="text-xs text-slate-600">Go to Settings to connect your Google account.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Config */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <FolderSearch size={16} className="text-blue-400" /> Knowledge Folders
                </h3>

                {/* Folder list */}
                <div className="space-y-2">
                    {folderIds.length === 0 && (
                        <p className="text-xs text-slate-500 italic">No folders configured. Add a Drive folder ID below.</p>
                    )}
                    {folderIds.map(id => (
                        <div key={id} className="flex items-center justify-between bg-slate-800 rounded-lg px-3 py-2 gap-2">
                            <span className="text-xs text-slate-300 font-mono truncate">{id}</span>
                            <button
                                onClick={() => removeFolder(id)}
                                className="text-slate-500 hover:text-red-400 flex-shrink-0 transition-colors"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ))}
                </div>

                {/* Add folder */}
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newFolderId}
                        onChange={e => setNewFolderId(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addFolder()}
                        placeholder="Google Drive folder ID..."
                        className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                    <button
                        onClick={addFolder}
                        disabled={!newFolderId.trim()}
                        className="flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors disabled:opacity-40"
                    >
                        <Plus size={14} /> Add
                    </button>
                </div>

                {/* Scan interval */}
                <div className="flex items-center gap-4">
                    <label className="text-sm text-slate-400 min-w-max">Scan interval</label>
                    <input
                        type="number"
                        min={5}
                        max={1440}
                        value={scanInterval}
                        onChange={e => { setScanInterval(Number(e.target.value)); setDirty(true); }}
                        className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                    <span className="text-sm text-slate-500">minutes</span>
                </div>

                {/* Save */}
                {dirty && (
                    <button
                        onClick={handleSave}
                        disabled={savingConfig}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        {savingConfig ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                        Save Configuration
                    </button>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
                <button
                    onClick={handleReindex}
                    disabled={reindexing}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                    {reindexing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Reindex Now
                </button>
                <button
                    onClick={handleClearIndex}
                    disabled={clearing}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                    {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Clear Index
                </button>
            </div>

            {/* Indexed Files */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                    <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                        <Database size={14} className="text-purple-400" />
                        Indexed Files
                        {indexedFiles && (
                            <span className="text-xs font-normal text-slate-500 normal-case tracking-normal ml-1">
                                ({indexedFiles.length})
                            </span>
                        )}
                    </h3>
                    <button onClick={() => refetchFiles()} className="text-slate-500 hover:text-slate-300 transition-colors">
                        <RefreshCw size={14} />
                    </button>
                </div>

                {loadingFiles ? (
                    <div className="flex items-center justify-center py-10 text-slate-500 gap-2">
                        <Loader2 size={16} className="animate-spin" /> Loading...
                    </div>
                ) : !indexedFiles || indexedFiles.length === 0 ? (
                    <div className="text-center py-10 text-slate-500 text-sm">
                        No files indexed yet. Add folders and click "Reindex Now".
                    </div>
                ) : (
                    <div className="divide-y divide-slate-800/60">
                        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            <span>File</span>
                            <span className="text-right">Chunks</span>
                            <span className="text-right">Last Indexed</span>
                        </div>
                        {indexedFiles.map(file => (
                            <div key={file.id} className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2.5 items-center hover:bg-slate-800/30 transition-colors">
                                <span className="text-sm text-slate-200 truncate flex items-center gap-2">
                                    <FileText size={14} className="text-slate-500 flex-shrink-0" />
                                    {file.name}
                                </span>
                                <span className="text-xs text-slate-400 text-right font-mono">
                                    {file.chunkCount}
                                </span>
                                <span className="text-xs text-slate-500 text-right whitespace-nowrap">
                                    {formatDate(file.lastIndexed)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type DriveTab = 'files' | 'rag';

export function DrivePage() {
    const [activeTab, setActiveTab] = useState<DriveTab>('files');

    const { data: googleAuth } = useApiQuery<{ authenticated: boolean; hasCredentials: boolean }>(
        '/api/plugins/google-auth/status'
    );

    const isAuthenticated = googleAuth?.authenticated ?? false;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <HardDrive size={24} className="text-blue-400" />
                        Google Drive
                    </h2>
                    <p className="text-slate-400 text-sm mt-1">
                        Browse files and manage RAG knowledge index
                    </p>
                </div>
            </div>

            {/* Auth warning banner */}
            {googleAuth && !isAuthenticated && (
                <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm">
                    <AlertCircle size={16} className="flex-shrink-0" />
                    Google account not connected. Go to{' '}
                    <span className="font-semibold underline cursor-default">Settings → Google Account</span>
                    {' '}to connect.
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit">
                {([
                    { id: 'files', label: 'File Browser', icon: <HardDrive size={14} /> },
                    { id: 'rag', label: 'Knowledge RAG', icon: <Database size={14} /> },
                ] as { id: DriveTab; label: string; icon: React.ReactNode }[]).map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                            activeTab === tab.id
                                ? 'bg-blue-600 text-white shadow'
                                : 'text-slate-400 hover:text-slate-200'
                        )}
                    >
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            {activeTab === 'files' && <DriveFileBrowser isAuthenticated={isAuthenticated} />}
            {activeTab === 'rag' && <KnowledgeRAGPanel isAuthenticated={isAuthenticated} />}
        </div>
    );
}
