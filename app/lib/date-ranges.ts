export type DateRange = [string, string];

export interface DateRangePreset {
  id: string;
  label: string;
  /** `anchor` is the last date with sales data; falls back to today when unknown. */
  range: (anchor?: string | null) => DateRange | null;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// Built from local calendar parts rather than toISOString(), which reports UTC
// and rolls the date forward for anyone west of Greenwich late in the day.
function toISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayISO(): string {
  return toISO(new Date());
}

/**
 * Presets count back from the last day that has sales rather than from today.
 * Anchoring on today would leave every window short by however many days the
 * export lags, while the period it gets compared against stays full length.
 */
function resolveAnchor(anchor?: string | null): string {
  return anchor && ISO_RE.test(anchor) ? anchor : todayISO();
}

function shiftDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

function shiftYears(iso: string, years: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setFullYear(d.getFullYear() + years);
  return toISO(d);
}

/** Inclusive window of `days` ending on the anchor. */
function trailingWindow(anchor: string | null | undefined, days: number): DateRange {
  const end = resolveAnchor(anchor);
  return [shiftDays(end, -(days - 1)), end];
}

export function getLast7Days(anchor?: string | null): DateRange {
  return trailingWindow(anchor, 7);
}

export function getLast30Days(anchor?: string | null): DateRange {
  return trailingWindow(anchor, 30);
}

export function getLast90Days(anchor?: string | null): DateRange {
  return trailingWindow(anchor, 90);
}

export function getLast12Months(anchor?: string | null): DateRange {
  const end = resolveAnchor(anchor);
  return [shiftDays(shiftYears(end, -1), 1), end];
}

export function getMTD(anchor?: string | null): DateRange {
  const end = resolveAnchor(anchor);
  return [`${end.slice(0, 7)}-01`, end];
}

export function getYTD(anchor?: string | null): DateRange {
  const end = resolveAnchor(anchor);
  return [`${end.slice(0, 4)}-01-01`, end];
}

export function daysInclusive(range: DateRange): number {
  const [y1, m1, d1] = range[0].split('-').map(Number);
  const [y2, m2, d2] = range[1].split('-').map(Number);
  const start = new Date(y1, m1 - 1, d1);
  const end = new Date(y2, m2 - 1, d2);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/** Same-length window ending the day before `range` starts. */
export function priorEqualLength(range: DateRange): DateRange {
  const days = daysInclusive(range);
  const priorEnd = shiftDays(range[0], -1);
  return [shiftDays(priorEnd, -(days - 1)), priorEnd];
}

/** Same calendar dates shifted back one year. */
export function priorCalendarYear(range: DateRange): DateRange {
  return [shiftYears(range[0], -1), shiftYears(range[1], -1)];
}

/** Move a window so its end date falls in `year`, keeping length and month/day. */
export function shiftRangeToYear(range: DateRange, year: number): DateRange {
  const currentYear = Number(range[1].slice(0, 4));
  if (!Number.isFinite(currentYear) || !Number.isFinite(year)) return range;
  const delta = year - currentYear;
  if (delta === 0) return range;
  return [shiftYears(range[0], delta), shiftYears(range[1], delta)];
}

export function defaultCompareYear(dataThrough?: string | null): number {
  const through = dataThrough && ISO_RE.test(dataThrough) ? dataThrough : todayISO();
  return Number(through.slice(0, 4)) - 1;
}

/** Years we can compare against, newest first, excluding the current data year. */
export function compareYearOptions(
  dataStart?: string | null,
  dataThrough?: string | null,
): number[] {
  const throughY = dataThrough && ISO_RE.test(dataThrough)
    ? Number(dataThrough.slice(0, 4))
    : Number(todayISO().slice(0, 4));
  const startY = Math.min(
    dataStart && ISO_RE.test(dataStart)
      ? Number(dataStart.slice(0, 4))
      : throughY - 3,
    throughY - 1,
  );
  const years: number[] = [];
  for (let y = throughY - 1; y >= startY; y--) years.push(y);
  return years;
}

export const DATE_PRESETS: DateRangePreset[] = [
  {
    id: '7d',
    label: 'Last 7 Days',
    range: (anchor) => getLast7Days(anchor),
  },
  {
    id: 'mtd',
    label: 'MTD',
    range: (anchor) => getMTD(anchor),
  },
  {
    id: 'ytd',
    label: 'YTD',
    range: (anchor) => getYTD(anchor),
  },
  {
    id: '30d',
    label: 'Last 30 Days',
    range: (anchor) => trailingWindow(anchor, 30),
  },
  {
    id: '90d',
    label: 'Last 90 Days',
    range: (anchor) => trailingWindow(anchor, 90),
  },
  {
    id: '12mo',
    label: 'Last 12 Months',
    range: (anchor) => getLast12Months(anchor),
  },
  {
    id: 'prior-year',
    label: 'Prior Year',
    range: (anchor) => {
      const year = Number(resolveAnchor(anchor).slice(0, 4)) - 1;
      return [`${year}-01-01`, `${year}-12-31`];
    },
  },
  {
    id: 'all',
    label: 'All Time',
    range: () => null,
  },
];

export function findPresetId(dateRange: DateRange | null, anchor?: string | null): string {
  if (!dateRange) return 'all';
  for (const preset of DATE_PRESETS) {
    const r = preset.range(anchor);
    if (r && r[0] === dateRange[0] && r[1] === dateRange[1]) return preset.id;
  }
  return 'custom';
}
