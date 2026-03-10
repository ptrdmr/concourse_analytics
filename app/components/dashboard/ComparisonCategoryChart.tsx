'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { formatCurrency } from '@/lib/format';

interface CategoryEntry {
  category: string;
  revenue: number;
}

interface Props {
  dataA: CategoryEntry[];
  dataB: CategoryEntry[];
  colors: Record<string, string>;
  title?: string;
  subtitle?: string;
}

const FALLBACK_COLORS = ['#10b981', '#22d3ee', '#f59e0b', '#ef4444', '#8b5cf6', '#f97316'];

function getColor(cat: string, i: number, colors: Record<string, string>) {
  return colors[cat] || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; payload?: { category: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const cat = payload[0]?.payload?.category ?? '';
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-sm font-semibold text-white mb-2">{cat}</p>
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

export function ComparisonCategoryChart({ dataA, dataB, colors, title = 'Sales by Category', subtitle = 'Period A vs Period B by category' }: Props) {
  const allCats = Array.from(new Set([...dataA.map(d => d.category), ...dataB.map(d => d.category)]))
    .sort()
    .slice(0, 12);
  const mapA = new Map(dataA.map(d => [d.category, d.revenue]));
  const mapB = new Map(dataB.map(d => [d.category, d.revenue]));
  const chartData = allCats.map((category, i) => ({
    category,
    periodA: mapA.get(category) ?? 0,
    periodB: mapB.get(category) ?? 0,
    fill: getColor(category, i, colors),
  }));

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
      <p className="text-sm text-muted mb-6">{subtitle}</p>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" horizontal={false} />
            <XAxis
              type="number"
              stroke="#525252"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatCurrency(v)}
            />
            <YAxis
              type="category"
              dataKey="category"
              stroke="#525252"
              fontSize={10}
              axisLine={false}
              tickLine={false}
              width={120}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Bar dataKey="periodA" name="Period A" fill="#10b981" radius={[0, 2, 2, 0]} maxBarSize={14} />
            <Bar dataKey="periodB" name="Period B" fill="#22d3ee" radius={[0, 2, 2, 0]} maxBarSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
