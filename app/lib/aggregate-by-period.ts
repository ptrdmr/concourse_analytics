import type { Transaction } from '@/types';

export type PeriodGranularity = 'day' | 'week' | 'month' | 'year';

export interface PeriodData {
  period: string;
  revenue: number;
  transactions: number;
  quantity: number;
}

/** Get period key from date string for aggregation. */
function getPeriodKey(dateStr: string, granularity: PeriodGranularity): string {
  const d = new Date(dateStr + 'T00:00:00');
  switch (granularity) {
    case 'day':
      return dateStr;
    case 'week': {
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(d);
      weekStart.setDate(diff);
      return weekStart.toISOString().slice(0, 10);
    }
    case 'month':
      return dateStr.slice(0, 7);
    case 'year':
      return dateStr.slice(0, 4);
    default:
      return dateStr;
  }
}

/** Aggregate transactions by period (day/week/month/year). */
export function aggregateByPeriod(
  transactions: Transaction[],
  granularity: PeriodGranularity
): PeriodData[] {
  const map = new Map<string, { revenue: number; transactions: number; quantity: number }>();
  for (const r of transactions) {
    const key = getPeriodKey(r.date, granularity);
    const entry = map.get(key) || { revenue: 0, transactions: 0, quantity: 0 };
    entry.revenue += r.revenue;
    entry.transactions += r.transactions;
    entry.quantity += r.quantity;
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .map(([period, data]) => ({ period, ...data }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

/** Format period for display. */
export function formatPeriodLabel(period: string, granularity: PeriodGranularity): string {
  switch (granularity) {
    case 'day':
      return period;
    case 'week':
      return `Week of ${period}`;
    case 'month': {
      const [y, m] = period.split('-');
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${monthNames[parseInt(m, 10) - 1]} ${y}`;
    }
    case 'year':
      return period;
    default:
      return period;
  }
}
