import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
    message?: string;
    className?: string;
}

export function LoadingSpinner({ message = 'Loading...', className = '' }: LoadingSpinnerProps) {
    return (
        <div className={`flex items-center justify-center gap-2 text-slate-500 py-20 ${className}`}>
            <Loader2 className="animate-spin" size={20} />
            <span>{message}</span>
        </div>
    );
}
