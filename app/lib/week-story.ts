import type { LaborDay, Transaction } from '@/types';
import { formatVerdictDollars, mondayOfWeek } from '@/lib/verdict';
import { formatCompact } from '@/lib/format';

/**
 * Builds the plain-English "state of the business" hero copy for the
 * Overview. No statistics vocabulary — everything reads as normal writing.
 * "Usual" always means the middle (median) of the trailing 8 complete weeks.
 * Hero stays department-level (Food / Bar / Bowling / Parties) — no products.
 */

export interface StoryTile {
  label: string;
  value: string;
  sub: string;
}

export interface WeekStory {
  weekStart: string;
  weekEnd: string;
  /** Big headline: global sales state. */
  headline: string;
  /** Supporting sentences: departments + labor. */
  lines: string[];
  /** Single "Do this" recommendation (already prefixed). */
  action: string | null;
  tiles: StoryTile[];
  /** Plain-English notes on how the numbers are figured. */
  explain: string[];
}

const TRAILING_WEEKS = 8;

/**
 * Map a transaction row to its hero department (Food / Bar / Bowling / Parties).
 * Catering is always reported under Parties. League Fees, Arcade, etc. are ignored.
 */
function heroDepartment(row: Transaction): string | null {
  const dept = row.department;
  const category = (row.category || '').toLowerCase();
  const name = (row.name || '').toLowerCase();
  const isCatering =
    category === 'catering' ||
    name.startsWith('catering') ||
    name.startsWith('ctr -');

  if (isCatering || dept === 'Parties') return 'Parties';
  if (dept === 'Food' || dept === 'Bar' || dept === 'Bowling') return dept;
  return null;
}

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

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formatWeekLabel(weekStart: string, weekEnd: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const start = parseLocalDate(weekStart).toLocaleDateString('en-US', opts);
  const end = parseLocalDate(weekEnd).toLocaleDateString('en-US', opts);
  return `Week of ${start} – ${end}`;
}

/** Last complete Monday–Sunday week in the data. */
function lastCompleteWeek(transactions: Transaction[]): string | null {
  let maxDate: string | null = null;
  for (const t of transactions) {
    if (maxDate === null || t.date > maxDate) maxDate = t.date;
  }
  if (!maxDate) return null;
  const monday = mondayOfWeek(maxDate);
  const sunday = addDaysISO(monday, 6);
  return sunday <= maxDate ? monday : addDaysISO(monday, -7);
}

