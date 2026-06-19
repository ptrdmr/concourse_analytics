'use client';

import { Fragment } from 'react';
import { useMemo } from 'react';
import { formatCompact, formatNumber } from '@/lib/format';
import type { HeatmapCell, IntradayMetric } from '@/lib/intraday';
import { getDisplaySlots, getDayLabel } from '@/lib/intraday';

interface Props {
  cells: HeatmapCell[];
  metric: IntradayMetric;
  resolution: 30 | 60 | 120;
  onCellClick?: (slot: number, dayOfWeek: number) => void;
  selectedSlot?: number | null;
}

export function DaypartHeatmap({ cells, metric, resolution, onCellClick, selectedSlot }: Props) {
  const displaySlots = useMemo(() => getDisplaySlots(resolution), [resolution]);

  const { maxValue, grid } = useMemo(() => {
    const gridMap = new Map<string, HeatmapCell>();
    for (const c of cells) {
      gridMap.set(`${c.dayOfWeek}-${c.slot}`, c);
    }

    let max = 0;
    for (const c of cells) {
      const v = metric === 'quantity' ? c.avgQuantity : c.avgRevenue;
      if (v > max) max = v;
    }

    return { maxValue: max || 1, grid: gridMap };
  }, [cells, metric]);

  function cellColor(value: number): string {
    if (value <= 0) return 'rgba(255,255,255,0.03)';
    const intensity = Math.min(value / maxValue, 1);
    const alpha = 0.15 + intensity * 0.85;
    return `rgba(34, 197, 94, ${alpha})`;
  }

  return (
    <div className="card p-6 overflow-x-auto">
      <div className="mb-4 min-w-[600px]">
        <h3 className="text-lg font-semibold text-foreground">Daypart Heatmap</h3>
        <p className="text-sm text-muted">Avg {metric === 'quantity' ? 'units' : 'revenue'} by day of week and time (4 AM start)</p>
      </div>
      <div className="min-w-[600px]">
        <div
          className="grid gap-px"
          style={{
            gridTemplateColumns: `48px repeat(${displaySlots.length}, minmax(20px, 1fr))`,
          }}
        >
          <div />
          {displaySlots.map(slot => {
            const sample = cells.find(c => c.slot === slot);
            return (
              <div key={slot} className="text-[9px] text-muted text-center truncate pb-1">
                {sample?.slotLabel ?? slot}
              </div>
            );
          })}

          {[1, 2, 3, 4, 5, 6, 0].map(dow => (
            <Fragment key={dow}>
              <div className="text-xs text-secondary flex items-center pr-2">
                {getDayLabel(dow)}
              </div>
              {displaySlots.map(slot => {
                const cell = grid.get(`${dow}-${slot}`);
                const value = cell
                  ? (metric === 'quantity' ? cell.avgQuantity : cell.avgRevenue)
                  : 0;
                const isSelected = selectedSlot === slot;
                return (
                  <button
                    key={`${dow}-${slot}`}
                    type="button"
                    title={`${getDayLabel(dow)} ${cell?.slotLabel ?? ''}: ${
                      metric === 'quantity' ? formatNumber(value) : formatCompact(value)
                    } avg/day`}
                    onClick={() => onCellClick?.(slot, dow)}
                    className={`aspect-square rounded-sm transition-all hover:ring-1 hover:ring-accent/50 ${
                      isSelected ? 'ring-2 ring-accent' : ''
                    }`}
                    style={{ backgroundColor: cellColor(value) }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
