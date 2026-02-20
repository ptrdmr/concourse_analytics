export type DateRange = [string, string];

export interface DateRangePreset {
  id: string;
  label: string;
  range: () => DateRange | null;
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function today(): Date {
  return new Date();
}

export function getYTD(): DateRange {
  const now = today();
  return [`${now.getFullYear()}-01-01`, toISO(now)];
}

export const DATE_PRESETS: DateRangePreset[] = [
  {
    id: 'ytd',
    label: 'YTD',
    range: () => getYTD(),
  },
  {
    id: '30d',
    label: 'Last 30 Days',
    range: () => {
      const end = today();
      const start = new Date(end);
      start.setDate(start.getDate() - 30);
      return [toISO(start), toISO(end)];
    },
  },
  {
    id: '90d',
    label: 'Last 90 Days',
    range: () => {
      const end = today();
      const start = new Date(end);
      start.setDate(start.getDate() - 90);
      return [toISO(start), toISO(end)];
    },
  },
  {
    id: '12mo',
    label: 'Last 12 Months',
    range: () => {
      const end = today();
      const start = new Date(end);
      start.setFullYear(start.getFullYear() - 1);
      return [toISO(start), toISO(end)];
    },
  },
  {
    id: 'prior-year',
    label: 'Prior Year',
    range: () => {
      const year = today().getFullYear() - 1;
      return [`${year}-01-01`, `${year}-12-31`];
    },
  },
  {
    id: 'all',
    label: 'All Time',
    range: () => null,
  },
];

export function findPresetId(dateRange: DateRange | null): string {
  if (!dateRange) return 'all';
  for (const preset of DATE_PRESETS) {
    const r = preset.range();
    if (r && r[0] === dateRange[0] && r[1] === dateRange[1]) return preset.id;
  }
  return 'custom';
}
