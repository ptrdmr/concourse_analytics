'use client';

import { useMemo } from 'react';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';

interface YearData {
  year: number;
  startDate: string;
  endDate: string;
  revenue: number;
  transactions: number;
  byDepartment: Record<string, number>;
}

interface Props {
  years: YearData[];
  department: string;
}

function formatDateRange(start: string, end: string): string {
  if (start === end) return start;
  return `${start} – ${end}`;
}

export function HolidayYoYTable({ years, department }: Props) {
  const rows = useMemo(() => {
    const sorted = [...years].sort((a, b) => a.year - b.year);
    return sorted.map((y, i) => {
      const prev = sorted[i - 1];
      const currRev = department === 'All' ? y.revenue : (y.byDepartment?.[department] ?? 0);
      const prevRev = prev
        ? (department === 'All' ? prev.revenue : (prev.byDepartment?.[department] ?? 0))
        : 0;
      const revYoY = prevRev > 0 ? ((currRev - prevRev) / prevRev) * 100 : null;
      const txnYoY = prev && prev.transactions > 0
        ? ((y.transactions - prev.transactions) / prev.transactions) * 100
        : null;
      return {
        ...y,
        displayRevenue: currRev,
        revYoY,
        txnYoY,
      };
    });
  }, [years, department]);

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-border">
        <h3 className="text-lg font-semibold text-white">Year-over-Year</h3>
        <p className="text-sm text-muted">Sales and transactions by year with YoY change</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-secondary">
              <th className="px-4 py-3 font-medium">Year</th>
              <th className="px-4 py-3 font-medium">Date Range</th>
              <th className="px-4 py-3 font-medium text-right">Sales</th>
              <th className="px-4 py-3 font-medium text-right">YoY %</th>
              <th className="px-4 py-3 font-medium text-right">Transactions</th>
              <th className="px-4 py-3 font-medium text-right">YoY %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} className="border-b border-border/50 hover:bg-white/5">
                <td className="px-4 py-3 font-mono">{r.year}</td>
                <td className="px-4 py-3 text-muted">{formatDateRange(r.startDate, r.endDate)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(r.displayRevenue)}</td>
                <td className="px-4 py-3 text-right">
                  {r.revYoY != null ? (
                    <span className={r.revYoY >= 0 ? 'text-accent' : 'text-red-400'}>
                      {r.revYoY >= 0 ? '+' : ''}{formatPercent(r.revYoY)}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatNumber(r.transactions)}</td>
                <td className="px-4 py-3 text-right">
                  {r.txnYoY != null ? (
                    <span className={r.txnYoY >= 0 ? 'text-accent' : 'text-red-400'}>
                      {r.txnYoY >= 0 ? '+' : ''}{formatPercent(r.txnYoY)}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
