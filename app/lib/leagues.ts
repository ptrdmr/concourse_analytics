import { slotToTimeLabel } from '@/lib/intraday';

export const IN_SEASON_DAYS = 14;

const NIGHTS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

const PALETTE = [
  '#60a5fa', '#f5a623', '#34d399', '#f472b6', '#a78bfa',
  '#fb7185', '#38bdf8', '#fbbf24', '#4ade80', '#c084fc',
  '#22d3ee', '#fb923c', '#818cf8', '#2dd4bf',
];

export type LeagueKind = 'lineage' | 'prizeFund' | 'prizeFundGeneral';

export interface LeagueCombinedDay {
  date: string;
  revenue: number;
  payments: number;
}

export interface LeagueSplitDay {
  date: string;
  league: string;
  kind: LeagueKind;
  revenue: number;
  quantity: number;
  payments: number;
  firstSlot: number;
}

export interface LeagueVoidDay {
  date: string;
  league: string;
  kind: LeagueKind;
  count: number;
  value: number;
}

export interface LeaguesData {
  generatedAt: string;
  dataThrough: string;
  combined: LeagueCombinedDay[];
  split: LeagueSplitDay[];
  voids: LeagueVoidDay[];
}

export interface LeagueCard {
  name: string;
  color: string;
  nightIndex: number;
  night: string;
  usualTime: string;
  lastBowled: string;
  lineage: number;
  prizeFund: number;
  prizeFundGeneral: number;
}

export interface WeekStack {
  week: string;
  combined: number;
  lineage: number;
  prizeFund: number;
  prizeFundGeneral: number;
}

export interface LeagueNight {
  date: string;
  payments: number;
  lineage: number;
  prizeFund: number;
  prizeFundGeneral: number;
  total: number;
}

export interface LeagueDetail {
  name: string;
  color: string;
  night: string;
  usualTime: string;
  since: string;
  nights: number;
  payments: number;
  lineage: number;
  prizeFund: number;
  prizeFundGeneral: number;
  total: number;
  avgLineagePerNight: number | null;
  voidValue: number;
  rows: LeagueNight[];
}

export interface PeriodTotals {
  combined: number;
  lineage: number;
  prizeFund: number;
  prizeFundGeneral: number;
  total: number;
}

export function leagueColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (Math.imul(hash, 31) + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function toISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shiftDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return toISO(date);
}

export function weekStartMonday(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + diff);
  return toISO(date);
}

function weekdayIndex(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
}

function modeNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export function inRange(date: string, range: [string, string] | null): boolean {
  if (!range) return true;
  return date >= range[0] && date <= range[1];
}

function rowsByLeague(split: LeagueSplitDay[]): Map<string, LeagueSplitDay[]> {
  const map = new Map<string, LeagueSplitDay[]>();
  for (const row of split) {
    const list = map.get(row.league) ?? [];
    list.push(row);
    map.set(row.league, list);
  }
  return map;
}

function nightAndTime(rows: LeagueSplitDay[]): { nightIndex: number; night: string; usualTime: string } {
  const dates = [...new Set(rows.map((row) => row.date))];
  const nightIndex = modeNumber(dates.map(weekdayIndex)) ?? 0;
  const earliestByDate = new Map<string, number>();
  for (const row of rows) {
    const prev = earliestByDate.get(row.date);
    if (prev == null || row.firstSlot < prev) earliestByDate.set(row.date, row.firstSlot);
  }
  const usual = modeNumber([...earliestByDate.values()]);
  return {
    nightIndex,
    night: NIGHTS[nightIndex] ?? '—',
    usualTime: usual == null ? '—' : slotToTimeLabel(usual),
  };
}

export function inSeasonLeagues(data: LeaguesData, range: [string, string] | null): LeagueCard[] {
  if (!data.dataThrough) return [];
  const start = shiftDate(data.dataThrough, -(IN_SEASON_DAYS - 1));
  const cards: LeagueCard[] = [];
  for (const [name, rows] of rowsByLeague(data.split)) {
    if (!rows.some((row) => row.date >= start && row.date <= data.dataThrough)) continue;
    const when = nightAndTime(rows);
    const sumKind = (kind: LeagueKind) =>
      rows.filter((row) => row.kind === kind && inRange(row.date, range)).reduce((sum, row) => sum + row.revenue, 0);
    const lastBowled = rows.reduce((latest, row) => (row.date > latest ? row.date : latest), rows[0].date);
    cards.push({
      name,
      color: leagueColor(name),
      nightIndex: when.nightIndex,
      night: when.night,
      usualTime: when.usualTime,
      lastBowled,
      lineage: sumKind('lineage'),
      prizeFund: sumKind('prizeFund'),
      prizeFundGeneral: sumKind('prizeFundGeneral'),
    });
  }
  return cards.sort((a, b) => a.nightIndex - b.nightIndex || a.name.localeCompare(b.name));
}

