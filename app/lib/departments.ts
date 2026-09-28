/** Department selection helpers. An empty list means "All" revenue departments. */

import nonRevenueConfig from '../../config/non_revenue.json';

export const ALL_DEPARTMENTS = 'All';

/** Bundled copy of config/non_revenue.json, used until summary.json carries the list. */
export const BUNDLED_NON_REVENUE: Record<string, string> = nonRevenueConfig.departments;

export function nonRevenueMap(
  summary?: { nonRevenue?: { departments?: Record<string, string> } } | null,
): Record<string, string> {
  const fromSummary = summary?.nonRevenue?.departments;
  if (fromSummary && Object.keys(fromSummary).length > 0) return fromSummary;
  return BUNDLED_NON_REVENUE;
}

export function nonRevenueNames(
  source?: { nonRevenueDepartments?: string[] } | null,
): string[] {
  if (source?.nonRevenueDepartments && source.nonRevenueDepartments.length > 0) {
    return source.nonRevenueDepartments;
  }
  return Object.keys(BUNDLED_NON_REVENUE);
}

export function isRevenueDepartment(
  department: string,
  nonRevenue: Record<string, string> | string[] = BUNDLED_NON_REVENUE,
): boolean {
  if (Array.isArray(nonRevenue)) return !nonRevenue.includes(department);
  return !(department in nonRevenue);
}

export function revenueOnly<T extends { department: string }>(
  rows: T[],
  nonRevenue: Record<string, string> | string[] = BUNDLED_NON_REVENUE,
): T[] {
  return rows.filter((row) => isRevenueDepartment(row.department, nonRevenue));
}

/** True when the selection is one or more non-revenue departments and nothing else. */
export function isNonRevenueSelection(
  selected: string[],
  nonRevenue: Record<string, string> | string[],
): boolean {
  if (selected.length === 0) return false;
  return selected.every((department) => !isRevenueDepartment(department, nonRevenue));
}

/**
 * `?dept=` holds a comma-joined list. Values arrive already decoded from
 * URLSearchParams, so no extra URI decoding. Department names must not contain commas.
 */
export function parseDepartmentsParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== ALL_DEPARTMENTS);
}

export function serializeDepartmentsParam(depts: string[]): string | null {
  if (depts.length === 0) return null;
  return depts.join(',');
}

export function departmentLabel(depts: string[]): string {
  return depts.length === 0 ? 'All departments' : depts.join(', ');
}

export function departmentsKey(depts: string[]): string {
  return depts.length === 0 ? ALL_DEPARTMENTS : [...depts].sort().join('|');
}

/**
 * Sum a per-department revenue map over the selection.
 * An empty selection is "All" revenue: the precomputed total minus non-revenue
 * departments still sitting in the map.
 */
export function revenueForDepartments(
  total: number,
  byDepartment: Record<string, number> | undefined,
  depts: string[],
  nonRevenue: string[] = Object.keys(BUNDLED_NON_REVENUE),
): number {
  if (depts.length === 0) {
    const held = nonRevenue.reduce((sum, department) => sum + (byDepartment?.[department] ?? 0), 0);
    return total - held;
  }
  return depts.reduce((sum, department) => sum + (byDepartment?.[department] ?? 0), 0);
}

/**
 * Selection after a click. `additive` is Ctrl/Cmd-click or a touch long-press.
 * Departments in `exclusive` switch the page to a different data source, so
 * they can never be combined with anything else.
 */
export function nextSelection(
  current: string[],
  clicked: string,
  additive: boolean,
  exclusive: string[] = [],
): string[] {
  if (clicked === ALL_DEPARTMENTS) return [];
  if (!additive || exclusive.includes(clicked)) return [clicked];

  const base = current.filter((d) => !exclusive.includes(d));
  if (base.includes(clicked)) return base.filter((d) => d !== clicked);
  return [...base, clicked];
}
