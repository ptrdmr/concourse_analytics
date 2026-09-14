import type { DateRange } from './date-ranges';
import type {
  ReservationCountRow,
  ReservationCountsData,
  ReservationDailyTabs,
} from '@/types';

export const GENERAL_LANE = 'General Lane Reservation';

export interface ReservationGroup {
  id: string;
  label: string;
  color: string;
  types: string[];
}

export const RESERVATION_GROUPS: ReservationGroup[] = [
  {
    id: 'lanes',
    label: 'Lane reservations',
    color: '#22c55e',
    types: [
      'Weekday Lane',
      'Sunday Lane',
      'Thursday Special',
      GENERAL_LANE,
      'NYE Reservation',
    ],
  },
  {
    id: 'suites',
    label: 'VIP Suites',
    color: '#a78bfa',
    types: ['Strike Zone Suite', 'Kingpin Suite', 'Powerhouse Suite'],
  },
  {
    id: 'kids',
    label: 'Kids parties',
    color: '#38bdf8',
    types: ['Supercharge', 'Sports Party', 'Summer Special', 'Jr. Strikers'],
  },
  {
    id: 'pair',
    label: 'Pair & Spare',
    color: '#f59e0b',
    types: ['Pair & Spare', 'Party Builder', 'Half House', 'Full Facility'],
  },
];

export const TYPE_COLORS: Record<string, string> = {
  'Weekday Lane': '#16a34a',
  'Sunday Lane': '#4ade80',
  'Thursday Special': '#86efac',
  [GENERAL_LANE]: '#a3a3a3',
  'NYE Reservation': '#bbf7d0',
  'Strike Zone Suite': '#a78bfa',
  'Kingpin Suite': '#8b5cf6',
  'Powerhouse Suite': '#c4b5fd',
  Supercharge: '#0ea5e9',
  'Sports Party': '#38bdf8',
  'Summer Special': '#7dd3fc',
  'Jr. Strikers': '#0284c7',
  'Pair & Spare': '#f59e0b',
  'Party Builder': '#fbbf24',
  'Half House': '#d97706',
  'Full Facility': '#fde68a',
};

