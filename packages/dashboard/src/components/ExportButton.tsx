import { useState } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { showToast } from '../hooks/useToast';

const API_BASE = import.meta.env.VITE_API_URL || window.location.origin;

export function ExportButton({ groupFolder }: { groupFolder: string }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleExport = async (format: 'json' | 'markdown') => {
        setLoading(true);
        setOpen(false);
        try {
            const accessCode = localStorage.getItem('nanogemclaw_access_code') || '';
            const res = await fetch(`${API_BASE}/api/groups/${encodeURIComponent(groupFolder)}/export?format=${format}`, {
                headers: { 'x-access-code': accessCode },
            });
            if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);

            const ext = format === 'markdown' ? 'md' : 'json';
            const contentType = format === 'markdown' ? 'text/markdown' : 'application/json';

            let blob: Blob;
            if (format === 'markdown') {
                const text = await res.text();
                blob = new Blob([text], { type: contentType });
            } else {
                const json = await res.json();
                blob = new Blob([JSON.stringify(json.data ?? json, null, 2)], { type: contentType });
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${groupFolder}-export.${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showToast(`Exported as ${format}`, 'success');
        } catch {
            showToast('Export failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(!open)}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors border border-slate-700 disabled:opacity-50"
            >
                <Download size={14} />
                {loading ? 'Exporting...' : 'Export'}
                <ChevronDown size={12} />
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden min-w-[140px]">
                        <button
                            onClick={() => handleExport('json')}
                            className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                        >
                            JSON
                        </button>
                        <button
                            onClick={() => handleExport('markdown')}
                            className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                        >
                            Markdown
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
