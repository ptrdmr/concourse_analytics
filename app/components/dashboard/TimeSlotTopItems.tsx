'use client';

import { useState } from 'react';
import { formatCurrency, formatNumber } from '@/lib/format';
import { slotToTimeLabel } from '@/lib/intraday';
import type { ItemSlotRank, IntradayMetric } from '@/lib/intraday';

interface Props {
  items: ItemSlotRank[];
  selectedSlot: number | null;
  resolution: 30 | 60 | 120;
  metric: IntradayMetric;
  singleDay?: boolean;
}

type SortKey = 'name' | 'quantity' | 'revenue' | 'avgQuantity' | 'avgRevenue';

export function TimeSlotTopItems({ items, selectedSlot, resolution, metric, singleDay }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>(metric === 'quantity' ? 'avgQuantity' : 'avgRevenue');
  const [sortAsc, setSortAsc] = useState(false);

  if (selectedSlot === null) {
    return (
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-white mb-2">Top Items by Time Slot</h3>
        <p className="text-sm text-muted">Click a time slot on the chart or heatmap to see ranked items.</p>
      </div>
    );
  }

  const slotLabel = slotToTimeLabel(selectedSlot);
  const windowLabel = resolution === 30 ? '30 min' : resolution === 60 ? '1 hour' : '2 hours';

  const sorted = [...items].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const SortHeader = ({ label, col }: { label: string; col: SortKey }) => (
    <th
      className="text-left text-xs text-muted font-medium py-2 px-3 cursor-pointer hover:text-white"
      onClick={() => toggleSort(col)}
    >
      {label}{sortKey === col ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Top Items — {slotLabel}</h3>
      <p className="text-sm text-muted mb-4">{windowLabel} window · {items.length} items</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted">No items sold in this time window for the selected filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <SortHeader label="Item" col="name" />
                <th className="text-left text-xs text-muted font-medium py-2 px-3">Category</th>
                <SortHeader label="Qty" col="quantity" />
                <SortHeader label={singleDay ? 'Revenue' : 'Avg Qty'} col={singleDay ? 'revenue' : 'avgQuantity'} />
                <SortHeader label={singleDay ? '—' : 'Avg Rev'} col="avgRevenue" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(item => (
                <tr key={item.name} className="border-b border-border/50 hover:bg-white/5">
                  <td className="py-2 px-3 text-white">{item.name}</td>
                  <td className="py-2 px-3 text-muted text-xs">{item.category}</td>
                  <td className="py-2 px-3 font-mono text-secondary">{formatNumber(item.quantity)}</td>
                  <td className="py-2 px-3 font-mono text-secondary">
                    {singleDay
                      ? formatCurrency(item.revenue)
                      : item.avgQuantity.toFixed(1)}
                  </td>
                  <td className="py-2 px-3 font-mono text-secondary">
                    {singleDay ? '—' : formatCurrency(item.avgRevenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
