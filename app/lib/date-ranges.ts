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

export function getMTD(anchor?: string | null): DateRange {
  const end = resolveAnchor(anchor);
  return [`${end.slice(0, 7)}-01`, end];
}

export function getYTD(anchor?: string | null): DateRange {
  const end = resolveAnchor(anchor);
  return [`${end.slice(0, 4)}-01-01`, end];
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
    range: (anchor) => {
      const end = resolveAnchor(anchor);
      return [shiftDays(shiftYears(end, -1), 1), end];
    },
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
