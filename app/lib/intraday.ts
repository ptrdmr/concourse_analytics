import type { IntradayRecord, VoidRecord } from '@/types';

export type TimeResolution = 30 | 60 | 120;
export type IntradayMetric = 'quantity' | 'revenue';

/** Business-day slot order: 4 AM through 3:59 AM */
export const BUSINESS_DAY_SLOTS: number[] = [
  ...Array.from({ length: 40 }, (_, i) => i + 8), // 4:00 AM – 11:59 PM
  ...Array.from({ length: 8 }, (_, i) => i),       // 12:00 AM – 3:59 AM
];

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const DAY_SHAPE_COLORS: Record<number, string> = {
  1: '#2563eb',
  2: '#f5a623',
  3: '#22c55e',
  4: '#ff5252',
  5: '#bb86fc',
  6: '#00b0ff',
  0: '#ff6eb4',
};

export function slotToTimeLabel(slot: number): string {
  const hour = Math.floor(slot / 2);
  const minute = slot % 2 === 0 ? '00' : '30';
  const h12 = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h12}:${minute} ${ampm}`;
}

export function slotToShortLabel(slot: number): string {
  const hour = Math.floor(slot / 2);
  const h12 = hour % 12 || 12;
  const ampm = hour < 12 ? 'a' : 'p';
  return `${h12}${ampm}`;
}

export function getDayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00').getDay();
}

export function getDayLabel(dow: number): string {
  return DAY_LABELS[dow] ?? '?';
}

export function countMatchingDays(
  dateRange: [string, string] | null,
  daysOfWeek: number[],
): number {
  if (!dateRange) return 1;
  const [startStr, endStr] = dateRange;
  const start = new Date(startStr + 'T12:00:00');
  const end = new Date(endStr + 'T12:00:00');
  let count = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (daysOfWeek.length === 0 || daysOfWeek.includes(d.getDay())) {
      count++;
    }
  }
  return count || 1;
}

export function yearsInRange(dateRange: [string, string] | null, availableYears: string[]): string[] {
  if (!dateRange) return availableYears;
  const startYear = dateRange[0].slice(0, 4);
  const endYear = dateRange[1].slice(0, 4);
  return availableYears.filter(y => y >= startYear && y <= endYear);
}

export function filterIntradayRecords(
  records: IntradayRecord[],
  opts: {
    dateRange: [string, string] | null;
    daysOfWeek: number[];
    categories: string[];
    selectedItems: string[];
  },
): IntradayRecord[] {
  const { dateRange, daysOfWeek, categories, selectedItems } = opts;
  if (daysOfWeek.length === 0) return [];

  const itemSet = selectedItems.length > 0 ? new Set(selectedItems) : null;

  return records.filter(r => {
    if (dateRange) {
      if (r.date < dateRange[0] || r.date > dateRange[1]) return false;
    }
    if (!daysOfWeek.includes(getDayOfWeek(r.date))) return false;
    if (categories.length > 0 && !categories.includes(r.category)) return false;
    if (itemSet && !itemSet.has(r.name)) return false;
    return true;
  });
}

export function filterVoidRecords(
  records: VoidRecord[],
  opts: {
    dateRange: [string, string] | null;
    daysOfWeek: number[];
    searchTerm: string;
  },
): VoidRecord[] {
  const { dateRange, daysOfWeek, searchTerm } = opts;
  const term = searchTerm.trim().toLowerCase();

  return records.filter(r => {
    if (dateRange) {
      if (r.date < dateRange[0] || r.date > dateRange[1]) return false;
    }
    if (daysOfWeek.length > 0 && !daysOfWeek.includes(getDayOfWeek(r.date))) return false;
    if (term && !r.name.toLowerCase().includes(term)) return false;
    return true;
  });
}

export function rollupSlots(slots: number[], resolution: TimeResolution): number[] {
  const step = resolution / 30;
  const groups = new Map<number, number[]>();
  for (const slot of slots) {
    const idx = BUSINESS_DAY_SLOTS.indexOf(slot);
    if (idx < 0) continue;
    const groupIdx = Math.floor(idx / step);
    if (!groups.has(groupIdx)) groups.set(groupIdx, []);
    groups.get(groupIdx)!.push(slot);
  }
  const result: number[] = [];
  for (let g = 0; g < Math.ceil(BUSINESS_DAY_SLOTS.length / step); g++) {
    const groupSlots = groups.get(g);
    if (groupSlots?.length) result.push(groupSlots[0]);
  }
  return result;
}

export function getDisplaySlots(resolution: TimeResolution): number[] {
  const step = resolution / 30;
  const result: number[] = [];
  for (let i = 0; i < BUSINESS_DAY_SLOTS.length; i += step) {
    result.push(BUSINESS_DAY_SLOTS[i]);
  }
  return result;
}

export function slotGroupKey(slot: number, resolution: TimeResolution): number {
  const idx = BUSINESS_DAY_SLOTS.indexOf(slot);
  if (idx < 0) return slot;
  const step = resolution / 30;
  const groupIdx = Math.floor(idx / step);
  return BUSINESS_DAY_SLOTS[groupIdx * step] ?? slot;
}

export interface SlotAggregate {
  slot: number;
  label: string;
  quantity: number;
  revenue: number;
  transactions: number;
  avgQuantity: number;
  avgRevenue: number;
}

export function aggregateBySlot(
  records: IntradayRecord[],
  resolution: TimeResolution,
  dayCount: number,
): SlotAggregate[] {
  const displaySlots = getDisplaySlots(resolution);
  const buckets = new Map<number, { quantity: number; revenue: number; transactions: number }>();

  for (const slot of displaySlots) {
    buckets.set(slot, { quantity: 0, revenue: 0, transactions: 0 });
  }

  for (const r of records) {
    const key = slotGroupKey(r.slot, resolution);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.quantity += r.quantity;
    bucket.revenue += r.revenue;
    bucket.transactions += r.transactions;
  }

  return displaySlots.map(slot => {
    const b = buckets.get(slot)!;
    return {
      slot,
      label: slotToTimeLabel(slot),
      quantity: b.quantity,
      revenue: b.revenue,
      transactions: b.transactions,
      avgQuantity: b.quantity / dayCount,
      avgRevenue: b.revenue / dayCount,
    };
  });
}

export interface DayShapeSeries {
  dayOfWeek: number;
  dayLabel: string;
  color: string;
  slots: SlotAggregate[];
}

export function buildDayShapeSeries(
  records: IntradayRecord[],
  resolution: TimeResolution,
  daysOfWeek: number[],
  dayCountsByDow: Record<number, number>,
  singleDay: boolean,
): DayShapeSeries[] {
  if (singleDay) {
    return [{
      dayOfWeek: -1,
      dayLabel: 'Selected day',
      color: DAY_SHAPE_COLORS[1],
      slots: aggregateBySlot(records, resolution, 1),
    }];
  }

  if (daysOfWeek.length === 0) return [];

  if (daysOfWeek.length >= 2) {
    const sorted = [...daysOfWeek].sort(
      (a, b) => DOW_ORDER.indexOf(a) - DOW_ORDER.indexOf(b),
    );
    return sorted.map(dow => ({
      dayOfWeek: dow,
      dayLabel: getDayLabel(dow),
      color: DAY_SHAPE_COLORS[dow],
      slots: aggregateBySlot(
        records.filter(r => getDayOfWeek(r.date) === dow),
        resolution,
        dayCountsByDow[dow] || 1,
      ),
    }));
  }

  const dow = daysOfWeek[0];
  return [{
    dayOfWeek: dow,
    dayLabel: getDayLabel(dow),
    color: DAY_SHAPE_COLORS[dow],
    slots: aggregateBySlot(
      records.filter(r => getDayOfWeek(r.date) === dow),
      resolution,
      dayCountsByDow[dow] || 1,
    ),
  }];
}

export interface HeatmapCell {
  dayOfWeek: number;
  dayLabel: string;
  slot: number;
  slotLabel: string;
  quantity: number;
  revenue: number;
  avgQuantity: number;
  avgRevenue: number;
}

export function buildHeatmap(
  records: IntradayRecord[],
  resolution: TimeResolution,
  dayCountsByDow: Record<number, number>,
): HeatmapCell[] {
  const displaySlots = getDisplaySlots(resolution);
  const cells: HeatmapCell[] = [];

  for (let dow = 0; dow < 7; dow++) {
    const dayCount = dayCountsByDow[dow] || 1;
    const dayRecords = records.filter(r => getDayOfWeek(r.date) === dow);

    for (const slot of displaySlots) {
      let quantity = 0;
      let revenue = 0;
      for (const r of dayRecords) {
        if (slotGroupKey(r.slot, resolution) === slot) {
          quantity += r.quantity;
          revenue += r.revenue;
        }
      }
      cells.push({
        dayOfWeek: dow,
        dayLabel: getDayLabel(dow),
        slot,
        slotLabel: slotToShortLabel(slot),
        quantity,
        revenue,
        avgQuantity: quantity / dayCount,
        avgRevenue: revenue / dayCount,
      });
    }
  }
  return cells;
}

export function countDaysByDowFromData(
  records: IntradayRecord[],
  daysOfWeek: number[],
): Record<number, number> {
  const dateSets: Record<number, Set<string>> = {
    0: new Set(), 1: new Set(), 2: new Set(), 3: new Set(),
    4: new Set(), 5: new Set(), 6: new Set(),
  };
  for (const r of records) {
    const dow = getDayOfWeek(r.date);
    if (daysOfWeek.length === 0 || daysOfWeek.includes(dow)) {
      dateSets[dow].add(r.date);
    }
  }
  return {
    0: dateSets[0].size,
    1: dateSets[1].size,
    2: dateSets[2].size,
    3: dateSets[3].size,
    4: dateSets[4].size,
    5: dateSets[5].size,
    6: dateSets[6].size,
  };
}

export function countDaysByDow(
  dateRange: [string, string] | null,
  daysOfWeek: number[],
): Record<number, number> {
  const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  if (!dateRange) return counts;

  const [startStr, endStr] = dateRange;
  const start = new Date(startStr + 'T12:00:00');
  const end = new Date(endStr + 'T12:00:00');
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (daysOfWeek.length === 0 || daysOfWeek.includes(dow)) {
      counts[dow]++;
    }
  }
  return counts;
}

export interface ItemSlotRank {
  name: string;
  category: string;
  quantity: number;
  revenue: number;
  avgQuantity: number;
  avgRevenue: number;
}

export function topItemsForSlot(
  records: IntradayRecord[],
  selectedSlot: number | null,
  resolution: TimeResolution,
  dayCount: number,
  limit = 20,
): ItemSlotRank[] {
  if (selectedSlot === null) return [];

  const byItem = new Map<string, { category: string; quantity: number; revenue: number }>();

  for (const r of records) {
    if (slotGroupKey(r.slot, resolution) !== selectedSlot) continue;
    const existing = byItem.get(r.name) ?? { category: r.category, quantity: 0, revenue: 0 };
    existing.quantity += r.quantity;
    existing.revenue += r.revenue;
    byItem.set(r.name, existing);
  }

  return Array.from(byItem.entries())
    .map(([name, data]) => ({
      name,
      category: data.category,
      quantity: data.quantity,
      revenue: data.revenue,
      avgQuantity: data.quantity / dayCount,
      avgRevenue: data.revenue / dayCount,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

export interface VoidSlotAggregate {
  slot: number;
  label: string;
  quantity: number;
  value: number;
  avgQuantity: number;
  avgValue: number;
}

export function aggregateVoidsBySlot(
  records: VoidRecord[],
  resolution: TimeResolution,
  dayCount: number,
): VoidSlotAggregate[] {
  const displaySlots = getDisplaySlots(resolution);
  const buckets = new Map<number, { quantity: number; value: number }>();

  for (const slot of displaySlots) {
    buckets.set(slot, { quantity: 0, value: 0 });
  }

  for (const r of records) {
    const key = slotGroupKey(r.slot, resolution);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.quantity += r.quantity;
    bucket.value += r.value;
  }

  return displaySlots.map(slot => {
    const b = buckets.get(slot)!;
    return {
      slot,
      label: slotToTimeLabel(slot),
      quantity: b.quantity,
      value: b.value,
      avgQuantity: b.quantity / dayCount,
      avgValue: b.value / dayCount,
    };
  });
}

export interface VoidItemRank {
  name: string;
  quantity: number;
  value: number;
  voidRate: number;
}

export function topVoidedItems(
  voidRecords: VoidRecord[],
  salesRecords: IntradayRecord[],
  limit = 15,
): VoidItemRank[] {
  const voidByItem = new Map<string, { quantity: number; value: number }>();
  for (const r of voidRecords) {
    const existing = voidByItem.get(r.name) ?? { quantity: 0, value: 0 };
    existing.quantity += r.quantity;
    existing.value += r.value;
    voidByItem.set(r.name, existing);
  }

  const salesByItem = new Map<string, number>();
  for (const r of salesRecords) {
    salesByItem.set(r.name, (salesByItem.get(r.name) ?? 0) + r.quantity);
  }

  return Array.from(voidByItem.entries())
    .map(([name, data]) => {
      const sold = salesByItem.get(name) ?? 0;
      const voidRate = sold + data.quantity > 0 ? data.quantity / (sold + data.quantity) : 1;
      return { name, quantity: data.quantity, value: data.value, voidRate };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}