export function periodTotals(data: LeaguesData, range: [string, string] | null): PeriodTotals {
  const totals: PeriodTotals = {
    combined: 0,
    lineage: 0,
    prizeFund: 0,
    prizeFundGeneral: 0,
    total: 0,
  };
  for (const row of data.combined) {
    if (inRange(row.date, range)) totals.combined += row.revenue;
  }
  for (const row of data.split) {
    if (!inRange(row.date, range)) continue;
    totals[row.kind] += row.revenue;
  }
  totals.total = totals.combined + totals.lineage + totals.prizeFund + totals.prizeFundGeneral;
  return totals;
}

export function weeklyTotals(
  data: LeaguesData,
  range: [string, string] | null,
  league?: string,
): WeekStack[] {
  const map = new Map<string, WeekStack>();
  const ensure = (date: string) => {
    const week = weekStartMonday(date);
    let row = map.get(week);
    if (!row) {
      row = { week, combined: 0, lineage: 0, prizeFund: 0, prizeFundGeneral: 0 };
      map.set(week, row);
    }
    return row;
  };

  if (!league) {
    for (const row of data.combined) {
      if (!inRange(row.date, range)) continue;
      ensure(row.date).combined += row.revenue;
    }
  }
  for (const row of data.split) {
    if (league && row.league !== league) continue;
    if (!inRange(row.date, range)) continue;
    ensure(row.date)[row.kind] += row.revenue;
  }
  return [...map.values()].sort((a, b) => a.week.localeCompare(b.week));
}

export function leagueDetail(
  data: LeaguesData,
  name: string,
  range: [string, string] | null,
): LeagueDetail | null {
  const rows = data.split.filter((row) => row.league === name);
  if (rows.length === 0) return null;
  const when = nightAndTime(rows);
  const since = rows.reduce((earliest, row) => (row.date < earliest ? row.date : earliest), rows[0].date);
  const inWindow = rows.filter((row) => inRange(row.date, range));

  const byDate = new Map<string, LeagueNight & { prizePayments: number }>();
  for (const row of inWindow) {
    const night = byDate.get(row.date) ?? {
      date: row.date,
      payments: 0,
      prizePayments: 0,
      lineage: 0,
      prizeFund: 0,
      prizeFundGeneral: 0,
      total: 0,
    };
    night[row.kind] += row.revenue;
    night.total += row.revenue;
    if (row.kind === 'lineage') night.payments += row.payments;
    if (row.kind === 'prizeFund') night.prizePayments += row.payments;
    byDate.set(row.date, night);
  }
  const nights = [...byDate.values()]
    .map(({ prizePayments, ...night }) => ({
      ...night,
      payments: night.payments || prizePayments,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const lineageNights = nights.filter((night) => night.lineage !== 0).length;
  const lineage = nights.reduce((sum, night) => sum + night.lineage, 0);
  const prizeFund = nights.reduce((sum, night) => sum + night.prizeFund, 0);
  const prizeFundGeneral = nights.reduce((sum, night) => sum + night.prizeFundGeneral, 0);
  const voidValue = data.voids
    .filter((row) => row.league === name && inRange(row.date, range))
    .reduce((sum, row) => sum + row.value, 0);

  return {
    name,
    color: leagueColor(name),
    night: when.night,
    usualTime: when.usualTime,
    since,
    nights: nights.length,
    payments: nights.reduce((sum, night) => sum + night.payments, 0),
    lineage,
    prizeFund,
    prizeFundGeneral,
    total: lineage + prizeFund + prizeFundGeneral,
    avgLineagePerNight: lineageNights > 0 ? lineage / lineageNights : null,
    voidValue,
    rows: nights,
  };
}

export function prizeFundInRange(data: LeaguesData, start: string, end: string): number {
  return data.split.reduce((sum, row) => {
    if (row.date < start || row.date > end) return sum;
    if (row.kind !== 'prizeFund' && row.kind !== 'prizeFundGeneral') return sum;
    return sum + row.revenue;
  }, 0);
}
