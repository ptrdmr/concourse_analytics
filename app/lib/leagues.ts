const PALETTE = [
  '#60a5fa', '#f5a623', '#34d399', '#f472b6', '#a78bfa',
  '#fb7185', '#38bdf8', '#fbbf24', '#4ade80', '#c084fc',
  '#22d3ee', '#fb923c', '#818cf8', '#2dd4bf',
];

export type LeagueKind = 'lineage' | 'prizeFund' | 'prizeFundGeneral' | 'leaguePayment' | 'preSplit';

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

export interface WeekStack {
  week: string;
  combined: number;
  lineage: number;
  prizeFund: number;
  prizeFundGeneral: number;
  leaguePayment: number;
}

export interface LeagueNight {
  date: string;
  payments: number;
  lineage: number;
  prizeFund: number;
  prizeFundGeneral: number;
  leaguePayment: number;
  preSplit: number;
  total: number;
}

export interface LeagueDetail {
  name: string;
  color: string;
  since: string;
  payments: number;
  lineage: number;
  prizeFund: number;
  prizeFundGeneral: number;
  leaguePayment: number;
  preSplit: number;
  total: number;
  voidValue: number;
  rows: LeagueNight[];
}

export interface PeriodTotals {
  combined: number;
  unassigned: number;
  lineage: number;
  prizeFund: number;
  prizeFundGeneral: number;
  leaguePayment: number;
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

export function weekStartMonday(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + diff);
  return toISO(date);
}

export function inRange(date: string, range: [string, string] | null): boolean {
  if (!range) return true;
  return date >= range[0] && date <= range[1];
}

/** One league. Both squads are collected on a single package. */
export const SUPER_SPORTS = 'Super Sports';

/** Leagues that still ring the old unassigned fee, so they have no split item yet. */
export const UNSPLIT_LEAGUES = [SUPER_SPORTS];

export function canonicalLeagueName(name: string): string {
  if (/^super\s*sports\b/i.test(name.trim())) return SUPER_SPORTS;
  return name;
}

export function leagueNames(data: LeaguesData): string[] {
  const names = new Set<string>(UNSPLIT_LEAGUES);
  for (const row of data.split) names.add(canonicalLeagueName(row.league));
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function periodTotals(data: LeaguesData, range: [string, string] | null): PeriodTotals {
  const totals: PeriodTotals = {
    combined: 0,
    unassigned: 0,
    lineage: 0,
    prizeFund: 0,
    prizeFundGeneral: 0,
    leaguePayment: 0,
    total: 0,
  };
  for (const row of data.combined) {
    if (inRange(row.date, range)) totals.unassigned += row.revenue;
  }
  for (const row of data.split) {
    if (!inRange(row.date, range)) continue;
    if (row.kind === 'preSplit') totals.combined += row.revenue;
    else totals[row.kind] += row.revenue;
  }
  totals.combined += totals.unassigned;
  totals.total = totals.combined + totals.lineage + totals.prizeFund + totals.prizeFundGeneral + totals.leaguePayment;
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
      row = { week, combined: 0, lineage: 0, prizeFund: 0, prizeFundGeneral: 0, leaguePayment: 0 };
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
    if (league && canonicalLeagueName(row.league) !== league) continue;
    if (!inRange(row.date, range)) continue;
    if (row.kind === 'preSplit') ensure(row.date).combined += row.revenue;
    else ensure(row.date)[row.kind] += row.revenue;
  }
  return [...map.values()].sort((a, b) => a.week.localeCompare(b.week));
}

export function leagueDetail(
  data: LeaguesData,
  name: string,
  range: [string, string] | null,
): LeagueDetail | null {
  const league = canonicalLeagueName(name);
  const rows = data.split.filter((row) => canonicalLeagueName(row.league) === league);
  if (rows.length === 0) {
    if (!UNSPLIT_LEAGUES.includes(league)) return null;
    return {
      name: league,
      color: leagueColor(league),
      since: '',
      payments: 0,
      lineage: 0,
      prizeFund: 0,
      prizeFundGeneral: 0,
      leaguePayment: 0,
      preSplit: 0,
      total: 0,
      voidValue: 0,
      rows: [],
    };
  }
  const packageRows = rows.filter((row) => row.kind === 'lineage' || row.kind === 'prizeFund' || row.kind === 'prizeFundGeneral');
  const since = packageRows.length === 0
    ? ''
    : packageRows.reduce((earliest, row) => (row.date < earliest ? row.date : earliest), packageRows[0].date);
  const inWindow = rows.filter((row) => inRange(row.date, range));

  const byDate = new Map<string, LeagueNight & { prizePayments: number; leaguePayments: number; preSplitPayments: number }>();
  for (const row of inWindow) {
    const night = byDate.get(row.date) ?? {
      date: row.date,
      payments: 0,
      prizePayments: 0,
      leaguePayments: 0,
      preSplitPayments: 0,
      lineage: 0,
      prizeFund: 0,
      prizeFundGeneral: 0,
      leaguePayment: 0,
      preSplit: 0,
      total: 0,
    };
    if (row.kind === 'preSplit') night.preSplit += row.revenue;
    else night[row.kind] += row.revenue;
    night.total += row.revenue;
    if (row.kind === 'lineage') night.payments += row.payments;
    if (row.kind === 'prizeFund') night.prizePayments += row.payments;
    if (row.kind === 'leaguePayment') night.leaguePayments += row.payments;
    if (row.kind === 'preSplit') night.preSplitPayments += row.payments;
    byDate.set(row.date, night);
  }
  const nights = [...byDate.values()]
    .map(({ prizePayments, leaguePayments, preSplitPayments, ...night }) => ({
      ...night,
      payments: night.payments || leaguePayments || preSplitPayments || prizePayments,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const lineage = nights.reduce((sum, night) => sum + night.lineage, 0);
  const prizeFund = nights.reduce((sum, night) => sum + night.prizeFund, 0);
  const prizeFundGeneral = nights.reduce((sum, night) => sum + night.prizeFundGeneral, 0);
  const leaguePayment = nights.reduce((sum, night) => sum + night.leaguePayment, 0);
  const preSplit = nights.reduce((sum, night) => sum + night.preSplit, 0);
  const voidValue = data.voids
    .filter((row) => canonicalLeagueName(row.league) === league && inRange(row.date, range))
    .reduce((sum, row) => sum + row.value, 0);

  return {
    name: league,
    color: leagueColor(league),
    since,
    payments: nights.reduce((sum, night) => sum + night.payments, 0),
    lineage,
    prizeFund,
    prizeFundGeneral,
    leaguePayment,
    preSplit,
    total: lineage + prizeFund + prizeFundGeneral + leaguePayment + preSplit,
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
