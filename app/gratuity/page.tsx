'use client';

import { useMemo, useState, useEffect } from 'react';
import { Nav } from '@/components/Nav';
import { useGratuity } from '@/hooks/useGratuity';
import type { GratuityDay, GratuityDaypart, GratuityHouse } from '@/types';

const HOUSES: GratuityHouse[] = ['Bar', 'Cafe', 'Other'];
const DAYPARTS: { key: GratuityDaypart; label: string }[] = [
  { key: 'pre17', label: 'Before 5pm' },
  { key: 'post17', label: 'After 5pm' },
];

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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

export default function GratuityPage() {
  const { data, dates, loading, available } = useGratuity();
  const [selectedDate, setSelectedDate] = useState('');

  useEffect(() => {
    if (!dates.length) return;
    if (!selectedDate || !dates.includes(selectedDate)) {
      setSelectedDate(dates[dates.length - 1]);
    }
  }, [dates, selectedDate]);

  const day = data?.dates[selectedDate] ?? null;
  const daypartHour = data?.daypartHour ?? 17;

  const totals = useMemo(() => {
    if (!day) return null;
    const bar = houseDayTotal(day, 'Bar');
    const cafe = houseDayTotal(day, 'Cafe');
    const other = houseDayTotal(day, 'Other');
    return {
      bar,
      cafe,
      other,
      day: bar + cafe + other,
      pre: daypartTotal(day, 'pre17'),
      post: daypartTotal(day, 'post17'),
    };
  }, [day]);

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

        <div className="card p-4 sm:p-5">
          <label className="flex flex-col gap-1 text-xs text-muted max-w-xs">
            Date
            <input
              type="date"
              value={selectedDate}
              min={dates[0]}
              max={dates[dates.length - 1]}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </label>
          {selectedDate && (
            <p className="text-sm text-secondary mt-3">{formatDateLabel(selectedDate)}</p>
          )}
        </div>

        {!day && (
          <p className="text-secondary">No tips recorded on this date.</p>
        )}

        {day && totals && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SummaryCard label="Day total" value={money(totals.day)} />
              <SummaryCard label="Bar" value={money(totals.bar)} hint="Bar terminals" />
              <SummaryCard label="Cafe" value={money(totals.cafe)} hint="CAFE1 only" />
              <SummaryCard label="Other" value={money(totals.other)} hint="SYNCSERVER + unmapped" />
            </div>

            {DAYPARTS.map(({ key, label }) => (
              <section key={key} className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-lg sm:text-xl font-semibold text-foreground">{label}</h2>
                  <span className="text-sm text-secondary">{money(daypartTotal(day, key))}</span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {HOUSES.map((house) => (
                    <HouseCard
                      key={`${key}-${house}`}
                      house={house}
                      employees={day[key][house] ?? {}}
                    />
                  ))}
                </div>
              </section>
            ))}

            <p className="text-xs text-muted leading-relaxed max-w-3xl">
              {daypartHour}:00 is ticket-open time, the same clock the POS gratuity report uses.
              Bar amounts are pool shares, not individual sales. House is the ticket terminal:
              BAR1 / BAR2 / BAR3 / MPOS2 / MPOS6 are Bar, CAFE1 is Cafe, SYNCSERVER is Other.
              {day.meta.unmappedTerminals.length > 0 && (
                <>
                  {' '}
                  Unmapped terminals this day (filed under Other):{' '}
                  {day.meta.unmappedTerminals.join(', ')}.
                </>
              )}
              {day.meta.tipOut > 0 && (
                <> Gratuity-out (tip-out) is {money(day.meta.tipOut)} and is not subtracted yet.</>
              )}
              {' '}
              {day.meta.zeroLines} of {day.meta.lines} tip lines were $0.00 and are omitted from
              amounts.
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
