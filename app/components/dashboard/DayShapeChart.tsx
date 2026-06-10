'use client';

import { useState } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { DayShapeSeries, IntradayMetric, SlotAggregate } from '@/lib/intraday';
import { getDisplaySlots, slotToShortLabel, slotToTimeLabel } from '@/lib/intraday';

interface Props {
  series: DayShapeSeries[];
  metric: IntradayMetric;
  resolution: 30 | 60 | 120;
  singleDay?: boolean;
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
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  metric: IntradayMetric;
  singleDay?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-2">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="text-sm flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-secondary">{p.name}: </span>
          <span className="text-white font-mono">
            {metric === 'quantity' ? formatNumber(p.value) : formatCurrency(p.value)}
            {!singleDay && <span className="text-muted text-xs ml-1">avg/day</span>}
          </span>
        </p>
      ))}
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
  onSlotClick,
}: Props) {
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const multiLine = series.length >= 2;
  const displaySlots = getDisplaySlots(resolution);

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
    return row;
  });

  const subtitle = multiLine
    ? `Compare avg ${metric} by time of day — ${series.map(s => s.dayLabel).join(', ')}`
    : singleDay
      ? 'Actual sales for selected day'
      : 'Average sales by time of day (4 AM start)';

  const yTickFormatter = (v: number) =>
    metric === 'quantity' ? formatNumber(v) : formatCurrency(v);

  return (
    <div className="card p-6">
      <div className="mb-1">
        <h3 className="text-lg font-semibold text-white">Day Shape</h3>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>
      <div className="h-[320px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          {multiLine ? (
            <LineChart
              data={chartData}
              onClick={(state) => {
                if (state?.activePayload?.[0]?.payload?.slot != null) {
                  onSlotClick?.(state.activePayload[0].payload.slot as number);
                }
              }}
            >
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
            <AreaChart
              data={chartData}
              onClick={(state) => {
                if (state?.activePayload?.[0]?.payload?.slot != null) {
                  onSlotClick?.(state.activePayload[0].payload.slot as number);
                }
              }}
            >
              <defs>
                <linearGradient id="dayShapeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={series[0]?.color ?? '#2563eb'} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={series[0]?.color ?? '#2563eb'} stopOpacity={0.05} />
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
                scale="linear"
                stroke="#525252"
                fontSize={11}
                axisLine={false}
                tickLine={false}
                tickFormatter={yTickFormatter}
              />
              <Tooltip
                content={
                  <MultiTooltip
                    metric={metric}
                    singleDay={singleDay}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey={series[0]?.dayLabel ?? 'value'}
                stroke={series[0]?.color ?? '#2563eb'}
                strokeWidth={2}
                fill="url(#dayShapeGradient)"
                activeDot={{ r: 5, fill: series[0]?.color ?? '#2563eb', stroke: '#fff', strokeWidth: 2 }}
              />
            </AreaChart>
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
                  active ? 'bg-white/10' : 'hover:bg-white/5'
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
                <span className={`text-xs ${active ? 'text-white font-medium' : 'text-secondary'}`}>
                  {s.dayLabel}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted mt-2">Click a point to see top items for that time window</p>
    </div>
  );
}
