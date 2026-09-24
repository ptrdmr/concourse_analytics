/** Department selection helpers. An empty list means "All". */

export const ALL_DEPARTMENTS = 'All';

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

/** Sum a per-department revenue map over the selection; empty selection uses the total. */
export function revenueForDepartments(
  total: number,
  byDepartment: Record<string, number> | undefined,
  depts: string[],
): number {
  if (depts.length === 0) return total;
  return depts.reduce((sum, d) => sum + (byDepartment?.[d] ?? 0), 0);
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
