import { useState, useCallback } from 'react';
import { apiFetch } from './useApi';

export interface PromptData {
    content: string;
    mtime: number;
}

export interface MemorySummary {
    group_folder: string;
    summary: string;
    messages_archived: number;
    chars_archived: number;
    created_at: string;
    updated_at: string;
}

export function usePrompt(groupFolder: string | null) {
    const [content, setContent] = useState('');
    const [originalContent, setOriginalContent] = useState('');
    const [mtime, setMtime] = useState(0);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!groupFolder) return;
        setLoading(true);
        setError(null);
        try {
            const result = await apiFetch<PromptData>(`/api/prompt/${groupFolder}`);
            setContent(result.content);
            setOriginalContent(result.content);
            setMtime(result.mtime);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load prompt');
        } finally {
            setLoading(false);
        }
    }, [groupFolder]);

    const save = useCallback(async () => {
        if (!groupFolder) return;
        setSaving(true);
        setError(null);
        try {
            const result = await apiFetch<{ mtime: number }>(`/api/prompt/${groupFolder}`, {
                method: 'PUT',
                body: JSON.stringify({ content, expectedMtime: mtime }),
            });
            setMtime(result.mtime);
            setOriginalContent(content);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save prompt');
        } finally {
            setSaving(false);
        }
    }, [groupFolder, content, mtime]);

    const revert = useCallback(() => {
        setContent(originalContent);
    }, [originalContent]);

    const hasChanges = content !== originalContent;

    return { content, setContent, originalContent, mtime, loading, saving, error, hasChanges, load, save, revert };
}
