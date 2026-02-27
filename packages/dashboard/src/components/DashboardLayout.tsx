import { LayoutDashboard, TerminalSquare, Settings, Database, Plus, CalendarClock, BarChart3, BookOpen, Calendar, Search, ScrollText, CalendarRange } from "lucide-react";
import { useTranslation } from 'react-i18next';
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from './LanguageSwitcher';

interface DashboardLayoutProps {
    children: React.ReactNode;
    activeTab?: string;
    onTabChange?: (tab: string) => void;
    onSearchOpen?: () => void;
    onAddGroup?: () => void;
}

export function DashboardLayout({ children, activeTab = 'overview', onTabChange, onSearchOpen, onAddGroup }: DashboardLayoutProps) {
    const { t } = useTranslation('nav');

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

                <nav className="flex-1 p-2 mt-4 overflow-y-auto">
                    {/* Main */}
                    <NavGroupLabel label={t('main')} />
                    <div className="space-y-1 mb-3">
                        <NavItem
                            icon={<LayoutDashboard size={20} />}
                            label={t('overview')}
                            active={activeTab === 'overview' || activeTab === 'group-detail'}
                            onClick={() => onTabChange?.('overview')}
                        />
                        <NavItem
                            icon={<TerminalSquare size={20} />}
                            label={t('logs')}
                            active={activeTab === 'logs'}
                            onClick={() => onTabChange?.('logs')}
                        />
                    </div>

                    {/* Management */}
                    <NavGroupLabel label={t('management')} />
                    <div className="space-y-1 mb-3">
                        <NavItem
                            icon={<Database size={20} />}
                            label={t('memory')}
                            active={activeTab === 'memory'}
                            onClick={() => onTabChange?.('memory')}
                        />
                        <NavItem
                            icon={<BookOpen size={20} />}
                            label={t('knowledge')}
                            active={activeTab === 'knowledge'}
                            onClick={() => onTabChange?.('knowledge')}
                        />
                        <NavItem
                            icon={<CalendarClock size={20} />}
                            label={t('tasks')}
                            active={activeTab === 'tasks'}
                            onClick={() => onTabChange?.('tasks')}
                        />
                        <NavItem
                            icon={<Calendar size={20} />}
                            label={t('calendar')}
                            active={activeTab === 'calendar'}
                            onClick={() => onTabChange?.('calendar')}
                        />
                        <NavItem
                            icon={<CalendarRange size={20} />}
                            label={t('schedule')}
                            active={activeTab === 'schedule'}
                            onClick={() => onTabChange?.('schedule')}
                        />
                    </div>

                    {/* Monitoring */}
                    <NavGroupLabel label={t('monitoring')} />
                    <div className="space-y-1 mb-3">
                        <NavItem
                            icon={<BarChart3 size={20} />}
                            label={t('analytics')}
                            active={activeTab === 'analytics'}
                            onClick={() => onTabChange?.('analytics')}
                        />
                        <NavItem
                            icon={<ScrollText size={20} />}
                            label={t('activityLogs')}
                            active={activeTab === 'activity-logs'}
                            onClick={() => onTabChange?.('activity-logs')}
                        />
                    </div>

                    {/* System */}
                    <NavGroupLabel label={t('system')} />
                    <div className="space-y-1">
                        <NavItem
                            icon={<Settings size={20} />}
                            label={t('settings')}
                            active={activeTab === 'settings'}
                            onClick={() => onTabChange?.('settings')}
                        />
                    </div>
                </nav>

                <div className="p-4 border-t border-slate-800 hidden lg:block">
                    <button
                        onClick={onAddGroup}
                        className="flex items-center gap-2 w-full bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20"
                    >
                        <Plus size={16} /> {t('addGroup')}
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 ml-16 lg:ml-64 p-4 lg:p-8 overflow-y-auto">
                <header className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-white">{t('dashboard')}</h1>
                        <p className="text-slate-400 text-sm mt-1">{t('realTimeCommandCenter')}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        {onSearchOpen && (
                            <button
                                onClick={onSearchOpen}
                                className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 text-xs font-mono hover:bg-slate-700 hover:text-slate-300 transition-colors"
                                title="Search (Cmd+K)"
                            >
                                <Search size={14} />
                                <span className="hidden lg:inline">{t('search', { ns: 'common' })}</span>
                                <kbd className="hidden lg:inline ml-1 px-1.5 py-0.5 bg-slate-900 rounded text-[10px] border border-slate-700">⌘K</kbd>
                            </button>
                        )}
                        <LanguageSwitcher />
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full text-green-400 text-xs font-mono">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            {t('online', { ns: 'common' })}
                        </div>
                    </div>
                </header>

                {children}
            </main>
        </div>
    );
}

function NavGroupLabel({ label }: { label: string }) {
    return (
        <div className="hidden lg:block text-[10px] text-slate-600 uppercase tracking-widest font-semibold px-3 mb-1 mt-1">
            {label}
        </div>
    );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group text-left",
                active
                    ? "bg-slate-800 text-white shadow-inner"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"
            )}
        >
            <span className={cn("transition-colors", active ? "text-blue-400" : "text-slate-500 group-hover:text-slate-300")}>
                {icon}
            </span>
            <span className="hidden lg:block text-sm font-medium">{label}</span>
            {active && <div className="ml-auto w-1 h-1 bg-blue-500 rounded-full hidden lg:block shadow-[0_0_8px_rgba(59,130,246,0.8)]" />}
        </button>
    );
}
