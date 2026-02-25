'use client';

import { formatCompact, formatCurrency } from '@/lib/format';

interface YearData {
  year: number;
  revenue: number;
  transactions: number;
}

interface Props {
  years: YearData[];
  yearColors: string[];
}

export function HolidayRanking({ years, yearColors }: Props) {
  if (years.length === 0) return null;

  const sorted = [...years].sort((a, b) => b.revenue - a.revenue);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const avg = years.reduce((s, y) => s + y.revenue, 0) / years.length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="card p-5">
        <div className="text-sm text-secondary mb-1">Best Year</div>
        <div className="text-2xl font-bold font-mono text-gradient flex items-center gap-2">
          {formatCompact(best.revenue)}
          <span className="text-base font-normal text-accent">({best.year})</span>
        </div>
      </div>
      <div className="card p-5">
        <div className="text-sm text-secondary mb-1">Worst Year</div>
        <div className="text-2xl font-bold font-mono flex items-center gap-2">
          {formatCompact(worst.revenue)}
          <span className="text-base font-normal text-muted">({worst.year})</span>
        </div>
      </div>
      <div className="card p-5">
        <div className="text-sm text-secondary mb-1">Average</div>
        <div className="text-2xl font-bold font-mono">
          {formatCompact(avg)}
        </div>
      </div>
    </div>
  );
}
