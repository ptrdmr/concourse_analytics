'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCurrency } from '@/lib/format';

interface Point {
  date: string;
  sales: number;
  tips: number;
  hours: number;
}

interface Props {
  data: Point[];
  metric: 'sales' | 'tips' | 'hours';
}

const COLORS = {
  sales: '#38bdf8',
  tips: '#f97316',
  hours: '#a78bfa',
};

export function TrendSparkline({ data, metric }: Props) {
  if (data.length === 0) {
    return <div className="h-32 flex items-center justify-center text-sm text-muted">No trend data in period</div>;
  }

  const color = COLORS[metric];
  const label = metric === 'sales' ? 'Sales' : metric === 'tips' ? 'Tips' : 'Hours';

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'var(--color-secondary)' }}
            tickFormatter={(v) => v.slice(5)}
            interval="preserveStartEnd"
          />
          <YAxis hide />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Point;
              return (
                <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
                  <p className="text-muted mb-1">{p.date}</p>
                  <p>{label}: {metric === 'hours' ? p.hours.toFixed(1) : formatCurrency(p[metric])}</p>
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey={metric} stroke={color} fill={`url(#grad-${metric})`} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
