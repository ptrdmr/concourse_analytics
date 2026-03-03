'use client';

import { useMemo } from 'react';
import type { Transaction } from '@/types';

export type HistoryGranularity = 'month' | 'week' | 'day';

export interface PeriodData {
  period: string;
  revenue: number;
  quantity: number;
  transactions: number;
}

function getWeekStart(dateStr: string): string {
  const dt = new Date(dateStr + 'T00:00:00');
  const day = dt.getDay();
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  dt.setDate(diff);
  return dt.toISOString().slice(0, 10);
}

export function useItemHistory(
  transactions: Transaction[],
  itemName: string | null,
  granularity: HistoryGranularity = 'month'
): PeriodData[] {
  return useMemo(() => {
    if (!itemName) return [];

    const data = transactions.filter(
      (r) => r.name.toLowerCase() === itemName.toLowerCase()
    );

    if (data.length === 0) return [];

    const map = new Map<string, { revenue: number; quantity: number; transactions: number }>();

    for (const r of data) {
      let key: string;
      if (granularity === 'month') {
        key = r.date.slice(0, 7);
      } else if (granularity === 'week') {
        key = getWeekStart(r.date);
      } else {
        key = r.date;
      }

      const entry = map.get(key) || { revenue: 0, quantity: 0, transactions: 0 };
      entry.revenue += r.revenue;
      entry.quantity += r.quantity;
      entry.transactions += r.transactions;
      map.set(key, entry);
    }

    return Array.from(map.entries())
      .map(([period, d]) => ({ period, ...d }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }, [transactions, itemName, granularity]);
}
