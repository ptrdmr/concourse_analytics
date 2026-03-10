'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { formatCompact, formatCurrency } from '@/lib/format';
import type { PeriodData, PeriodGranularity } from '@/lib/aggregate-by-period';

interface ChartPoint {
  slot: string;
  label: string;
  periodA: number;
  periodB: number;
}

const SLOT_LABELS: Record<PeriodGranularity, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  year: 'Year',
};

interface Props {
  dataA: PeriodData[];
  dataB: PeriodData[];
  granularity: PeriodGranularity;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; payload?: ChartPoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const displayLabel = payload[0]?.payload?.label ?? label;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-2">{displayLabel}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="text-sm">
          <span className={p.dataKey === 'periodA' ? 'text-[#10b981]' : 'text-[#22d3ee]'}>
            {p.dataKey === 'periodA' ? 'Period A' : 'Period B'}:
          </span>{' '}
          <span className="font-mono text-white">{formatCurrency(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

export function ComparisonBarChart({ dataA, dataB, granularity }: Props) {
  const maxLen = Math.max(dataA.length, dataB.length);
  const slotLabel = SLOT_LABELS[granularity];
  const chartData: ChartPoint[] = [];

  for (let i = 0; i < maxLen; i++) {
    const a = dataA[i];
    const b = dataB[i];
    chartData.push({
      slot: String(i),
      label: `${slotLabel} ${i + 1}`,
      periodA: a?.revenue ?? 0,
      periodB: b?.revenue ?? 0,
    });
  }

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Sales by Period</h3>
      <p className="text-sm text-muted mb-6">
        Period A vs Period B — {granularity} granularity
      </p>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
            <XAxis
              dataKey="slot"
              stroke="#525252"
              fontSize={10}
              axisLine={false}
              tickLine={false}
              tickFormatter={(_, i) => chartData[i]?.label ?? ''}
              interval={chartData.length > 16 ? 2 : chartData.length > 8 ? 1 : 0}
            />
            <YAxis
              stroke="#525252"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatCompact(v)}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value) => (
                <span className="text-secondary">{value === 'periodA' ? 'Period A' : 'Period B'}</span>
              )}
            />
            <Bar
              dataKey="periodA"
              name="Period A"
              fill="#10b981"
              radius={[2, 2, 0, 0]}
              maxBarSize={24}
            />
            <Bar
              dataKey="periodB"
              name="Period B"
              fill="#22d3ee"
              radius={[2, 2, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
