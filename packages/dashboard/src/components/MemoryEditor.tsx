import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { Save, Loader2, XCircle } from 'lucide-react';
import { useApiQuery, useApiMutation } from '../hooks/useApi';

interface MemoryEditorProps {
    groupFolder: string;
}

interface PromptData {
    content: string;
    mtime: number;
}

export function MemoryEditor({ groupFolder }: MemoryEditorProps) {
    const [content, setContent] = useState('');
    const [isDirty, setIsDirty] = useState(false);

    // Fetch memory
    const { data, isLoading, refetch } = useApiQuery<PromptData>(`/api/prompt/${groupFolder}`);

    // Save mutation
    const { mutate: savePrompt, isLoading: isSaving, error: saveError } = useApiMutation<{ mtime: number }, { content: string, expectedMtime: number }>(
        `/api/prompt/${groupFolder}`,
        'PUT'
    );

    // Sync content when data loads
    useEffect(() => {
        if (data) {
            setContent(data.content);
            setIsDirty(false);
        }
    }, [data]);

    const handleSave = async () => {
        if (!data) return;

        const result = await savePrompt({
            content,
            expectedMtime: data.mtime
        });

        if (result) {
            // Success: refresh data to get new mtime
            await refetch();
            setIsDirty(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full text-slate-500 gap-2">
                <Loader2 className="animate-spin" /> Loading memory...
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-950 rounded-xl border border-slate-800 shadow-xl overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50">
                <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-slate-400">GEMINI.md</span>
                    {isDirty && <span className="w-2 h-2 rounded-full bg-yellow-500" title="Unsaved changes" />}
                </div>

                <div className="flex items-center gap-2">
                    {saveError && (
                        <span className="text-red-400 text-xs flex items-center gap-1">
                            <XCircle size={14} /> Failed to save
                        </span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={!isDirty || isSaving}
                        className={`
               flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
               ${isDirty
                                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed'}
             `}
                    >
                        {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                        {isSaving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>

            {/* Editor */}
            <div className="flex-1">
                <Editor
                    height="100%"
                    defaultLanguage="markdown"
                    theme="vs-dark"
                    value={content}
                    onChange={(value) => {
                        setContent(value || '');
                        setIsDirty(true);
                    }}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        wordWrap: 'on',
                        padding: { top: 16, bottom: 16 }
                    }}
                />
            </div>
        </div>
    );
}
