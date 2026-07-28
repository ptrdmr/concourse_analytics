'use client';

import { useState, useMemo, useEffect, Suspense } from 'react';
import { Nav } from '@/components/Nav';
import { DateRangePicker } from '@/components/dashboard/DateRangePicker';
import { SpecialtyCocktailsPanel } from '@/components/dashboard/SpecialtyCocktailsPanel';
import { PackageDetailTable } from '@/components/dashboard/PackageDetailTable';
import { ItemHistoryPanel } from '@/components/dashboard/ItemHistoryPanel';
import type { ItemData } from '@/components/dashboard/ItemDetailTable';
import { useTransactions, useSummary, useFilteredData, usePackages } from '@/hooks/useTransactions';
import { aggregatePackageItems, filterPackages } from '@/lib/packages';
import { getYTD } from '@/lib/date-ranges';
import type { Filters } from '@/types';
import { useUrlDateRange } from '@/hooks/useUrlFilters';
import { useDataContext } from '@/context/DataContext';
import { formatCurrency, formatNumber } from '@/lib/format';

function SpecialsContent() {
  const { setDataSummary } = useDataContext();
  const { raw, loading: txnLoading } = useTransactions();
  const { summary, loading: sumLoading } = useSummary();
  const { packages, loading: pkgLoading } = usePackages();

  const dataThrough = summary?.dateRange?.[1] ?? null;
  const [dateRange, setDateRange] = useUrlDateRange(getYTD(dataThrough));
  const [selectedItem, setSelectedItem] = useState<ItemData | null>(null);
  const [historySource, setHistorySource] = useState<'cocktails' | 'packages'>('packages');

  const barFilters = useMemo<Filters>(() => ({
    department: 'Bar',
    dateRange,
    categories: [],
    searchTerm: '',
  }), [dateRange]);

  const packageFilters = useMemo<Filters>(() => ({
    department: 'All',
    dateRange,
    categories: [],
    searchTerm: '',
  }), [dateRange]);

  const { topItems: barTopItems } = useFilteredData(raw, barFilters);
  const packageFiltered = useMemo(
    () => filterPackages(packages, packageFilters),
    [packages, packageFilters],
  );
  const packageItems = useMemo(
    () => aggregatePackageItems(packageFiltered),
    [packageFiltered],
  );

  const categoryColors = summary?.categoryColors || {};
  const loading = txnLoading || sumLoading || pkgLoading;

  const summaryText = useMemo(() => {
    if (loading) return '';
    const lines = [
      'Dashboard: Specials',
      `Date Range: ${dateRange ? `${dateRange[0]} to ${dateRange[1]}` : 'All time'}`,
      '',
      'Summer package specials:',
      ...packageItems.slice(0, 10).map(
        (p, i) => `${i + 1}. ${p.name} - ${formatCurrency(p.revenue)} (qty: ${formatNumber(p.quantity)})`,
      ),
    ];
    return lines.join('\n');
  }, [loading, dateRange, packageItems]);

  useEffect(() => {
    if (summaryText) setDataSummary(summaryText);
  }, [summaryText, setDataSummary]);

  if (loading) {
    return (
      <div className="min-h-screen pb-16 flex items-center justify-center">
        <div className="text-secondary animate-pulse text-lg">Loading specials data...</div>
      </div>
    );
  }

  return (
    <main className="min-h-screen pb-16">
      <Nav />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gradient">Specials</h1>
          <p className="text-sm text-muted mt-1">
            Summer package performance and specialty cocktail sales
          </p>
        </div>

        <DateRangePicker value={dateRange} onChange={setDateRange} dataThrough={dataThrough} />

        <SpecialtyCocktailsPanel items={barTopItems} colors={categoryColors} />

        <PackageDetailTable
          items={packageItems}
          colors={categoryColors}
          onItemClick={(item) => {
            setHistorySource('packages');
            setSelectedItem(item);
          }}
        />
      </div>

      {selectedItem && (
        <ItemHistoryPanel
          item={selectedItem}
          transactions={historySource === 'packages' ? packageFiltered : raw.filter(
            (r) => r.department === 'Bar' && r.name === selectedItem.name,
          )}
          colors={categoryColors}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </main>
  );
}

export default function SpecialsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen pb-16 flex items-center justify-center">
        <div className="text-secondary animate-pulse text-lg">Loading...</div>
      </div>
    }>
      <SpecialsContent />
    </Suspense>
  );
}
