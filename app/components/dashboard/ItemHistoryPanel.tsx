'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatCompact, formatCurrency, formatNumber } from '@/lib/format';
import { useItemHistory, type HistoryGranularity } from '@/hooks/useItemHistory';
import type { Transaction } from '@/types';

interface ItemData {
  name: string;
  revenue: number;
  quantity: number;
  category: string;
}

interface Props {
  item: ItemData;
  transactions: Transaction[];
  colors: Record<string, string>;
  onClose: () => void;
}

const FALLBACK = '#10b981';

const GRANULARITY_OPTIONS: { value: HistoryGranularity; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];

function formatPeriodLabel(period: string, granularity: HistoryGranularity): string {
  if (granularity === 'month') {
    const [y, m] = period.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(m, 10) - 1]} ${y}`;
  }
  if (granularity === 'week') {
    const d = new Date(period + 'T00:00:00');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `Week of ${monthNames[d.getMonth()]} ${d.getDate()}`;
  }
  const d = new Date(period + 'T00:00:00');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[d.getMonth()]} ${d.getDate()}`;
}

function PeriodTooltip({
  active,
  payload,
  label,
  granularity,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
  granularity: HistoryGranularity;
}) {
  if (!active || !payload?.length || !label) return null;
  const displayLabel = formatPeriodLabel(label, granularity);
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-1">{displayLabel}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-sm">
          <span className="text-secondary">
            {p.dataKey === 'revenue' ? 'Revenue' : 'Transactions'}:{' '}
          </span>
          <span className="text-white font-mono">
            {p.dataKey === 'revenue' ? formatCurrency(p.value) : formatNumber(p.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

export function ItemHistoryPanel({ item, transactions, colors, onClose }: Props) {
  const [granularity, setGranularity] = useState<HistoryGranularity>('month');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const periodData = useItemHistory(transactions, item.name, granularity);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) setIsFullscreen(false);
        else onClose();
      }
    },
    [onClose, isFullscreen]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  const categoryColor = colors[item.category] || FALLBACK;

  const periodLabel = granularity === 'month' ? 'Month' : granularity === 'week' ? 'Week' : 'Day';

  return (
    <div
      className={`fixed inset-0 z-50 flex ${isFullscreen ? 'items-stretch justify-center' : 'justify-end'}`}
      aria-modal="true"
      aria-label="Item history"
    >
      <div
        className={`absolute inset-0 ${isFullscreen ? 'bg-black/80' : 'bg-black/60'}`}
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      <div
        className={`relative bg-[var(--color-card)] shadow-xl overflow-y-auto transition-all duration-200 ${
          isFullscreen
            ? 'w-full max-w-5xl mx-auto border border-[var(--color-border)]'
            : 'w-full max-w-lg border-l border-[var(--color-border)] animate-slide-in-right'
        }`}
        style={{ maxHeight: '100vh' }}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 p-6 pb-4 bg-[var(--color-card)] border-b border-[var(--color-border)]">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-white truncate">{item.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: categoryColor }}
              />
              <span className="text-sm text-secondary">{item.category}</span>
            </div>
            <p className="mt-2 text-sm text-muted">
              Total: {formatCurrency(item.revenue)} revenue · {formatNumber(item.quantity)} sold
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 rounded-lg text-secondary hover:text-white hover:bg-white/5 transition-colors"
              aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-secondary hover:text-white hover:bg-white/5 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {periodData.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {GRANULARITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setGranularity(opt.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      granularity === opt.value
                        ? 'bg-accent/20 text-accent border border-accent/40'
                        : 'bg-white/5 text-secondary hover:bg-white/10 hover:text-white border border-transparent'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div>
                <h3 className="text-sm font-medium text-secondary mb-4">
                  {granularity === 'month' ? 'Monthly' : granularity === 'week' ? 'Weekly' : 'Daily'} trend
                </h3>
                <div className={isFullscreen ? 'h-[400px]' : 'h-[280px]'}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={periodData}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#1f1f1f"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="period"
                        stroke="#525252"
                        fontSize={11}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => {
                          if (granularity === 'month') return formatPeriodLabel(v, granularity).split(' ')[0];
                          const d = new Date(v + 'T00:00:00');
                          return `${d.getMonth() + 1}/${d.getDate()}`;
                        }}
                        interval={Math.max(Math.floor(periodData.length / 8), 1)}
                      />
                      <YAxis
                        yAxisId="revenue"
                        stroke="#525252"
                        fontSize={11}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => formatCompact(v)}
                      />
                      <YAxis
                        yAxisId="txns"
                        orientation="right"
                        stroke="#525252"
                        fontSize={11}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => formatNumber(v)}
                      />
                      <Tooltip content={<PeriodTooltip granularity={granularity} />} />
                      <Bar
                        yAxisId="txns"
                        dataKey="transactions"
                        fill="#22d3ee"
                        fillOpacity={0.2}
                        radius={[2, 2, 0, 0]}
                        maxBarSize={12}
                      />
                      <Line
                        yAxisId="revenue"
                        type="monotone"
                        dataKey="revenue"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{
                          r: 4,
                          fill: '#10b981',
                          stroke: '#000',
                          strokeWidth: 2,
                        }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-secondary mb-3">
                  By {periodLabel.toLowerCase()}
                </h3>
                <div className={`overflow-x-auto overflow-y-auto ${isFullscreen ? 'max-h-[400px]' : 'max-h-[240px]'}`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-card)]">
                        <th className="text-left py-2 px-3 text-secondary font-medium">
                          {periodLabel}
                        </th>
                        <th className="text-right py-2 px-3 text-secondary font-medium">
                          Revenue
                        </th>
                        <th className="text-right py-2 px-3 text-secondary font-medium">
                          Qty
                        </th>
                        <th className="text-right py-2 px-3 text-secondary font-medium">
                          Txns
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodData.map((p) => (
                        <tr
                          key={p.period}
                          className="border-b border-[var(--color-border)]/50"
                        >
                          <td className="py-2 px-3 text-secondary">
                            {formatPeriodLabel(p.period, granularity)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-accent">
                            {formatCurrency(p.revenue)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {formatNumber(p.quantity)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {formatNumber(p.transactions)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">
              No {granularity}ly history for this item in the current filter.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
