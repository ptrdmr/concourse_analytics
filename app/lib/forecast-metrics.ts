export interface ForecastMetricRow {
  weekStart: string;
  predictedRevenue: number;
}

function parseLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * True when the ISO week starting Monday `weekStart` (YYYY-MM-DD) has fully ended
 * in the local calendar (i.e. today is that Monday or later).
 */
export function isCompletedFullWeek(weekStartIso: string, asOf: Date = new Date()): boolean {
  const start = parseLocalDate(weekStartIso);
  const nextMonday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  const asDay = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  return asDay >= nextMonday;
}

export interface ForecastOverlapMetrics {
  n: number;
  mae: number;
  rmse: number;
  rSquared: number | undefined;
}

function byWeekStart(rows: ForecastMetricRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of rows) {
    m.set(row.weekStart, row.predictedRevenue);
  }
  return m;
}

/**
 * MAE, RMSE, and R² comparing predicted to actual on weeks where both exist
 * (same weekStart keys). Uses completed full weeks only for actuals. R² is omitted when n < 2.
 */
export function computeForecastOverlapMetrics(
  actual: ForecastMetricRow[],
  seasonal: ForecastMetricRow[],
  asOf: Date = new Date(),
): ForecastOverlapMetrics | null {
  const actualFullWeeks = actual.filter(row => isCompletedFullWeek(row.weekStart, asOf));
  const actualByWeek = byWeekStart(actualFullWeeks);
  const seasonalByWeek = byWeekStart(seasonal);

  const pairs: { y: number; yhat: number }[] = [];
  for (const [weekStart, y] of actualByWeek) {
    if (!seasonalByWeek.has(weekStart)) continue;
    const yhat = seasonalByWeek.get(weekStart)!;
    pairs.push({ y, yhat });
  }

  if (pairs.length === 0) return null;

  const n = pairs.length;
  let absSum = 0;
  let sqErrSum = 0;
  for (const { y, yhat } of pairs) {
    const e = y - yhat;
    absSum += Math.abs(e);
    sqErrSum += e * e;
  }

  const mae = absSum / n;
  const rmse = Math.sqrt(sqErrSum / n);

  let rSquared: number | undefined;
  if (n >= 2) {
    const meanY = pairs.reduce((s, p) => s + p.y, 0) / n;
    let ssTot = 0;
    for (const { y } of pairs) {
      const d = y - meanY;
      ssTot += d * d;
    }
    rSquared = ssTot > 0 ? 1 - sqErrSum / ssTot : undefined;
  }

  return { n, mae, rmse, rSquared };
}
