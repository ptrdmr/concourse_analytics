import { SPECIALS_TARGETS } from '@/config/specials-targets';
import type { LaborDay, Transaction } from '@/types';

export type VerdictKind =
  | 'item-drop'
  | 'labor-win'
  | 'labor-slack'
  | 'daypart-bleed'
  | 'specials'
  | 'clean';

export interface VerdictFinding {
  id: string;
  kind: VerdictKind;
  sentence: string;
  dollarImpactWeekly: number;
  math: string[];
  watchNote?: string;
  /** Present on item-drop findings for Menu Watch. */
  itemName?: string;
  currentUnits?: number;
  baselineUnits?: number;
  streak?: number;
  annualImpact?: number;
}

export interface DaypartBaselineRow {
  department: string;
  dow: number;
  window: string;
  weeks: Array<{ weekStart: string; revenue: number }>;
  baselineMedian: number;
  currentWeek: number;
  gapDollars: number;
  underStreak: number;
}

export interface DaypartBaselinesData {
  generatedAt?: string;
  windows?: Array<{ id: string; label: string }>;
  rows: DaypartBaselineRow[];
}

export interface ItemFindingDetail {
  itemName: string;
  currentUnits: number;
  baselineUnits: number;
  streak: number;
  dollarImpactWeekly: number;
  annualImpact: number;
  sentence: string;
  math: string[];
}

export interface VerdictResult {
  findings: VerdictFinding[];
  action: { sentence: string; math: string[] } | null;
  clean: boolean;
  weekStart: string | null;
  weekEnd: string | null;
  /** All flagged item drops (not truncated) for Menu Watch. */
  itemFindings: ItemFindingDetail[];
  watchNotes: string[];
}

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const WINDOW_LABELS: Record<string, string> = {
  morning: 'morning',
  lunch: 'lunch (11am-3pm)',
  afternoon: 'afternoon (3-6pm)',
  evening: 'evening (6-9pm)',
  late: 'late (9pm-4am)',
};

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** Monday of the ISO week containing `iso`. */
export function mondayOfWeek(iso: string): string {
  const d = parseLocalDate(iso);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toISO(d);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Round dollars for display: >=1000 → nearest 100; else nearest 10. */
export function roundVerdictDollars(value: number): number {
  const abs = Math.abs(value);
  const step = abs >= 1000 ? 100 : 10;
  return Math.round(value / step) * step;
}

export function formatVerdictDollars(value: number): string {
  const rounded = roundVerdictDollars(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rounded);
}

function formatAnnual(weeklyImpact: number): string {
  return formatVerdictDollars(weeklyImpact * 52);
}

/**
 * Last complete Monday–Sunday week fully inside dateRange.
 * If the range ends mid-week, use the last complete week before the end.
 */
export function resolveCurrentWeek(
  dateRange: [string, string] | null,
  allDates: string[],
): { weekStart: string; weekEnd: string } | null {
  let endAnchor: string | null = null;
  if (dateRange) {
    endAnchor = dateRange[1];
  } else if (allDates.length > 0) {
    endAnchor = allDates.reduce((a, b) => (a > b ? a : b));
  }
  if (!endAnchor) return null;

  let candidateStart = mondayOfWeek(endAnchor);
  let candidateEnd = addDaysISO(candidateStart, 6);

  // Need a complete week fully ended on or before endAnchor.
  if (candidateEnd > endAnchor) {
    candidateStart = addDaysISO(candidateStart, -7);
    candidateEnd = addDaysISO(candidateStart, 6);
  }

  if (dateRange && candidateStart < dateRange[0]) {
    // Prefer a week fully inside the range.
    const startMonday = mondayOfWeek(dateRange[0]);
    const firstFullyInside =
      startMonday < dateRange[0] ? addDaysISO(startMonday, 7) : startMonday;
    if (firstFullyInside <= candidateStart && addDaysISO(firstFullyInside, 6) <= dateRange[1]) {
      // ok — candidate is fine if also >= firstFullyInside
    } else if (addDaysISO(firstFullyInside, 6) <= dateRange[1]) {
      candidateStart = firstFullyInside;
      candidateEnd = addDaysISO(candidateStart, 6);
    }
  }

  if (candidateEnd > endAnchor) return null;
  return { weekStart: candidateStart, weekEnd: candidateEnd };
}

function enumerateWeekStarts(endWeekStart: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(addDaysISO(endWeekStart, -7 * i));
  }
  return out;
}

