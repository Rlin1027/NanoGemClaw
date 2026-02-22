import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface UsageChartProps {
    data: any[];
    type?: 'line' | 'bar';
    dataKeys: { key: string; color: string; name: string }[];
    xKey?: string;
    height?: number;
}

export function UsageChart({ data, type = 'line', dataKeys, xKey = 'bucket', height = 300 }: UsageChartProps) {
    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
                No data available
            </div>
        );
    }

    const Chart = type === 'bar' ? BarChart : LineChart;

    return (
        <ResponsiveContainer width="100%" height={height}>
            <Chart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                    dataKey={xKey}
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                />
                <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip
                    contentStyle={{
                        backgroundColor: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        color: '#e2e8f0',
                    }}
                />
                <Legend />
                {dataKeys.map(dk => (
                    type === 'bar' ? (
                        <Bar key={dk.key} dataKey={dk.key} fill={dk.color} name={dk.name} />
                    ) : (
                        <Line key={dk.key} type="monotone" dataKey={dk.key} stroke={dk.color} name={dk.name} strokeWidth={2} dot={false} />
                    )
                ))}
            </Chart>
        </ResponsiveContainer>
    );
}
