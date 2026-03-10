'use client';

import { useState, useMemo, Suspense } from 'react';
import { useTransactions, useSummary, useFilteredData, useModifiers, useModifierTransactions } from '@/hooks/useTransactions';
import type { Filters } from '@/types';
import { aggregateByPeriod, type PeriodGranularity } from '@/lib/aggregate-by-period';
import { Nav } from '@/components/Nav';
import { ComparisonPeriodPicker } from '@/components/dashboard/ComparisonPeriodPicker';
import { ComparisonKpiCards } from '@/components/dashboard/ComparisonKpiCards';
import { ComparisonBarChart } from '@/components/dashboard/ComparisonBarChart';
import { ComparisonCategoryChart } from '@/components/dashboard/ComparisonCategoryChart';
import type { DateRange } from '@/lib/date-ranges';

const GRANULARITIES: { id: PeriodGranularity; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

function getDefaultPeriods(): { periodA: DateRange; periodB: DateRange } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const today = `${y}-${m}-${d}`;
  return {
    periodA: [`${y - 1}-01-01`, `${y - 1}-12-31`],
    periodB: [`${y}-01-01`, today],
  };
}

function CompareContent() {
  const { raw, loading: txnLoading } = useTransactions();
  const { summary, loading: sumLoading } = useSummary();
  const { modifiers } = useModifiers();
  const { modifierTransactions, loading: modTxnLoading } = useModifierTransactions();

  const [periodA, setPeriodA] = useState<DateRange>(() => getDefaultPeriods().periodA);
  const [periodB, setPeriodB] = useState<DateRange>(() => getDefaultPeriods().periodB);
  const [department, setDepartment] = useState('All');
  const [categories, setCategories] = useState<string[]>([]);
  const [granularity, setGranularity] = useState<PeriodGranularity>('week');

  const departments = useMemo(() => {
    if (!summary) return [];
    const depts = Object.keys(summary.departments).filter(d => d !== 'Vending Machines');
    const sorted = depts.sort((a, b) =>
      (summary.departments[b]?.revenue || 0) - (summary.departments[a]?.revenue || 0)
    );
    if (!sorted.includes('Modifiers')) sorted.push('Modifiers');
    return ['All', ...sorted];
  }, [summary]);

  const availableCategories = useMemo(() => {
    if (!summary || department === 'All') {
      const cats = new Set<string>();
      if (summary) {
        Object.values(summary.departments).forEach(d => d.categories.forEach(c => cats.add(c)));
      }
      return Array.from(cats).sort();
    }
    if (department === 'Modifiers') {
      const cats = new Set(modifiers.map(m => m.subdepartment || 'Other').filter(Boolean));
      return Array.from(cats).sort();
    }
    return summary.departments[department]?.categories || [];
  }, [summary, department, modifiers]);

  const sourceData = useMemo(() => {
    const isModifiers = department === 'Modifiers';
    return isModifiers ? modifierTransactions : raw;
  }, [department, raw, modifierTransactions]);

  const filtersA: Filters = useMemo(() => ({
    department,
    dateRange: periodA,
    categories,
    searchTerm: '',
  }), [department, periodA, categories]);

  const filtersB: Filters = useMemo(() => ({
    department,
    dateRange: periodB,
    categories,
    searchTerm: '',
  }), [department, periodB, categories]);

  const filteredA = useFilteredData(sourceData, filtersA);
  const filteredB = useFilteredData(sourceData, filtersB);

  const periodDataA = useMemo(
    () => aggregateByPeriod(filteredA.filtered, granularity),
    [filteredA.filtered, granularity]
  );
  const periodDataB = useMemo(
    () => aggregateByPeriod(filteredB.filtered, granularity),
    [filteredB.filtered, granularity]
  );

  const loading = txnLoading || sumLoading || (department === 'Modifiers' && modTxnLoading);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-secondary animate-pulse text-lg mb-2">Loading data...</div>
          <p className="text-sm text-muted">Processing transaction data</p>
        </div>
      </div>
    );
  }

  const categoryColors = summary?.categoryColors || {};

  return (
    <main className="min-h-screen">
      <Nav />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Period Comparison</h1>
          <p className="text-sm text-muted">
            Compare two time frames side by side. Follow the numbered sections below to walk through the page.
          </p>
        </div>

        <section>
          <h2 className="text-lg font-semibold text-white mb-1">1. Period A & B</h2>
          <p className="text-sm text-muted mb-4">
            Select start and end dates for each comparison period. Period A is your baseline; Period B is what you compare against.
          </p>
          <ComparisonPeriodPicker
            periodA={periodA}
            periodB={periodB}
            onPeriodAChange={(r) => r && setPeriodA(r)}
            onPeriodBChange={(r) => r && setPeriodB(r)}
          />
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-1">2. Department</h2>
          <p className="text-sm text-muted mb-4">
            Filter by department (All, Bowling, Bar, Food, etc.) to focus on a specific area of your business.
          </p>
          <div className="flex flex-wrap gap-2">
            {departments.map(dept => (
              <button
                key={dept}
                onClick={() => setDepartment(dept)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  department === dept
                    ? 'bg-accent text-black'
                    : 'bg-white/5 text-secondary hover:bg-white/10 hover:text-white'
                }`}
              >
                {dept}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-1">3. Granularity</h2>
          <p className="text-sm text-muted mb-4">
            Choose how to break down the data within each period: Day, Week, Month, or Year. This affects the Sales by Period chart.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            {GRANULARITIES.map(g => (
              <button
                key={g.id}
                onClick={() => setGranularity(g.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  granularity === g.id
                    ? 'bg-accent/20 text-accent border border-accent/40'
                    : 'bg-white/5 text-secondary hover:bg-white/10 hover:text-white border border-transparent'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-1">4. Category</h2>
          <p className="text-sm text-muted mb-4">
            Narrow further by selecting one or more categories within the chosen department.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {availableCategories.slice(0, 12).map(cat => {
              const active = categories.includes(cat);
              return (
                <button
                  key={cat}
                  onClick={() => {
                    setCategories(active ? categories.filter(c => c !== cat) : [...categories, cat]);
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    active
                      ? 'bg-accent/20 text-accent border border-accent/40'
                      : 'bg-white/5 text-muted hover:bg-secondary border border-transparent'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-1">5. KPI Cards</h2>
          <p className="text-sm text-muted mb-4">
            Compare Sales, Quantity, Transactions, and Unique Items between the two periods. The percentage shows change from Period A to Period B.
          </p>
          <ComparisonKpiCards
            kpisA={filteredA.kpis}
            kpisB={filteredB.kpis}
            labelA="Period A"
            labelB="Period B"
          />
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section>
            <h2 className="text-lg font-semibold text-white mb-1">6. Sales by Period</h2>
            <p className="text-sm text-muted mb-4">
              Bar chart comparing Period A vs Period B at your chosen granularity (e.g., Week 1 vs Week 1, Month 1 vs Month 1).
            </p>
            <ComparisonBarChart
              dataA={periodDataA}
              dataB={periodDataB}
              granularity={granularity}
            />
          </section>
          <section>
            <h2 className="text-lg font-semibold text-white mb-1">7. Sales by Department</h2>
            <p className="text-sm text-muted mb-4">
              Horizontal bar chart comparing department performance across both periods.
            </p>
            <ComparisonCategoryChart
              dataA={filteredA.departmentBreakdown}
              dataB={filteredB.departmentBreakdown}
              colors={categoryColors}
              title="Sales by Department"
              subtitle="Period A vs Period B by department"
            />
          </section>
        </div>
      </div>
    </main>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-secondary animate-pulse text-lg">Loading...</div>
        </div>
      }
    >
      <CompareContent />
    </Suspense>
  );
}
