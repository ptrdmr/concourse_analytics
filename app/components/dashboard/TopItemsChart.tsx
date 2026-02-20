'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { formatCurrency } from '@/lib/format';

interface ItemData {
  name: string;
  revenue: number;
  quantity: number;
  category: string;
}

interface Props {
  items: ItemData[];
  colors: Record<string, string>;
}

const FALLBACK = '#10b981';

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ItemData }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-sm font-semibold text-white">{d.name}</p>
      <p className="text-xs text-muted">{d.category}</p>
      <p className="text-sm text-accent mt-1">{formatCurrency(d.revenue)}</p>
    </div>
  );
}

export function TopItemsChart({ items, colors }: Props) {
  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Top 20 Items by Revenue</h3>
      <p className="text-sm text-muted mb-6">Highest revenue-generating items</p>
      <div className="h-[520px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={items} layout="vertical" margin={{ left: 120 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" horizontal={false} />
            <XAxis
              type="number"
              stroke="#525252"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => formatCurrency(v)}
            />
            <YAxis
              type="category"
              dataKey="name"
              stroke="#525252"
              fontSize={12}
              axisLine={false}
              tickLine={false}
              width={110}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="revenue" radius={[0, 6, 6, 0]} maxBarSize={24} fillOpacity={0.85}>
              {items.map((entry) => (
                <Cell key={entry.name} fill={colors[entry.category] || FALLBACK} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
