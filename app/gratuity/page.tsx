'use client';

import { useMemo, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { useGratuity } from '@/hooks/useGratuity';
import type { GratuityDay, GratuityDaypart, GratuityHouse } from '@/types';

const HOUSES: GratuityHouse[] = ['Bar', 'Cafe', 'Other'];
const DAYPARTS: { key: GratuityDaypart; label: string }[] = [
  { key: 'pre17', label: 'Before 5pm' },
  { key: 'post17', label: 'After 5pm' },
];

type Mode = 'day' | 'range';

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function houseTotal(employees: Record<string, number> | undefined): number {
  if (!employees) return 0;
  return Object.values(employees).reduce((sum, n) => sum + n, 0);
}

function sortedEmployees(employees: Record<string, number> | undefined) {
  return Object.entries(employees ?? {})
    .filter(([, amt]) => amt !== 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function daypartTotal(day: GratuityDay, key: GratuityDaypart): number {
  return HOUSES.reduce((sum, house) => sum + houseTotal(day[key][house]), 0);
}

function houseDayTotal(day: GratuityDay, house: GratuityHouse): number {
  return houseTotal(day.pre17[house]) + houseTotal(day.post17[house]);
}

function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function clampIso(iso: string, min: string, max: string): string {
  if (iso < min) return min;
  if (iso > max) return max;
  return iso;
}

function stepToTippedDate(current: string, dates: string[], dir: -1 | 1): string {
  if (!dates.length) return current;
  if (dir < 0) {
    const prev = [...dates].reverse().find((d) => d < current);
    return prev ?? dates[0];
  }
  const next = dates.find((d) => d > current);
  return next ?? dates[dates.length - 1];
}

function emptyHouses(): Record<GratuityHouse, Record<string, number>> {
  return { Bar: {}, Cafe: {}, Other: {} };
}

function addAmounts(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = { ...(a ?? {}) };
  for (const [name, amt] of Object.entries(b ?? {})) {
    out[name] = round2((out[name] ?? 0) + amt);
  }
  return out;
}

function mergeDays(days: GratuityDay[]): GratuityDay {
  const acc: GratuityDay = {
    pre17: emptyHouses(),
    post17: emptyHouses(),
    meta: { lines: 0, zeroLines: 0, tipOut: 0, unknownTimes: 0, unmappedTerminals: [] },
  };
  const unmapped = new Set<string>();
  for (const day of days) {
    for (const part of DAYPARTS.map((d) => d.key)) {
      for (const house of HOUSES) {
        acc[part][house] = addAmounts(acc[part][house], day[part][house]);
      }
    }
    acc.meta.lines += day.meta.lines;
    acc.meta.zeroLines += day.meta.zeroLines;
    acc.meta.tipOut = round2(acc.meta.tipOut + day.meta.tipOut);
    acc.meta.unknownTimes = (acc.meta.unknownTimes ?? 0) + (day.meta.unknownTimes ?? 0);
    for (const term of day.meta.unmappedTerminals) unmapped.add(term);
  }
  acc.meta.unmappedTerminals = [...unmapped].sort();
  return acc;
}

export default function GratuityPage() {
  const { data, dates, loading, available } = useGratuity();
  const [mode, setMode] = useState<Mode>('day');
  const [selectedDate, setSelectedDate] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  const minDate = dates[0] ?? '';
  const maxDate = dates[dates.length - 1] ?? '';

  useEffect(() => {
    if (!dates.length) return;
    if (!selectedDate || !dates.includes(selectedDate)) {
      setSelectedDate(dates[dates.length - 1]);
    }
    if (!rangeEnd || rangeEnd > dates[dates.length - 1]) {
      const end = dates[dates.length - 1];
      const start = clampIso(shiftIso(end, -6), dates[0], end);
      setRangeEnd(end);
      setRangeStart(start);
    }
  }, [dates, selectedDate, rangeEnd]);

  const daypartHour = data?.daypartHour ?? 17;

  const view = useMemo(() => {
    if (!data) return null;
    if (mode === 'day') {
      const day = data.dates[selectedDate];
      if (!day) return { day: null, daysUsed: 0, start: selectedDate, end: selectedDate };
      return { day, daysUsed: 1, start: selectedDate, end: selectedDate };
    }
    const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
    const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
    const slice = dates.filter((d) => d >= start && d <= end);
    if (!slice.length) return { day: null, daysUsed: 0, start, end };
    return {
      day: mergeDays(slice.map((d) => data.dates[d])),
      daysUsed: slice.length,
      start,
      end,
    };
  }, [data, dates, mode, selectedDate, rangeStart, rangeEnd]);

  const totals = useMemo(() => {
    if (!view?.day) return null;
    const bar = houseDayTotal(view.day, 'Bar');
    const cafe = houseDayTotal(view.day, 'Cafe');
    const other = houseDayTotal(view.day, 'Other');
    return { bar, cafe, other, all: bar + cafe + other };
  }, [view]);

  const canPrevDay = Boolean(minDate && selectedDate > minDate);
  const canNextDay = Boolean(maxDate && selectedDate < maxDate);
  const canPrevRange = Boolean(minDate && rangeStart > minDate);
  const canNextRange = Boolean(maxDate && rangeEnd < maxDate);

  function goDay(dir: -1 | 1) {
    setSelectedDate(stepToTippedDate(selectedDate, dates, dir));
  }

  function goRange(dir: -1 | 1) {
    if (!minDate || !maxDate) return;
    const nextStart = clampIso(shiftIso(rangeStart, dir), minDate, maxDate);
    const nextEnd = clampIso(shiftIso(rangeEnd, dir), minDate, maxDate);
    if (nextStart <= nextEnd) {
      setRangeStart(nextStart);
      setRangeEnd(nextEnd);
    }
  }

  function setRange(start: string, end: string) {
    setRangeStart(start);
    setRangeEnd(end);
  }

  function switchMode(next: Mode) {
    setMode(next);
    if (next === 'range' && selectedDate) {
      const end = selectedDate;
      const start = clampIso(shiftIso(end, -6), minDate || end, end);
      setRangeStart(start);
      setRangeEnd(end);
    }
    if (next === 'day' && rangeEnd) {
      setSelectedDate(dates.includes(rangeEnd) ? rangeEnd : stepToTippedDate(rangeEnd, dates, -1));
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-secondary animate-pulse text-lg mb-2">Loading gratuity…</div>
          <p className="text-sm text-muted">Reading tip dayparts from published tickets</p>
        </div>
      </div>
    );
  }

  if (!available || !data) {
    return (
      <main className="min-h-screen pb-16">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <h1 className="text-2xl font-bold text-gradient">Gratuity</h1>
          <p className="text-secondary mt-2">
            No gratuity file yet. From this machine run{' '}
            <code className="text-accent">python scripts/export_dashboards.py --from-tickets</code>
            . Nightly will write it on the next ETL.
          </p>
        </div>
      </main>
    );
  }

  const periodLabel =
    mode === 'day'
      ? selectedDate
        ? formatDateLabel(selectedDate)
        : ''
      : view
        ? `${formatShortDate(view.start)} – ${formatShortDate(view.end)}`
        : '';

  return (
    <main className="min-h-screen pb-16">
      <Nav />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gradient">Gratuity</h1>
          <p className="text-secondary text-sm mt-1">
            Tips received, split before and after {daypartHour}:00 by ticket open time, then by
            the terminal that rang the ticket.
          </p>
        </div>

        <div className="card p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => switchMode('day')}
              className={`px-4 py-2 rounded-full text-sm transition-colors ${
                mode === 'day'
                  ? 'bg-accent/15 text-accent'
                  : 'text-secondary hover:bg-overlay/5 hover:text-foreground'
              }`}
            >
              Day
            </button>
            <button
              type="button"
              onClick={() => switchMode('range')}
              className={`px-4 py-2 rounded-full text-sm transition-colors ${
                mode === 'range'
                  ? 'bg-accent/15 text-accent'
                  : 'text-secondary hover:bg-overlay/5 hover:text-foreground'
              }`}
            >
              Date range
            </button>
          </div>

          {mode === 'day' ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-secondary">Date</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => goDay(-1)}
                  disabled={!canPrevDay}
                  className="p-2 rounded-lg bg-overlay/5 text-secondary hover:bg-overlay/10 hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Previous day"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <input
                  type="date"
                  value={selectedDate}
                  min={minDate}
                  max={maxDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
                <button
                  type="button"
                  onClick={() => goDay(1)}
                  disabled={!canNextDay}
                  className="p-2 rounded-lg bg-overlay/5 text-secondary hover:bg-overlay/10 hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Next day"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => goRange(-1)}
                  disabled={!canPrevRange}
                  className="p-2 rounded-lg bg-overlay/5 text-secondary hover:bg-overlay/10 hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Previous period"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <label className="text-sm text-secondary" htmlFor="grat-start">
                  From
                </label>
                <input
                  id="grat-start"
                  type="date"
                  value={rangeStart}
                  min={minDate}
                  max={maxDate}
                  onChange={(e) => setRange(e.target.value, rangeEnd)}
                  className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
                <label className="text-sm text-secondary" htmlFor="grat-end">
                  To
                </label>
                <input
                  id="grat-end"
                  type="date"
                  value={rangeEnd}
                  min={minDate}
                  max={maxDate}
                  onChange={(e) => setRange(rangeStart, e.target.value)}
                  className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
                <button
                  type="button"
                  onClick={() => goRange(1)}
                  disabled={!canNextRange}
                  className="p-2 rounded-lg bg-overlay/5 text-secondary hover:bg-overlay/10 hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Next period"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {periodLabel && (
            <p className="text-sm text-secondary">
              {periodLabel}
              {mode === 'range' && view && (
                <>
                  {' '}
                  · {view.daysUsed} day{view.daysUsed === 1 ? '' : 's'} with tips
                </>
              )}
            </p>
          )}
        </div>

        {!view?.day && (
          <p className="text-secondary">No tips recorded in this {mode === 'day' ? 'date' : 'range'}.</p>
        )}

        {view?.day && totals && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SummaryCard
                label={mode === 'day' ? 'Day total' : 'Period total'}
                value={money(totals.all)}
              />
              <SummaryCard label="Bar" value={money(totals.bar)} hint="Bar terminals" />
              <SummaryCard label="Cafe" value={money(totals.cafe)} hint="CAFE1 only" />
              <SummaryCard label="Other" value={money(totals.other)} hint="SYNCSERVER + unmapped" />
            </div>

            {DAYPARTS.map(({ key, label }) => (
              <section key={key} className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-lg sm:text-xl font-semibold text-foreground">{label}</h2>
                  <span className="text-sm text-secondary">{money(daypartTotal(view.day, key))}</span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {HOUSES.map((house) => (
                    <HouseCard
                      key={`${key}-${house}`}
                      house={house}
                      employees={view.day[key][house] ?? {}}
                    />
                  ))}
                </div>
              </section>
            ))}

            <p className="text-xs text-muted leading-relaxed max-w-3xl">
              {daypartHour}:00 is ticket-open time, the same clock the POS gratuity report uses.
              Bar amounts are pool shares, not individual sales. House is the ticket terminal:
              BAR1 / BAR2 / BAR3 / MPOS2 / MPOS6 are Bar, CAFE1 is Cafe, SYNCSERVER is Other.
              {view.day.meta.unmappedTerminals.length > 0 && (
                <>
                  {' '}
                  Unmapped terminals {mode === 'day' ? 'this day' : 'in this range'} (filed under
                  Other): {view.day.meta.unmappedTerminals.join(', ')}.
                </>
              )}
              {view.day.meta.tipOut > 0 && (
                <> Gratuity-out (tip-out) is {money(view.day.meta.tipOut)} and is not subtracted yet.</>
              )}{' '}
              {view.day.meta.zeroLines} of {view.day.meta.lines} tip lines were $0.00 and are omitted
              from amounts.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="text-xl font-semibold text-foreground mt-1">{value}</p>
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
}

function HouseCard({
  house,
  employees,
}: {
  house: GratuityHouse;
  employees: Record<string, number>;
}) {
  const rows = sortedEmployees(employees);
  const total = houseTotal(employees);
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-foreground">{house}</h3>
        <span className="text-sm text-accent">{money(total)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No tips</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted text-left">
              <th className="font-medium pb-2">Employee</th>
              <th className="font-medium pb-2 text-right">Tips</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, amt]) => (
              <tr key={name} className="border-t border-border/60">
                <td className="py-1.5 text-foreground">{name}</td>
                <td className="py-1.5 text-right tabular-nums">{money(amt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
