'use client';

import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { formatNumber } from '@/lib/format';
import { formatPeriodLabel, type AlignedWeekPoint, type ChartGrain } from '@/lib/reservations';

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
  grain?: ChartGrain;
  currentLabel: string;
  baselineLabel: string;
  currentRange?: string;
  baselineRange?: string;
}

function seriesSide(
  p: { dataKey?: string; name?: string },
  currentLabel: string,
): 'A' | 'B' {
  if (p.dataKey === 'periodA' || p.dataKey === 'current') return 'A';
  if (p.dataKey === 'periodB' || p.dataKey === 'baseline') return 'B';
  if (String(p.name).trim() === String(currentLabel)) return 'A';
  return 'B';
}

function WeeklyTooltip({
  active,
  payload,
  currentLabel,
  baselineLabel,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; name?: string; payload?: AlignedWeekPoint }>;
  currentLabel: string;
  baselineLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="bg-card border border-border-hover rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-2">{row?.label}</p>
      {payload.map((p) => {
        const side = seriesSide(p, currentLabel);
        const week = side === 'A' ? row?.weekA : row?.weekB;
        const partial = side === 'A' ? row?.partialA : row?.partialB;
        const name = side === 'A' ? currentLabel : baselineLabel;
        return (
          <p key={`${p.dataKey}-${p.name}`} className="text-sm">
            <span className="text-secondary">{name}</span>
            {week ? <span className="text-muted"> ({formatPeriodLabel(week)}{partial ? ', partial' : ''})</span> : null}
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
  grain = 'week',
  currentLabel,
  baselineLabel,
  currentRange,
  baselineRange,
}: Props) {
  const monthly = grain === 'month';
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-foreground mb-1">
          {monthly ? 'Monthly overlay' : 'Weekly overlay'}
        </h3>
        <p className="text-sm text-muted mb-4">
          {monthly ? 'Same calendar month in each year' : 'Same calendar week in each year'}
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
                <Legend
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value) => String(value).trim()}
                />
                <Line
                  type="monotone"
                  dataKey="periodA"
                  name={`${currentLabel} `}
                  stroke={CURRENT}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: CURRENT }}
                />
                <Line
                  type="monotone"
                  dataKey="periodB"
                  name={`${baselineLabel} `}
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
