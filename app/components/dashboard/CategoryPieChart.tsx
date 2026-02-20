'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatCompact, formatCurrency, formatPercent } from '@/lib/format';

interface CategoryData {
  category: string;
  revenue: number;
}

interface Props {
  data: CategoryData[];
  colors: Record<string, string>;
}

const FALLBACK_COLORS = [
  '#10b981', '#22d3ee', '#f59e0b', '#ef4444', '#8b5cf6',
  '#f97316', '#ec4899', '#84cc16', '#06b6d4', '#e879f9',
  '#a78bfa', '#14b8a6', '#f43f5e', '#eab308', '#6366f1',
];

function getColor(category: string, index: number, colors: Record<string, string>) {
  return colors[category] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: CategoryData }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-sm font-semibold text-white">{d.category}</p>
      <p className="text-sm text-accent">{formatCurrency(d.revenue)}</p>
    </div>
  );
}

export function CategoryPieChart({ data, colors }: Props) {
  const total = data.reduce((s, d) => s + d.revenue, 0);

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Revenue by Category</h3>
      <p className="text-sm text-muted mb-6">Top categories by total revenue</p>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="h-[300px] flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.slice(0, 12)}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={120}
                paddingAngle={2}
                dataKey="revenue"
              >
                {data.slice(0, 12).map((entry, i) => (
                  <Cell key={entry.category} fill={getColor(entry.category, i, colors)} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-2 max-h-[300px] overflow-y-auto pr-2">
          {data.slice(0, 12).map((d, i) => (
            <div key={d.category} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: getColor(d.category, i, colors) }}
                />
                <span className="text-secondary truncate">{d.category}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono text-white">{formatCompact(d.revenue)}</span>
                <span className="text-muted text-xs w-12 text-right">
                  {formatPercent((d.revenue / total) * 100)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