function sumDailySales(
  transactions: Transaction[],
  start: string,
  end: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of transactions) {
    if (row.date < start || row.date > end) continue;
    map.set(row.date, (map.get(row.date) || 0) + row.revenue);
  }
  return map;
}

function weekTotals(
  daily: Map<string, number>,
  weekStart: string,
): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += daily.get(addDaysISO(weekStart, i)) || 0;
  }
  return sum;
}

function laborWeekTotals(
  laborByDate: Record<string, LaborDay>,
  weekStart: string,
): { cost: number; hours: number } {
  let cost = 0;
  let hours = 0;
  for (let i = 0; i < 7; i++) {
    const day = laborByDate[addDaysISO(weekStart, i)];
    if (!day) continue;
    cost += day.laborCost || 0;
    hours += day.laborHours || 0;
  }
  return { cost, hours };
}

interface ItemWeek {
  units: number;
  revenue: number;
}

function buildItemWeekly(
  transactions: Transaction[],
  weekStarts: string[],
): Map<string, Map<string, ItemWeek>> {
  // item -> weekStart -> totals
  const weekSet = new Set(weekStarts);
  const minDate = weekStarts[0];
  const maxDate = addDaysISO(weekStarts[weekStarts.length - 1], 6);
  const out = new Map<string, Map<string, ItemWeek>>();

  for (const row of transactions) {
    if (row.date < minDate || row.date > maxDate) continue;
    const ws = mondayOfWeek(row.date);
    if (!weekSet.has(ws)) continue;
    let byWeek = out.get(row.name);
    if (!byWeek) {
      byWeek = new Map();
      out.set(row.name, byWeek);
    }
    const cur = byWeek.get(ws) || { units: 0, revenue: 0 };
    cur.units += row.quantity;
    cur.revenue += row.revenue;
    byWeek.set(ws, cur);
  }
  return out;
}

function buildItemDrops(
  transactions: Transaction[],
  currentWeekStart: string,
): { findings: VerdictFinding[]; details: ItemFindingDetail[] } {
  const trailing = enumerateWeekStarts(addDaysISO(currentWeekStart, -7), 10);
  const allWeeks = [...trailing, currentWeekStart];
  const itemWeekly = buildItemWeekly(transactions, allWeeks);
  const findings: VerdictFinding[] = [];
  const details: ItemFindingDetail[] = [];

  for (const [itemName, byWeek] of itemWeekly) {
    const trailingUnits = trailing
      .map((ws) => byWeek.get(ws)?.units ?? 0)
      .filter((u) => u > 0);
    if (trailingUnits.length < 4) continue;

    const baseline = median(trailingUnits);
    if (baseline == null || baseline < 5) continue;

    const absDevs = trailingUnits.map((u) => Math.abs(u - baseline));
    const mad = median(absDevs) ?? 0;
    const dropByMad = mad;
    const dropByPct = 0.4 * baseline;
    const requiredDrop = Math.max(dropByMad, dropByPct);
    const threshold = baseline - requiredDrop;

    const currentUnits = byWeek.get(currentWeekStart)?.units ?? 0;
    if (currentUnits >= threshold) continue;

    // Streak: consecutive weeks ending at current below threshold
    let streak = 0;
    for (let i = allWeeks.length - 1; i >= 0; i--) {
      const u = byWeek.get(allWeeks[i])?.units ?? 0;
      if (u < threshold) streak += 1;
      else break;
    }
    if (streak < 2) continue;

    const trailingRevenue = trailing
      .map((ws) => byWeek.get(ws)?.revenue ?? 0)
      .filter((_, idx) => (byWeek.get(trailing[idx])?.units ?? 0) > 0);
    const medianRev = median(trailingRevenue) ?? 0;
    const currentRev = byWeek.get(currentWeekStart)?.revenue ?? 0;
    const dollarImpactWeekly = Math.max(0, medianRev - currentRev);
    const annualImpact = dollarImpactWeekly * 52;
    const baselineRounded = Math.round(baseline);

    const sentence =
      `${itemName}: ${Math.round(currentUnits)} sold this week vs a typical ${baselineRounded}. ` +
      `Down ${streak} weeks straight — roughly ${formatAnnual(dollarImpactWeekly)}/year if it holds.`;

    const math = [
      `Trailing non-zero weeks (units): ${trailingUnits.map((u) => Math.round(u)).join(', ')}`,
      `Median baseline units: ${baseline.toFixed(1)}`,
      `MAD: ${mad.toFixed(1)}; 40% of baseline: ${(0.4 * baseline).toFixed(1)}`,
      `Required drop (larger of MAD / 40%): ${requiredDrop.toFixed(1)}`,
      `Flag threshold: ${threshold.toFixed(1)}`,
      `Current week units: ${currentUnits.toFixed(1)}`,
      `Streak below threshold: ${streak}`,
      `Median weekly revenue: ${formatVerdictDollars(medianRev)}`,
      `Current week revenue: ${formatVerdictDollars(currentRev)}`,
      `Weekly impact: ${formatVerdictDollars(dollarImpactWeekly)} × 52 = ${formatAnnual(dollarImpactWeekly)}/year`,
    ];

    const finding: VerdictFinding = {
      id: `item-${itemName}`,
      kind: 'item-drop',
      sentence,
      dollarImpactWeekly,
      math,
      itemName,
      currentUnits,
      baselineUnits: baseline,
      streak,
      annualImpact,
    };
    findings.push(finding);
    details.push({
      itemName,
      currentUnits,
      baselineUnits: baseline,
      streak,
      dollarImpactWeekly,
      annualImpact,
      sentence,
      math,
    });
  }

  details.sort((a, b) => b.dollarImpactWeekly - a.dollarImpactWeekly);
  return { findings, details };
}

