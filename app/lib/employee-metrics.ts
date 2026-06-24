import type { EmployeeDaily, EmployeePeriod, EmployeeProfile, EmployeeRankings, EmployeeRollup, EmployeeTopItem } from '@/types';

export function dayTips(d: EmployeeDaily): number {
  return d.gratuity + d.serviceChargeVip + d.serviceChargeParty + d.serviceChargeOther;
}

export function periodBounds(
  dataRange: [string, string],
  period: EmployeePeriod,
): [string, string] {
  const end = dataRange[1] || new Date().toISOString().slice(0, 10);
  if (period === 'all') return [dataRange[0], end];
  const endDate = new Date(`${end}T12:00:00`);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (period - 1));
  const start = startDate.toISOString().slice(0, 10);
  const clampedStart = start < dataRange[0] ? dataRange[0] : start;
  return [clampedStart, end];
}

export function intersectPeriod(
  periodStart: string,
  periodEnd: string,
  rangeStart: string,
  rangeEnd: string,
): [string, string] | null {
  if (!rangeStart || !rangeEnd) return null;
  const start = periodStart > rangeStart ? periodStart : rangeStart;
  const end = periodEnd < rangeEnd ? periodEnd : rangeEnd;
  if (start > end) return null;
  return [start, end];
}

export function filterEmployeeDays(
  days: Record<string, EmployeeDaily>,
  start: string,
  end: string,
): Array<[string, EmployeeDaily]> {
  return Object.entries(days)
    .filter(([date]) => date >= start && date <= end)
    .sort(([a], [b]) => a.localeCompare(b));
}

