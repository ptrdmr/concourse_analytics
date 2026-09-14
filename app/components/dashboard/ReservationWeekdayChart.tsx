'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { formatNumber } from '@/lib/format';
import { GENERAL_LANE, type WeekdayPoint } from '@/lib/reservations';

interface ComparePoint {
  day: string;
  current: number;
  baseline: number;
}

interface Props {
  data: WeekdayPoint[];
  compare?: boolean;
  compareData?: ComparePoint[];
  currentLabel?: string;
  baselineLabel?: string;
}

function TooltipSingle({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border-hover rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-1">{label}</p>
      <p className="text-sm font-mono text-foreground">{formatNumber(payload[0].value)}</p>
    </div>
  );
}

function TooltipCompare({
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
      <p className="text-xs text-muted mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-sm">
          <span className="text-secondary">{p.dataKey === 'current' ? currentLabel : baselineLabel}: </span>
          <span className="font-mono text-foreground">{formatNumber(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

export function ReservationWeekdayChart({
  data,
  compare,
  compareData,
  currentLabel = 'Current',
  baselineLabel = 'Baseline',
}: Props) {
  const hasAny = compare
    ? (compareData || []).some((d) => d.current > 0 || d.baseline > 0)
    : data.some((d) => d.count > 0);
  if (!hasAny) return null;

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-foreground mb-1">{GENERAL_LANE} by weekday</h3>
      <p className="text-sm text-muted mb-4">
        Walk-in / standard-rate lane bookings only — named programs are counted in their own rows
      </p>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          {compare && compareData ? (
            <BarChart data={compareData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
              <XAxis dataKey="day" stroke="#525252" fontSize={11} axisLine={false} tickLine={false} />
              <YAxis
                stroke="#525252"
                fontSize={11}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                tickFormatter={(v) => formatNumber(v)}
              />
              <Tooltip content={<TooltipCompare currentLabel={currentLabel} baselineLabel={baselineLabel} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="current" name={currentLabel} fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="baseline" name={baselineLabel} fill="#a1a1aa" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
              <XAxis dataKey="day" stroke="#525252" fontSize={11} axisLine={false} tickLine={false} />
              <YAxis
                stroke="#525252"
                fontSize={11}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                tickFormatter={(v) => formatNumber(v)}
              />
              <Tooltip content={<TooltipSingle />} />
              <Bar dataKey="count" fill="#a3a3a3" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
