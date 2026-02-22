import { AlertCircle } from 'lucide-react';

interface DeleteConfirmModalProps {
    docTitle: string;
    onClose: () => void;
    onConfirm: () => void;
    isLoading: boolean;
}

export function DeleteConfirmModal({ docTitle, onClose, onConfirm, isLoading }: DeleteConfirmModalProps) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md m-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-start gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                        <AlertCircle size={20} className="text-red-500" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">Delete Document</h3>
                        <p className="text-slate-400 text-sm mt-1">
                            Are you sure you want to delete <span className="font-medium text-slate-300">{docTitle}</span>? This action cannot be undone.
                        </p>
                    </div>
                </div>
                <div className="flex gap-3 justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isLoading}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Deleting...' : 'Delete'}
                    </button>
                </div>
            </div>
        </div>
    );
}
