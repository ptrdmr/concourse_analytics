'use client';

import { useState, useMemo, useEffect, Suspense } from 'react';
import { Nav } from '@/components/Nav';
import { DateRangePicker } from '@/components/dashboard/DateRangePicker';
import { DayShapeChart } from '@/components/dashboard/DayShapeChart';
import { DaypartHeatmap } from '@/components/dashboard/DaypartHeatmap';
import { TimeSlotTopItems } from '@/components/dashboard/TimeSlotTopItems';
import { DaypartItemFilter } from '@/components/dashboard/DaypartItemFilter';
import { CategoryMultiSelect } from '@/components/dashboard/CategoryMultiSelect';
import {
  useIntradayIndex,
  useIntradayData,
  useIntradayDepartments,
  type IntradayFilters,
} from '@/hooks/useIntraday';
import { getYTD } from '@/lib/date-ranges';
import type { DateRange } from '@/lib/date-ranges';
import { useUrlDateRange, useUrlString } from '@/hooks/useUrlFilters';
import { buildDaypartsSummary } from '@/lib/build-data-summary';
import { useDataContext } from '@/context/DataContext';
import {
  buildDayShapeSeries,
  buildHeatmap,
  buildLaborDayShape,
  countDaysByDow,
  countDaysByDowFromData,
  topItemsForSlot,
  getDayLabel,
} from '@/lib/intraday';
import { useIntradayLabor } from '@/hooks/useIntradayLabor';
import type { IntradayMetric, TimeResolution } from '@/lib/intraday';

const ALL_DOW = [0, 1, 2, 3, 4, 5, 6];

const DAY_OPTIONS = [
  { dow: 1, label: 'Mon' },
  { dow: 2, label: 'Tue' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' },
  { dow: 5, label: 'Fri' },
  { dow: 6, label: 'Sat' },
  { dow: 0, label: 'Sun' },
];

const RESOLUTION_OPTIONS: { value: TimeResolution; label: string }[] = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hr' },
  { value: 120, label: '2 hr' },
];

export default function DaypartsPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 text-center text-muted animate-pulse">
          Loading dayparts...
        </div>
      </main>
    }>
      <DaypartsContent />
    </Suspense>
  );
}

