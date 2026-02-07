import { LayoutDashboard, TerminalSquare, Settings, Database, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardLayoutProps {
    children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 flex font-sans selection:bg-blue-500/30">

            {/* Sidebar */}
            <aside className="w-16 lg:w-64 border-r border-slate-800 flex flex-col fixed h-full bg-slate-950 z-10 transition-all duration-300">
                <div className="h-16 flex items-center justify-center lg:justify-start lg:px-6 border-b border-slate-800">
                    <div className="w-8 h-8 bg-gradient-to-tr from-blue-500 to-purple-500 rounded-lg shadow-lg shadow-blue-500/20" />
                    <span className="hidden lg:block ml-3 font-bold text-lg tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                        GemClaw
                    </span>
                </div>

                <nav className="flex-1 p-2 space-y-2 mt-4">
                    <NavItem icon={<LayoutDashboard size={20} />} label="Overview" active />
                    <NavItem icon={<TerminalSquare size={20} />} label="Logs" />
                    <NavItem icon={<Database size={20} />} label="Memory" />
                    <NavItem icon={<Settings size={20} />} label="Settings" />
                </nav>

                <div className="p-4 border-t border-slate-800 hidden lg:block">
                    <button className="flex items-center gap-2 w-full bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20">
                        <Plus size={16} /> Add Group
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 ml-16 lg:ml-64 p-4 lg:p-8 overflow-y-auto">
                <header className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
                        <p className="text-slate-400 text-sm mt-1">Real-time Command Center</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full text-green-400 text-xs font-mono">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            ONLINE
                        </div>
                    </div>
                </header>

                {children}
            </main>
        </div>
    );
}

function NavItem({ icon, label, active }: { icon: React.ReactNode, label: string, active?: boolean }) {
    return (
        <button className={cn(
            "w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group",
            active
                ? "bg-slate-800 text-white shadow-inner"
                : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"
        )}>
            <span className={cn("transition-colors", active ? "text-blue-400" : "text-slate-500 group-hover:text-slate-300")}>
                {icon}
            </span>
            <span className="hidden lg:block text-sm font-medium">{label}</span>
            {active && <div className="ml-auto w-1 h-1 bg-blue-500 rounded-full hidden lg:block shadow-[0_0_8px_rgba(59,130,246,0.8)]" />}
        </button>
    );
}