function buildSpecialsFindings(
  transactions: Transaction[],
  currentWeekStart: string,
): VerdictFinding[] {
  const entries = Object.entries(SPECIALS_TARGETS);
  if (entries.length === 0) return [];

  const weekEnd = addDaysISO(currentWeekStart, 6);
  const findings: VerdictFinding[] = [];

  for (const [name, target] of entries) {
    let units = 0;
    let revenue = 0;
    for (const row of transactions) {
      if (row.name !== name) continue;
      if (row.date < currentWeekStart || row.date > weekEnd) continue;
      units += row.quantity;
      revenue += row.revenue;
    }
    const actual = target.unit === 'dollars' ? revenue : units;
    if (target.targetPerWeek <= 0) continue;
    const ratio = actual / target.targetPerWeek;

    if (ratio < 0.75) {
      const weeklyGap =
        target.unit === 'dollars'
          ? target.targetPerWeek - actual
          : (target.targetPerWeek - actual) * (units > 0 ? revenue / units : 0);
      const fourWeekGap = weeklyGap * 4;
      const sentence =
        target.unit === 'dollars'
          ? `${name}: ${formatVerdictDollars(actual)} this week vs ${formatVerdictDollars(target.targetPerWeek)} target — on pace to miss by roughly ${formatVerdictDollars(fourWeekGap)} over 4 weeks.`
          : `${name}: ${Math.round(actual)} units this week vs ${target.targetPerWeek} target — on pace to miss by roughly ${formatVerdictDollars(fourWeekGap)} over 4 weeks.`;
      findings.push({
        id: `special-under-${name}`,
        kind: 'specials',
        sentence,
        dollarImpactWeekly: Math.max(0, weeklyGap),
        math: [
          `Target: ${target.targetPerWeek} ${target.unit}/week`,
          `Actual this week: ${actual.toFixed(1)}`,
          `Ratio: ${(ratio * 100).toFixed(0)}% of target`,
          `4-week miss pace: ${formatVerdictDollars(fourWeekGap)}`,
        ],
      });
    } else if (ratio > 1.25) {
      const pct = Math.round((ratio - 1) * 100);
      const beat =
        target.unit === 'dollars' ? actual - target.targetPerWeek : 0;
      findings.push({
        id: `special-over-${name}`,
        kind: 'specials',
        sentence: `${name} beat target by ${pct}% — consider extending or repricing.`,
        dollarImpactWeekly: Math.max(0, beat),
        math: [
          `Target: ${target.targetPerWeek} ${target.unit}/week`,
          `Actual this week: ${actual.toFixed(1)}`,
          `Beat by: ${pct}%`,
        ],
      });
    }
  }
  return findings;
}

