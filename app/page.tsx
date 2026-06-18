'use client';

import { useState, useMemo, useEffect, Suspense } from 'react';
import { useTransactions, useSummary, useFilteredData } from '@/hooks/useTransactions';
import { useLabor } from '@/hooks/useLabor';
import { formatCompact, formatNumber, formatPercent } from '@/lib/format';
import { buildOverviewSummary } from '@/lib/build-data-summary';
import {
  buildSalesLaborSummary,
  filterTransactionsByRange,
  percentChange,
  priorPeriodRange,
} from '@/lib/sales-labor';
import { useDataContext } from '@/context/DataContext';
import { useUrlDateRange } from '@/hooks/useUrlFilters';
import { DollarSign, Receipt, TrendingDown, TrendingUp, Users } from 'lucide-react';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { DateRangePicker } from '@/components/dashboard/DateRangePicker';
import { SalesVsLaborCard } from '@/components/dashboard/SalesVsLaborCard';
import { getLast7Days } from '@/lib/date-ranges';
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
  return (
    <Suspense fallback={
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Nav />
        <div className="text-secondary animate-pulse text-lg">Loading dashboard...</div>
      </main>
    }>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const { raw, loading: txnLoading } = useTransactions();
  const { summary, loading: sumLoading } = useSummary();
  const { laborByDate, laborThrough, loading: laborLoading, available: laborAvailable } = useLabor();
  const { setDataSummary } = useDataContext();

  const [dateRange, setDateRange] = useUrlDateRange(getLast7Days());
  const filters = useMemo<Filters>(() => ({
    department: 'All',
    dateRange,
    categories: [],
    searchTerm: '',
  }), [dateRange]);

  const { filtered, kpis } = useFilteredData(raw, filters);

  const salesLabor = useMemo(
    () => buildSalesLaborSummary({
      transactions: raw,
      laborByDate,
      dateRange,
      laborAvailable,
      laborThrough,
    }),
    [raw, laborByDate, dateRange, laborAvailable, laborThrough],
  );

  const priorComparison = useMemo(() => {
    if (!dateRange) return null;
    const priorRange = priorPeriodRange(dateRange);
    const priorSales = filterTransactionsByRange(raw, priorRange);
    const priorSalesTotal = priorSales.reduce((s, r) => s + r.revenue, 0);
    const priorLaborTotal = priorRange
      ? Object.entries(laborByDate)
          .filter(([date]) => date >= priorRange[0] && date <= priorRange[1])
          .reduce((s, [, day]) => s + day.laborCost, 0)
      : 0;

    return {
      salesDelta: percentChange(salesLabor.totalSales, priorSalesTotal),
      laborDelta: laborAvailable ? percentChange(salesLabor.totalLaborCost, priorLaborTotal) : null,
    };
  }, [dateRange, raw, laborByDate, salesLabor, laborAvailable]);

  const depts = useMemo(() => {
    const map = new Map<
      string,
      { revenue: number; transactions: number }
    >();
    for (const r of filtered) {
      const entry = map.get(r.department) || {
        revenue: 0,
        transactions: 0,
      };
      entry.revenue += r.revenue;
      entry.transactions += r.transactions;
      map.set(r.department, entry);
    }
    return Array.from(map.entries())
      .map(([name, e]) => ({
        name,
        revenue: e.revenue,
        transactions: e.transactions,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  const salesThrough = summary?.dateRange?.[1] ?? null;

  const summaryText = useMemo(() => {
    if (txnLoading || sumLoading) return '';
    return buildOverviewSummary({
      dateRange,
      kpis,
      departments: depts.map(d => ({
        name: d.name,
        revenue: d.revenue,
        transactions: d.transactions,
        uniqueItems: 0,
      })),
      labor: {
        totalLaborCost: salesLabor.totalLaborCost,
        laborPct: salesLabor.laborPct,
        salesPerLaborHour: salesLabor.salesPerLaborHour,
        laborAvailable,
      },
    });
  }, [txnLoading, sumLoading, dateRange, kpis, depts, salesLabor, laborAvailable]);

  useEffect(() => {
    if (summaryText) setDataSummary(summaryText);
  }, [summaryText, setDataSummary]);

  const loading = txnLoading || sumLoading;

  if (loading) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Nav />
        <div className="text-secondary animate-pulse text-lg">Loading dashboard...</div>
        <p className="text-sm text-muted">Loading 125K+ transactions — this may take a moment</p>
      </main>
    );
  }

  if (!summary) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Nav />
        <div className="text-red-400 text-center max-w-md">
          <p className="font-medium">Failed to load data.</p>
          <p className="text-sm text-muted mt-2">
            Run <code className="text-accent">python scripts/export_dashboards.py</code> to generate the data files, then refresh.
          </p>
        </div>
      </main>
    );
  }

  const displayDateRange = dateRange
    ? `${dateRange[0]} to ${dateRange[1]}`
    : 'All time';

  return (
    <main className="min-h-screen">
      <Nav />

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-6">
          <h2 className="text-2xl sm:text-4xl font-bold mb-2">Business Overview</h2>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <p className="text-secondary mt-2">{displayDateRange}</p>
          <p className="text-xs text-muted mt-1 break-words">
            Sales through {salesThrough ?? '—'}
            {laborAvailable && laborThrough ? ` · Labor through ${laborThrough}` : laborLoading ? '' : ' · Labor not loaded'}
          </p>
        </div>

        <SalesVsLaborCard
          summary={salesLabor}
          salesDelta={priorComparison?.salesDelta}
          laborDelta={priorComparison?.laborDelta}
        />

        <div className="hidden lg:grid grid-cols-4 gap-4 mt-8">
          <OwnerKpiCard
            icon={<DollarSign className="w-5 h-5" />}
            label="Total Sales"
            value={formatCompact(kpis.totalRevenue)}
            delta={priorComparison?.salesDelta}
            accent
          />
          <OwnerKpiCard
            icon={<Users className="w-5 h-5" />}
            label="Labor Cost"
            value={laborAvailable ? formatCompact(salesLabor.totalLaborCost) : '—'}
            delta={priorComparison?.laborDelta}
          />
          <OwnerKpiCard
            icon={<TrendingUp className="w-5 h-5" />}
            label="Labor % of Sales"
            value={salesLabor.laborPct != null ? formatPercent(salesLabor.laborPct) : '—'}
          />
          <OwnerKpiCard
            icon={<Receipt className="w-5 h-5" />}
            label="Avg Ticket"
            value={salesLabor.avgTicket != null ? formatCompact(salesLabor.avgTicket) : '—'}
            sub={`${formatNumber(kpis.totalTransactions)} transactions`}
          />
        </div>

        <div className="mt-14 pt-8 border-t border-white/10">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-secondary">By Department</h3>
              <p className="text-sm text-muted">Tap a department for deeper analysis in Explorer.</p>
            </div>
            <Link href="/explorer" className="text-sm text-accent hover:underline">
              Open Explorer
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {depts.map(({ name, revenue, transactions }) => {
              const explorerHref = dateRange
                ? `/explorer?dept=${encodeURIComponent(name)}&from=${dateRange[0]}&to=${dateRange[1]}`
                : `/explorer?dept=${encodeURIComponent(name)}`;
              return (
                <Link
                  key={name}
                  href={explorerHref}
                  className="card p-4 group cursor-pointer hover:-translate-y-0.5 transition-transform opacity-90 hover:opacity-100"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xl">{DEPT_ICONS[name] || '📊'}</span>
                    <h4 className="text-base font-semibold">{name}</h4>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-secondary">Sales</span>
                      <span className="font-mono font-medium text-accent">
                        {formatCompact(revenue)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-secondary">Transactions</span>
                      <span className="font-mono">{formatNumber(transactions)}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}

function OwnerKpiCard({
  icon,
  label,
  value,
  delta,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta?: number | null;
  sub?: string;
  accent?: boolean;
}) {
  const positive = delta != null && delta >= 0;
  const DeltaIcon = positive ? TrendingUp : TrendingDown;

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 text-secondary mb-2">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className={`text-2xl font-bold font-mono ${accent ? 'text-gradient' : ''}`}>
        {value}
      </div>
      {delta != null && (
        <p className={`text-xs mt-2 inline-flex items-center gap-1 ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
          <DeltaIcon className="w-3 h-3" />
          {positive ? '+' : ''}{formatPercent(delta)} vs prior period
        </p>
      )}
      {sub && <p className="text-xs text-muted mt-2">{sub}</p>}
    </div>
  );
}
