'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DollarSign, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { formatCompact, formatCurrency, formatPercent } from '@/lib/format';
import type { SalesLaborSummary } from '@/types';

interface Props {
  summary: SalesLaborSummary;
  salesDelta?: number | null;
  laborDelta?: number | null;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { label: string; sales: number; laborCost: number; laborPct: number | null } }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-2">{point.label}</p>
      <p className="text-sm">
        <span className="text-accent">Sales:</span>{' '}
        <span className="font-mono text-white">{formatCurrency(point.sales)}</span>
      </p>
      <p className="text-sm">
        <span className="text-[#f97316]">Labor:</span>{' '}
        <span className="font-mono text-white">{formatCurrency(point.laborCost)}</span>
      </p>
      {point.laborPct != null && (
        <p className="text-sm text-secondary mt-1">
          Labor {formatPercent(point.laborPct)} of sales
        </p>
      )}
    </div>
  );
}

function DeltaBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const positive = value >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  const color = positive ? 'text-emerald-400' : 'text-red-400';

  return (
    <span className={`inline-flex items-center gap-1 text-xs ${color}`}>
      <Icon className="w-3 h-3" />
      {positive ? '+' : ''}{formatPercent(value)} vs prior period
    </span>
  );
}

function HeroMetric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs text-secondary mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono ${accent ? 'text-gradient' : 'text-white'}`}>
        {value}
      </p>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
  );
}

export function SalesVsLaborCard({ summary, salesDelta, laborDelta }: Props) {
  const {
    totalSales,
    totalLaborCost,
    laborPct,
    salesPerLaborHour,
    chart,
    chartGranularity,
    laborAvailable,
  } = summary;

  const isMonthly = chartGranularity === 'month';

  const chartData = chart.map((d) => ({
    ...d,
    shortLabel: isMonthly
      ? d.label.replace(/ \d{4}$/, '')
      : d.label.replace(/, \d{4}$/, ''),
  }));

  const bestPeriod = chart.reduce(
    (best, d) => (d.sales > best.sales ? d : best),
    chart[0] ?? { label: '—', sales: 0, laborCost: 0 },
  );
  const worstPeriod = chart.reduce(
    (worst, d) => (d.sales < worst.sales ? d : worst),
    chart[0] ?? { label: '—', sales: 0, laborCost: 0 },
  );

  return (
    <div className="card p-6 sm:p-8 border-accent/20 bg-gradient-to-br from-accent/5 via-transparent to-transparent">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-accent mb-1">Owner snapshot</p>
          <h3 className="text-xl sm:text-2xl font-bold text-white">Sales vs Labor</h3>
          <p className="text-sm text-secondary mt-1">
            {isMonthly
              ? 'Monthly sales compared to wage labor cost for the selected period.'
              : 'Daily sales compared to wage labor cost for the selected period.'}
          </p>
        </div>
        {chart.length > 0 && (
          <p className="text-xs text-muted max-w-md">
            Best {isMonthly ? 'month' : 'day'}: {bestPeriod.label} ({formatCompact(bestPeriod.sales)}).
            {' '}Slowest: {worstPeriod.label} ({formatCompact(worstPeriod.sales)}).
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <HeroMetric
          label="Total Sales"
          value={formatCompact(totalSales)}
          accent
          sub={<DeltaBadge value={salesDelta} />}
        />
        <HeroMetric
          label="Labor Cost"
          value={laborAvailable ? formatCompact(totalLaborCost) : '—'}
          sub={<DeltaBadge value={laborAvailable ? laborDelta : null} />}
        />
        <HeroMetric
          label="Labor % of Sales"
          value={laborPct != null ? formatPercent(laborPct) : '—'}
        />
        <HeroMetric
          label="Sales / Labor Hour"
          value={salesPerLaborHour != null ? formatCompact(salesPerLaborHour) : '—'}
        />
      </div>

      {!laborAvailable ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-10 text-center">
          <Users className="w-8 h-8 text-muted mx-auto mb-3" />
          <p className="text-white font-medium mb-1">Labor data not connected yet</p>
          <p className="text-sm text-secondary max-w-lg mx-auto">
            Run <code className="text-accent">npm run labor</code> with your 7shifts token in{' '}
            <code className="text-accent">.env</code> to populate daily labor cost.
          </p>
        </div>
      ) : (
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
              <XAxis
                dataKey="shortLabel"
                stroke="#525252"
                fontSize={10}
                axisLine={false}
                tickLine={false}
                interval={isMonthly ? 0 : chartData.length > 14 ? 1 : 0}
              />
              <YAxis
                yAxisId="left"
                stroke="#525252"
                fontSize={11}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCompact(v)}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value) => (
                  <span className="text-secondary">
                    {value === 'sales' ? 'Sales' : 'Labor Cost'}
                  </span>
                )}
              />
              <Bar
                yAxisId="left"
                dataKey="sales"
                name="sales"
                fill="#2563eb"
                radius={[2, 2, 0, 0]}
                maxBarSize={32}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="laborCost"
                name="laborCost"
                stroke="#f97316"
                strokeWidth={2}
                dot={{ r: 3, fill: '#f97316' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {laborAvailable && totalLaborCost === 0 && chart.some((d) => d.sales > 0) && (
        <p className="text-xs text-amber-400/90 mt-4 flex items-center gap-2">
          <DollarSign className="w-3.5 h-3.5" />
          Sales are present but labor cost is zero for this range — check your 7shifts pull dates.
        </p>
      )}
    </div>
  );
}
