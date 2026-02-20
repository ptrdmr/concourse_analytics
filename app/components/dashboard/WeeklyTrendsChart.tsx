'use client';

import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { formatCompact, formatCurrency, formatNumber } from '@/lib/format';

interface WeekData {
  week: string;
  revenue: number;
  transactions: number;
}

interface Props {
  data: WeekData[];
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-1">Week of {label}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="text-sm">
          <span className="text-secondary">{p.dataKey === 'revenue' ? 'Revenue' : 'Transactions'}: </span>
          <span className="text-white font-mono">
            {p.dataKey === 'revenue' ? formatCurrency(p.value) : formatNumber(p.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

export function WeeklyTrendsChart({ data }: Props) {
  const displayData = data.slice(-52);

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Weekly Trends</h3>
      <p className="text-sm text-muted mb-6">Revenue and transaction volume over time</p>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={displayData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
            <XAxis
              dataKey="week"
              stroke="#525252"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => v.slice(5)}
              interval={Math.max(Math.floor(displayData.length / 8), 1)}
            />
            <YAxis
              yAxisId="revenue"
              stroke="#525252"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => formatCompact(v)}
            />
            <YAxis
              yAxisId="txns"
              orientation="right"
              stroke="#525252"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => formatNumber(v)}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar
              yAxisId="txns"
              dataKey="transactions"
              fill="#22d3ee"
              fillOpacity={0.2}
              radius={[2, 2, 0, 0]}
              maxBarSize={12}
            />
            <Line
              yAxisId="revenue"
              type="monotone"
              dataKey="revenue"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#10b981', stroke: '#000', strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
