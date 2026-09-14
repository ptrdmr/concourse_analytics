'use client';

import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { formatNumber } from '@/lib/format';
import type { AlignedWeekPoint } from '@/lib/reservations';

const CURRENT = '#22c55e';
const BASELINE = '#a1a1aa';

interface BarRow {
  key: string;
  label: string;
  color: string;
  current: number;
  baseline: number;
}

interface Props {
  weekly: AlignedWeekPoint[];
  bars: BarRow[];
  currentLabel: string;
  baselineLabel: string;
  currentRange?: string;
  baselineRange?: string;
}

function WeeklyTooltip({
  active,
  payload,
  currentLabel,
  baselineLabel,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; payload?: AlignedWeekPoint }>;
  currentLabel: string;
  baselineLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="bg-card border border-border-hover rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-2">{row?.label}</p>
      {payload.map((p) => {
        const week = p.dataKey === 'periodA' ? row?.weekA : row?.weekB;
        const partial = p.dataKey === 'periodA' ? row?.partialA : row?.partialB;
        const name = p.dataKey === 'periodA' ? currentLabel : baselineLabel;
        return (
          <p key={p.dataKey} className="text-sm">
            <span className="text-secondary">{name}</span>
            {week ? <span className="text-muted"> ({week}{partial ? ', partial' : ''})</span> : null}
            <span className="text-foreground font-mono"> {formatNumber(p.value)}</span>
          </p>
        );
      })}
    </div>
  );
}

function BarTooltip({
  active,
  payload,
  label,
  currentLabel,
  baselineLabel,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
  currentLabel: string;
  baselineLabel: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border-hover rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-2">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-sm">
          <span className="text-secondary">{p.dataKey === 'current' ? currentLabel : baselineLabel}: </span>
          <span className="text-foreground font-mono">{formatNumber(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

export function ReservationCompareCharts({
  weekly,
  bars,
  currentLabel,
  baselineLabel,
  currentRange,
  baselineRange,
}: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-foreground mb-1">Weekly overlay</h3>
        <p className="text-sm text-muted mb-4">
          Aligned by week number in each window
          {currentRange && baselineRange ? ` — ${currentRange} vs ${baselineRange}` : ` — ${currentLabel} vs ${baselineLabel}`}
        </p>
        {weekly.length === 0 ? (
          <p className="text-sm text-muted py-12 text-center">No reservations in this window.</p>
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weekly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#525252"
                  fontSize={11}
                  axisLine={false}
                  tickLine={false}
                  interval={Math.max(Math.floor(weekly.length / 8), 0)}
                />
                <YAxis
                  stroke="#525252"
                  fontSize={11}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  tickFormatter={(v) => formatNumber(v)}
                />
                <Tooltip content={<WeeklyTooltip currentLabel={currentLabel} baselineLabel={baselineLabel} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="periodA"
                  name={currentLabel}
                  stroke={CURRENT}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: CURRENT }}
                />
                <Line
                  type="monotone"
                  dataKey="periodB"
                  name={baselineLabel}
                  stroke={BASELINE}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={{ r: 3, fill: BASELINE }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card p-6">
        <h3 className="text-lg font-semibold text-foreground mb-1">Totals by type</h3>
        <p className="text-sm text-muted mb-4">{currentLabel} vs {baselineLabel} for the selected families</p>
        {bars.length === 0 ? (
          <p className="text-sm text-muted py-12 text-center">Nothing selected.</p>
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} layout="vertical" margin={{ left: 8, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" horizontal={false} />
                <XAxis
                  type="number"
                  stroke="#525252"
                  fontSize={11}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  tickFormatter={(v) => formatNumber(v)}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  stroke="#525252"
                  fontSize={11}
                  axisLine={false}
                  tickLine={false}
                  width={110}
                />
                <Tooltip content={<BarTooltip currentLabel={currentLabel} baselineLabel={baselineLabel} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="current" name={currentLabel} fill={CURRENT} radius={[0, 4, 4, 0]} maxBarSize={18} />
                <Bar dataKey="baseline" name={baselineLabel} fill={BASELINE} radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
