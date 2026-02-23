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
  lines.push(`KPIs: Revenue ${formatCurrency(kpis.totalRevenue)} | Qty ${formatNumber(kpis.totalQuantity)} | Transactions ${formatNumber(kpis.totalTransactions)} | Unique Items ${kpis.uniqueItems}`);
  lines.push('');

  const top = topItems.slice(0, 15);
  if (top.length > 0) {
    lines.push('Top Items by Revenue:');
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
  lines.push(`KPIs: Revenue ${formatCurrency(kpis.totalRevenue)} | Qty ${formatNumber(kpis.totalQuantity)} | Transactions ${formatNumber(kpis.totalTransactions)} | Unique Items ${kpis.uniqueItems}`);
  lines.push('');

  if (departments.length > 0) {
    lines.push('Revenue by Department:');
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
  lines.push(`Total Bowling Revenue: ${formatCurrency(totalRevenue)}`);
  lines.push(`Years of Data: ${years.length} (${years.join(', ')})`);
  lines.push(`Date Range: ${dateRange.start} to ${dateRange.end}`);
  lines.push('');

  if (currentYearWeeks && currentYearWeeks.length > 0) {
    const currentYear = years[years.length - 1];
    lines.push(`${currentYear} Weekly Revenue (most recent ${Math.min(currentYearWeeks.length, 12)} weeks):`);
    currentYearWeeks.slice(-12).forEach(w => {
      lines.push(`  Week ${w.week}: ${formatCurrency(w.revenue)}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}
