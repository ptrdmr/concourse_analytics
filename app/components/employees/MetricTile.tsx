'use client';

import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';

interface MetricTileProps {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}

export function MetricTile({ label, value, sub, accent }: MetricTileProps) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'border-accent/30 bg-accent/5' : 'border-border bg-card/60'}`}>
      <p className="text-xs text-muted uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${accent ? 'text-accent' : 'text-foreground'}`}>{value}</p>
      {sub ? <p className="text-xs text-secondary mt-1">{sub}</p> : null}
    </div>
  );
}

export function formatMetricCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return formatCurrency(value);
}

export function formatMetricNumber(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

export function formatMetricPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return formatPercent(value);
}

export function formatMetricCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return formatNumber(value);
}
