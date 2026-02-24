'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface BurndownDataPoint {
  date: string;
  remaining: number;
  completed: number;
}

interface BurndownChartProps {
  data: BurndownDataPoint[];
}

export function BurndownChart({ data }: BurndownChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-foreground-muted text-xs">
        No burndown data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
        <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} />
        <Tooltip
          contentStyle={{
            background: '#1a1a2e',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            fontSize: '11px',
          }}
        />
        <Legend wrapperStyle={{ fontSize: '11px' }} />
        <Line
          type="monotone"
          dataKey="remaining"
          stroke="#f97316"
          strokeWidth={2}
          dot={false}
          name="Remaining"
        />
        <Line
          type="monotone"
          dataKey="completed"
          stroke="#22c55e"
          strokeWidth={2}
          dot={false}
          name="Completed"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
