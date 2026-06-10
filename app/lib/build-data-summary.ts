import { formatCurrency, formatNumber, formatPercent } from './format';

interface TopItem {
  name: string;
  revenue: number;
  quantity: number;
  category: string;
}

interface CategoryEntry {
  category: string;
  revenue: number;
}

interface WeeklyEntry {
  week: string;
  revenue: number;
}

interface KPIs {
  totalRevenue: number;
  totalQuantity: number;
  totalTransactions: number;
  uniqueItems: number;
}

export function buildExplorerSummary(opts: {
  department: string;
  dateRange: [string, string] | null;
  kpis: KPIs;
  categoryBreakdown: CategoryEntry[];
  weeklyTrends: WeeklyEntry[];
  topItems: TopItem[];
}): string {
  const { department, dateRange, kpis, categoryBreakdown, weeklyTrends, topItems } = opts;
  const lines: string[] = [];

  lines.push('Dashboard: Data Explorer');
  lines.push(`Department: ${department || 'All'} | Date Range: ${dateRange ? `${dateRange[0]} to ${dateRange[1]}` : 'All time'}`);
  lines.push(`KPIs: Sales ${formatCurrency(kpis.totalRevenue)} | Qty ${formatNumber(kpis.totalQuantity)} | Transactions ${formatNumber(kpis.totalTransactions)} | Unique Items ${kpis.uniqueItems}`);
  lines.push('');

  const top = topItems.slice(0, 15);
  if (top.length > 0) {
    lines.push('Top Items by Sales:');
    top.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.name} - ${formatCurrency(item.revenue)} (qty: ${formatNumber(item.quantity)}, category: ${item.category})`);
    });
    lines.push('');
  }

  const totalCatRevenue = categoryBreakdown.reduce((s, c) => s + c.revenue, 0);
  if (categoryBreakdown.length > 0) {
    lines.push('Category Breakdown:');
    categoryBreakdown.forEach(c => {
      const pct = totalCatRevenue > 0 ? (c.revenue / totalCatRevenue) * 100 : 0;
      lines.push(`- ${c.category}: ${formatCurrency(c.revenue)} (${formatPercent(pct)})`);
    });
    lines.push('');
  }

  const recentWeeks = weeklyTrends.slice(-8);
  if (recentWeeks.length > 0) {
    lines.push('Weekly Trend (last 8 weeks):');
    lines.push(recentWeeks.map(w => `${w.week}: ${formatCurrency(w.revenue)}`).join(' | '));
    lines.push('');
  }

  return lines.join('\n');
}

export function buildOverviewSummary(opts: {
  dateRange: [string, string] | null;
  kpis: KPIs;
  departments: Array<{ name: string; revenue: number; transactions: number; uniqueItems: number }>;
}): string {
  const { dateRange, kpis, departments } = opts;
  const lines: string[] = [];

  lines.push('Dashboard: Business Overview');
  lines.push(`Date Range: ${dateRange ? `${dateRange[0]} to ${dateRange[1]}` : 'All time'}`);
  lines.push(`KPIs: Sales ${formatCurrency(kpis.totalRevenue)} | Qty ${formatNumber(kpis.totalQuantity)} | Transactions ${formatNumber(kpis.totalTransactions)} | Unique Items ${kpis.uniqueItems}`);
  lines.push('');

  if (departments.length > 0) {
    lines.push('Sales by Department:');
    departments.forEach(d => {
      lines.push(`- ${d.name}: ${formatCurrency(d.revenue)} (${formatNumber(d.transactions)} txns, ${d.uniqueItems} items)`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

export function buildBowlingSummary(opts: {
  totalRevenue: number;
  years: number[];
  dateRange: { start: string; end: string };
  currentYearWeeks?: Array<{ week: number; revenue: number }>;
}): string {
  const { totalRevenue, years, dateRange, currentYearWeeks } = opts;
  const lines: string[] = [];

  lines.push('Dashboard: Bowling Forecast');
  lines.push(`Total Bowling Sales: ${formatCurrency(totalRevenue)}`);
  lines.push(`Years of Data: ${years.length} (${years.join(', ')})`);
  lines.push(`Date Range: ${dateRange.start} to ${dateRange.end}`);
  lines.push('');

  if (currentYearWeeks && currentYearWeeks.length > 0) {
    const currentYear = years[years.length - 1];
    lines.push(`${currentYear} Weekly Sales (most recent ${Math.min(currentYearWeeks.length, 12)} weeks):`);
    currentYearWeeks.slice(-12).forEach(w => {
      lines.push(`  Week ${w.week}: ${formatCurrency(w.revenue)}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

export function buildDaypartsSummary(opts: {
  department: string;
  dateRange: [string, string] | null;
  metric: string;
  dayCount: number;
  peakSlot?: string;
  peakValue?: number;
}): string {
  const { department, dateRange, metric, dayCount, peakSlot, peakValue } = opts;
  const lines: string[] = [];

  lines.push('Dashboard: Dayparts');
  lines.push(`Department: ${department} | Date Range: ${dateRange ? `${dateRange[0]} to ${dateRange[1]}` : 'All time'}`);
  lines.push(`Metric: ${metric} | Matching days: ${dayCount}`);
  if (peakSlot && peakValue != null) {
    lines.push(`Peak slot: ${peakSlot} (${metric === 'revenue' ? formatCurrency(peakValue) : formatNumber(peakValue)})`);
  }
  lines.push('');

  return lines.join('\n');
}

export function buildPaymentsSummary(opts: {
  periodLabel: string;
  cashAmount: number;
  cashTransactions: number;
  creditAmount: number;
  creditTransactions: number;
  totalAmount: number;
  topPayments: Array<{ name: string; amount: number; transactions: number }>;
}): string {
  const { periodLabel, cashAmount, cashTransactions, creditAmount, creditTransactions, totalAmount, topPayments } = opts;
  const lines: string[] = [];

  lines.push('Dashboard: Payments');
  lines.push(`Period: ${periodLabel}`);
  lines.push(`Cash: ${formatCurrency(cashAmount)} (${formatNumber(cashTransactions)} payments)`);
  lines.push(`Credit/Card: ${formatCurrency(creditAmount)} (${formatNumber(creditTransactions)} payments)`);
  lines.push(`Total Tender: ${formatCurrency(totalAmount)}`);
  lines.push('');

  if (topPayments.length > 0) {
    lines.push('Top payment types:');
    topPayments.slice(0, 10).forEach((p, i) => {
      lines.push(`${i + 1}. ${p.name} - ${formatCurrency(p.amount)} (${formatNumber(p.transactions)} payments)`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

export function buildHolidaysSummary(opts: {
  holiday: string;
  department: string;
  years: Array<{ year: number; revenue: number; transactions: number }>;
}): string {
  const { holiday, department, years } = opts;
  const lines: string[] = [];

  lines.push('Dashboard: Holiday Analysis');
  lines.push(`Holiday: ${holiday} | Department: ${department}`);
  lines.push('');

  if (years.length > 0) {
    lines.push('Year-over-year:');
    years.forEach((y) => {
      lines.push(`- ${y.year}: ${formatCurrency(y.revenue)} (${formatNumber(y.transactions)} txns)`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

export function buildCompareSummary(opts: {
  periodA: [string, string];
  periodB: [string, string];
  department: string;
  granularity: string;
  kpisA: KPIs;
  kpisB: KPIs;
}): string {
  const { periodA, periodB, department, granularity, kpisA, kpisB } = opts;
  const lines: string[] = [];

  lines.push('Dashboard: Period Comparison');
  lines.push(`Period A: ${periodA[0]} to ${periodA[1]}`);
  lines.push(`Period B: ${periodB[0]} to ${periodB[1]}`);
  lines.push(`Department: ${department} | Granularity: ${granularity}`);
  lines.push('');
  lines.push(`Period A KPIs: Sales ${formatCurrency(kpisA.totalRevenue)} | Qty ${formatNumber(kpisA.totalQuantity)} | Txns ${formatNumber(kpisA.totalTransactions)}`);
  lines.push(`Period B KPIs: Sales ${formatCurrency(kpisB.totalRevenue)} | Qty ${formatNumber(kpisB.totalQuantity)} | Txns ${formatNumber(kpisB.totalTransactions)}`);

  const revChange = kpisA.totalRevenue > 0
    ? ((kpisB.totalRevenue - kpisA.totalRevenue) / kpisA.totalRevenue) * 100
    : 0;
  lines.push(`Sales change A→B: ${formatPercent(revChange)}`);
  lines.push('');

  return lines.join('\n');
}

export function buildTicketsSummary(opts: {
  month: string | null;
  monthLabel: string;
  ticketCount: number;
  filteredCount: number;
  departments: string[];
}): string {
  const { month, monthLabel, ticketCount, filteredCount, departments } = opts;
  const lines: string[] = [];

  lines.push('Dashboard: Ticket Lookup');
  lines.push(`Month: ${monthLabel || month || 'None selected'}`);
  lines.push(`Tickets in month: ${formatNumber(ticketCount)}`);
  if (filteredCount !== ticketCount) {
    lines.push(`Filtered results: ${formatNumber(filteredCount)}`);
  }
  if (departments.length > 0) {
    lines.push(`Departments: ${departments.join(', ')}`);
  }
  lines.push('');

  return lines.join('\n');
}
