'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useBookingPace } from '@/hooks/useBookingPace';
import {
  buildPaceSeries,
  compareAsOf,
  daysBetween,
  defaultEventMonth,
  eventMonths,
  historyCoverageFor,
  listRows,
  monthEnd,
  monthLabel,
  paceTotals,
  paymentsForMonth,
  shortDate,
  targetGaps,
  yearsForMonth,
  type PacePayment,
  type PacePoint,
  type TargetGap,
} from '@/lib/booking-pace';
import { formatCurrency, formatNumber } from '@/lib/format';
import { formatPctChange, pctChange, RESERVATION_GROUPS } from '@/lib/reservations';

const THIS_YEAR = '#22c55e';
const LAST_YEAR = '#94a3b8';

const GROUP_LABEL = new Map(RESERVATION_GROUPS.map((group) => [group.id, group.label]));
const GROUP_COLOR = new Map(RESERVATION_GROUPS.map((group) => [group.id, group.color]));

function groupLabel(id: string | null): string {
  if (!id) return 'Other';
  return GROUP_LABEL.get(id) || id;
}

function statusLabel(status: string): string {
  if (status === 'booked') return 'Booked';
  if (status === 'completed') return 'Happened';
  if (status === 'unredeemed') return 'Not redeemed';
  if (status === 'cancelled') return 'Cancelled';
  return 'No date';
}