export function buildWeekStory(input: {
  transactions: Transaction[];
  laborByDate: Record<string, LaborDay>;
  laborAvailable: boolean;
  action: string | null;
  nextWeekForecast: number | null;
}): WeekStory | null {
  const { transactions, laborByDate, laborAvailable, action, nextWeekForecast } = input;

  const weekStart = lastCompleteWeek(transactions);
  if (!weekStart) return null;
  const weekEnd = addDaysISO(weekStart, 6);

  // Week starts: 8 trailing + current
  const weekStarts: string[] = [];
  for (let i = TRAILING_WEEKS; i >= 0; i--) {
    weekStarts.push(addDaysISO(weekStart, -7 * i));
  }
  const rangeStart = weekStarts[0];

  // One pass: house total + hero-department revenue per week.
  // House total still includes every department (global sales).
  // Department narrative is Food / Bar / Bowling / Parties only (catering → Parties).
  const totalByWeek = new Map<string, number>();
  const deptByWeek = new Map<string, Map<string, number>>();
  for (const row of transactions) {
    if (row.date < rangeStart || row.date > weekEnd) continue;
    const ws = mondayOfWeek(row.date);
    totalByWeek.set(ws, (totalByWeek.get(ws) || 0) + row.revenue);
    const heroDept = heroDepartment(row);
    if (!heroDept) continue;
    let deptMap = deptByWeek.get(heroDept);
    if (!deptMap) {
      deptMap = new Map();
      deptByWeek.set(heroDept, deptMap);
    }
    deptMap.set(ws, (deptMap.get(ws) || 0) + row.revenue);
  }

  const trailingStarts = weekStarts.slice(0, -1);
  const currentSales = totalByWeek.get(weekStart) || 0;
  const usualSales = median(
    trailingStarts.map((ws) => totalByWeek.get(ws) || 0).filter((v) => v > 0),
  );

  // --- Headline: global sales state ---
  let headline: string;
  if (usualSales == null || usualSales <= 0) {
    headline = `Sales came in around ${formatCompact(currentSales)} this week.`;
  } else {
    const delta = currentSales - usualSales;
    const pct = Math.abs(delta) / usualSales;
    if (pct < 0.04) {
      headline = `Sales came in around ${formatCompact(currentSales)} — right in line with a normal week.`;
    } else if (delta > 0) {
      headline = `Sales came in around ${formatCompact(currentSales)} — about ${formatVerdictDollars(delta)} stronger than usual.`;
    } else {
      headline = `Sales came in around ${formatCompact(currentSales)} — about ${formatVerdictDollars(-delta)} softer than usual.`;
    }
  }

  const lines: string[] = [];

  // --- Department movement ---
  interface DeptMove {
    name: string;
    pct: number;
  }
  const movers: DeptMove[] = [];
  for (const [dept, byWeek] of deptByWeek) {
    const usual = median(
      trailingStarts.map((ws) => byWeek.get(ws) || 0).filter((v) => v > 0),
    );
    if (usual == null || usual < 1000) continue;
    const cur = byWeek.get(weekStart) || 0;
    const pct = (cur - usual) / usual;
    if (Math.abs(pct) >= 0.1) movers.push({ name: dept, pct });
  }
  movers.sort((a, b) => b.pct - a.pct);
  const up = movers.length > 0 && movers[0].pct > 0 ? movers[0] : null;
  const down = movers.length > 0 && movers[movers.length - 1].pct < 0 ? movers[movers.length - 1] : null;

  // Big multiples read better as words than as "up 262%".
  const upPhrase = (m: DeptMove): string => {
    if (m.pct >= 2) return `${m.name} more than tripled its usual week`;
    if (m.pct >= 1) return `${m.name} more than doubled its usual week`;
    return `${m.name} led the way, up about ${Math.round(m.pct * 100)}% on its usual week`;
  };

  if (up && down) {
    lines.push(`${upPhrase(up)}; ${down.name} ran about ${Math.round(-down.pct * 100)}% light.`);
  } else if (up) {
    lines.push(`${upPhrase(up)}.`);
  } else if (down) {
    lines.push(`${down.name} ran about ${Math.round(-down.pct * 100)}% under its usual week.`);
  } else {
    lines.push('Every department ran close to its usual.');
  }

  // --- Labor share ---
  let laborTile: StoryTile | null = null;
  if (laborAvailable) {
    const weeklyLaborPct: number[] = [];
    for (const ws of trailingStarts) {
      let cost = 0;
      for (let i = 0; i < 7; i++) {
        cost += laborByDate[addDaysISO(ws, i)]?.laborCost || 0;
      }
      const sales = totalByWeek.get(ws) || 0;
      if (sales > 0 && cost > 0) weeklyLaborPct.push((cost / sales) * 100);
    }
    let currentCost = 0;
    for (let i = 0; i < 7; i++) {
      currentCost += laborByDate[addDaysISO(weekStart, i)]?.laborCost || 0;
    }
    const usualPct = median(weeklyLaborPct);
    if (currentSales > 0 && currentCost > 0 && usualPct != null) {
      const curPct = (currentCost / currentSales) * 100;
      const curCents = Math.round(curPct);
      const usualCents = Math.round(usualPct);
      if (curCents <= usualCents - 2) {
        lines.push(
          `Labor took about ${curCents}¢ of every sales dollar — leaner than your usual ${usualCents}¢. That's the right direction.`,
        );
      } else if (curCents >= usualCents + 2) {
        lines.push(
          `Labor took about ${curCents}¢ of every sales dollar, a touch heavier than your usual ${usualCents}¢ — worth a look at next week's schedule.`,
        );
      } else {
        lines.push(`Labor took its usual share — about ${curCents}¢ of every sales dollar.`);
      }
      laborTile = {
        label: 'Labor',
        value: `${curCents}¢ / $1`,
        sub: `usually about ${usualCents}¢`,
      };
    }
  }

  // --- Tiles ---
  const tiles: StoryTile[] = [
    {
      label: 'Sales this week',
      value: formatCompact(currentSales),
      sub: usualSales != null ? `usually about ${formatCompact(usualSales)}` : 'building your usual now',
    },
  ];
  if (laborTile) tiles.push(laborTile);
  if (nextWeekForecast != null && nextWeekForecast > 0) {
    tiles.push({
      label: 'Next week',
      value: formatCompact(Math.round(nextWeekForecast / 1000) * 1000),
      sub: 'expected, from your seasonal pattern',
    });
  }

  const explain = [
    '"Usual" is the middle of your last 8 full weeks, so one crazy week doesn\'t skew it.',
    'Department and labor lines only speak up when something moved enough to matter.',
    '"Next week" blends your recent pace with the same weeks from prior years.',
  ];

  // If the engine didn't hand us an action, suggest one from the department story.
  let resolvedAction = action;
  if (!resolvedAction && down) {
    resolvedAction = `Do this: dig into ${down.name} — it ran about ${Math.round(-down.pct * 100)}% under its usual week.`;
  }

  return {
    weekStart,
    weekEnd,
    headline,
    lines: lines.slice(0, 3),
    action: resolvedAction,
    tiles,
    explain,
  };
}

export { formatWeekLabel };
