'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompact, formatCurrency } from '@/lib/format';
import type { WeekStack } from '@/lib/leagues';

const SERIES = [
  { key: 'combined', name: 'Combined fees', fill: '#737373' },
  { key: 'lineage', name: 'Lineage', fill: '#34d399' },
  { key: 'prizeFund', name: 'Prize fund', fill: '#c084fc' },
  { key: 'prizeFundGeneral', name: 'Prize fund general', fill: '#f472b6' },
] as const;

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-1">Week of {label}</p>
      {payload.filter((entry) => entry.value).map((entry) => (
        <p key={entry.name} className="text-sm">
          <span style={{ color: entry.color }}>{entry.name}: </span>
          <span className="font-mono">{formatCurrency(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

export function LeagueWeeklyChart({ data, title }: { data: WeekStack[]; title: string }) {
  const visible = SERIES.filter((series) => data.some((row) => row[series.key] !== 0));
  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted mb-6">Monday-start weeks in the selected dates</p>
      {data.length === 0 ? (
        <p className="text-sm text-muted">No league collections in this date range.</p>
      ) : (
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
              <XAxis
                dataKey="week"
                stroke="#525252"
                fontSize={11}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value: string) => value.slice(5)}
                interval={Math.max(Math.floor(data.length / 8), 0)}
              />
              <YAxis
                stroke="#525252"
                fontSize={11}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value: number) => formatCompact(value)}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              {visible.map((series) => (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  name={series.name}
                  stackId="collections"
                  fill={series.fill}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
