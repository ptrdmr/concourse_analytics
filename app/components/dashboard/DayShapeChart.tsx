'use client';

import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { DayShapeSeries, IntradayMetric, SlotAggregate } from '@/lib/intraday';
import { getDisplaySlots, slotToShortLabel, slotToTimeLabel } from '@/lib/intraday';
import type { LaborDayShapePoint } from '@/types';

const LABOR_COLOR = '#f97316';

interface Props {
  series: DayShapeSeries[];
  metric: IntradayMetric;
  resolution: 30 | 60 | 120;
  singleDay?: boolean;
  laborSeries?: LaborDayShapePoint[];
  showLabor?: boolean;
  onSlotClick?: (slot: number) => void;
}

function slotValue(slot: SlotAggregate | undefined, metric: IntradayMetric, singleDay: boolean): number {
  if (!slot) return 0;
  return metric === 'quantity'
    ? (singleDay ? slot.quantity : slot.avgQuantity)
    : (singleDay ? slot.revenue : slot.avgRevenue);
}

function MultiTooltip({
  active,
  payload,
  label,
  metric,
  singleDay,
  laborLabel,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey?: string }>;
  label?: string;
  metric: IntradayMetric;
  singleDay?: boolean;
  laborLabel?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border-hover rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-2">{label}</p>
      {payload.map(p => {
        const isLabor = p.dataKey === 'labor';
        const formatted = isLabor
          ? (metric === 'quantity' ? formatNumber(p.value) : formatCurrency(p.value))
          : (metric === 'quantity' ? formatNumber(p.value) : formatCurrency(p.value));
        return (
          <p key={p.name} className="text-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
            <span className="text-secondary">{isLabor ? laborLabel : p.name}: </span>
            <span className="text-foreground font-mono">
              {formatted}
              {!singleDay && !isLabor && <span className="text-muted text-xs ml-1">avg/day</span>}
              {!singleDay && isLabor && <span className="text-muted text-xs ml-1">avg/day</span>}
            </span>
          </p>
        );
      })}
    </div>
  );
}

function lineHighlight(
  dayLabel: string,
  color: string,
  hoveredDay: string | null,
): { stroke: string; strokeWidth: number; strokeOpacity: number } {
  if (!hoveredDay) {
    return { stroke: color, strokeWidth: 2, strokeOpacity: 1 };
  }
  if (hoveredDay === dayLabel) {
    return { stroke: color, strokeWidth: 3.5, strokeOpacity: 1 };
  }
  return { stroke: color, strokeWidth: 1.5, strokeOpacity: 0.12 };
}