function mergeTopItems(items: EmployeeTopItem[]): EmployeeTopItem[] {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item.name, (map.get(item.name) ?? 0) + item.revenue);
  }
  return [...map.entries()]
    .map(([name, revenue]) => ({ name, revenue: Math.round(revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

function mergeDeptMix(entries: Array<[string, EmployeeDaily]>, profile: EmployeeProfile): Record<string, number> {
  const inPeriod = entries.length > 0;
  if (!inPeriod) return profile.deptMix;
  const totalSales = entries.reduce((s, [, d]) => s + d.sales, 0);
  if (totalSales <= 0) return profile.deptMix;
  const mix: Record<string, number> = {};
  for (const [dept, amt] of Object.entries(profile.deptMix)) {
    mix[dept] = amt;
  }
  return mix;
}

export function rollupEmployee(
  profile: EmployeeProfile,
  period: EmployeePeriod,
  dataRange: [string, string],
  laborDateRange: [string, string] = ['', ''],
): EmployeeRollup {
  const [start, end] = periodBounds(dataRange, period);
  const entries = filterEmployeeDays(profile.days, start, end);
  const laborBounds = intersectPeriod(start, end, laborDateRange[0], laborDateRange[1]);
  const laborPeriodStart = laborBounds?.[0] ?? '';
  const laborPeriodEnd = laborBounds?.[1] ?? '';
  const laborEntries = laborBounds
    ? filterEmployeeDays(profile.days, laborPeriodStart, laborPeriodEnd)
    : [];

  let sales = 0;
  let tickets = 0;
  let gratuity = 0;
  let serviceChargeVip = 0;
  let serviceChargeParty = 0;
  let serviceChargeOther = 0;

  let laborSales = 0;
  let laborTips = 0;
  let hours = 0;
  let laborCost = 0;
  let shiftCount = 0;
  let scheduledShifts = 0;
  let lateMinutes = 0;
  let noShows = 0;

  const dailyTrend: EmployeeRollup['dailyTrend'] = [];
  let bestDay: EmployeeRollup['bestDay'] = null;

  for (const [date, d] of entries) {
    sales += d.sales;
    tickets += d.tickets;
    gratuity += d.gratuity;
    serviceChargeVip += d.serviceChargeVip;
    serviceChargeParty += d.serviceChargeParty;
    serviceChargeOther += d.serviceChargeOther;

    const tips = dayTips(d);
    dailyTrend.push({ date, sales: d.sales, tips, hours: d.hours });
    if (!bestDay || d.sales > bestDay.sales) {
      bestDay = { date, sales: d.sales };
    }
  }

  for (const [, d] of laborEntries) {
    laborSales += d.sales;
    laborTips += dayTips(d);
    hours += d.hours;
    laborCost += d.laborCost;
    if (d.hours > 0) shiftCount += 1;
    scheduledShifts += d.scheduledShifts;
    lateMinutes += d.lateMinutes;
    noShows += d.noShow;
  }

  const totalTips = gratuity + serviceChargeVip + serviceChargeParty + serviceChargeOther;
  const laborPeriodDays = laborBounds
    ? Math.max(
        1,
        Math.ceil(
          (new Date(`${laborPeriodEnd}T12:00:00`).getTime() -
            new Date(`${laborPeriodStart}T12:00:00`).getTime()) /
            86400000,
        ) + 1,
      )
    : 1;
  const weeks = laborPeriodDays / 7;

  return {
    employeeId: profile.id,
    displayName: profile.displayName,
    roles: profile.roles,
    wage: profile.wage,
    hiredAt: profile.hiredAt,
    active: profile.active,
    periodStart: start,
    periodEnd: end,
    laborPeriodStart,
    laborPeriodEnd,
    laborSales,
    laborTips,
    sales,
    tickets,
    gratuity,
    serviceChargeVip,
    serviceChargeParty,
    serviceChargeOther,
    totalTips,
    hours,
    laborCost,
    shiftCount,
    scheduledShifts,
    lateMinutes,
    noShows,
    avgCheck: tickets > 0 ? sales / tickets : null,
    salesPerHour: hours > 0 ? laborSales / hours : null,
    tipsPerHour: hours > 0 ? laborTips / hours : null,
    tipRate: sales > 0 ? (totalTips / sales) * 100 : null,
    salesPerWageDollar: profile.wage > 0 && laborSales > 0 ? laborSales / profile.wage : null,
    personalLaborPct: laborSales > 0 ? (laborCost / laborSales) * 100 : null,
    avgHoursPerWeek: hours > 0 ? hours / weeks : null,
    avgShiftLength: shiftCount > 0 ? hours / shiftCount : null,
    dailyTrend,
    deptMix: mergeDeptMix(entries, profile),
    topItems: mergeTopItems(profile.topItems),
    bestDay,
    laborLinked: profile.sevenShiftsUserId != null && hours > 0,
  };
}

function primaryRole(roles: string[]): string | null {
  if (!roles.length) return null;
  return roles[0];
}

function rolesOverlap(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  const setB = new Set(b.map((r) => r.toLowerCase()));
  return a.some((r) => setB.has(r.toLowerCase()));
}

function rankMetric(
  rollups: EmployeeRollup[],
  targetId: string,
  getter: (r: EmployeeRollup) => number | null,
  higherIsBetter = true,
): { rank: number | null; percentile: number | null; peerCount: number } {
  const peers = rollups
    .map((r) => ({ id: r.employeeId, value: getter(r) }))
    .filter((p): p is { id: string; value: number } => p.value != null && p.value > 0);

  if (peers.length === 0) return { rank: null, percentile: null, peerCount: 0 };

  peers.sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value));
  const idx = peers.findIndex((p) => p.id === targetId);
  if (idx < 0) return { rank: null, percentile: null, peerCount: peers.length };

  const rank = idx + 1;
  const percentile = Math.round(((peers.length - rank) / Math.max(peers.length - 1, 1)) * 100);
  return { rank, percentile, peerCount: peers.length };
}

export function computeEmployeeRankings(
  rollups: EmployeeRollup[],
  target: EmployeeRollup,
  profiles: EmployeeProfile[],
): EmployeeRankings {
  const role = primaryRole(target.roles);
  const peerRollups = role
    ? rollups.filter((r) => {
        const p = profiles.find((e) => e.id === r.employeeId);
        return p && rolesOverlap(p.roles, target.roles);
      })
    : rollups;

  const pool = peerRollups.length >= 3 ? peerRollups : rollups;

  const sales = rankMetric(pool, target.employeeId, (r) => r.sales);
  const tipsPerHour = rankMetric(pool, target.employeeId, (r) => r.tipsPerHour);
  const splh = rankMetric(pool, target.employeeId, (r) => r.salesPerHour);
  const hours = rankMetric(pool, target.employeeId, (r) => r.hours);

  return {
    salesRank: sales.rank,
    salesPercentile: sales.percentile,
    tipsPerHourRank: tipsPerHour.rank,
    tipsPerHourPercentile: tipsPerHour.percentile,
    splhRank: splh.rank,
    splhPercentile: splh.percentile,
    hoursRank: hours.rank,
    hoursPercentile: hours.percentile,
    peerCount: sales.peerCount,
    roleLabel: role,
  };
}

export function computeRoleAverages(
  rollups: EmployeeRollup[],
  role: string | null,
): { avgTipRate: number | null; avgSplh: number | null } {
  const peers = role
    ? rollups.filter((r) => r.roles.some((x) => x.toLowerCase() === role.toLowerCase()))
    : rollups;

  const tipRates = peers.map((r) => r.tipRate).filter((v): v is number => v != null && v > 0);
  const splhs = peers.map((r) => r.salesPerHour).filter((v): v is number => v != null && v > 0);

  return {
    avgTipRate: tipRates.length ? tipRates.reduce((a, b) => a + b, 0) / tipRates.length : null,
    avgSplh: splhs.length ? splhs.reduce((a, b) => a + b, 0) / splhs.length : null,
  };
}

export function workPatternGrid(
  days: Record<string, EmployeeDaily>,
  start: string,
  end: string,
): number[][] {
  // rows: Sun-Sat, cols: dayparts (4am-11, 11-3, 3-8, 8-4)
  const grid = Array.from({ length: 7 }, () => [0, 0, 0, 0]);
  for (const [date, d] of filterEmployeeDays(days, start, end)) {
    if (d.hours <= 0) continue;
    const dow = new Date(`${date}T12:00:00`).getDay();
    // Without punch times in JSON, distribute hours evenly across dayparts worked
    // Use tickets as proxy: more activity -> spread across evening slots
    const slot = d.tickets > 20 ? 2 : d.tickets > 5 ? 1 : 0;
    grid[dow][slot] += d.hours;
  }
  return grid;
}

export function allRoles(employees: EmployeeProfile[]): string[] {
  const set = new Set<string>();
  for (const e of employees) {
    for (const r of e.roles) set.add(r);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
