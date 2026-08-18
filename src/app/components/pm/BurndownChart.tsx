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
  scope?: number;
  remaining: number | null;
  completed: number;
  forecast?: number | null;
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

  const hasForecast = data.some((d) => d.forecast !== null && d.forecast !== undefined);
  const hasScope = data.some((d) => d.scope !== undefined);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
          minTickGap={24}
        />
        <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: '#1a1a2e',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            fontSize: '11px',
          }}
        />
        <Legend wrapperStyle={{ fontSize: '11px' }} />
        {hasScope && (
          <Line
            type="stepAfter"
            dataKey="scope"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth={1}
            dot={false}
            name="Scope"
          />
        )}
        <Line
          type="monotone"
          dataKey="remaining"
          stroke="#f97316"
          strokeWidth={2}
          dot={false}
          // The forecast days carry no `remaining`; joining across them would
          // draw a measured line through days nobody has lived yet.
          connectNulls={false}
          name="Remaining"
        />
        {hasForecast && (
          <Line
            type="monotone"
            dataKey="forecast"
            stroke="#f97316"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            connectNulls={false}
            name="Forecast"
          />
        )}
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
