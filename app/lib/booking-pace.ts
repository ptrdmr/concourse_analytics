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
  /** pos, or 17hats when the paid date was rebuilt from the 2024 history file. */
  paidSource?: string;
}

export interface HistoryCoverage {
  source: string;
  from: string | null;
  to: string | null;
}

export interface BookingPaceFile {
  generatedAt: string;
  dataThrough: string | null;
  dbStatus: string;
  dbAsOf: string | null;
  unknownEvent: { count: number; amount: number };
  conflicts: number;
  history?: HistoryCoverage[];
  payments: PacePayment[];
}

export interface PacePoint {
  label: string;
  /** Tooltip title when the axis label is abbreviated. */
  hint?: string;
  focusEvents: number | null;
  focusDollars: number | null;
  compareEvents: number | null;
  compareDollars: number | null;
  /** Comparison year after the same-point cutoff. Null up to that point, so a dashed line can start there. */
  compareAheadEvents: number | null;
  compareAheadDollars: number | null;
}

export type PaceGrain = 'day' | 'week' | 'month';

export interface PaceSeriesOptions {
  fullMonth?: boolean;
  /** Week is the long run. Day is one point per day inside `range`. Month is one point per month-end. */
  grain?: PaceGrain;
  /** Inclusive dates on the focus calendar. Day grain only. */
  range?: [string, string];
}