function buildDaypartBleedFinding(
  baselines: DaypartBaselinesData | null | undefined,
): VerdictFinding | null {
  if (!baselines?.rows?.length) return null;
  const windowLabels = new Map(
    (baselines.windows || []).map((w) => [w.id, w.label]),
  );
  const candidates = baselines.rows
    .filter(
      (r) =>
        r.department === 'All' &&
        ['lunch', 'afternoon', 'evening', 'late'].includes(r.window) &&
        r.gapDollars > 0 &&
        r.underStreak >= 1,
    )
    .sort((a, b) => b.gapDollars - a.gapDollars);
  if (candidates.length === 0) return null;
  const top = candidates[0];
  const weekday = WEEKDAY_NAMES[top.dow] ?? `DOW ${top.dow}`;
  const winLabel =
    WINDOW_LABELS[top.window] ||
    windowLabels.get(top.window) ||
    top.window;
  const streak = top.underStreak;
  const sentence =
    `${weekday} ${winLabel} ran about ${formatVerdictDollars(top.gapDollars)} under typical. ` +
    `${streak} week${streak === 1 ? '' : 's'} in a row.`;
  return {
    id: `daypart-${top.dow}-${top.window}`,
    kind: 'daypart-bleed',
    sentence,
    dollarImpactWeekly: top.gapDollars,
    math: [
      `Department: ${top.department}`,
      `Day of week: ${weekday} (${top.dow})`,
      `Window: ${winLabel}`,
      `Trailing median: ${formatVerdictDollars(top.baselineMedian)}`,
      `Current week: ${formatVerdictDollars(top.currentWeek)}`,
      `Gap: ${formatVerdictDollars(top.gapDollars)}`,
      `Under streak: ${streak}`,
    ],
  };
}

function buildLaborFindings(
  transactions: Transaction[],
  laborByDate: Record<string, LaborDay>,
  currentWeekStart: string,
): { findings: VerdictFinding[]; watchNotes: string[]; laborWinHeld: boolean; lowestSplhWeekday: string | null; excessHours: number | null } {
  const trailingStarts = enumerateWeekStarts(addDaysISO(currentWeekStart, -7), 8);
  const lookbackStart = trailingStarts[0];
  const currentEnd = addDaysISO(currentWeekStart, 6);
  const dailySales = sumDailySales(transactions, lookbackStart, currentEnd);

  const trailingSplh: number[] = [];
  const trailingLaborCost: number[] = [];
  for (const ws of trailingStarts) {
    const sales = weekTotals(dailySales, ws);
    const labor = laborWeekTotals(laborByDate, ws);
    if (labor.hours > 0 && sales > 0) {
      trailingSplh.push(sales / labor.hours);
      trailingLaborCost.push(labor.cost);
    }
  }

  const findings: VerdictFinding[] = [];
  let laborWinHeld = false;
  let lowestSplhWeekday: string | null = null;
  let excessHours: number | null = null;

  const currentSales = weekTotals(dailySales, currentWeekStart);
  const currentLabor = laborWeekTotals(laborByDate, currentWeekStart);
  const baselineSplh = median(trailingSplh);
  const baselineLaborCost = median(trailingLaborCost);

  if (
    baselineSplh != null &&
    baselineLaborCost != null &&
    currentLabor.hours > 0 &&
    currentSales > 0
  ) {
    const currentSplh = currentSales / currentLabor.hours;

    // Track lowest-SPLH weekday in current week for action copy
    let minSplh = Infinity;
    for (let i = 0; i < 7; i++) {
      const date = addDaysISO(currentWeekStart, i);
      const sales = dailySales.get(date) || 0;
      const hours = laborByDate[date]?.laborHours || 0;
      if (hours > 0 && sales > 0) {
        const splh = sales / hours;
        if (splh < minSplh) {
          minSplh = splh;
          lowestSplhWeekday = WEEKDAY_NAMES[i];
        }
      }
    }

    if (currentSplh >= baselineSplh && currentLabor.cost < baselineLaborCost) {
      laborWinHeld = true;
      const delta = baselineLaborCost - currentLabor.cost;
      findings.push({
        id: 'labor-win',
        kind: 'labor-win',
        sentence:
          `Labor down about ${formatVerdictDollars(delta)} and sales per labor hour rose to ` +
          `${formatVerdictDollars(currentSplh)} — the cut was working capital, not coverage. Keep going.`,
        dollarImpactWeekly: delta,
        math: [
          `Trailing 8-week median SPLH: ${formatVerdictDollars(baselineSplh)}`,
          `Current week SPLH: ${formatVerdictDollars(currentSplh)} (sales ${formatVerdictDollars(currentSales)} ÷ ${currentLabor.hours.toFixed(1)} hrs)`,
          `Trailing median labor cost: ${formatVerdictDollars(baselineLaborCost)}`,
          `Current labor cost: ${formatVerdictDollars(currentLabor.cost)}`,
          `Savings this week: ${formatVerdictDollars(delta)}`,
        ],
      });
    }

    if (currentSplh < 0.9 * baselineSplh) {
      const supportedHours = currentSales / baselineSplh;
      const excess = Math.max(0, currentLabor.hours - supportedHours);
      excessHours = excess;
      const hourlyRate = currentLabor.cost / currentLabor.hours;
      const impact = excess * hourlyRate;
      findings.push({
        id: 'labor-slack',
        kind: 'labor-slack',
        sentence:
          `You paid for about ${Math.round(excess)} more labor hours than sales supported: ` +
          `roughly ${formatVerdictDollars(impact)} this week.`,
        dollarImpactWeekly: impact,
        math: [
          `Baseline SPLH: ${formatVerdictDollars(baselineSplh)}`,
          `Current SPLH: ${formatVerdictDollars(currentSplh)} (< 90% of baseline)`,
          `Hours sales support at baseline SPLH: ${supportedHours.toFixed(1)}`,
          `Actual hours: ${currentLabor.hours.toFixed(1)}`,
          `Excess hours: ${excess.toFixed(1)}`,
          `Avg hourly cost: ${formatVerdictDollars(hourlyRate)}`,
          `Impact: ${formatVerdictDollars(impact)}`,
        ],
      });
    }
  }

  // Soft watch notes — never ranked findings
  const watchNotes = buildLaborWatchNotes(
    dailySales,
    laborByDate,
    currentWeekStart,
    trailingStarts,
  );

  if (findings.length > 0 && watchNotes.length > 0) {
    findings[0] = { ...findings[0], watchNote: watchNotes.join(' ') };
  }

  return { findings, watchNotes, laborWinHeld, lowestSplhWeekday, excessHours };
}

