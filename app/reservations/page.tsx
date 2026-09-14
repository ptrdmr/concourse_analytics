'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { Search, X } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { DateRangePicker } from '@/components/dashboard/DateRangePicker';
import { ReservationComparePicker } from '@/components/dashboard/ReservationComparePicker';
import { ReservationTrendsChart } from '@/components/dashboard/ReservationTrendsChart';
import { ReservationCompareCharts } from '@/components/dashboard/ReservationCompareCharts';
import { ReservationWeekdayChart } from '@/components/dashboard/ReservationWeekdayChart';
import { ReservationTypeTable } from '@/components/dashboard/ReservationTypeTable';
import { useSummary } from '@/hooks/useTransactions';
import { useReservations } from '@/hooks/useReservations';
import { useUrlReservationsState } from '@/hooks/useUrlFilters';
import { useDataContext } from '@/context/DataContext';
import {
  compareYearOptions,
  defaultCompareYear,
  getLast90Days,
  shiftRangeToYear,
  type DateRange,
} from '@/lib/date-ranges';
import { formatNumber } from '@/lib/format';
import {
  GENERAL_LANE,
  RESERVATION_GROUPS,
  TYPE_COLORS,
  alignWeeklyCompare,
  buildReservationSummary,
  chartMode,
  formatPctChange,
  groupTotalsForBar,
  matchingTypes,
  pctChange,
  resolveRange,
  seriesTotals,
  weekdayCounts,
  weekOverWeekChange,
  weeklyByGroups,
  weeklyByTypes,
  weeklyTabCounts,
  weeklyTotals,
  isFullTypeSelection,
} from '@/lib/reservations';

const ALL_GROUP_IDS = RESERVATION_GROUPS.map((g) => g.id);

