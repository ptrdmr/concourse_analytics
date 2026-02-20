'use client';

import { useState, useEffect, useMemo } from 'react';
import type { Transaction, Summary, Filters } from '@/types';

export function useSummary() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/data/summary.json')
      .then(res => res.json())
      .then(data => { setSummary(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return { summary, loading };
}

export function useTransactions() {
  const [raw, setRaw] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/data/transactions.json')
      .then(res => res.json())
      .then((data: Transaction[]) => { setRaw(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return { raw, loading };
}

export function useFilteredData(raw: Transaction[], filters: Filters) {
  const filtered = useMemo(() => {
    let data = raw;

    if (filters.department && filters.department !== 'All') {
      data = data.filter(r => r.department === filters.department);
    }

    if (filters.dateRange) {
      const [start, end] = filters.dateRange;
      data = data.filter(r => r.date >= start && r.date <= end);
    }

    if (filters.categories.length > 0) {
      data = data.filter(r => filters.categories.includes(r.category));
    }

    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      data = data.filter(r => r.name.toLowerCase().includes(term));
    }

    return data;
  }, [raw, filters]);

  const kpis = useMemo(() => {
    const totalRevenue = filtered.reduce((s, r) => s + r.revenue, 0);
    const totalQuantity = filtered.reduce((s, r) => s + r.quantity, 0);
    const totalTransactions = filtered.reduce((s, r) => s + r.transactions, 0);
    const uniqueItems = new Set(filtered.map(r => r.name)).size;

    return { totalRevenue, totalQuantity, totalTransactions, uniqueItems };
  }, [filtered]);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      map.set(r.category, (map.get(r.category) || 0) + r.revenue);
    }
    return Array.from(map.entries())
      .map(([category, revenue]) => ({ category, revenue }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  const weeklyTrends = useMemo(() => {
    const map = new Map<string, { revenue: number; transactions: number }>();
    for (const r of filtered) {
      const dt = new Date(r.date + 'T00:00:00');
      const day = dt.getDay();
      const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(dt.setDate(diff)).toISOString().slice(0, 10);

      const entry = map.get(weekStart) || { revenue: 0, transactions: 0 };
      entry.revenue += r.revenue;
      entry.transactions += r.transactions;
      map.set(weekStart, entry);
    }
    return Array.from(map.entries())
      .map(([week, data]) => ({ week, ...data }))
      .sort((a, b) => a.week.localeCompare(b.week));
  }, [filtered]);

  const topItems = useMemo(() => {
    const map = new Map<string, { revenue: number; quantity: number; category: string }>();
    for (const r of filtered) {
      const entry = map.get(r.name) || { revenue: 0, quantity: 0, category: r.category };
      entry.revenue += r.revenue;
      entry.quantity += r.quantity;
      map.set(r.name, entry);
    }
    return Array.from(map.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  return { filtered, kpis, categoryBreakdown, weeklyTrends, topItems };
}
