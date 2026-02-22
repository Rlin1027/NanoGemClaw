import { useToast } from '../hooks/useToast';
import { X, AlertCircle, CheckCircle, Info } from 'lucide-react';
import { cn } from '../lib/utils';

const ICONS = {
    error: AlertCircle,
    success: CheckCircle,
    info: Info,
};

const STYLES = {
    error: 'bg-red-500/10 border-red-500/30 text-red-400',
    success: 'bg-green-500/10 border-green-500/30 text-green-400',
    info: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
};

export function ToastContainer() {
    const { toasts, dismiss } = useToast();
    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
            {toasts.map(toast => {
                const Icon = ICONS[toast.type];
                return (
                    <div
                        key={toast.id}
                        className={cn(
                            'flex items-start gap-3 p-4 rounded-lg border shadow-lg animate-in slide-in-from-right',
                            STYLES[toast.type]
                        )}
                    >
                        <Icon size={18} className="mt-0.5 shrink-0" />
                        <p className="text-sm flex-1">{toast.message}</p>
                        <button onClick={() => dismiss(toast.id)} className="shrink-0 opacity-60 hover:opacity-100">
                            <X size={14} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
