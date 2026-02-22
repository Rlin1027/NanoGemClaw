interface StatCardItem {
    label: string;
    value: string | number;
    sub?: string;
}

interface StatsCardsProps {
    stats: StatCardItem[];
}

export function StatsCards({ stats }: StatsCardsProps) {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((stat, i) => (
                <div key={i} className="bg-slate-900/50 p-4 rounded-lg border border-slate-800">
                    <div className="text-slate-500 text-xs mb-1">{stat.label}</div>
                    <div className="text-slate-100 font-mono font-bold text-xl">{stat.value}</div>
                    {stat.sub && <div className="text-slate-500 text-xs mt-1">{stat.sub}</div>}
                </div>
            ))}
        </div>
    );
}
