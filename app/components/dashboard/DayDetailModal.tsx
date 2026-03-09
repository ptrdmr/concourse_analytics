'use client';

import { useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { Transaction } from '@/types';

interface Props {
  date: string;
  items: Transaction[];
  totalRevenue: number;
  colors: Record<string, string>;
  onClose: () => void;
}

const FALLBACK = '#10b981';

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function DayDetailModal({ date, items, totalRevenue, colors, onClose }: Props) {
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  const sortedItems = [...items].sort((a, b) => b.revenue - a.revenue);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-modal="true"
      aria-label="Transaction details for date"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      <div
        className="relative bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden animate-fade-in"
      >
        <div className="flex items-start justify-between gap-4 p-6 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-xl font-semibold text-white">{formatDateLabel(date)}</h2>
            <p className="mt-1 text-sm text-accent font-mono">{formatCurrency(totalRevenue)} total sales</p>
            <p className="mt-0.5 text-sm text-muted">{formatNumber(items.length)} item types · {formatNumber(items.reduce((s, r) => s + r.transactions, 0))} transactions</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-secondary hover:text-white hover:bg-white/5 transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[calc(85vh-140px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--color-card)] z-10">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-3 px-4 text-secondary font-medium">Item</th>
                <th className="text-left py-3 px-4 text-secondary font-medium">Category</th>
                <th className="text-right py-3 px-4 text-secondary font-medium">Sales</th>
                <th className="text-right py-3 px-4 text-secondary font-medium">Qty</th>
                <th className="text-right py-3 px-4 text-secondary font-medium">Txns</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((row, i) => (
                <tr key={`${row.name}-${row.category}-${i}`} className="border-b border-[var(--color-border)]/50">
                  <td className="py-2.5 px-4 text-white truncate max-w-[200px]">{row.name}</td>
                  <td className="py-2.5 px-4">
                    <span
                      className="inline-flex items-center gap-1.5 text-secondary"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: colors[row.category] || FALLBACK }}
                      />
                      {row.category}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-accent">{formatCurrency(row.revenue)}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{formatNumber(row.quantity)}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{formatNumber(row.transactions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