export function DayShapeChart({
  series,
  metric,
  resolution,
  singleDay,
  laborSeries,
  showLabor = false,
  onSlotClick,
}: Props) {
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const multiLine = series.length >= 2;
  const displaySlots = getDisplaySlots(resolution);

  const laborBySlot = useMemo(
    () => new Map((laborSeries ?? []).map(point => [point.slot, point])),
    [laborSeries],
  );

  const hasLaborData = useMemo(
    () => (laborSeries ?? []).some(p => (metric === 'revenue' ? p.avgCost : p.avgHeadcount) > 0),
    [laborSeries, metric],
  );

  const laborVisible = showLabor && !multiLine && hasLaborData;
  const laborLineLabel = metric === 'revenue' ? 'Total store labor' : 'Avg staff';
  const laborTickFormatter = (v: number) =>
    metric === 'quantity' ? formatNumber(v) : formatCurrency(v);

  const chartData = displaySlots.map(slot => {
    const row: Record<string, string | number> = {
      slot,
      shortLabel: slotToShortLabel(slot),
      label: slotToTimeLabel(slot),
    };
    for (const s of series) {
      const slotAgg = s.slots.find(sl => sl.slot === slot);
      row[s.dayLabel] = slotValue(slotAgg, metric, !!singleDay);
    }
    const laborPoint = laborBySlot.get(slot);
    if (laborPoint) {
      row.labor = metric === 'revenue' ? laborPoint.avgCost : laborPoint.avgHeadcount;
    }
    return row;
  });

  const subtitle = multiLine
    ? `Compare avg ${metric} by time of day — ${series.map(s => s.dayLabel).join(', ')}`
    : laborVisible
      ? metric === 'revenue'
        ? 'Average sales vs average total store labor by time of day (4 AM start)'
        : 'Average sales vs average staff on floor by time of day (4 AM start)'
      : singleDay
        ? 'Actual sales for selected day'
        : 'Average sales by time of day (4 AM start)';

  const yTickFormatter = (v: number) =>
    metric === 'quantity' ? formatNumber(v) : formatCurrency(v);

  const handleChartClick = (state: { activePayload?: Array<{ payload?: { slot?: number } }> }) => {
    if (state?.activePayload?.[0]?.payload?.slot != null) {
      onSlotClick?.(state.activePayload[0].payload.slot as number);
    }
  };

  return (
    <div className="card p-6">
      <div className="mb-1">
        <h3 className="text-lg font-semibold text-foreground">Day Shape</h3>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>
      <div className="h-[320px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          {multiLine ? (
            <LineChart data={chartData} onClick={handleChartClick}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
              <XAxis
                dataKey="shortLabel"
                stroke="#525252"
                fontSize={10}
                axisLine={false}
                tickLine={false}
                interval={Math.max(Math.floor(chartData.length / 12), 0)}
              />
              <YAxis
                scale="linear"
                stroke="#525252"
                fontSize={11}
                axisLine={false}
                tickLine={false}
                tickFormatter={yTickFormatter}
              />
              <Tooltip content={<MultiTooltip metric={metric} singleDay={singleDay} />} />
              {series.map(s => {
                const style = lineHighlight(s.dayLabel, s.color, hoveredDay);
                return (
                  <Line
                    key={s.dayLabel}
                    type="monotone"
                    dataKey={s.dayLabel}
                    stroke={style.stroke}
                    strokeWidth={style.strokeWidth}
                    strokeOpacity={style.strokeOpacity}
                    dot={false}
                    activeDot={
                      hoveredDay && hoveredDay !== s.dayLabel
                        ? false
                        : { r: 4, fill: s.color, stroke: '#fff', strokeWidth: 2 }
                    }
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          ) : (
            <ComposedChart data={chartData} onClick={handleChartClick}>
              <defs>
                <linearGradient id="dayShapeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={series[0]?.color ?? '#22c55e'} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={series[0]?.color ?? '#22c55e'} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
              <XAxis
                dataKey="shortLabel"
                stroke="#525252"
                fontSize={10}
                axisLine={false}
                tickLine={false}
                interval={Math.max(Math.floor(chartData.length / 12), 0)}
              />
              <YAxis
                yAxisId="left"
                scale="linear"
                stroke="#525252"
                fontSize={11}
                axisLine={false}
                tickLine={false}
                tickFormatter={yTickFormatter}
              />
              {laborVisible && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  scale="linear"
                  stroke={LABOR_COLOR}
                  fontSize={11}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={laborTickFormatter}
                />
              )}
              <Tooltip
                content={
                  <MultiTooltip
                    metric={metric}
                    singleDay={singleDay}
                    laborLabel={laborLineLabel}
                  />
                }
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey={series[0]?.dayLabel ?? 'value'}
                name={series[0]?.dayLabel ?? 'Sales'}
                stroke={series[0]?.color ?? '#22c55e'}
                strokeWidth={2}
                fill="url(#dayShapeGradient)"
                activeDot={{ r: 5, fill: series[0]?.color ?? '#22c55e', stroke: '#fff', strokeWidth: 2 }}
              />
              {laborVisible && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="labor"
                  name={laborLineLabel}
                  stroke={LABOR_COLOR}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: LABOR_COLOR, stroke: '#fff', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
      {multiLine && (
        <div
          className="flex flex-wrap justify-center gap-4 mt-3"
          onMouseLeave={() => setHoveredDay(null)}
        >
          {series.map(s => {
            const active = hoveredDay === s.dayLabel;
            const dimmed = hoveredDay != null && !active;
            return (
              <button
                key={s.dayLabel}
                type="button"
                className={`flex items-center gap-2 px-2 py-1 rounded-md transition-all ${
                  active ? 'bg-overlay/10' : 'hover:bg-overlay/5'
                } ${dimmed ? 'opacity-40' : 'opacity-100'}`}
                onMouseEnter={() => setHoveredDay(s.dayLabel)}
                onFocus={() => setHoveredDay(s.dayLabel)}
                onBlur={() => setHoveredDay(null)}
              >
                <span
                  className="w-3 h-0.5 rounded-full shrink-0 transition-all"
                  style={{
                    backgroundColor: s.color,
                    height: active ? 3 : 2,
                    width: active ? 20 : 12,
                  }}
                />
                <span className={`text-xs ${active ? 'text-foreground font-medium' : 'text-secondary'}`}>
                  {s.dayLabel}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {laborVisible && (
        <div className="flex items-center justify-center gap-4 mt-3 text-xs text-secondary">
          <span className="inline-flex items-center gap-2">
            <span className="w-3 h-0.5 rounded-full bg-[#22c55e]" />
            Sales
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-3 h-0.5 rounded-full bg-[#f97316]" />
            {laborLineLabel}
          </span>
        </div>
      )}
      <p className="text-xs text-muted mt-2">Click a point to see top items for that time window</p>
    </div>
  );
}