export interface TargetGap {
  year: number;
  atPoint: PaceTotals;
  atMonthStart: PaceTotals;
  atMonthEnd: PaceTotals;
  toMatchStart: PaceTotals;
  toMatchEnd: PaceTotals;
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

export function monthEnd(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return formatDay(new Date(year, month, 0));
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
  return alignedCompareDate(dataThrough, focusMonth, compareYear);
}

/** The compare-year day that sits the same distance from its event month as `focusDay`. */
export function alignedCompareDate(focusDay: string, focusMonth: string, compareYear: number): string {
  const focusStart = `${focusMonth}-01`;
  const compareStart = `${compareYear}-${focusMonth.slice(5, 7)}-01`;
  return addDays(compareStart, daysBetween(focusStart, focusDay));
}

/**
 * Window for the day chart.
 * While the event month is still open, start 7 days before `asOf` and run through
 * the end of `asOf`'s own calendar month, stopping at the event month if that is sooner.
 * Once the event month is over, show that whole month. The last week of "today"
 * would mostly be deposits for other months.
 */
export function defaultDayRange(asOf: string, focusMonth: string): [string, string] {
  const eventEnd = monthEnd(focusMonth);
  if (asOf > eventEnd) return [`${focusMonth}-01`, eventEnd];
  const start = addDays(asOf, -7);
  const endOfAsOfMonth = monthEnd(asOf.slice(0, 7));
  return [start, endOfAsOfMonth > eventEnd ? eventEnd : endOfAsOfMonth];
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

/** rebuilt when the compare month's lead-up is inside the history window, partial when it starts earlier. */
export function historyCoverageFor(
  coverage: HistoryCoverage[] | undefined,
  compareYear: number,
  focusMonth: string,
): 'rebuilt' | 'partial' | null {
  const window = (coverage || []).find((item) => (
    item.from
    && item.to
    && item.from.slice(0, 4) <= String(compareYear)
    && item.to.slice(0, 4) >= String(compareYear)
  ));
  if (!window?.from) return null;
  const leadUp = addDays(`${compareYear}-${focusMonth.slice(5, 7)}-01`, -84);
  return leadUp < window.from ? 'partial' : 'rebuilt';
}

export function targetGaps(
  focus: PaceTotals,
  compareRows: PacePayment[],
  compareYear: number,
  focusMonth: string,
  cutoff: string,
): TargetGap {
  const month = focusMonth.slice(5, 7);
  const start = `${compareYear}-${month}-01`;
  const end = monthEnd(`${compareYear}-${month}`);
  const atPoint = totalsAt(compareRows, cutoff);
  const atMonthStart = totalsAt(compareRows, start);
  const atMonthEnd = totalsAt(compareRows, end);
  const gap = (target: PaceTotals): PaceTotals => ({
    events: Math.max(0, target.events - focus.events),
    dollars: Math.max(0, Math.round((target.dollars - focus.dollars) * 100) / 100),
  });
  return {
    year: compareYear,
    atPoint,
    atMonthStart,
    atMonthEnd,
    toMatchStart: gap(atMonthStart),
    toMatchEnd: gap(atMonthEnd),
  };
}

function weekBefore(paid: string, start: string): number {
  const days = daysBetween(paid, start);
  return days > 0 ? Math.ceil(days / 7) : 0;
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** How many months `paid` falls before the event month. Negative once the month has started. */
function monthsBefore(paid: string, eventMonth: string): number {
  const [paidYear, paidMonth] = paid.slice(0, 7).split('-').map(Number);
  const [eventYear, event] = eventMonth.split('-').map(Number);
  return (eventYear * 12 + event) - (paidYear * 12 + paidMonth);
}

function monthTickLabel(monthKey: string, eventMonth: string): string {
  const abbrev = (MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1] || monthKey).slice(0, 3);
  const before = monthsBefore(`${monthKey}-01`, eventMonth);
  if (before >= 12) return `${abbrev} -${Math.floor(before / 12)}`;
  return abbrev;
}

function sliceTotals(
  rows: PacePayment[] | undefined,
  cut: string,
  cutoff: string,
  fullMonth: boolean,
): { toDate: PaceTotals | null; ahead: PaceTotals | null } {
  if (!rows) return { toDate: null, ahead: null };
  const toDate = cut <= cutoff ? totalsAt(rows, cut) : null;
  const ahead = fullMonth && cut >= cutoff ? totalsAt(rows, cut) : null;
  return { toDate, ahead };
}

function pacePoint(
  label: string,
  focus: PaceTotals | null,
  compare: { toDate: PaceTotals | null; ahead: PaceTotals | null },
): PacePoint {
  return {
    label,
    focusEvents: focus?.events ?? null,
    focusDollars: focus ? Math.round(focus.dollars) : null,
    compareEvents: compare.toDate?.events ?? null,
    compareDollars: compare.toDate ? Math.round(compare.toDate.dollars) : null,
    compareAheadEvents: compare.ahead?.events ?? null,
    compareAheadDollars: compare.ahead ? Math.round(compare.ahead.dollars) : null,
  };
}

export function buildPaceSeries(
  focusRows: PacePayment[],
  compareRows: PacePayment[],
  focusMonth: string,
  compareYear: number,
  focusAsOf: string,
  compareCutoff: string,
  options: PaceSeriesOptions = {},
): PacePoint[] {
  const grain = options.grain ?? 'week';
  if (grain === 'day') {
    return buildDaySeries(focusRows, compareRows, focusMonth, compareYear, focusAsOf, compareCutoff, options);
  }
  if (grain === 'month') {
    return buildMonthSeries(focusRows, compareRows, focusMonth, compareYear, focusAsOf, compareCutoff, options);
  }
  const fullMonth = options.fullMonth === true;
  const focusStart = `${focusMonth}-01`;
  const compareStart = `${compareYear}-${focusMonth.slice(5, 7)}-01`;

  let maxWeek = 0;
  for (const row of focusRows) maxWeek = Math.max(maxWeek, weekBefore(row.paid, focusStart));
  for (const row of compareRows) maxWeek = Math.max(maxWeek, weekBefore(row.paid, compareStart));
  maxWeek = Math.min(Math.max(maxWeek, 4), 52);

  const lagDays = daysBetween(focusAsOf, focusStart);
  const throughToday = lagDays > 0 ? Math.ceil(lagDays / 7) : -Math.min(8, Math.floor(-lagDays / 7));
  const daysAfterStart = daysBetween(focusStart, monthEnd(focusMonth));
  const fullMonthEnd = daysAfterStart > 0 ? -Math.ceil(daysAfterStart / 7) : 0;
  const lastWeek = fullMonth ? fullMonthEnd : throughToday;

  const at = (focusCut: string, compareCut: string): PacePoint => {
    const focus = focusCut <= focusAsOf ? totalsAt(focusRows, focusCut) : null;
    return pacePoint(
      '',
      focus,
      sliceTotals(compareRows, compareCut, compareCutoff, fullMonth),
    );
  };

  const points: PacePoint[] = [];
  let placedAsOf = false;
  for (let week = maxWeek; week >= lastWeek; week -= 1) {
    const focusCut = addDays(focusStart, -7 * week);
    if (fullMonth && !placedAsOf && focusCut > focusAsOf) {
      const marker = at(focusAsOf, compareCutoff);
      marker.label = shortDate(focusAsOf);
      points.push(marker);
      placedAsOf = true;
    }
    const compareCut = addDays(compareStart, -7 * week);
    const point = at(focusCut, compareCut);
    point.label = week > 0 ? `${week}w` : week === 0 ? 'Start' : `+${-week}w`;
    const hasCompare = point.compareDollars != null || point.compareAheadDollars != null;
    if (!point.focusDollars && point.focusDollars !== 0 && !hasCompare && point.focusEvents == null) continue;
    if (point.focusEvents == null && point.compareEvents == null && point.compareAheadEvents == null) continue;
    points.push(point);
  }

  while (
    points.length > 2
    && (points[0].focusDollars || 0) === 0
    && (points[0].compareDollars || 0) === 0
  ) {
    points.shift();
  }

  if (!fullMonth) {
    const lastCut = addDays(focusStart, -7 * lastWeek);
    if (focusAsOf !== lastCut) {
      const marker = at(focusAsOf, compareCutoff);
      marker.label = shortDate(focusAsOf);
      points.push(marker);
    }
  } else if (!placedAsOf) {
    const marker = at(focusAsOf, compareCutoff);
    marker.label = shortDate(focusAsOf);
    points.push(marker);
  }
  return points;
}

function hasPoint(point: PacePoint): boolean {
  return point.focusEvents != null || point.compareEvents != null || point.compareAheadEvents != null;
}

function trimFlatStart(points: PacePoint[]): PacePoint[] {
  const next = points.slice();
  while (
    next.length > 2
    && (next[0].focusDollars || 0) === 0
    && (next[0].compareDollars || 0) === 0
  ) {
    next.shift();
  }
  return next;
}

function cutPoint(
  label: string,
  focusRows: PacePayment[],
  compareRows: PacePayment[],
  focusCut: string,
  compareCut: string,
  focusAsOf: string,
  compareCutoff: string,
  fullMonth: boolean,
): PacePoint {
  const focus = focusCut <= focusAsOf ? totalsAt(focusRows, focusCut) : null;
  return pacePoint(label, focus, sliceTotals(compareRows, compareCut, compareCutoff, fullMonth));
}

function buildDaySeries(
  focusRows: PacePayment[],
  compareRows: PacePayment[],
  focusMonth: string,
  compareYear: number,
  focusAsOf: string,
  compareCutoff: string,
  options: PaceSeriesOptions,
): PacePoint[] {
  const fallback = defaultDayRange(focusAsOf, focusMonth);
  let start = options.range?.[0] || fallback[0];
  let end = options.range?.[1] || fallback[1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
  if (start > end) {
    const swap = start;
    start = end;
    end = swap;
  }
  const showAhead = end > focusAsOf;
  const points: PacePoint[] = [];
  let guard = 0;
  for (let day = start; day <= end && guard < 1500; day = addDays(day, 1)) {
    guard += 1;
    const compareCut = alignedCompareDate(day, focusMonth, compareYear);
    const point = cutPoint(
      shortDate(day),
      focusRows,
      compareRows,
      day,
      compareCut,
      focusAsOf,
      compareCutoff,
      showAhead,
    );
    if (hasPoint(point)) points.push(point);
  }
  return points;
}

function buildMonthSeries(
  focusRows: PacePayment[],
  compareRows: PacePayment[],
  focusMonth: string,
  compareYear: number,
  focusAsOf: string,
  compareCutoff: string,
  options: PaceSeriesOptions,
): PacePoint[] {
  const fullMonth = options.fullMonth === true;
  const focusStartMonth = focusMonth.slice(0, 7);
  const compareStartMonth = `${compareYear}-${focusMonth.slice(5, 7)}`;

  let maxOffset = 0;
  for (const row of focusRows) maxOffset = Math.max(maxOffset, monthsBefore(row.paid, focusStartMonth));
  for (const row of compareRows) maxOffset = Math.max(maxOffset, monthsBefore(row.paid, compareStartMonth));
  maxOffset = Math.min(Math.max(maxOffset, 3), 36);

  const asOfOffset = monthsBefore(focusAsOf, focusStartMonth);
  const lastOffset = fullMonth ? 0 : Math.max(asOfOffset, 0);
  const points: PacePoint[] = [];
  let placedAsOf = false;

  for (let offset = maxOffset; offset >= lastOffset; offset -= 1) {
    const focusMonthKey = shiftMonth(focusStartMonth, -offset);
    const compareMonthKey = shiftMonth(compareStartMonth, -offset);
    const monthEndCut = monthEnd(focusMonthKey);
    const partial = focusMonthKey === focusAsOf.slice(0, 7) && focusAsOf < monthEndCut;

    if (fullMonth && !placedAsOf && monthEndCut > focusAsOf) {
      const asOfIsMonthEnd = monthEnd(focusAsOf.slice(0, 7)) === focusAsOf;
      if (!asOfIsMonthEnd) {
        const marker = cutPoint(
          shortDate(focusAsOf),
          focusRows,
          compareRows,
          focusAsOf,
          compareCutoff,
          focusAsOf,
          compareCutoff,
          true,
        );
        marker.hint = `Through ${shortDate(focusAsOf)}`;
        if (hasPoint(marker)) points.push(marker);
      }
      placedAsOf = true;
    }

    const focusCut = !fullMonth && partial ? focusAsOf : monthEndCut;
    const compareCut = !fullMonth && partial ? compareCutoff : monthEnd(compareMonthKey);
    const label = !fullMonth && partial ? shortDate(focusAsOf) : monthTickLabel(focusMonthKey, focusStartMonth);
    const point = cutPoint(
      label,
      focusRows,
      compareRows,
      focusCut,
      compareCut,
      focusAsOf,
      compareCutoff,
      fullMonth,
    );
    point.hint = `Through ${shortDate(focusCut)}`;
    if (hasPoint(point)) points.push(point);
  }

  return trimFlatStart(points);
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
