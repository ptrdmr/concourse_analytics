'use client';

import { useState, useMemo } from 'react';
import { useTransactions, useSummary, useFilteredData } from '@/hooks/useTransactions';
import { formatCompact, formatNumber } from '@/lib/format';
import { DollarSign, ShoppingCart, TrendingUp, Package } from 'lucide-react';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { DateRangePicker } from '@/components/dashboard/DateRangePicker';
import { getYTD } from '@/lib/date-ranges';
import type { Filters } from '@/types';

const DEPT_ICONS: Record<string, string> = {
  Food: '🍕',
  Bar: '🍺',
  Bowling: '🎳',
  'League Fees': '🏆',
  Parties: '🎉',
  Arcade: '🕹️',
};

export default function HomePage() {
  const { raw, loading: txnLoading } = useTransactions();
  const { summary, loading: sumLoading } = useSummary();

  const [dateRange, setDateRange] = useState<[string, string] | null>(getYTD());
  const filters: Filters = {
    department: 'All',
    dateRange,
    categories: [],
    searchTerm: '',
  };

  const { filtered, kpis } = useFilteredData(raw, filters);

  const depts = useMemo(() => {
    const map = new Map<
      string,
      { revenue: number; transactions: number; items: Set<string>; categories: Set<string>; dates: string[] }
    >();
    for (const r of filtered) {
      const entry = map.get(r.department) || {
        revenue: 0,
        transactions: 0,
        items: new Set<string>(),
        categories: new Set<string>(),
        dates: [] as string[],
      };
      entry.revenue += r.revenue;
      entry.transactions += r.transactions;
      entry.items.add(r.name);
      entry.categories.add(r.category);
      entry.dates.push(r.date);
      map.set(r.department, entry);
    }
    return Array.from(map.entries())
      .map(([name, e]) => ({
        name,
        revenue: e.revenue,
        transactions: e.transactions,
        uniqueItems: e.items.size,
        categories: Array.from(e.categories).sort(),
        dateRange:
          e.dates.length > 0
            ? ([
                e.dates.reduce((a, b) => (a < b ? a : b)),
                e.dates.reduce((a, b) => (a > b ? a : b)),
              ] as [string, string])
            : (['', ''] as [string, string]),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  const loading = txnLoading || sumLoading;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-secondary animate-pulse text-lg">Loading dashboard...</div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-400">Failed to load data.</div>
      </div>
    );
  }

  const displayDateRange = dateRange
    ? `${dateRange[0]} to ${dateRange[1]}`
    : 'All time';

  return (
    <main className="min-h-screen">
      <Nav />

      <section className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-6">
          <h2 className="text-4xl font-bold mb-2">Business Overview</h2>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <p className="text-secondary mt-2">
            {displayDateRange}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
          <KpiCard
            icon={<DollarSign className="w-5 h-5" />}
            label="Total Revenue"
            value={formatCompact(kpis.totalRevenue)}
            accent
          />
          <KpiCard
            icon={<ShoppingCart className="w-5 h-5" />}
            label="Departments"
            value={String(depts.length)}
          />
          <KpiCard
            icon={<Package className="w-5 h-5" />}
            label="Unique Items"
            value={formatNumber(kpis.uniqueItems)}
          />
          <KpiCard
            icon={<TrendingUp className="w-5 h-5" />}
            label="Total Transactions"
            value={formatNumber(kpis.totalTransactions)}
          />
        </div>

        <h3 className="text-2xl font-bold mt-12 mb-6">Departments</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {depts.map(({ name, revenue, uniqueItems, transactions, categories, dateRange }) => (
            <Link
              key={name}
              href={`/explorer?dept=${encodeURIComponent(name)}`}
              className="card p-6 group cursor-pointer hover:-translate-y-0.5 transition-transform"
            >
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">{DEPT_ICONS[name] || '📊'}</span>
                <h4 className="text-lg font-semibold">{name}</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-secondary">Revenue</span>
                  <span className="font-mono font-medium text-accent">
                    {formatCompact(revenue)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary">Items</span>
                  <span className="font-mono">{uniqueItems}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary">Transactions</span>
                  <span className="font-mono">{formatNumber(transactions)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary">Categories</span>
                  <span className="font-mono">{categories.length}</span>
                </div>
              </div>
              <div className="mt-4 text-xs text-muted">
                {dateRange[0] && dateRange[1] ? `${dateRange[0]} — ${dateRange[1]}` : '—'}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function KpiCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 text-secondary mb-2">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className={`text-2xl font-bold font-mono ${accent ? 'text-gradient' : ''}`}>
        {value}
      </div>
    </div>
  );
}