function PaceChart({
  title,
  data,
  focusKey,
  compareKey,
  aheadKey,
  focusName,
  compareName,
  fullMonth,
  formatValue,
  formatAxis,
  expanded = false,
}: {
  title: string;
  data: PacePoint[];
  focusKey: string;
  compareKey: string;
  aheadKey: string;
  focusName: string;
  compareName: string;
  fullMonth: boolean;
  formatValue: (value: number) => string;
  formatAxis?: (value: number) => string;
  expanded?: boolean;
}) {
  const tick = expanded ? 13 : 11;
  return (
    <>
      <h3 className={expanded ? 'text-lg font-semibold text-foreground' : 'text-sm font-medium text-foreground mb-3'}>{title}</h3>
      <div className={expanded ? 'h-[calc(100vh-9rem)]' : 'h-64'}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: expanded ? 24 : 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="label" tick={{ fill: '#a3a3a3', fontSize: tick }} interval={expanded ? 2 : 'preserveStartEnd'} />
            <YAxis tick={{ fill: '#a3a3a3', fontSize: tick }} width={expanded ? 72 : 44} tickFormatter={(v) => (formatAxis || formatValue)(Number(v))} />
            <Tooltip
              formatter={(value, name) => [formatValue(Number(value ?? 0)), String(name)]}
              contentStyle={{ background: '#171717', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8 }}
              labelStyle={{ color: '#a3a3a3', fontSize: 12 }}
            />
            <Legend />
            <Line type="monotone" dataKey={focusKey} name={focusName} stroke={THIS_YEAR} strokeWidth={expanded ? 2.5 : 2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey={compareKey} name={compareName} stroke={LAST_YEAR} strokeWidth={expanded ? 2.5 : 2} dot={false} connectNulls={false} />
            {fullMonth && (
              <Line type="monotone" dataKey={aheadKey} name={`${compareName} rest of month`} stroke={LAST_YEAR} strokeWidth={expanded ? 2.5 : 2} strokeDasharray="6 4" dot={false} connectNulls={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function PaceChartCard(props: {
  title: string;
  data: PacePoint[];
  focusKey: string;
  compareKey: string;
  aheadKey: string;
  focusName: string;
  compareName: string;
  fullMonth: boolean;
  formatValue: (value: number) => string;
  formatAxis?: (value: number) => string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <div
        className="card p-4 sm:p-5 text-left cursor-pointer hover:border-accent/40 transition-colors"
        role="button"
        tabIndex={0}
        aria-label={`Enlarge ${props.title}`}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <PaceChart {...props} />
        <p className="text-xs text-muted mt-2">Click to enlarge</p>
      </div>
      {open && createPortal(
        <div className="fixed inset-0 z-[110] p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={props.title}>
          <div className="absolute inset-0 bg-black/75" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="relative h-full bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl shadow-xl flex flex-col p-4 sm:p-6">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-lg text-secondary hover:text-foreground hover:bg-overlay/5"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="pr-12 flex-1 min-h-0">
              <PaceChart {...props} expanded />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export function BookingPaceSection() {
  const { data, loading, error } = useBookingPace();
  const [month, setMonth] = useState<string | null>(null);
  const [compareYear, setCompareYear] = useState<number | null>(null);
  const [fullMonth, setFullMonth] = useState(true);

  const months = useMemo(() => (data ? eventMonths(data.payments) : []), [data]);
  const focusMonth = month && months.includes(month)
    ? month
    : defaultEventMonth(data?.dataThrough ?? null, months);
  const yearChoices = useMemo(
    () => (data && focusMonth ? yearsForMonth(data.payments, focusMonth) : []),
    [data, focusMonth],
  );
  const focusYear = focusMonth ? Number(focusMonth.slice(0, 4)) : 0;
  const otherYears = yearChoices.filter((year) => year !== focusYear);
  const selectedCompare = compareYear != null && otherYears.includes(compareYear)
    ? compareYear
    : (otherYears.includes(focusYear - 1) ? focusYear - 1 : otherYears[0] ?? null);

  const view = useMemo(() => {
    if (!data || !focusMonth || !data.dataThrough) return null;
    const asOf = data.dataThrough;
    const focusRows = paymentsForMonth(data.payments, focusMonth, asOf);
    const compareMonth = selectedCompare != null
      ? `${selectedCompare}-${focusMonth.slice(5, 7)}`
      : null;
    const cutoff = selectedCompare != null ? compareAsOf(asOf, focusMonth, selectedCompare) : null;
    const throughMonth = (year: number) => monthEnd(`${year}-${focusMonth.slice(5, 7)}`);
    const compareRows = compareMonth && cutoff
      ? paymentsForMonth(data.payments, compareMonth, cutoff)
      : [];
    const compareAll = compareMonth
      ? paymentsForMonth(data.payments, compareMonth, throughMonth(selectedCompare!))
      : [];
    const focus = paceTotals(focusRows);
    const compare = paceTotals(compareRows);
    const series = selectedCompare != null && cutoff
      ? buildPaceSeries(focusRows, compareAll, focusMonth, selectedCompare, asOf, cutoff, { fullMonth })
      : buildPaceSeries(focusRows, [], focusMonth, focusYear, asOf, asOf, { fullMonth });
    const targets = selectedCompare != null && cutoff
      ? [targetGaps(focus, compareAll, selectedCompare, focusMonth, cutoff)]
      : [];
    const byGroup = new Map<string, { focus: PacePayment[]; compare: PacePayment[] }>();
    for (const row of focusRows) {
      const key = row.group || 'other';
      const bucket = byGroup.get(key) || { focus: [], compare: [] };
      bucket.focus.push(row);
      byGroup.set(key, bucket);
    }
    for (const row of compareRows) {
      const key = row.group || 'other';
      const bucket = byGroup.get(key) || { focus: [], compare: [] };
      bucket.compare.push(row);
      byGroup.set(key, bucket);
    }
    const order = [...RESERVATION_GROUPS.map((group) => group.id), 'other'];
    const groups = order
      .filter((id) => byGroup.has(id))
      .map((id) => {
        const bucket = byGroup.get(id)!;
        return {
          id,
          label: groupLabel(id === 'other' ? null : id),
          color: GROUP_COLOR.get(id) || '#a3a3a3',
          focus: paceTotals(bucket.focus),
          compare: paceTotals(bucket.compare),
        };
      });
    return {
      asOf,
      cutoff,
      focus,
      compare,
      series,
      groups,
      targets,
      list: listRows(focusRows),
    };
  }, [data, focusMonth, focusYear, selectedCompare, fullMonth]);

  if (loading) {
    return (
      <section className="card p-5">
        <div className="text-secondary animate-pulse">Loading booking pace...</div>
      </section>
    );
  }

  if (error || !data || !view || !focusMonth) {
    return (
      <section className="card p-5">
        <h2 className="text-lg font-semibold text-foreground">Booking pace</h2>
        <p className="text-sm text-muted mt-1">Booking pace data is not on this deploy yet.</p>
      </section>
    );
  }

  const focusName = String(focusYear);
  const compareName = selectedCompare != null ? String(selectedCompare) : 'Last year';

  return (
    <section className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-end gap-4">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-foreground">Booking pace</h2>
          <p className="text-sm text-muted mt-1">
            Deposits taken toward {monthLabel(focusMonth)}, counted on the day they were paid.
            {view.cutoff ? ` ${compareSentence(focusMonth, compareName, view.asOf, view.cutoff)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Event month
            <select
              value={focusMonth}
              onChange={(event) => setMonth(event.target.value)}
              className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {[...months].reverse().map((key) => (
                <option key={key} value={key}>{monthLabel(key)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Compare with
            <select
              value={selectedCompare ?? ''}
              onChange={(event) => setCompareYear(Number(event.target.value))}
              className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {otherYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted self-end pb-2">
            <input
              type="checkbox"
              checked={fullMonth}
              onChange={(event) => setFullMonth(event.target.checked)}
              className="accent-accent"
            />
            Show full month
          </label>
        </div>
      </div>

      {data.unknownEvent.count > 0 && (
        <p className="text-xs text-muted">
          {formatNumber(data.unknownEvent.count)} deposits ({formatCurrency(data.unknownEvent.amount)}) have no event date, so they are not on this chart.
          {data.dbStatus !== 'live' ? ' The live booking book could not be read; this is the last saved copy.' : ''}
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Parties" value={formatNumber(view.focus.events)} compare={view.compare.events} current={view.focus.events} name={compareName} />
        <Kpi label="Deposit dollars" value={formatCurrency(view.focus.dollars)} compare={view.compare.dollars} current={view.focus.dollars} name={compareName} />
        <Kpi label={`${compareName} parties`} value={formatNumber(view.compare.events)} />
        <Kpi label={`${compareName} dollars`} value={formatCurrency(view.compare.dollars)} />
      </div>

      {view.targets.length > 0 && (
        <div className="card overflow-x-auto">
          <h3 className="text-sm font-medium text-foreground px-4 pt-4">Where we&apos;re aiming</h3>
          <p className="text-xs text-muted px-4 pt-1 pb-2">
            {compareName}, counted on the day the deposit was paid. To match is how far {focusName} still is from that year. This year is not projected.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <th className="px-4 py-3 font-medium">Year</th>
                <th className="px-4 py-3 font-medium text-right">At this point</th>
                <th className="px-4 py-3 font-medium text-right">By {shortDate(`${focusMonth}-01`)}</th>
                <th className="px-4 py-3 font-medium text-right">To match that</th>
                <th className="px-4 py-3 font-medium text-right">Full month</th>
                <th className="px-4 py-3 font-medium text-right">To match that</th>
              </tr>
            </thead>
            <tbody>
              {view.targets.map((target) => (
                <tr key={target.year} className="border-b border-border/60">
                  <td className="px-4 py-2.5">{target.year}</td>
                  <AimCell totals={target.atPoint} />
                  <AimCell totals={target.atMonthStart} />
                  <AimCell totals={target.toMatchStart} />
                  <AimCell totals={target.atMonthEnd} />
                  <AimCell totals={target.toMatchEnd} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <PaceChartCard
          title="Cumulative deposit dollars"
          data={view.series}
          focusKey="focusDollars"
          compareKey="compareDollars"
          aheadKey="compareAheadDollars"
          focusName={focusName}
          compareName={compareName}
          fullMonth={fullMonth}
          formatValue={(value) => formatCurrency(value)}
          formatAxis={(value) => (value >= 1000 ? `$${Math.round(value / 1000)}k` : formatCurrency(value))}
        />
        <PaceChartCard
          title="Cumulative parties"
          data={view.series}
          focusKey="focusEvents"
          compareKey="compareEvents"
          aheadKey="compareAheadEvents"
          focusName={focusName}
          compareName={compareName}
          fullMonth={fullMonth}
          formatValue={(value) => formatNumber(value)}
        />
      </div>
      <p className="text-xs text-muted -mt-2">
        {fullMonth
          ? `Solid lines stop at ${shortDate(view.asOf)}. Dashed lines are what that year still booked, by paid date, through the end of the month.`
          : `Weeks before the month starts. The last point is ${shortDate(view.asOf)}.`}
        {' '}{historyFootnote(data.history, selectedCompare, focusMonth)}
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Group</th>
              <th className="px-4 py-3 font-medium text-right">{focusName} parties</th>
              <th className="px-4 py-3 font-medium text-right">{focusName} dollars</th>
              <th className="px-4 py-3 font-medium text-right">{compareName} parties</th>
              <th className="px-4 py-3 font-medium text-right">{compareName} dollars</th>
            </tr>
          </thead>
          <tbody>
            {view.groups.map((group) => (
              <tr key={group.id} className="border-b border-border/60">
                <td className="px-4 py-2.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ background: group.color }} />
                  {group.label}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">{formatNumber(group.focus.events)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(group.focus.dollars)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-secondary">{formatNumber(group.compare.events)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-secondary">{formatCurrency(group.compare.dollars)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto max-h-[32rem] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Party</th>
              <th className="px-4 py-3 font-medium">Paid</th>
              <th className="px-4 py-3 font-medium">Event</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {view.list.map((row, index) => (
              <tr key={`${row.party}-${row.paid}-${row.event}-${index}`} className="border-b border-border/60">
                <td className="px-4 py-2">{row.party}{row.conflict ? ' *' : ''}</td>
                <td className="px-4 py-2 font-mono text-secondary">{row.paid}</td>
                <td className="px-4 py-2 font-mono text-secondary">{row.event}</td>
                <td className="px-4 py-2">{row.type}</td>
                <td className="px-4 py-2 text-secondary">{statusLabel(row.status)}</td>
                <td className="px-4 py-2 text-right font-mono">{formatCurrency(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">A star marks a party whose booked date, close-out, and typed name disagree.</p>
    </section>
  );
}

function AimCell({ totals }: { totals: TargetGap['atPoint'] }) {
  return (
    <td className="px-4 py-2.5 text-right font-mono text-secondary">
      <div>{formatNumber(totals.events)} parties</div>
      <div>{formatCurrency(totals.dollars)}</div>
    </td>
  );
}

function historyFootnote(
  coverage: { source: string; from: string | null; to: string | null }[] | undefined,
  year: number | null,
  focusMonth: string,
): string {
  if (year == null) return '';
  const kind = historyCoverageFor(coverage, year, focusMonth);
  if (kind === 'partial') {
    const from = (coverage || []).find((item) => item.from)?.from;
    return `${year} before ${from ? shortDate(from) : 'the history window'} is only partly rebuilt, so that comparison is partial.`;
  }
  if (kind === 'rebuilt') {
    return `${year} party deposits use 17hats paid dates matched to POS accounts.`;
  }
  return '';
}

function compareSentence(focusMonth: string, compareName: string, asOf: string, cutoff: string): string {
  const lag = daysBetween(asOf, `${focusMonth}-01`);
  const monthName = monthLabel(focusMonth).replace(/ \d{4}$/, '');
  if (lag > 0) {
    return `${compareName} stops at ${shortDate(cutoff)}, ${lag} days before ${monthName} ${compareName}.`;
  }
  return `${compareName} includes deposits paid through ${shortDate(cutoff)}.`;
}

function Kpi({
  label,
  value,
  compare,
  current,
  name,
}: {
  label: string;
  value: string;
  compare?: number;
  current?: number;
  name?: string;
}) {
  const change = compare != null && current != null ? pctChange(compare, current) : null;
  return (
    <div className="card p-5">
      <div className="text-sm text-secondary mb-1">{label}</div>
      <div className="text-2xl font-bold font-mono text-gradient">{value}</div>
      {change != null && (
        <div className={`text-xs font-mono mt-1 ${change >= 0 ? 'text-accent' : 'text-red-400'}`}>
          {formatPctChange(change)} vs {name}
        </div>
      )}
    </div>
  );
}
