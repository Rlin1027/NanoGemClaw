import { useState, useEffect } from 'react';
import { FileText, Plus, Trash2, Save, Search, BookOpen, Edit, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSocket } from '../hooks/useSocket';
import { useKnowledgeEditor } from '../hooks/useKnowledgeEditor';
import { useKnowledgeSearch } from '../hooks/useKnowledge';
import { CreateDocumentModal } from '../components/knowledge/CreateDocumentModal';
import { DeleteConfirmModal } from '../components/knowledge/DeleteConfirmModal';

export function KnowledgePage() {
    const { groups } = useSocket();
    const [selectedGroupFolder, setSelectedGroupFolder] = useState<string>(groups[0]?.id || '');
    const [searchQuery, setSearchQuery] = useState('');

    const editor = useKnowledgeEditor(selectedGroupFolder);
    const ftsSearch = useKnowledgeSearch(selectedGroupFolder);

    const useFts = searchQuery.length >= 3;

    // Trigger FTS search when query changes
    useEffect(() => {
        ftsSearch.search(searchQuery);
    }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

    // Client-side filter for short queries, FTS results for 3+ chars
    const filteredDocs = useFts
        ? (editor.docs || []).filter(doc =>
            ftsSearch.results.some(r => r.id === doc.id)
        )
        : (editor.docs || []).filter(doc =>
            doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
        );

    const totalSize = (editor.docs || []).reduce((sum, doc) => sum + doc.size_chars, 0);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <BookOpen size={24} className="text-blue-400" />
                        Knowledge Base
                    </h2>
                    <p className="text-slate-400 text-sm mt-1">
                        {totalSize.toLocaleString()} chars across {(editor.docs || []).length} documents
                    </p>
                </div>
                <button
                    onClick={() => editor.setShowCreateModal(true)}
                    disabled={!selectedGroupFolder}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Plus size={16} /> New Document
                </button>
            </div>

            {/* Group Selector and Search */}
            <div className="flex gap-3">
                <select
                    value={selectedGroupFolder}
                    onChange={e => {
                        setSelectedGroupFolder(e.target.value);
                        editor.handleSelectDoc(null as any);
                    }}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
                >
                    <option value="">Select a group</option>
                    {groups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                </select>
                <div className="relative flex-1 max-w-md">
                    {ftsSearch.isSearching ? (
                        <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400 animate-spin" size={16} />
                    ) : (
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                    )}
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search documents... (3+ chars for full-text)"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                </div>
            </div>

            {/* Main Content */}
            {!selectedGroupFolder ? (
                <div className="flex items-center justify-center py-20 text-slate-500 bg-slate-900/30 rounded-xl border-2 border-dashed border-slate-800">
                    Select a group to view knowledge base
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-20rem)]">
                    {/* Document List */}
                    <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-y-auto">
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Documents</h3>
                        {editor.isLoading ? (
                            <div className="text-slate-500 text-center py-8 text-sm">Loading...</div>
                        ) : filteredDocs.length === 0 ? (
                            <div className="text-slate-500 text-center py-8 text-sm">
                                {searchQuery ? 'No matching documents' : 'No documents yet'}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {filteredDocs.map(doc => (
                                    <button
                                        key={doc.id}
                                        onClick={() => editor.handleSelectDoc(doc)}
                                        className={cn(
                                            'w-full text-left p-3 rounded-lg transition-all',
                                            editor.selectedDoc?.id === doc.id
                                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100'
                                        )}
                                    >
                                        <div className="flex items-start gap-2">
                                            <FileText size={16} className="mt-0.5 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-sm truncate">{doc.title}</div>
                                                <div className="text-xs opacity-70 mt-1 truncate">{doc.filename}</div>
                                                <div className="text-xs opacity-60 mt-1">
                                                    {doc.size_chars.toLocaleString()} chars
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Editor/Viewer */}
                    <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                        {!editor.selectedDoc ? (
                            <div className="flex-1 flex items-center justify-center text-slate-500">
                                Select a document to view or edit
                            </div>
                        ) : (
                            <>
                                {/* Document Header */}
                                <div className="border-b border-slate-800 p-4 flex items-center justify-between">
                                    <div className="flex-1 min-w-0">
                                        {editor.isEditing ? (
                                            <input
                                                type="text"
                                                value={editor.editTitle}
                                                onChange={e => editor.setEditTitle(e.target.value)}
                                                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                            />
                                        ) : (
                                            <>
                                                <h3 className="text-white font-semibold truncate">{editor.selectedDoc.title}</h3>
                                                <p className="text-slate-400 text-xs mt-1">{editor.selectedDoc.filename}</p>
                                            </>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 ml-4">
                                        {editor.isEditing ? (
                                            <>
                                                <button
                                                    onClick={editor.handleSave}
                                                    disabled={editor.updateMutation.isLoading}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                                                >
                                                    <Save size={14} /> Save
                                                </button>
                                                <button
                                                    onClick={editor.handleCancelEdit}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-medium transition-colors"
                                                >
                                                    <X size={14} /> Cancel
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => editor.setIsEditing(true)}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors"
                                                >
                                                    <Edit size={14} /> Edit
                                                </button>
                                                <button
                                                    onClick={() => editor.setShowDeleteConfirm(true)}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition-colors"
                                                >
                                                    <Trash2 size={14} /> Delete
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Content Area */}
                                <div className="flex-1 p-4 overflow-y-auto">
                                    {editor.isEditing ? (
                                        <textarea
                                            value={editor.editContent}
                                            onChange={e => editor.setEditContent(e.target.value)}
                                            className="w-full h-full bg-slate-950 border border-slate-800 rounded-lg p-4 text-slate-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                                            placeholder="Enter markdown content..."
                                        />
                                    ) : (
                                        <pre className="text-slate-300 text-sm font-mono whitespace-pre-wrap break-words">
                                            {editor.selectedDoc.content}
                                        </pre>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Create Modal */}
            {editor.showCreateModal && (
                <CreateDocumentModal
                    onClose={() => editor.setShowCreateModal(false)}
                    onCreate={editor.handleCreate}
                    isLoading={editor.createMutation.isLoading}
                />
            )}

            {/* Delete Confirmation */}
            {editor.showDeleteConfirm && editor.selectedDoc && (
                <DeleteConfirmModal
                    docTitle={editor.selectedDoc.title}
                    onClose={() => editor.setShowDeleteConfirm(false)}
                    onConfirm={editor.handleDelete}
                    isLoading={editor.deleteMutation.isLoading}
                />
            )}
        </div>
    );
}
