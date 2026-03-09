import type { Transaction } from '@/types';
import { formatCurrency, formatNumber, formatPercent } from './format';

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

function filterByDept(data: Transaction[], department?: string): Transaction[] {
  if (!department || department === 'All') return data;
  return data.filter(r => r.department.toLowerCase() === department.toLowerCase());
}

function filterByDateRange(data: Transaction[], startDate?: string, endDate?: string): Transaction[] {
  let result = data;
  if (startDate) result = result.filter(r => r.date >= startDate);
  if (endDate) result = result.filter(r => r.date <= endDate);
  return result;
}

function filterByCategory(data: Transaction[], category?: string): Transaction[] {
  if (!category) return data;
  return data.filter(r => r.category.toLowerCase() === category.toLowerCase());
}

function describeFilters(department?: string, startDate?: string, endDate?: string, category?: string): string {
  const parts: string[] = [];
  parts.push(department && department !== 'All' ? department : 'All departments');
  if (category) parts.push(`category: ${category}`);
  if (startDate && endDate) parts.push(`${startDate} to ${endDate}`);
  else if (startDate) parts.push(`from ${startDate}`);
  else if (endDate) parts.push(`through ${endDate}`);
  else parts.push('All time');
  return parts.join(', ');
}

function searchItems(transactions: Transaction[], args: Record<string, unknown>): string {
  const query = (args.query as string || '').toLowerCase();
  const department = args.department as string | undefined;
  const category = args.category as string | undefined;
  const startDate = args.start_date as string | undefined;
  const endDate = args.end_date as string | undefined;
  const limit = Math.min((args.limit as number) || 20, 50);

  let data = filterByDept(transactions, department);
  data = filterByDateRange(data, startDate, endDate);
  data = filterByCategory(data, category);

  if (query) {
    data = data.filter(r => r.name.toLowerCase().includes(query));
  }

  const itemMap = new Map<string, { revenue: number; quantity: number; transactions: number; category: string; department: string }>();
  for (const r of data) {
    const entry = itemMap.get(r.name) || { revenue: 0, quantity: 0, transactions: 0, category: r.category, department: r.department };
    entry.revenue += r.revenue;
    entry.quantity += r.quantity;
    entry.transactions += r.transactions;
    itemMap.set(r.name, entry);
  }

  const items = Array.from(itemMap.entries())
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);

  if (items.length === 0) {
    return `No items found matching "${query}" in ${describeFilters(department, startDate, endDate, category)}.`;
  }

  const totalRev = items.reduce((s, i) => s + i.revenue, 0);
  const lines = [`Found ${items.length} item(s) matching "${query || '*'}" in ${describeFilters(department, startDate, endDate, category)}:`];
  items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.name} - ${formatCurrency(item.revenue)} rev, ${formatNumber(item.quantity)} qty, ${formatNumber(item.transactions)} txns (${item.category}, ${item.department})`);
  });
  lines.push(`Total: ${formatCurrency(totalRev)} sales across ${items.length} items`);
  return lines.join('\n');
}

function getItemHistory(transactions: Transaction[], args: Record<string, unknown>): string {
  const itemName = (args.item_name as string || '').toLowerCase();
  const department = args.department as string | undefined;

  let data = filterByDept(transactions, department);
  data = data.filter(r => r.name.toLowerCase().includes(itemName));

  if (data.length === 0) {
    return `No data found for item matching "${args.item_name}".`;
  }

  const matchedNames = [...new Set(data.map(r => r.name))];

  const monthMap = new Map<string, { revenue: number; quantity: number; transactions: number }>();
  for (const r of data) {
    const month = r.date.slice(0, 7);
    const entry = monthMap.get(month) || { revenue: 0, quantity: 0, transactions: 0 };
    entry.revenue += r.revenue;
    entry.quantity += r.quantity;
    entry.transactions += r.transactions;
    monthMap.set(month, entry);
  }

  const months = Array.from(monthMap.entries())
    .map(([month, d]) => ({ month, ...d }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const totalRev = months.reduce((s, m) => s + m.revenue, 0);
  const totalQty = months.reduce((s, m) => s + m.quantity, 0);

  const lines = [`Monthly history for "${matchedNames.join(', ')}":`];
  lines.push(`Total: ${formatCurrency(totalRev)} rev, ${formatNumber(totalQty)} qty over ${months.length} months`);
  lines.push('');
  for (const m of months) {
    lines.push(`${m.month}: ${formatCurrency(m.revenue)} rev, ${formatNumber(m.quantity)} qty, ${formatNumber(m.transactions)} txns`);
  }

  if (months.length >= 2) {
    const recent = months[months.length - 1];
    const prior = months[months.length - 2];
    const pctChange = prior.revenue > 0 ? ((recent.revenue - prior.revenue) / prior.revenue) * 100 : 0;
    lines.push('');
    lines.push(`Latest trend: ${recent.month} vs ${prior.month}: ${pctChange >= 0 ? '+' : ''}${formatPercent(pctChange)}`);
  }

  return lines.join('\n');
}

function comparePeriods(transactions: Transaction[], args: Record<string, unknown>): string {
  const department = args.department as string | undefined;
  const itemName = args.item_name as string | undefined;
  const period1Start = args.period1_start as string;
  const period1End = args.period1_end as string;
  const period2Start = args.period2_start as string;
  const period2End = args.period2_end as string;

  let data = filterByDept(transactions, department);
  if (itemName) {
    const q = itemName.toLowerCase();
    data = data.filter(r => r.name.toLowerCase().includes(q));
  }

  const p1 = filterByDateRange(data, period1Start, period1End);
  const p2 = filterByDateRange(data, period2Start, period2End);

  const aggregate = (rows: Transaction[]) => ({
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    quantity: rows.reduce((s, r) => s + r.quantity, 0),
    transactions: rows.reduce((s, r) => s + r.transactions, 0),
    uniqueItems: new Set(rows.map(r => r.name)).size,
  });

  const a1 = aggregate(p1);
  const a2 = aggregate(p2);

  const pctRev = a1.revenue > 0 ? ((a2.revenue - a1.revenue) / a1.revenue) * 100 : 0;
  const pctQty = a1.quantity > 0 ? ((a2.quantity - a1.quantity) / a1.quantity) * 100 : 0;

  const label = itemName || department || 'All';
  const lines = [
    `Comparison for ${label}:`,
    `Period 1 (${period1Start} to ${period1End}): ${formatCurrency(a1.revenue)} rev, ${formatNumber(a1.quantity)} qty, ${formatNumber(a1.transactions)} txns`,
    `Period 2 (${period2Start} to ${period2End}): ${formatCurrency(a2.revenue)} rev, ${formatNumber(a2.quantity)} qty, ${formatNumber(a2.transactions)} txns`,
    '',
    `Sales change: ${pctRev >= 0 ? '+' : ''}${formatPercent(pctRev)}`,
    `Quantity change: ${pctQty >= 0 ? '+' : ''}${formatPercent(pctQty)}`,
  ];

  return lines.join('\n');
}

function getCategoryBreakdown(transactions: Transaction[], args: Record<string, unknown>): string {
  const department = args.department as string | undefined;
  const startDate = args.start_date as string | undefined;
  const endDate = args.end_date as string | undefined;

  let data = filterByDept(transactions, department);
  data = filterByDateRange(data, startDate, endDate);

  const catMap = new Map<string, { revenue: number; quantity: number; transactions: number }>();
  for (const r of data) {
    const entry = catMap.get(r.category) || { revenue: 0, quantity: 0, transactions: 0 };
    entry.revenue += r.revenue;
    entry.quantity += r.quantity;
    entry.transactions += r.transactions;
    catMap.set(r.category, entry);
  }

  const cats = Array.from(catMap.entries())
    .map(([category, d]) => ({ category, ...d }))
    .sort((a, b) => b.revenue - a.revenue);

  if (cats.length === 0) {
    return `No data found for ${describeFilters(department, startDate, endDate)}.`;
  }

  const totalRev = cats.reduce((s, c) => s + c.revenue, 0);

  const lines = [`Category breakdown for ${describeFilters(department, startDate, endDate)}:`];
  for (const c of cats) {
    const pct = totalRev > 0 ? (c.revenue / totalRev) * 100 : 0;
    lines.push(`- ${c.category}: ${formatCurrency(c.revenue)} (${formatPercent(pct)}) | ${formatNumber(c.quantity)} qty, ${formatNumber(c.transactions)} txns`);
  }
  lines.push(`Total: ${formatCurrency(totalRev)}`);
  return lines.join('\n');
}

function getTopItems(transactions: Transaction[], args: Record<string, unknown>): string {
  const department = args.department as string | undefined;
  const startDate = args.start_date as string | undefined;
  const endDate = args.end_date as string | undefined;
  const sortBy = (args.sort_by as string) || 'revenue';
  const limit = Math.min((args.limit as number) || 10, 50);

  let data = filterByDept(transactions, department);
  data = filterByDateRange(data, startDate, endDate);

  const itemMap = new Map<string, { revenue: number; quantity: number; transactions: number; category: string }>();
  for (const r of data) {
    const entry = itemMap.get(r.name) || { revenue: 0, quantity: 0, transactions: 0, category: r.category };
    entry.revenue += r.revenue;
    entry.quantity += r.quantity;
    entry.transactions += r.transactions;
    itemMap.set(r.name, entry);
  }

  const items = Array.from(itemMap.entries())
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => sortBy === 'quantity' ? b.quantity - a.quantity : b.revenue - a.revenue)
    .slice(0, limit);

  if (items.length === 0) {
    return `No items found for ${describeFilters(department, startDate, endDate)}.`;
  }

  const lines = [`Top ${items.length} items by ${sortBy} for ${describeFilters(department, startDate, endDate)}:`];
  items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.name} - ${formatCurrency(item.revenue)} rev, ${formatNumber(item.quantity)} qty (${item.category})`);
  });
  return lines.join('\n');
}

const TOOL_HANDLERS: Record<string, (txns: Transaction[], args: Record<string, unknown>) => string> = {
  search_items: searchItems,
  get_item_history: getItemHistory,
  compare_periods: comparePeriods,
  get_category_breakdown: getCategoryBreakdown,
  get_top_items: getTopItems,
};

export function executeToolCall(call: ToolCall, transactions: Transaction[]): string {
  const handler = TOOL_HANDLERS[call.name];
  if (!handler) return `Unknown tool: ${call.name}`;
  try {
    return handler(transactions, call.arguments);
  } catch (err) {
    return `Error executing ${call.name}: ${err instanceof Error ? err.message : 'unknown error'}`;
  }
}
