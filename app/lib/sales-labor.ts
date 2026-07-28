import type { DateRange } from '@/lib/date-ranges';
import type { DailySalesLaborPoint, LaborDay, SalesLaborSummary, Transaction } from '@/types';

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function addDays(iso: string, days: number): string {
  const d = parseDate(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

function daysBetween(start: string, end: string): number {
  const ms = parseDate(end).getTime() - parseDate(start).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
}

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  let current = start;
  while (current <= end) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

function formatDayLabel(iso: string): string {
  const d = parseDate(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export const CHART_MONTHLY_THRESHOLD_DAYS = 90;

export function chartGranularityForRange(dateRange: DateRange | null): 'day' | 'month' {
  if (!dateRange) return 'month';
  return daysBetween(dateRange[0], dateRange[1]) > CHART_MONTHLY_THRESHOLD_DAYS ? 'month' : 'day';
}

export function aggregateSalesLaborForChart(
  daily: DailySalesLaborPoint[],
  granularity: 'day' | 'month',
): DailySalesLaborPoint[] {
  if (granularity === 'day') return daily;

  const byMonth = new Map<string, DailySalesLaborPoint>();

  for (const point of daily) {
    const monthKey = point.date.slice(0, 7);
    const existing = byMonth.get(monthKey) || {
      date: `${monthKey}-01`,
      label: formatMonthLabel(monthKey),
      sales: 0,
      laborCost: 0,
      laborHours: 0,
      laborPct: null,
    };

    existing.sales += point.sales;
    existing.laborCost += point.laborCost;
    existing.laborHours += point.laborHours;
    byMonth.set(monthKey, existing);
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, point]) => ({
      ...point,
      laborPct: point.sales > 0 ? (point.laborCost / point.sales) * 100 : null,
    }));
}

export function priorPeriodRange(dateRange: DateRange): DateRange {
  const [start, end] = dateRange;
  const length = daysBetween(start, end);
  const priorEnd = addDays(start, -1);
  const priorStart = addDays(priorEnd, -(length - 1));
  return [priorStart, priorEnd];
}

export function dailySalesByDate(
  transactions: Transaction[],
  dateRange: DateRange | null,
): Map<string, { sales: number; transactions: number }> {
  const map = new Map<string, { sales: number; transactions: number }>();
  for (const row of transactions) {
    if (dateRange) {
      const [start, end] = dateRange;
      if (row.date < start || row.date > end) continue;
    }
    const entry = map.get(row.date) || { sales: 0, transactions: 0 };
    entry.sales += row.revenue;
    entry.transactions += row.transactions;
    map.set(row.date, entry);
  }
  return map;
}

export function buildSalesLaborSummary(opts: {
  transactions: Transaction[];
  laborByDate: Record<string, LaborDay>;
  dateRange: DateRange | null;
  laborAvailable: boolean;
  laborThrough: string | null;
  /** Last date the sales export covers; days past it are dropped entirely. */
  salesThrough?: string | null;
}): SalesLaborSummary {
  const { transactions, laborByDate, dateRange, laborAvailable, laborThrough, salesThrough } = opts;

  const allDates = dateRange
    ? enumerateDates(dateRange[0], dateRange[1])
    : Array.from(
        new Set([
          ...transactions.map((t) => t.date),
          ...Object.keys(laborByDate),
        ])
      ).sort();

  // Labor lands a day or two ahead of sales. Counting those days would inflate
  // labor cost against sales that haven't been exported yet, throwing off both
  // labor % and sales per labor hour.
  const dates = salesThrough ? allDates.filter((d) => d <= salesThrough) : allDates;

  const salesMap = dailySalesByDate(transactions, dateRange);

  let totalSales = 0;
  let totalLaborCost = 0;
  let totalLaborHours = 0;
  let totalTransactions = 0;

  const daily = dates.map((date) => {
    const salesEntry = salesMap.get(date);
    const sales = salesEntry?.sales ?? 0;
    const labor = laborByDate[date];
    const laborCost = labor?.laborCost ?? 0;
    const laborHours = labor?.laborHours ?? 0;

    totalSales += sales;
    totalLaborCost += laborCost;
    totalLaborHours += laborHours;
    totalTransactions += salesEntry?.transactions ?? 0;

    return {
      date,
      label: formatDayLabel(date),
      sales,
      laborCost,
      laborHours,
      laborPct: sales > 0 ? (laborCost / sales) * 100 : null,
    };
  });

  const laborPct = totalSales > 0 ? (totalLaborCost / totalSales) * 100 : null;
  const salesPerLaborHour = totalLaborHours > 0 ? totalSales / totalLaborHours : null;
  const avgTicket = totalTransactions > 0 ? totalSales / totalTransactions : null;

  const chartGranularity = chartGranularityForRange(dateRange);
  const chart = aggregateSalesLaborForChart(daily, chartGranularity);

  return {
    totalSales,
    totalLaborCost,
    totalLaborHours,
    laborPct,
    salesPerLaborHour,
    avgTicket,
    totalTransactions,
    daily,
    chartGranularity,
    chart,
    laborAvailable,
    laborThrough,
  };
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function filterTransactionsByRange(
  transactions: Transaction[],
  dateRange: DateRange | null,
): Transaction[] {
  if (!dateRange) return transactions;
  const [start, end] = dateRange;
  return transactions.filter((t) => t.date >= start && t.date <= end);
}
