'use client';

import { formatCompact, formatNumber } from '@/lib/format';

interface Kpis {
  totalRevenue: number;
  totalQuantity: number;
  totalTransactions: number;
  uniqueItems: number;
}

interface Props {
  kpisA: Kpis;
  kpisB: Kpis;
  labelA?: string;
  labelB?: string;
}

function pctChange(a: number, b: number): string {
  if (a === 0) return b > 0 ? '+∞' : '—';
  const pct = ((b - a) / a) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

export function ComparisonKpiCards({ kpisA, kpisB, labelA = 'Period A', labelB = 'Period B' }: Props) {
  const metrics = [
    { key: 'totalRevenue', label: 'Sales', format: (v: number) => formatCompact(v) },
    { key: 'totalQuantity', label: 'Quantity', format: (v: number) => formatNumber(v) },
    { key: 'totalTransactions', label: 'Transactions', format: (v: number) => formatNumber(v) },
    { key: 'uniqueItems', label: 'Unique Items', format: (v: number) => String(v) },
  ] as const;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map(({ key, label, format }) => {
        const a = kpisA[key];
        const b = kpisB[key];
        const change = pctChange(a, b);
        const improved = key === 'totalRevenue' || key === 'totalQuantity' || key === 'totalTransactions'
          ? b > a
          : null;
        return (
          <div key={key} className="card p-5">
            <div className="text-secondary text-sm mb-2">{label}</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-xs text-muted">{labelA}</div>
                <div className="font-mono font-semibold text-[#10b981]">{format(a)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">{labelB}</div>
                <div className="font-mono font-semibold text-[#22d3ee]">{format(b)}</div>
              </div>
            </div>
            <div className={`mt-2 text-xs font-mono ${
              improved === true ? 'text-accent' : improved === false ? 'text-red-400' : 'text-muted'
            }`}>
              {change}
            </div>
          </div>
        );
      })}
    </div>
  );
}
