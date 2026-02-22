import { cn } from "@/lib/utils";

interface ToggleSwitchProps {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    label: string;
    description?: string;
    disabled?: boolean;
}

export function ToggleSwitch({ enabled, onChange, label, description, disabled }: ToggleSwitchProps) {
    return (
        <div className="flex flex-col justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-slate-200">{label}</div>
                <button
                    onClick={() => !disabled && onChange(!enabled)}
                    disabled={disabled}
                    className={cn(
                        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                        enabled ? "bg-blue-600" : "bg-slate-700",
                        disabled && "opacity-50 cursor-not-allowed"
                    )}
                >
                    <span className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                        enabled ? "translate-x-6" : "translate-x-1"
                    )} />
                </button>
            </div>
            {description && <div className="text-xs text-slate-500">{description}</div>}
        </div>
    );
}
