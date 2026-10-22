/** Booking pace: deposits toward an event month, cut at the same point last year. */

export interface PacePayment {
  txnId: string;
  paid: string;
  amount: number;
  accountId: number | null;
  party: string | null;
  isFirstPayment: boolean;
  event: string | null;
  eventSource: string;
  eventConflict: boolean;
  group: string | null;
  type: string;
  status: string;
}

export interface BookingPaceFile {
  generatedAt: string;
  dataThrough: string | null;
  dbStatus: string;
  dbAsOf: string | null;
  unknownEvent: { count: number; amount: number };
  conflicts: number;
  payments: PacePayment[];
}

export interface PacePoint {
  label: string;
  focusEvents: number | null;
  focusDollars: number | null;
  compareEvents: number | null;
  compareDollars: number | null;
}

export interface PaceTotals {
  events: number;
  dollars: number;
}

export interface PaceListRow {
  party: string;
  paid: string;
  event: string;
  type: string;
  group: string | null;
  status: string;
  amount: number;
  conflict: boolean;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseDay(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDay(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const value = parseDay(iso);
  value.setDate(value.getDate() + days);
  return formatDay(value);
}

/** Calendar days from `from` to `to`. Positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  const ms = parseDay(to).getTime() - parseDay(from).getTime();
  return Math.round(ms / 86400000);
}

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const name = MONTH_NAMES[Number(month) - 1] || month;
  return `${name} ${year}`;
}

export function shortDate(iso: string): string {
  const [, month, day] = iso.slice(0, 10).split('-');
  return `${Number(month)}/${Number(day)}`;
}

export function eventMonths(payments: PacePayment[]): string[] {
  const found = new Set<string>();
  for (const row of payments) {
    if (row.event && row.status !== 'cancelled') found.add(row.event.slice(0, 7));
  }
  return Array.from(found).sort();
}

export function defaultEventMonth(dataThrough: string | null, months: string[]): string {
  if (!months.length) return dataThrough?.slice(0, 7) || '';
  const year = (dataThrough || months[months.length - 1]).slice(0, 4);
  const december = `${year}-12`;
  if (months.includes(december)) return december;
  const through = (dataThrough || '').slice(0, 7);
  const upcoming = months.find((month) => month >= through);
  return upcoming || months[months.length - 1];
}

export function yearsForMonth(payments: PacePayment[], monthKey: string): number[] {
  const month = monthKey.slice(5, 7);
  const years = new Set<number>();
  for (const row of payments) {
    if (!row.event || row.status === 'cancelled') continue;
    if (row.event.slice(5, 7) === month) years.add(Number(row.event.slice(0, 4)));
  }
  return Array.from(years).sort((a, b) => b - a);
}

/** Same number of days before (or after) the compare month as `dataThrough` is for the focus month. */
export function compareAsOf(dataThrough: string, focusMonth: string, compareYear: number): string {
  const focusStart = `${focusMonth}-01`;
  const compareStart = `${compareYear}-${focusMonth.slice(5, 7)}-01`;
  const lag = daysBetween(dataThrough, focusStart);
  return addDays(compareStart, -lag);
}

export function paymentsForMonth(payments: PacePayment[], monthKey: string, asOf: string): PacePayment[] {
  return payments.filter((row) => (
    row.status !== 'cancelled'
    && !!row.event
    && row.event.slice(0, 7) === monthKey
    && row.paid <= asOf
  ));
}

export function paceTotals(rows: PacePayment[]): PaceTotals {
  let dollars = 0;
  let events = 0;
  for (const row of rows) {
    dollars += row.amount;
    if (row.isFirstPayment) events += 1;
  }
  return { events, dollars };
}

function totalsAt(rows: PacePayment[], cutoff: string): PaceTotals {
  return paceTotals(rows.filter((row) => row.paid <= cutoff));
}

export function buildPaceSeries(
  focusRows: PacePayment[],
  compareRows: PacePayment[],
  focusMonth: string,
  compareYear: number,
  focusAsOf: string,
  compareCutoff: string,
): PacePoint[] {
  const focusStart = `${focusMonth}-01`;
  const compareStart = `${compareYear}-${focusMonth.slice(5, 7)}-01`;
  const weekBefore = (paid: string, start: string) => {
    const days = daysBetween(paid, start);
    return days > 0 ? Math.ceil(days / 7) : 0;
  };

  let maxWeek = 0;
  for (const row of focusRows) maxWeek = Math.max(maxWeek, weekBefore(row.paid, focusStart));
  for (const row of compareRows) maxWeek = Math.max(maxWeek, weekBefore(row.paid, compareStart));
  maxWeek = Math.min(Math.max(maxWeek, 4), 52);

  const lagDays = daysBetween(focusAsOf, focusStart);
  const endWeek = lagDays > 0 ? Math.ceil(lagDays / 7) : -Math.min(8, Math.floor(-lagDays / 7));

  const points: PacePoint[] = [];
  for (let week = maxWeek; week >= endWeek; week -= 1) {
    const focusCut = addDays(focusStart, -7 * week);
    const compareCut = addDays(compareStart, -7 * week);
    const focus = focusCut <= focusAsOf ? totalsAt(focusRows, focusCut) : null;
    const compare = compareCut <= compareCutoff ? totalsAt(compareRows, compareCut) : null;
    if (!focus && !compare) continue;
    points.push({
      label: week > 0 ? `${week}w` : week === 0 ? 'Start' : `+${-week}w`,
      focusEvents: focus?.events ?? null,
      focusDollars: focus ? Math.round(focus.dollars) : null,
      compareEvents: compare?.events ?? null,
      compareDollars: compare ? Math.round(compare.dollars) : null,
    });
  }

  while (
    points.length > 2
    && (points[0].focusDollars || 0) === 0
    && (points[0].compareDollars || 0) === 0
  ) {
    points.shift();
  }

  const lastCut = addDays(focusStart, -7 * endWeek);
  if (focusAsOf !== lastCut) {
    const focus = totalsAt(focusRows, focusAsOf);
    const compare = totalsAt(compareRows, compareCutoff);
    points.push({
      label: shortDate(focusAsOf),
      focusEvents: focus.events,
      focusDollars: Math.round(focus.dollars),
      compareEvents: compare.events,
      compareDollars: Math.round(compare.dollars),
    });
  }
  return points;
}

export function listRows(rows: PacePayment[]): PaceListRow[] {
  const extras = rows.filter((row) => !row.isFirstPayment);
  const listed = rows.filter((row) => row.isFirstPayment).map((row) => {
    let amount = row.amount;
    if (row.accountId != null) {
      for (const extra of extras) {
        if (extra.accountId === row.accountId) amount += extra.amount;
      }
    }
    return {
      party: row.party || 'Unnamed',
      paid: row.paid,
      event: row.event || '',
      type: row.type,
      group: row.group,
      status: row.status,
      amount: Math.round(amount * 100) / 100,
      conflict: row.eventConflict,
    };
  });
  listed.sort((a, b) => a.event.localeCompare(b.event) || a.party.localeCompare(b.party));
  return listed;
}
