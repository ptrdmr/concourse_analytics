import type { Filters, PackageRecord } from '@/types';
import type { ItemData } from '@/components/dashboard/ItemDetailTable';

export const PACKAGE_CATEGORY = 'Summer Specials';

/** Display order for the Package Detail table. */
export const PACKAGE_DISPLAY_ORDER = [
  'Summer Triple Play',
  'All You Can Bowl',
  'Monday Roll Call',
  'First Roll Friday',
  'Family Fun Pack',
  'Summer Party Builder',
  'Group Party Pack',
] as const;

export type PackageDisplayName = (typeof PACKAGE_DISPLAY_ORDER)[number];

export function filterPackages(packages: PackageRecord[], filters: Filters): PackageRecord[] {
  let data = packages;

  if (filters.department && filters.department !== 'All') {
    data = data.filter((r) => r.department === filters.department);
  }

  if (filters.dateRange) {
    const [start, end] = filters.dateRange;
    data = data.filter((r) => r.date >= start && r.date <= end);
  }

  if (filters.categories.length > 0) {
    data = data.filter((r) => filters.categories.includes(r.category));
  }

  if (filters.searchTerm) {
    const term = filters.searchTerm.toLowerCase();
    data = data.filter(
      (r) =>
        r.name.toLowerCase().includes(term) ||
        r.category.toLowerCase().includes(term),
    );
  }

  return data;
}

export function aggregatePackageItems(packages: PackageRecord[]): ItemData[] {
  const map = new Map<string, { revenue: number; quantity: number; category: string }>();

  for (const row of packages) {
    const entry = map.get(row.name) || { revenue: 0, quantity: 0, category: row.category };
    entry.revenue += row.revenue;
    entry.quantity += row.quantity;
    map.set(row.name, entry);
  }

  const order = new Map(PACKAGE_DISPLAY_ORDER.map((name, index) => [name, index]));

  return Array.from(map.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => {
      const aOrder = order.get(a.name as PackageDisplayName);
      const bOrder = order.get(b.name as PackageDisplayName);
      if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;
      return b.revenue - a.revenue;
    });
}