export const TYPE_TO_GROUP: Record<string, ReservationGroup> = Object.fromEntries(
  RESERVATION_GROUPS.flatMap((g) => g.types.map((t) => [t, g])),
);

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function toISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function mondayWeekStart(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return toISO(d);
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function sundayOfWeek(weekStart: string): string {
  return addDays(weekStart, 6);
}

export function weekdayIndexMonday(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  const dow = new Date(year, month - 1, day).getDay();
  return dow === 0 ? 6 : dow - 1;
}

export function resolveRange(
  range: DateRange | null,
  fallback: [string, string] | null | undefined,
): DateRange | null {
  if (range) return range;
  if (fallback && fallback[0] && fallback[1]) return fallback;
  return null;
}

export function inRange(iso: string, range: DateRange | null): boolean {
  if (!range) return true;
  return iso >= range[0] && iso <= range[1];
}

export function isPartialWeek(
  weekStart: string,
  range: DateRange | null,
  dataThrough: string | null,
): boolean {
  const weekEnd = sundayOfWeek(weekStart);
  const start = range?.[0];
  const end = range?.[1];
  const cap = dataThrough && end ? (dataThrough < end ? dataThrough : end) : (dataThrough || end);
  if (start && weekStart < start) return true;
  if (cap && weekEnd > cap) return true;
  return false;
}

export function filterRows(
  rows: ReservationCountRow[],
  range: DateRange | null,
  types?: Set<string> | string[],
): ReservationCountRow[] {
  const typeSet = types ? (types instanceof Set ? types : new Set(types)) : null;
  return rows.filter((r) => inRange(r.date, range) && (!typeSet || typeSet.has(r.type)));
}

export function filterDailyTabs(
  rows: ReservationDailyTabs[],
  range: DateRange | null,
): ReservationDailyTabs[] {
  return rows.filter((r) => inRange(r.date, range));
}

export function typesInGroups(groupIds: string[]): string[] {
  const idSet = new Set(groupIds);
  return RESERVATION_GROUPS.filter((g) => idSet.has(g.id)).flatMap((g) => g.types);
}

export function matchingTypes(search: string, groupIds: string[], allTypes: string[]): string[] {
  const allowed = groupIds.length > 0 ? typesInGroups(groupIds) : allTypes;
  const term = search.trim().toLowerCase();
  if (!term) return allowed;
  return allowed.filter((t) => t.toLowerCase().includes(term));
}

export function isFullTypeSelection(selected: string[], allTypes: string[]): boolean {
  if (allTypes.length === 0) return selected.length === 0;
  const set = new Set(selected);
  return allTypes.every((t) => set.has(t));
}

export type ChartMode = 'groups' | 'types';

export function chartMode(selectedGroupIds: string[], search: string): ChartMode {
  if (search.trim()) return 'types';
  if (selectedGroupIds.length === 1) return 'types';
  return 'groups';
}

export interface WeeklyPoint {
  week: string;
  partial: boolean;
  total: number;
  [key: string]: string | number | boolean;
}

export function aggregateWeekly(
  rows: ReservationCountRow[],
  range: DateRange | null,
  dataThrough: string | null,
  keys: string[],
  keyForType: (type: string) => string | null,
): WeeklyPoint[] {
  const map = new Map<string, WeeklyPoint>();
  for (const row of rows) {
    if (!inRange(row.date, range)) continue;
    const key = keyForType(row.type);
    if (!key) continue;
    const week = mondayWeekStart(row.date);
    let point = map.get(week);
    if (!point) {
      point = { week, partial: isPartialWeek(week, range, dataThrough), total: 0 };
      for (const k of keys) point[k] = 0;
      map.set(week, point);
    }
    point[key] = (Number(point[key]) || 0) + row.count;
    point.total += row.count;
  }
  return Array.from(map.values()).sort((a, b) => a.week.localeCompare(b.week));
}

export function weeklyByGroups(
  rows: ReservationCountRow[],
  range: DateRange | null,
  dataThrough: string | null,
  groupIds: string[],
): WeeklyPoint[] {
  const idSet = new Set(groupIds);
  const groups = RESERVATION_GROUPS.filter((g) => idSet.has(g.id));
  return aggregateWeekly(
    rows,
    range,
    dataThrough,
    groups.map((g) => g.id),
    (type) => {
      const g = TYPE_TO_GROUP[type];
      return g && idSet.has(g.id) ? g.id : null;
    },
  );
}

export function weeklyByTypes(
  rows: ReservationCountRow[],
  range: DateRange | null,
  dataThrough: string | null,
  types: string[],
): WeeklyPoint[] {
  const allowed = new Set(types);
  return aggregateWeekly(
    rows,
    range,
    dataThrough,
    types,
    (type) => (allowed.has(type) ? type : null),
  );
}

export function weeklyTotals(
  rows: ReservationCountRow[],
  range: DateRange | null,
  dataThrough: string | null,
  types: string[],
): WeeklyPoint[] {
  const points = weeklyByTypes(rows, range, dataThrough, types);
  return points.map((p) => ({ week: p.week, partial: p.partial, total: p.total }));
}

export function weeklyTabCounts(
  dailyTabs: ReservationDailyTabs[],
  range: DateRange | null,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of filterDailyTabs(dailyTabs, range)) {
    const week = mondayWeekStart(row.date);
    map[week] = (map[week] || 0) + row.tabs;
  }
  return map;
}

export interface WeekdayPoint {
  day: string;
  index: number;
  count: number;
}

export function weekdayCounts(
  rows: ReservationCountRow[],
  range: DateRange | null,
  type: string,
): WeekdayPoint[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const row of rows) {
    if (row.type !== type || !inRange(row.date, range)) continue;
    counts[weekdayIndexMonday(row.date)] += row.count;
  }
  return WEEKDAY_LABELS.map((day, index) => ({ day, index, count: counts[index] }));
}

export interface SeriesTotals {
  distinctTabs: number;
  cellSum: number;
  named: number;
  generalLane: number;
  byType: Record<string, number>;
  byGroup: Record<string, number>;
  topType: { name: string; count: number } | null;
}

export function seriesTotals(
  rows: ReservationCountRow[],
  dailyTabs: ReservationDailyTabs[],
  range: DateRange | null,
  types?: string[],
): SeriesTotals {
  const allowed = types ? new Set(types) : null;
  const byType: Record<string, number> = {};
  const byGroup: Record<string, number> = {};
  for (const g of RESERVATION_GROUPS) byGroup[g.id] = 0;

  let cellSum = 0;
  let named = 0;
  let generalLane = 0;
  for (const row of rows) {
    if (!inRange(row.date, range)) continue;
    if (allowed && !allowed.has(row.type)) continue;
    byType[row.type] = (byType[row.type] || 0) + row.count;
    cellSum += row.count;
    if (row.type === GENERAL_LANE) generalLane += row.count;
    else named += row.count;
    const g = TYPE_TO_GROUP[row.type];
    if (g) byGroup[g.id] += row.count;
  }

  const distinctTabs = filterDailyTabs(dailyTabs, range).reduce((s, r) => s + r.tabs, 0);
  const top = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
  return {
    distinctTabs,
    cellSum,
    named,
    generalLane,
    byType,
    byGroup,
    topType: top ? { name: top[0], count: top[1] } : null,
  };
}

