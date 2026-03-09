'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/format';

export interface ItemData {
  name: string;
  revenue: number;
  quantity: number;
  category: string;
}

interface Props {
  items: ItemData[];
  colors: Record<string, string>;
  onItemClick?: (item: ItemData) => void;
}

type SortKey = 'name' | 'category' | 'revenue' | 'quantity';
type SortDir = 'asc' | 'desc';

const FALLBACK = '#10b981';
const PAGE_SIZE = 25;

export function ItemDetailTable({ items, colors, onItemClick }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return items;
    const term = searchTerm.toLowerCase().trim();
    return items.filter(
      item =>
        item.name.toLowerCase().includes(term) ||
        item.category.toLowerCase().includes(term)
    );
  }, [items, searchTerm]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

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
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-white">Item Detail</h3>
          {onItemClick && (
            <span className="text-sm text-accent font-medium px-2.5 py-0.5 rounded-md bg-accent/10 border border-accent/30 shrink-0">
              Click any item to see monthly sales
            </span>
          )}
        </div>
        <div className="relative min-w-0 sm:min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search items..."
            value={searchTerm}
            onChange={e => {
              setSearchTerm(e.target.value);
              setPage(0);
            }}
            className="w-full pl-10 pr-8 py-2 rounded-lg bg-white/5 border border-border text-sm placeholder:text-muted focus:outline-none focus:border-accent/50"
          />
          {searchTerm && (
            <button
              onClick={() => {
                setSearchTerm('');
                setPage(0);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-white"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted mb-4">
        {filtered.length} items{searchTerm ? ` matching "${searchTerm}"` : ''}
        {sorted.length > 0 && (
          <> — showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)}</>
        )}
      </p>
      <div className="overflow-x-auto">
        {pageItems.length === 0 ? (
          <p className="py-8 text-center text-muted">
            {searchTerm ? `No items match "${searchTerm}"` : 'No items in this selection'}
          </p>
        ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {([['name', 'Item'], ['category', 'Category'], ['revenue', 'Sales'], ['quantity', 'Qty Sold']] as [SortKey, string][]).map(([key, label]) => (
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
              <tr
                key={item.name}
                onClick={() => onItemClick?.(item)}
                className={`border-b border-border/50 hover:bg-white/[0.02] ${onItemClick ? 'cursor-pointer' : ''}`}
              >
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
        )}
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