function ReservationKpis({
  compare,
  totals,
  totalsB,
  wow,
  fullSelection,
  currentLabel,
  baselineLabel,
}: {
  compare: boolean;
  totals: ReturnType<typeof seriesTotals>;
  totalsB?: ReturnType<typeof seriesTotals>;
  wow: number | null;
  fullSelection: boolean;
  currentLabel: string;
  baselineLabel: string;
}) {
  const bookingsA = fullSelection ? totals.distinctTabs : totals.cellSum;
  const bookingsB = totalsB ? (fullSelection ? totalsB.distinctTabs : totalsB.cellSum) : 0;
  const bookingsCaption = fullSelection ? 'Distinct tabs' : 'Selected type counts';

  if (compare && totalsB) {
    const cards = [
      { label: 'Bookings', a: bookingsA, b: bookingsB, caption: bookingsCaption },
      { label: 'Named programs', a: totals.named, b: totalsB.named, caption: '' },
      { label: 'General Lane', a: totals.generalLane, b: totalsB.generalLane, caption: '' },
      {
        label: 'Top type',
        a: totals.topType?.count ?? 0,
        b: totalsB.topType?.count ?? 0,
        caption: totals.topType?.name ?? '',
      },
    ];
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card p-5">
            <div className="text-sm text-secondary mb-1">{c.label}</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-xs text-muted">{currentLabel}</div>
                <div className="font-mono font-semibold text-foreground">{formatNumber(c.a)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">{baselineLabel}</div>
                <div className="font-mono font-semibold text-secondary">{formatNumber(c.b)}</div>
              </div>
            </div>
            <div className={`mt-2 text-xs font-mono ${(pctChange(c.b, c.a) ?? 0) >= 0 ? 'text-accent' : 'text-red-400'}`}>
              {formatPctChange(pctChange(c.b, c.a))}
              {c.caption ? <span className="text-muted"> · {c.caption}</span> : null}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const single = [
    { label: 'Bookings', value: formatNumber(bookingsA), caption: bookingsCaption, tone: 'gradient' as const },
    { label: 'Named programs', value: formatNumber(totals.named), caption: 'Excludes General Lane', tone: 'gradient' as const },
    { label: 'General Lane', value: formatNumber(totals.generalLane), caption: 'Walk-in / standard rate', tone: 'gradient' as const },
    fullSelection
      ? {
          label: 'Week over week',
          value: formatPctChange(wow),
          caption: totals.topType ? `Top: ${totals.topType.name}` : 'Complete weeks only',
          tone: (wow ?? 0) >= 0 ? 'up' as const : 'down' as const,
        }
      : {
          label: 'Top type',
          value: formatNumber(totals.topType?.count ?? 0),
          caption: totals.topType?.name ?? '—',
          tone: 'gradient' as const,
        },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {single.map((c) => (
        <div key={c.label} className="card p-5">
          <div className="text-sm text-secondary mb-1">{c.label}</div>
          <div className={`text-2xl font-bold font-mono ${
            c.tone === 'gradient' ? 'text-gradient' : c.tone === 'up' ? 'text-accent' : 'text-red-400'
          }`}>
            {c.value}
          </div>
          <div className="text-xs text-muted mt-1">{c.caption}</div>
        </div>
      ))}
    </div>
  );
}

function ReservationsContent() {
  const { setDataSummary } = useDataContext();
  const { summary } = useSummary();
  const { data, loading } = useReservations();

  const dataThrough = summary?.dateRange?.[1] ?? data?.dateRange?.[1] ?? null;
  const dataStart = summary?.dateRange?.[0] ?? data?.dateRange?.[0] ?? null;
  const defaults = useMemo(() => ({
    periodA: getLast90Days(dataThrough),
    vsYear: defaultCompareYear(dataThrough),
  }), [dataThrough]);

  const {
    compare,
    periodA,
    vsYear,
    setCompare,
    setPeriodA,
    setVsYear,
  } = useUrlReservationsState(defaults);

  const [selectedGroups, setSelectedGroups] = useState<string[]>(ALL_GROUP_IDS);
  const [search, setSearch] = useState('');

  const fallbackRange = data?.dateRange?.[0] && data?.dateRange?.[1]
    ? (data.dateRange as DateRange)
    : null;
  const rangeA = resolveRange(periodA, fallbackRange);
  const rangeB = rangeA ? shiftRangeToYear(rangeA, vsYear) : null;
  const currentYearLabel = rangeA ? rangeA[1].slice(0, 4) : 'Current';
  const yearChips = useMemo(() => {
    const opts = compareYearOptions(dataStart, dataThrough);
    if (opts.includes(vsYear)) return opts;
    return [vsYear, ...opts].sort((a, b) => b - a);
  }, [dataStart, dataThrough, vsYear]);

  const types = matchingTypes(search, selectedGroups, data?.types?.length ? data.types : RESERVATION_GROUPS.flatMap((g) => g.types));
  const mode = chartMode(selectedGroups, search);
  const rows = data?.rows ?? [];
  const dailyTabs = data?.dailyTabs ?? [];
  const fullSelection = isFullTypeSelection(types, data?.types ?? RESERVATION_GROUPS.flatMap((g) => g.types));

  const totals = useMemo(
    () => seriesTotals(rows, dailyTabs, rangeA, types),
    [rows, dailyTabs, rangeA, types],
  );
  const totalsB = useMemo(
    () => seriesTotals(rows, dailyTabs, rangeB, types),
    [rows, dailyTabs, rangeB, types],
  );
  const wow = useMemo(
    () => weekOverWeekChange(dailyTabs, rangeA, dataThrough),
    [dailyTabs, rangeA, dataThrough],
  );

  const tableWeeks = useMemo(
    () => weeklyByTypes(rows, rangeA, dataThrough, types),
    [rows, rangeA, dataThrough, types],
  );
  const weekTabs = useMemo(
    () => weeklyTabCounts(dailyTabs, rangeA),
    [dailyTabs, rangeA],
  );

  const chartSeries = useMemo(() => {
    if (mode === 'groups') {
      return RESERVATION_GROUPS.filter((g) => selectedGroups.includes(g.id)).map((g) => ({
        key: g.id,
        label: g.label,
        color: g.color,
      }));
    }
    return types.map((t) => ({
      key: t,
      label: t,
      color: TYPE_COLORS[t] || '#a3a3a3',
    }));
  }, [mode, selectedGroups, types]);

  const chartData = useMemo(() => {
    if (mode === 'groups') return weeklyByGroups(rows, rangeA, dataThrough, selectedGroups);
    return weeklyByTypes(rows, rangeA, dataThrough, types);
  }, [mode, rows, rangeA, dataThrough, selectedGroups, types]);

  const compareWeekly = useMemo(() => {
    const a = weeklyTotals(rows, rangeA, dataThrough, types);
    const b = weeklyTotals(rows, rangeB, dataThrough, types);
    return alignWeeklyCompare(a, b);
  }, [rows, rangeA, rangeB, dataThrough, types]);

  const compareBars = useMemo(() => {
    const a = groupTotalsForBar(totals, selectedGroups, mode, types);
    const b = groupTotalsForBar(totalsB, selectedGroups, mode, types);
    const bMap = Object.fromEntries(b.map((row) => [row.key, row.count]));
    return a.map((row) => ({
      key: row.key,
      label: row.label,
      color: row.color,
      current: row.count,
      baseline: bMap[row.key] || 0,
    }));
  }, [totals, totalsB, selectedGroups, mode, types]);

  const weekdayA = useMemo(
    () => weekdayCounts(rows, rangeA, GENERAL_LANE),
    [rows, rangeA],
  );
  const weekdayB = useMemo(
    () => weekdayCounts(rows, rangeB, GENERAL_LANE),
    [rows, rangeB],
  );
  const weekdayCompare = weekdayA.map((d, i) => ({
    day: d.day,
    current: d.count,
    baseline: weekdayB[i]?.count || 0,
  }));
  const showGeneralLane = types.includes(GENERAL_LANE);

  const summaryText = useMemo(
    () => buildReservationSummary({
      range: rangeA,
      compare,
      rangeB: compare ? rangeB : undefined,
      totals,
      totalsB: compare ? totalsB : undefined,
      vsYear: compare ? vsYear : undefined,
    }),
    [rangeA, rangeB, compare, totals, totalsB, vsYear],
  );

  useEffect(() => {
    if (summaryText) setDataSummary(summaryText);
  }, [summaryText, setDataSummary]);

  const loadingScreen = loading && !data?.rows?.length;

  function toggleGroup(id: string) {
    setSelectedGroups((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((g) => g !== id);
        return next.length === 0 ? prev : next;
      }
      return [...prev, id];
    });
  }

  function handleAllTime(range: DateRange | null, setter: (r: DateRange | null) => void) {
    if (range) {
      setter(range);
      return;
    }
    if (fallbackRange) setter(fallbackRange);
  }

  if (loadingScreen) {
    return (
      <div className="min-h-screen pb-16 flex items-center justify-center">
        <div className="text-secondary animate-pulse text-lg">Loading reservation data...</div>
      </div>
    );
  }

  return (
    <main className="min-h-screen pb-16">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gradient">Reservations</h1>
          <p className="text-sm text-muted mt-1">
            Realized party and lane bookings by week — one tab, one reservation
          </p>
        </div>

        <DateRangePicker
          value={rangeA}
          onChange={(r) => handleAllTime(r, setPeriodA)}
          dataThrough={dataThrough}
          trailing={
            <ReservationComparePicker
              compare={compare}
              onCompareChange={setCompare}
              years={yearChips}
              vsYear={vsYear}
              onYearChange={setVsYear}
            />
          }
          footnote={
            compare && rangeB
              ? `vs ${vsYear}: ${rangeB[0]} to ${rangeB[1]}`
              : null
          }
        />

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex flex-wrap gap-2">
            {RESERVATION_GROUPS.map((g) => {
              const active = selectedGroups.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleGroup(g.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    active ? 'bg-overlay/10 text-foreground' : 'bg-overlay/5 text-muted'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: g.color, opacity: active ? 1 : 0.3 }}
                  />
                  {g.label}
                </button>
              );
            })}
          </div>
          <div className="relative sm:ml-auto w-full sm:w-64">
            <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a reservation type"
              className="w-full pl-9 pr-8 py-2 rounded-lg bg-overlay/5 border border-border text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <ReservationKpis
          compare={compare}
          totals={totals}
          totalsB={compare ? totalsB : undefined}
          wow={wow}
          fullSelection={fullSelection}
          currentLabel={currentYearLabel}
          baselineLabel={String(vsYear)}
        />

        {compare ? (
          <ReservationCompareCharts
            weekly={compareWeekly}
            bars={compareBars}
            currentLabel={currentYearLabel}
            baselineLabel={String(vsYear)}
            currentRange={rangeA ? `${rangeA[0]} → ${rangeA[1]}` : undefined}
            baselineRange={rangeB ? `${rangeB[0]} → ${rangeB[1]}` : undefined}
          />
        ) : (
          <ReservationTrendsChart
            data={chartData}
            series={chartSeries}
            subtitle={
              mode === 'groups'
                ? 'One line per family. Select a single family to break out its types.'
                : 'Component types in the current selection'
            }
          />
        )}

        {showGeneralLane && (
          <ReservationWeekdayChart
            data={weekdayA}
            compare={compare}
            compareData={compare ? weekdayCompare : undefined}
            currentLabel={currentYearLabel}
            baselineLabel={String(vsYear)}
          />
        )}

        <ReservationTypeTable
          weeks={tableWeeks}
          types={types}
          selectedGroupIds={selectedGroups}
          totals={totals}
          distinctTabs={totals.distinctTabs}
          weekTabs={weekTabs}
          compare={compare}
          totalsB={compare ? totalsB : undefined}
          fullSelection={fullSelection}
          currentLabel={currentYearLabel}
          baselineLabel={String(vsYear)}
          onTypeClick={(type) => setSearch(type)}
        />
      </div>
    </main>
  );
}

export default function ReservationsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen pb-16 flex items-center justify-center">
        <div className="text-secondary animate-pulse text-lg">Loading...</div>
      </div>
    }>
      <ReservationsContent />
    </Suspense>
  );
}
