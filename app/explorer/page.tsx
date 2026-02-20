'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTransactions, useSummary, useFilteredData } from '@/hooks/useTransactions';
import type { Filters } from '@/types';
import { getYTD } from '@/lib/date-ranges';
import { FilterBar } from '@/components/dashboard/FilterBar';
import { KpiRow } from '@/components/dashboard/KpiRow';
import { CategoryPieChart } from '@/components/dashboard/CategoryPieChart';
import { WeeklyTrendsChart } from '@/components/dashboard/WeeklyTrendsChart';
import { TopItemsChart } from '@/components/dashboard/TopItemsChart';
import { ItemDetailTable } from '@/components/dashboard/ItemDetailTable';
import { Nav } from '@/components/Nav';

function ExplorerContent() {
  const searchParams = useSearchParams();
  const initialDept = searchParams.get('dept') || 'All';

  const { raw, loading: txnLoading } = useTransactions();
  const { summary, loading: sumLoading } = useSummary();

  const [filters, setFilters] = useState<Filters>({
    department: initialDept,
    dateRange: getYTD(),
    categories: [],
    searchTerm: '',
  });

  useEffect(() => {
    const dept = searchParams.get('dept');
    if (dept) setFilters(f => ({ ...f, department: dept }));
  }, [searchParams]);

  const departments = useMemo(() => {
    if (!summary) return [];
    return ['All', ...Object.keys(summary.departments).sort((a, b) => {
      return (summary.departments[b]?.revenue || 0) - (summary.departments[a]?.revenue || 0);
    })];
  }, [summary]);

  const availableCategories = useMemo(() => {
    if (!summary || filters.department === 'All') {
      const cats = new Set<string>();
      if (summary) {
        Object.values(summary.departments).forEach(d => d.categories.forEach(c => cats.add(c)));
      }
      return Array.from(cats).sort();
    }
    return summary.departments[filters.department]?.categories || [];
  }, [summary, filters.department]);

  const { filtered, kpis, categoryBreakdown, weeklyTrends, topItems } =
    useFilteredData(raw, filters);

  const loading = txnLoading || sumLoading;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-secondary animate-pulse text-lg mb-2">Loading data...</div>
          <p className="text-sm text-muted">Processing 125K+ transaction rows</p>
        </div>
      </div>
    );
  }

  const categoryColors = summary?.categoryColors || {};

  return (
    <main className="min-h-screen">
      <Nav />

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <FilterBar
          departments={departments}
          categories={availableCategories}
          filters={filters}
          onChange={setFilters}
        />

        <KpiRow kpis={kpis} />

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          <CategoryPieChart data={categoryBreakdown} colors={categoryColors} />
          <WeeklyTrendsChart data={weeklyTrends} />
        </div>

        <TopItemsChart items={topItems.slice(0, 20)} colors={categoryColors} />

        <ItemDetailTable items={topItems} colors={categoryColors} />
      </div>
    </main>
  );
}

export default function ExplorerPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-secondary animate-pulse text-lg">Loading...</div>
      </div>
    }>
      <ExplorerContent />
    </Suspense>
  );
}
