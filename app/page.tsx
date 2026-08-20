'use client';

import { useMemo, useEffect, Suspense } from 'react';
import { useTransactions, useSummary, useFilteredData } from '@/hooks/useTransactions';
import { useLabor } from '@/hooks/useLabor';
import { useVerdictForecast, useDaypartBaselines } from '@/hooks/useVerdictData';
import { formatCompact, formatNumber } from '@/lib/format';
import { buildOverviewSummary } from '@/lib/build-data-summary';
import {
  buildSalesLaborSummary,
  filterTransactionsByRange,
  percentChange,
  priorPeriodRange,
} from '@/lib/sales-labor';
import { buildVerdict } from '@/lib/verdict';
import { buildWeekStory } from '@/lib/week-story';
import { useDataContext } from '@/context/DataContext';
import { useUrlDateRange } from '@/hooks/useUrlFilters';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { DateRangePicker } from '@/components/dashboard/DateRangePicker';
import { SalesVsLaborCard } from '@/components/dashboard/SalesVsLaborCard';
import { HeroSection } from '@/components/dashboard/HeroSection';
import { BleedList } from '@/components/dashboard/BleedList';
import { MenuWatch } from '@/components/dashboard/MenuWatch';
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

function nextMondayISO(from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const day = d.getDay();
  const add = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + add);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

export default function HomePage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen pb-16 flex flex-col items-center justify-center gap-4">
        <div className="print:hidden"><Nav /></div>
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
  const { data: forecastData } = useVerdictForecast();
  const { data: daypartBaselines, loading: daypartLoading } = useDaypartBaselines();
  const { setDataSummary } = useDataContext();

  const salesThrough = summary?.dateRange?.[1] ?? null;
  const [dateRange, setDateRange] = useUrlDateRange(getLast7Days(salesThrough));
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
      salesThrough,
    }),
    [raw, laborByDate, dateRange, laborAvailable, laborThrough, salesThrough],
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

  const verdict = useMemo(
    () => buildVerdict({
      transactions: raw,
      laborByDate,
      laborAvailable,
      dateRange: null, // hero always reports the last complete week
      daypartBaselines,
    }),
    [raw, laborByDate, laborAvailable, daypartBaselines],
  );

  const nextWeekForecast = useMemo(() => {
    if (!forecastData?.house?.forecast?.length) return null;
    const target = nextMondayISO();
    const row = forecastData.house.forecast.find((f) => f.weekStart === target);
    return row?.predictedRevenue ?? null;
  }, [forecastData]);

  const story = useMemo(() => {
    // Hero stays department-level: never lead with a product "Do this".
    // Item findings still feed Menu Watch further down the page.
    const top = verdict.findings[0];
    const action =
      top && top.kind !== 'item-drop' && top.kind !== 'specials'
        ? (verdict.action?.sentence ?? null)
        : null;

    return buildWeekStory({
      transactions: raw,
      laborByDate,
      laborAvailable,
      action,
      nextWeekForecast,
    });
  }, [raw, laborByDate, laborAvailable, verdict, nextWeekForecast]);

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
      <main className="min-h-screen pb-16 flex flex-col items-center justify-center gap-4">
        <div className="print:hidden"><Nav /></div>
        <div className="text-secondary animate-pulse text-lg">Loading dashboard...</div>
        <p className="text-sm text-muted">Loading 125K+ transactions — this may take a moment</p>
      </main>
    );
  }

  if (!summary) {
    return (
      <main className="min-h-screen pb-16 flex flex-col items-center justify-center gap-4">
        <div className="print:hidden"><Nav /></div>
        <div className="text-red-400 text-center max-w-md">
          <p className="font-medium">Failed to load data.</p>
          <p className="text-sm text-muted mt-2">
            Run <code className="text-accent">python scripts/export_dashboards.py</code> to generate the data files, then refresh.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-16">
      <div className="print:hidden">
        <Nav />
      </div>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <HeroSection story={story} />

        <BleedList data={daypartBaselines} loading={daypartLoading} />

        <div className="mt-12 print:hidden">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-secondary">The details</h2>
              <p className="text-xs text-muted mt-0.5">
                Sales through {salesThrough ?? '—'}
                {laborAvailable && laborThrough ? ` · Labor through ${laborThrough}` : laborLoading ? '' : ' · Labor not loaded'}
              </p>
            </div>
            <DateRangePicker value={dateRange} onChange={setDateRange} dataThrough={salesThrough} />
          </div>

          <SalesVsLaborCard
            summary={salesLabor}
            salesDelta={priorComparison?.salesDelta}
            laborDelta={priorComparison?.laborDelta}
          />
        </div>

        <div className="mt-12 print:hidden">
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

        <div className="print:hidden">
          <MenuWatch items={verdict.itemFindings} />
        </div>
      </section>
    </main>
  );
}
