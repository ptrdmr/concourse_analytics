'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTransactions, useSummary, useFilteredData } from '@/hooks/useTransactions';
import type { Filters } from '@/types';
import { getYTD } from '@/lib/date-ranges';
import { buildExplorerSummary } from '@/lib/build-data-summary';
import { useDataContext } from '@/context/DataContext';
import { FilterBar } from '@/components/dashboard/FilterBar';
import { KpiRow } from '@/components/dashboard/KpiRow';
import { CategoryPieChart } from '@/components/dashboard/CategoryPieChart';
import { WeeklyTrendsChart } from '@/components/dashboard/WeeklyTrendsChart';
import { TopItemsChart } from '@/components/dashboard/TopItemsChart';
import { SpecialtyCocktailsPanel } from '@/components/dashboard/SpecialtyCocktailsPanel';
import { ItemDetailTable } from '@/components/dashboard/ItemDetailTable';
import { ItemHistoryPanel } from '@/components/dashboard/ItemHistoryPanel';
import { RevenueCalendarCard } from '@/components/dashboard/RevenueCalendarCard';
import { DayDetailModal } from '@/components/dashboard/DayDetailModal';
import type { ItemData } from '@/components/dashboard/ItemDetailTable';
import { Nav } from '@/components/Nav';

function ExplorerContent() {
  const searchParams = useSearchParams();
  const initialDept = searchParams.get('dept') || 'All';
  const { setDataSummary } = useDataContext();

  const { raw, loading: txnLoading } = useTransactions();
  const { summary, loading: sumLoading } = useSummary();

  const [filters, setFilters] = useState<Filters>({
    department: initialDept,
    dateRange: getYTD(),
    categories: [],
    searchTerm: '',
  });
  const [selectedItem, setSelectedItem] = useState<ItemData | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<'category' | 'trends' | 'calendar' | null>(null);

  useEffect(() => {
    const dept = searchParams.get('dept');
    if (dept) setFilters(f => ({ ...f, department: dept }));
  }, [searchParams]);

  const departments = useMemo(() => {
    if (!summary) return [];
    const depts = Object.keys(summary.departments).filter(d => d !== 'Vending Machines');
    return ['All', ...depts.sort((a, b) => {
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

  const { filtered, kpis, categoryBreakdown, weeklyTrends, topItems, dailyRevenue, dailyRevenueAllTime } =
    useFilteredData(raw, filters);

  const summaryText = useMemo(() => {
    if (txnLoading || sumLoading) return '';
    return buildExplorerSummary({
      department: filters.department,
      dateRange: filters.dateRange,
      kpis,
      categoryBreakdown,
      weeklyTrends,
      topItems,
    });
  }, [txnLoading, sumLoading, filters.department, filters.dateRange, kpis, categoryBreakdown, weeklyTrends, topItems]);

  useEffect(() => {
    if (summaryText) setDataSummary(summaryText);
  }, [summaryText, setDataSummary]);

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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <FilterBar
          departments={departments}
          categories={availableCategories}
          filters={filters}
          onChange={setFilters}
        />

        <KpiRow kpis={kpis} />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 xl:gap-8">
          <div
            className={`transition-all duration-300 ${selectedCard === 'category' ? 'xl:col-span-2' : ''} ${selectedCard === 'category' ? 'order-first' : selectedCard ? 'order-1' : ''}`}
            onClick={() => setSelectedCard((s) => (s === 'category' ? null : 'category'))}
          >
            <div
              className={`h-full cursor-pointer transition-all duration-200 ${
                selectedCard === 'category'
                  ? 'ring-2 ring-accent/50 rounded-xl'
                  : ''
              }`}
            >
              <CategoryPieChart
                data={categoryBreakdown}
                colors={categoryColors}
                onCategoryClick={() => setSelectedCard('category')}
              />
            </div>
          </div>
          <div
            className={`transition-all duration-300 ${selectedCard === 'trends' ? 'xl:col-span-2' : ''} ${selectedCard === 'trends' ? 'order-first' : selectedCard === 'category' ? 'order-2' : selectedCard === 'calendar' ? 'order-1' : ''}`}
            onClick={() => setSelectedCard((s) => (s === 'trends' ? null : 'trends'))}
          >
            <div
              className={`h-full cursor-pointer transition-all duration-200 ${
                selectedCard === 'trends'
                  ? 'ring-2 ring-accent/50 rounded-xl'
                  : ''
              }`}
            >
              <WeeklyTrendsChart data={weeklyTrends} />
            </div>
          </div>
          <div
            className={`transition-all duration-300 ${selectedCard === 'calendar' ? 'xl:col-span-2' : ''} ${selectedCard === 'calendar' ? 'order-first' : selectedCard ? 'order-2' : ''}`}
            onClick={() => setSelectedCard((s) => (s === 'calendar' ? null : 'calendar'))}
          >
            <div
              className={`h-full cursor-pointer transition-all duration-200 ${
                selectedCard === 'calendar'
                  ? 'ring-2 ring-accent/50 rounded-xl'
                  : ''
              }`}
            >
              <RevenueCalendarCard
                dailyRevenue={dailyRevenueAllTime}
                dateRange={null}
                department={filters.department}
                onDayClick={(date) => {
                  setSelectedCard('calendar');
                  setSelectedDate(date);
                }}
              />
            </div>
          </div>
        </div>

        {filters.department === 'Bar' && (
          <SpecialtyCocktailsPanel items={topItems} colors={categoryColors} />
        )}

        <TopItemsChart items={topItems.slice(0, 20)} colors={categoryColors} />

        <ItemDetailTable
          items={topItems}
          colors={categoryColors}
          onItemClick={setSelectedItem}
        />
      </div>

      {selectedItem && (
        <ItemHistoryPanel
          item={selectedItem}
          transactions={filtered}
          colors={categoryColors}
          onClose={() => setSelectedItem(null)}
        />
      )}

      {selectedDate && (() => {
        const dayData = dailyRevenueAllTime.find(d => d.date === selectedDate);
        const items = dayData?.items ?? [];
        const totalRevenue = dayData?.revenue ?? items.reduce((s, r) => s + r.revenue, 0);
        return (
          <DayDetailModal
            date={selectedDate}
            items={items}
            totalRevenue={totalRevenue}
            colors={categoryColors}
            onClose={() => setSelectedDate(null)}
          />
        );
      })()}
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
