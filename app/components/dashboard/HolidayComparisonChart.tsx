'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { formatCompact, formatCurrency } from '@/lib/format';

interface YearData {
  year: number;
  revenue: number;
  transactions: number;
  byDepartment: Record<string, number>;
}

interface Props {
  years: YearData[];
  department: string;
  yearColors: string[];
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-1">{label}</p>
      <p className="text-sm font-mono text-white">{formatCurrency(payload[0]?.value ?? 0)}</p>
    </div>
  );
}

export function HolidayComparisonChart({ years, department, yearColors }: Props) {
  const data = years
    .sort((a, b) => a.year - b.year)
    .map((y, i) => ({
      year: String(y.year),
      revenue: department === 'All' ? y.revenue : (y.byDepartment?.[department] ?? 0),
      fill: yearColors[i % yearColors.length],
    }));

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Revenue by Year</h3>
      <p className="text-sm text-muted mb-6">
        {department === 'All' ? 'All departments' : department} — {years.length} years
      </p>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
            <XAxis
              dataKey="year"
              stroke="#525252"
              fontSize={11}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              stroke="#525252"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatCompact(v)}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar
              dataKey="revenue"
              fill="#10b981"
              radius={[4, 4, 0, 0]}
              maxBarSize={60}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
