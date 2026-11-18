'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ServiceChargePanel } from '@/components/gratuity/ServiceChargePanel';
import { useGratuity } from '@/hooks/useGratuity';
import { useServiceCharges } from '@/hooks/useServiceCharges';
import type { GratuityDay, GratuityDaypart, GratuityHouse } from '@/types';

const HOUSES: GratuityHouse[] = ['Bar', 'Cafe', 'Other'];
const DAYPARTS: { key: GratuityDaypart; label: string }[] = [
  { key: 'pre17', label: 'Before 5pm' },
  { key: 'post17', label: 'After 5pm' },
];

type Mode = 'day' | 'range';
type RecordView = 'tips' | 'charges';

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

function formatShortDate(iso: string): string {
  const [year, month, date] = iso.split('-').map(Number);
  if (!year || !month || !date) return iso;
  return new Date(year, month - 1, date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function shiftIso(iso: string, days: number): string {
  const [year, month, date] = iso.split('-').map(Number);
  const dt = new Date(year, month - 1, date);
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
  if (dir < 0) return [...dates].reverse().find((day) => day < current) ?? dates[0];
  return dates.find((day) => day > current) ?? dates[dates.length - 1];
}

function emptyHouses(): Record<GratuityHouse, Record<string, number>> {
  return { Bar: {}, Cafe: {}, Other: {} };
}

function addAmounts(a: Record<string, number> | undefined, b: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = { ...(a ?? {}) };
  for (const [name, amt] of Object.entries(b ?? {})) out[name] = round2((out[name] ?? 0) + amt);
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
    for (const part of DAYPARTS.map((item) => item.key)) {
      for (const house of HOUSES) acc[part][house] = addAmounts(acc[part][house], day[part][house]);
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

export function PosRecords({ initialDate, passcode }: { initialDate: string; passcode: string }) {
  const tips = useGratuity(passcode);
  const serviceCharges = useServiceCharges(passcode);
  const [view, setView] = useState<RecordView>('tips');
  const [mode, setMode] = useState<Mode>('day');
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  const dates = view === 'charges' ? serviceCharges.dates : tips.dates;
  const minDate = dates[0] ?? '';
  const maxDate = dates[dates.length - 1] ?? '';

  useEffect(() => {
    if (!dates.length) return;
    if (!selectedDate || !dates.includes(selectedDate)) setSelectedDate(dates[dates.length - 1]);
    if (!rangeEnd || rangeEnd > dates[dates.length - 1]) {
      const end = dates[dates.length - 1];
      setRangeEnd(end);
      setRangeStart(clampIso(shiftIso(end, -6), dates[0], end));
    }
  }, [dates, selectedDate, rangeEnd]);

  const tipView = useMemo(() => {
    if (!tips.data) return null;
    if (mode === 'day') {
      const day = tips.data.dates[selectedDate];
      if (!day) return { day: null, daysUsed: 0, start: selectedDate, end: selectedDate };
      return { day, daysUsed: 1, start: selectedDate, end: selectedDate };
    }
    const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
    const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
    const slice = tips.dates.filter((day) => day >= start && day <= end);
    if (!slice.length) return { day: null, daysUsed: 0, start, end };
    return { day: mergeDays(slice.map((day) => tips.data!.dates[day])), daysUsed: slice.length, start, end };
  }, [tips.data, tips.dates, mode, selectedDate, rangeStart, rangeEnd]);

  const totals = useMemo(() => {
    if (!tipView?.day) return null;
    const bar = houseDayTotal(tipView.day, 'Bar');
    const cafe = houseDayTotal(tipView.day, 'Cafe');
    const other = houseDayTotal(tipView.day, 'Other');
    return { bar, cafe, other, all: bar + cafe + other };
  }, [tipView]);

  const chargeTabs = useMemo(() => {
    const tabs = serviceCharges.data?.tabs ?? [];
    if (mode === 'day') return tabs.filter((tab) => tab.date === selectedDate);
    const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
    const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
    if (!start || !end) return [];
    return tabs.filter((tab) => tab.date >= start && tab.date <= end);
  }, [serviceCharges.data, mode, selectedDate, rangeStart, rangeEnd]);

  const daypartHour = tips.data?.daypartHour ?? 17;
  const canPrev = Boolean(dates.length && selectedDate > dates[0]);
  const canNext = Boolean(dates.length && selectedDate < dates[dates.length - 1]);

  if (view === 'tips' && tips.loading) return <p className="text-secondary">Loading the POS tip records…</p>;
  if (view === 'charges' && serviceCharges.loading) return <p className="text-secondary">Loading service charges…</p>;

  return (
    <div className="space-y-6">
      <div className="card p-4 sm:p-5 space-y-4">
        <p className="text-sm text-secondary">
          These are the raw POS records, before the worksheet splits them. Tips are split before and after {daypartHour}:00 by ticket open time.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <TabButton active={view === 'tips'} onClick={() => setView('tips')}>Tips</TabButton>
          <TabButton active={view === 'charges'} onClick={() => setView('charges')}>Service charges</TabButton>
          <TabButton active={mode === 'day'} onClick={() => setMode('day')}>Day</TabButton>
          <TabButton active={mode === 'range'} onClick={() => setMode('range')}>Date range</TabButton>
        </div>
        {mode === 'day' ? (
          <div className="flex items-center gap-1">
            <StepButton label="Previous day" disabled={!canPrev} onClick={() => setSelectedDate(stepToTippedDate(selectedDate, dates, -1))}>
              <ChevronLeft className="w-5 h-5" />
            </StepButton>
            <input
              type="date"
              value={selectedDate}
              min={minDate}
              max={maxDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground"
            />
            <StepButton label="Next day" disabled={!canNext} onClick={() => setSelectedDate(stepToTippedDate(selectedDate, dates, 1))}>
              <ChevronRight className="w-5 h-5" />
            </StepButton>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-secondary" htmlFor="pos-start">From</label>
            <input id="pos-start" type="date" value={rangeStart} min={minDate} max={maxDate} onChange={(event) => setRangeStart(event.target.value)} className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm" />
            <label className="text-sm text-secondary" htmlFor="pos-end">To</label>
            <input id="pos-end" type="date" value={rangeEnd} min={minDate} max={maxDate} onChange={(event) => setRangeEnd(event.target.value)} className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm" />
          </div>
        )}
        {mode === 'range' && tipView && view === 'tips' && (
          <p className="text-sm text-secondary">{formatShortDate(tipView.start)} – {formatShortDate(tipView.end)} · {tipView.daysUsed} days with tips</p>
        )}
      </div>

      {view === 'charges' && (
        !serviceCharges.available || !serviceCharges.data ? (
          <p className="text-secondary">No service charge file yet.</p>
        ) : (
          <ServiceChargePanel tabs={chargeTabs} />
        )
      )}

      {view === 'tips' && !tips.available && (
        <p className="text-secondary">No gratuity file yet.</p>
      )}

      {view === 'tips' && tipView?.day && totals && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard label={mode === 'day' ? 'Day total' : 'Period total'} value={money(totals.all)} />
            <SummaryCard label="Bar" value={money(totals.bar)} hint="Bar terminals" />
            <SummaryCard label="Cafe" value={money(totals.cafe)} hint="CAFE1 only" />
            <SummaryCard label="Other" value={money(totals.other)} hint="SYNCSERVER + unmapped" />
          </div>
          {DAYPARTS.map(({ key, label }) => (
            <section key={key} className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold text-foreground">{label}</h2>
                <span className="text-sm text-secondary">{money(daypartTotal(tipView.day!, key))}</span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {HOUSES.map((house) => (
                  <HouseCard key={`${key}-${house}`} house={house} employees={tipView.day![key][house] ?? {}} />
                ))}
              </div>
            </section>
          ))}
          <p className="text-xs text-muted leading-relaxed max-w-3xl">
            House is the ticket terminal. Bar amounts are pool shares, not individual sales.
            {tipView.day.meta.tipOut > 0 && <> Gratuity-out is {money(tipView.day.meta.tipOut)} and is not subtracted here.</>}
          </p>
        </>
      )}
      {view === 'tips' && tips.available && !tipView?.day && (
        <p className="text-secondary">No tips recorded in this {mode === 'day' ? 'date' : 'range'}.</p>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm transition-colors ${active ? 'bg-accent/15 text-accent' : 'text-secondary hover:bg-overlay/5 hover:text-foreground'}`}
    >
      {children}
    </button>
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="p-2 rounded-lg bg-overlay/5 text-secondary hover:bg-overlay/10 hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="text-xl font-semibold text-foreground mt-1">{value}</p>
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
}

function HouseCard({ house, employees }: { house: GratuityHouse; employees: Record<string, number> }) {
  const rows = sortedEmployees(employees);
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-foreground">{house}</h3>
        <span className="text-sm text-accent">{money(houseTotal(employees))}</span>
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