function buildLaborWatchNotes(
  dailySales: Map<string, number>,
  laborByDate: Record<string, LaborDay>,
  currentWeekStart: string,
  trailingStarts: string[],
): string[] {
  // Top 3 revenue days of current week
  const currentDays: Array<{ date: string; sales: number; dow: number }> = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysISO(currentWeekStart, i);
    currentDays.push({ date, sales: dailySales.get(date) || 0, dow: i });
  }
  currentDays.sort((a, b) => b.sales - a.sales);
  const top3 = currentDays.slice(0, 3);

  const notes: string[] = [];
  for (const day of top3) {
    if (day.sales <= 0) continue;
    const hoursByWeek: number[] = [];
    const salesByWeek: number[] = [];
    for (const ws of trailingStarts) {
      const d = addDaysISO(ws, day.dow);
      hoursByWeek.push(laborByDate[d]?.laborHours || 0);
      salesByWeek.push(dailySales.get(d) || 0);
    }
    const hoursMedian = median(hoursByWeek.filter((h) => h > 0));
    const salesMedian = median(salesByWeek.filter((s) => s > 0));
    if (hoursMedian == null || salesMedian == null || hoursMedian === 0) continue;
    const dayHours = laborByDate[day.date]?.laborHours || 0;
    if (dayHours < 0.7 * hoursMedian && day.sales >= 0.9 * salesMedian) {
      notes.push(
        `${WEEKDAY_NAMES[day.dow]} ran well under its usual staffing while sales held — keep an eye on service.`,
      );
    }
  }
  return notes;
}