function DaypartsContent() {
  const { setDataSummary } = useDataContext();
  const { index, loading: indexLoading, error: indexError } = useIntradayIndex();
  const departments = useIntradayDepartments(index);

  const [department, setDepartment] = useUrlString('dept', 'All');
  const [dateRange, setDateRange] = useUrlDateRange(getYTD());
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [resolution, setResolution] = useState<TimeResolution>(60);
  const [metric, setMetric] = useState<IntradayMetric>('quantity');
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [showLabor, setShowLabor] = useState(true);

  const { laborDays, available: laborAvailable } = useIntradayLabor();

  useEffect(() => {
    if (departments.length > 0 && !departments.includes(department)) {
      setDepartment('All');
    }
  }, [departments, department]);

  const filters: IntradayFilters = useMemo(
    () => ({ department, dateRange, daysOfWeek, categories, selectedItems }),
    [department, dateRange, daysOfWeek, categories, selectedItems],
  );

  const { filteredSales, dayCount, categories: availableCategories, availableItems, loading, isReady } =
    useIntradayData(index, filters);

  const singleDay = dateRange !== null && dateRange[0] === dateRange[1];

  const effectiveDayCount = useMemo(() => {
    if (singleDay) return 1;
    if (dateRange) return dayCount;
    const uniqueDates = new Set<string>();
    for (const r of filteredSales) {
      if (daysOfWeek.length === 0 || daysOfWeek.includes(new Date(r.date + 'T12:00:00').getDay())) {
        uniqueDates.add(r.date);
      }
    }
    return uniqueDates.size || 1;
  }, [dateRange, dayCount, filteredSales, daysOfWeek, singleDay]);

  const dayCountsByDow = useMemo(() => {
    if (dateRange) return countDaysByDow(dateRange, daysOfWeek);
    return countDaysByDowFromData(filteredSales, daysOfWeek);
  }, [dateRange, daysOfWeek, filteredSales]);

  const dayShapeSeries = useMemo(
    () => buildDayShapeSeries(
      filteredSales,
      resolution,
      daysOfWeek,
      dayCountsByDow,
      singleDay,
    ),
    [filteredSales, resolution, daysOfWeek, dayCountsByDow, singleDay],
  );

  const singleSeriesView = dayShapeSeries.length === 1;

  const laborDayCount = useMemo(() => {
    if (singleDay) return 1;
    if (daysOfWeek.length === 1) return dayCountsByDow[daysOfWeek[0]] || effectiveDayCount;
    return effectiveDayCount;
  }, [singleDay, daysOfWeek, dayCountsByDow, effectiveDayCount]);

  const laborSeries = useMemo(() => {
    if (!laborAvailable || !singleSeriesView || daysOfWeek.length === 0) return [];
    const dayOfWeek = singleDay ? null : (daysOfWeek.length === 1 ? daysOfWeek[0] : null);
    return buildLaborDayShape(laborDays, {
      dateRange,
      dayOfWeek,
      resolution,
      dayCount: laborDayCount,
      singleDay,
    });
  }, [
    laborAvailable,
    singleSeriesView,
    daysOfWeek,
    laborDays,
    dateRange,
    resolution,
    laborDayCount,
    singleDay,
  ]);

  const canShowLaborToggle = laborAvailable && singleSeriesView && daysOfWeek.length > 0;

  const heatmapCells = useMemo(() => {
    return buildHeatmap(filteredSales, resolution, dayCountsByDow);
  }, [filteredSales, resolution, dayCountsByDow]);

  const topItems = useMemo(
    () => topItemsForSlot(filteredSales, selectedSlot, resolution, effectiveDayCount),
    [filteredSales, selectedSlot, resolution, effectiveDayCount],
  );

  const summaryText = useMemo(() => {
    if (!isReady) return '';
    let peakSlot: string | undefined;
    let peakValue: number | undefined;
    for (const series of dayShapeSeries) {
      for (const slot of series.slots) {
        const val = metric === 'revenue' ? slot.avgRevenue : slot.avgQuantity;
        if (peakValue == null || val > peakValue) {
          peakValue = val;
          peakSlot = slot.label;
        }
      }
    }
    return buildDaypartsSummary({
      department,
      dateRange,
      metric,
      dayCount,
      peakSlot,
      peakValue,
    });
  }, [isReady, dayShapeSeries, department, dateRange, metric, dayCount]);

  useEffect(() => {
    if (summaryText) setDataSummary(summaryText);
  }, [summaryText, setDataSummary]);

  const allDaysSelected =
    daysOfWeek.length === ALL_DOW.length && ALL_DOW.every(d => daysOfWeek.includes(d));

  function selectAllDays() {
    setDaysOfWeek(ALL_DOW);
  }

  function toggleDay(dow: number) {
    setDaysOfWeek(prev =>
      prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow],
    );
  }

  if (indexLoading) {
    return (
      <main className="min-h-screen">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 text-center text-muted animate-pulse">
          Loading dayparts data...
        </div>
      </main>
    );
  }

  if (indexError || !index) {
    return (
      <main className="min-h-screen">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 text-center">
          <p className="text-red-400 mb-2">Failed to load intraday data.</p>
          <p className="text-sm text-muted">Run <code className="text-accent">python scripts/export_dashboards.py</code> to generate intraday JSON.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gradient">Dayparts</h1>
          <p className="text-sm text-muted mt-1">
            Item sales throughout the business day — peak hours and staffing patterns
          </p>
        </div>

        {/* Department */}
        <div className="flex flex-wrap gap-2">
          {departments.map(dept => (
            <button
              key={dept}
              onClick={() => { setDepartment(dept); setCategories([]); setSelectedItems([]); setSelectedSlot(null); }}
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

        {/* Date range */}
        <DateRangePicker value={dateRange} onChange={setDateRange} />

        {/* Day of week */}
        <div className="space-y-2">
          <p className="text-xs text-muted uppercase tracking-wide">Day of week</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={selectAllDays}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                allDaysSelected
                  ? 'bg-accent/20 text-accent border border-accent/40'
                  : 'bg-white/5 text-muted hover:text-secondary border border-transparent'
              }`}
            >
              All
            </button>
            {DAY_OPTIONS.map(({ dow, label }) => (
              <button
                key={dow}
                onClick={() => toggleDay(dow)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  daysOfWeek.includes(dow)
                    ? 'bg-accent/20 text-accent border border-accent/40'
                    : 'bg-white/5 text-muted hover:text-secondary border border-transparent'
                }`}
              >
                {label}
              </button>
            ))}
            {daysOfWeek.length > 0 && (
              <button
                onClick={() => setDaysOfWeek([])}
                className="px-3 py-1.5 rounded-full text-xs text-muted hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-xs text-muted">
            {daysOfWeek.length === 0
              ? 'No days selected — pick days or click All to view patterns'
              : `Showing: ${
                  allDaysSelected
                    ? 'All days'
                    : [...daysOfWeek]
                        .sort((a, b) => [1, 2, 3, 4, 5, 6, 0].indexOf(a) - [1, 2, 3, 4, 5, 6, 0].indexOf(b))
                        .map(d => getDayLabel(d))
                        .join(', ')
                } · ${dayCount} matching days`}
          </p>
        </div>

        {/* Resolution + metric */}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex gap-1.5">
            {RESOLUTION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => { setResolution(opt.value); setSelectedSlot(null); }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  resolution === opt.value
                    ? 'bg-accent/20 text-accent border border-accent/40'
                    : 'bg-white/5 text-muted hover:text-secondary border border-transparent'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {(['quantity', 'revenue'] as IntradayMetric[]).map(m => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
                  metric === m
                    ? 'bg-accent/20 text-accent border border-accent/40'
                    : 'bg-white/5 text-muted hover:text-secondary border border-transparent'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {canShowLaborToggle && (
            <button
              type="button"
              onClick={() => setShowLabor(prev => !prev)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                showLabor
                  ? 'bg-[#f97316]/20 text-[#f97316] border border-[#f97316]/40'
                  : 'bg-white/5 text-muted hover:text-secondary border border-transparent'
              }`}
            >
              {showLabor ? 'Labor overlay on' : 'Labor overlay off'}
            </button>
          )}
        </div>

        {/* Item + category filters */}
        <div className="flex flex-wrap items-start gap-6">
          <DaypartItemFilter
            items={availableItems}
            selected={selectedItems}
            onChange={setSelectedItems}
          />
          <CategoryMultiSelect
            categories={availableCategories}
            selected={categories}
            onChange={setCategories}
          />
        </div>

        {loading && (
          <p className="text-sm text-muted animate-pulse">
            Loading {department === 'All' ? 'all departments' : department} data...
          </p>
        )}

        {isReady && daysOfWeek.length === 0 && !loading && (
          <div className="card p-8 text-center text-muted">
            Select one or more days of the week, or click All, to view daypart patterns.
          </div>
        )}

        {isReady && daysOfWeek.length > 0 && filteredSales.length === 0 && !loading && (
          <div className="card p-8 text-center text-muted">
            No sales data for the selected filters. Try expanding the date range or changing department.
          </div>
        )}

        {isReady && daysOfWeek.length > 0 && filteredSales.length > 0 && (
          <div className="space-y-6">
            <DayShapeChart
              series={dayShapeSeries}
              metric={metric}
              resolution={resolution}
              singleDay={singleDay}
              laborSeries={laborSeries}
              showLabor={showLabor && canShowLaborToggle}
              onSlotClick={setSelectedSlot}
            />

            <DaypartHeatmap
              cells={heatmapCells}
              metric={metric}
              resolution={resolution}
              selectedSlot={selectedSlot}
              onCellClick={(slot) => setSelectedSlot(slot)}
            />

            <TimeSlotTopItems
              items={topItems}
              selectedSlot={selectedSlot}
              resolution={resolution}
              metric={metric}
              singleDay={singleDay}
            />
          </div>
        )}
      </div>
    </main>
  );
}