export function weekOverWeekChange(
  dailyTabs: ReservationDailyTabs[],
  range: DateRange | null,
  dataThrough: string | null,
): number | null {
  const weeks: { week: string; tabs: number; partial: boolean }[] = [];
  const map = new Map<string, number>();
  for (const row of filterDailyTabs(dailyTabs, range)) {
    const week = mondayWeekStart(row.date);
    map.set(week, (map.get(week) || 0) + row.tabs);
  }
  for (const [week, tabs] of Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    weeks.push({ week, tabs, partial: isPartialWeek(week, range, dataThrough) });
  }
  const complete = weeks.filter((w) => !w.partial);
  if (complete.length < 2) return null;
  const prev = complete[complete.length - 2].tabs;
  const last = complete[complete.length - 1].tabs;
  if (prev === 0) return last > 0 ? null : 0;
  return ((last - prev) / prev) * 100;
}

export function pctChange(baseline: number, current: number): number | null {
  if (baseline === 0) return current === 0 ? 0 : null;
  return ((current - baseline) / baseline) * 100;
}

export function formatPctChange(value: number | null): string {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export interface AlignedWeekPoint {
  slot: number;
  label: string;
  periodA: number;
  periodB: number;
  weekA?: string;
  weekB?: string;
  partialA?: boolean;
  partialB?: boolean;
}

export function alignWeeklyCompare(
  seriesA: WeeklyPoint[],
  seriesB: WeeklyPoint[],
): AlignedWeekPoint[] {
  const maxLen = Math.max(seriesA.length, seriesB.length);
  const points: AlignedWeekPoint[] = [];
  for (let i = 0; i < maxLen; i++) {
    const a = seriesA[i];
    const b = seriesB[i];
    points.push({
      slot: i,
      label: `Week ${i + 1}`,
      periodA: a?.total ?? 0,
      periodB: b?.total ?? 0,
      weekA: a?.week,
      weekB: b?.week,
      partialA: a?.partial,
      partialB: b?.partial,
    });
  }
  return points;
}

export function groupTotalsForBar(
  totals: SeriesTotals,
  groupIds: string[],
  mode: ChartMode,
  types: string[],
): Array<{ key: string; label: string; color: string; count: number }> {
  if (mode === 'types') {
    return types.map((t) => ({
      key: t,
      label: t,
      color: TYPE_COLORS[t] || TYPE_TO_GROUP[t]?.color || '#a3a3a3',
      count: totals.byType[t] || 0,
    }));
  }
  return RESERVATION_GROUPS.filter((g) => groupIds.includes(g.id)).map((g) => ({
    key: g.id,
    label: g.label,
    color: g.color,
    count: totals.byGroup[g.id] || 0,
  }));
}

export function buildReservationSummary(args: {
  range: DateRange | null;
  compare: boolean;
  rangeB?: DateRange | null;
  totals: SeriesTotals;
  totalsB?: SeriesTotals;
  vsYear?: number;
}): string {
  const { range, compare, rangeB, totals, totalsB, vsYear } = args;
  const lines = [
    'Dashboard: Reservations',
    `Date Range: ${range ? `${range[0]} to ${range[1]}` : 'All time'}`,
    `Distinct tabs: ${totals.distinctTabs}`,
    `Named programs: ${totals.named}`,
    `General Lane: ${totals.generalLane}`,
  ];
  if (totals.topType) {
    lines.push(`Top type: ${totals.topType.name} (${totals.topType.count})`);
  }
  if (compare && rangeB && totalsB) {
    lines.push('');
    lines.push(`Compare year: ${vsYear ?? rangeB[0].slice(0, 4)} (${rangeB[0]} to ${rangeB[1]})`);
    lines.push(`Compare tabs: ${totalsB.distinctTabs}`);
    const delta = pctChange(totalsB.distinctTabs, totals.distinctTabs);
    lines.push(`Change vs ${vsYear ?? 'compare year'}: ${formatPctChange(delta)}`);
  }
  return lines.join('\n');
}

export function emptyReservationData(): ReservationCountsData {
  return {
    generatedAt: '',
    dateRange: ['', ''],
    types: RESERVATION_GROUPS.flatMap((g) => g.types),
    rows: [],
    dailyTabs: [],
  };
}