function buildAction(
  top: VerdictFinding,
  ctx: {
    lowestSplhWeekday: string | null;
    excessHours: number | null;
  },
): { sentence: string; math: string[] } {
  const annual = formatAnnual(top.dollarImpactWeekly);
  if (top.kind === 'labor-slack') {
    const hrs = ctx.excessHours != null ? Math.round(ctx.excessHours) : Math.round(top.dollarImpactWeekly / 20);
    const day = ctx.lowestSplhWeekday || 'the softest day';
    return {
      sentence: `Do this: trim about ${hrs} hours next week, starting with ${day}. Worth roughly ${annual}/year.`,
      math: [
        `Top finding: labor slack`,
        `Excess hours ≈ ${hrs}`,
        `Lowest SPLH weekday: ${day}`,
        `Annualized: ${annual}`,
      ],
    };
  }
  if (top.kind === 'item-drop') {
    const item = top.itemName || 'this item';
    return {
      sentence: `Do this: decide whether ${item} gets a push or a menu review — it's bleeding roughly ${annual}/year.`,
      math: top.math,
    };
  }
  if (top.kind === 'labor-win') {
    return {
      sentence: `Do this: hold the current staffing level — it's outperforming the old one by roughly ${annual}/year.`,
      math: top.math,
    };
  }
  if (top.kind === 'daypart-bleed') {
    return {
      sentence: `Do this: put a focused push on that daypart next week — it's leaving roughly ${annual}/year on the table.`,
      math: top.math,
    };
  }
  if (top.kind === 'specials') {
    return {
      sentence: `Do this: act on the specials finding — roughly ${annual}/year at stake if the gap holds.`,
      math: top.math,
    };
  }
  return {
    sentence: `Do this: keep an eye on next week and hold the line.`,
    math: [],
  };
}

export function buildVerdict(input: {
  transactions: Transaction[];
  laborByDate: Record<string, LaborDay>;
  laborAvailable: boolean;
  dateRange: [string, string] | null;
  daypartBaselines?: DaypartBaselinesData | null;
}): VerdictResult {
  const { transactions, laborByDate, laborAvailable, dateRange, daypartBaselines } = input;
  const allDates = transactions.map((t) => t.date);
  const week = resolveCurrentWeek(dateRange, allDates);

  if (!week) {
    return {
      findings: [
        {
          id: 'clean',
          kind: 'clean',
          sentence: 'No material leaks this week.',
          dollarImpactWeekly: 0,
          math: ['Not enough date coverage to resolve a complete week.'],
        },
      ],
      action: null,
      clean: true,
      weekStart: null,
      weekEnd: null,
      itemFindings: [],
      watchNotes: [],
    };
  }

  const { findings: itemFindingsRaw, details: itemFindings } = buildItemDrops(
    transactions,
    week.weekStart,
  );
  const specialsFindings = buildSpecialsFindings(transactions, week.weekStart);
  const daypartFinding = buildDaypartBleedFinding(daypartBaselines);

  let laborFindings: VerdictFinding[] = [];
  let watchNotes: string[] = [];
  let laborWinHeld = false;
  let lowestSplhWeekday: string | null = null;
  let excessHours: number | null = null;

  if (laborAvailable) {
    const labor = buildLaborFindings(transactions, laborByDate, week.weekStart);
    laborFindings = labor.findings;
    watchNotes = labor.watchNotes;
    laborWinHeld = labor.laborWinHeld;
    lowestSplhWeekday = labor.lowestSplhWeekday;
    excessHours = labor.excessHours;
  }

  const candidates: VerdictFinding[] = [
    ...itemFindingsRaw,
    ...specialsFindings,
    ...laborFindings,
  ];
  if (daypartFinding) candidates.push(daypartFinding);

  candidates.sort((a, b) => b.dollarImpactWeekly - a.dollarImpactWeekly);
  const top = candidates.slice(0, 4);

  if (top.length === 0) {
    let sentence = 'No material leaks this week.';
    const math = ['No item, labor, daypart, or specials findings cleared the noise thresholds.'];
    if (laborWinHeld && laborFindings.length === 0) {
      // labor-win should have been in findings; if somehow not, still praise
      sentence += ' Labor efficiency looks solid.';
    }
    return {
      findings: [
        {
          id: 'clean',
          kind: 'clean',
          sentence,
          dollarImpactWeekly: 0,
          math,
          watchNote: watchNotes[0],
        },
      ],
      action: null,
      clean: true,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      itemFindings,
      watchNotes,
    };
  }

  // If labor-win was filtered out of top-4 but held, mention in clean path only — here we have findings
  const action = buildAction(top[0], { lowestSplhWeekday, excessHours });

  return {
    findings: top,
    action,
    clean: false,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    itemFindings,
    watchNotes,
  };
}
