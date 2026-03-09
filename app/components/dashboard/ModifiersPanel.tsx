'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/format';

export interface ModifierData {
  name: string;
  count: number;
  revenue: number;
  unitPrice: number;
  subdepartment: string;
}

interface Props {
  modifiers: ModifierData[];
}

type SortKey = 'name' | 'subdepartment' | 'count' | 'unitPrice' | 'revenue';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;

export function ModifiersPanel({ modifiers }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const copy = [...modifiers];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return copy;
  }, [modifiers, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageItems = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'subdepartment' ? 'asc' : 'desc');
    }
    setPage(0);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return null;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3.5 h-3.5 inline" />
      : <ChevronDown className="w-3.5 h-3.5 inline" />;
  }

  if (modifiers.length === 0) {
    return null;
  }

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Modifiers</h3>
      <p className="text-sm text-muted mb-4">
        Food department add-ons (toppings, extras) — {modifiers.length} unique modifiers
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {([
                ['name', 'Modifier'],
                ['subdepartment', 'Subdepartment'],
                ['count', 'Count'],
                ['unitPrice', 'Unit $'],
                ['revenue', 'Sales'],
              ] as [SortKey, string][]).map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  className={`text-left py-3 px-3 text-secondary font-medium cursor-pointer hover:text-white transition-colors ${
                    key === 'count' || key === 'unitPrice' || key === 'revenue' ? 'text-right' : ''
                  }`}
                >
                  {label} <SortIcon col={key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageItems.map(mod => (
              <tr
                key={mod.name}
                className="border-b border-border/50 hover:bg-white/[0.02]"
              >
                <td className="py-2.5 px-3 font-medium">{mod.name}</td>
                <td className="py-2.5 px-3 text-secondary">{mod.subdepartment || '—'}</td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                  {formatNumber(mod.count)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-accent">
                  {formatCurrency(mod.unitPrice)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-accent">
                  {formatCurrency(mod.revenue)}
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
