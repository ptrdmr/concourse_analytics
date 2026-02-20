'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/format';

interface ItemData {
  name: string;
  revenue: number;
  quantity: number;
  category: string;
}

interface Props {
  items: ItemData[];
  colors: Record<string, string>;
}

type SortKey = 'name' | 'category' | 'revenue' | 'quantity';
type SortDir = 'asc' | 'desc';

const FALLBACK = '#10b981';
const PAGE_SIZE = 25;

export function ItemDetailTable({ items, colors }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return copy;
  }, [items, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageItems = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'category' ? 'asc' : 'desc');
    }
    setPage(0);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return null;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3.5 h-3.5 inline" />
      : <ChevronDown className="w-3.5 h-3.5 inline" />;
  }

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Item Detail</h3>
      <p className="text-sm text-muted mb-4">
        {items.length} items — showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, items.length)}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {([['name', 'Item'], ['category', 'Category'], ['revenue', 'Revenue'], ['quantity', 'Qty Sold']] as [SortKey, string][]).map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  className={`text-left py-3 px-3 text-secondary font-medium cursor-pointer hover:text-white transition-colors ${
                    key === 'revenue' || key === 'quantity' ? 'text-right' : ''
                  }`}
                >
                  {label} <SortIcon col={key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageItems.map(item => (
              <tr key={item.name} className="border-b border-border/50 hover:bg-white/[0.02]">
                <td className="py-2.5 px-3 font-medium">{item.name}</td>
                <td className="py-2.5 px-3">
                  <span className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: colors[item.category] || FALLBACK }}
                    />
                    <span className="text-secondary">{item.category}</span>
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-accent">
                  {formatCurrency(item.revenue)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                  {formatNumber(item.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 rounded-lg text-sm bg-white/5 text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-muted">
            Page {page + 1} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 rounded-lg text-sm bg-white/5 text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
