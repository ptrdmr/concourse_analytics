'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { formatNumber } from '@/lib/format';
import { formatPeriodTick, type ChartGrain, type WeeklyPoint } from '@/lib/reservations';

interface Series {
  key: string;
  label: string;
  color: string;
}

interface Props {
  data: WeeklyPoint[];
  series: Series[];
  grain?: ChartGrain;
  title?: string;
  subtitle?: string;
}

function CustomTooltip({
  active,
  payload,
  label,
  grain,
}: {
  active?: boolean;
  payload?: Array<{ value: number; color: string; dataKey: string; payload?: WeeklyPoint }>;
  label?: string;
  grain: ChartGrain;
}) {
  if (!active || !payload?.length) return null;
  const partial = payload[0]?.payload?.partial;
  const heading = grain === 'month'
    ? formatPeriodTick(label || '')
    : `Week of ${label}`;
  return (
    <div className="bg-card border border-border-hover rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-2">
        {heading}{partial ? ' (partial)' : ''}
      </p>
      {payload
        .filter((p) => (p.value || 0) > 0)
        .sort((a, b) => b.value - a.value)
        .map((p) => (
          <p key={p.dataKey} className="text-sm">
            <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ background: p.color }} />
            <span className="text-secondary">{p.dataKey}: </span>
            <span className="text-foreground font-mono">{formatNumber(p.value)}</span>
          </p>
        ))}
    </div>
  );
}

export function ReservationTrendsChart({
  data,
  series,
  grain = 'week',
  title,
  subtitle,
}: Props) {
  const heading = title ?? (grain === 'month' ? 'Monthly bookings' : 'Weekly bookings');
  const caption = subtitle ?? (
    grain === 'month'
      ? 'Calendar months in this window'
      : 'Distinct tabs per reservation type, Monday weeks'
  );
  const labeled = data.map((point) => {
    const next: Record<string, string | number | boolean> = { ...point };
    for (const s of series) {
      next[s.label] = Number(point[s.key]) || 0;
    }
    return next;
  });

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-foreground mb-1">{heading}</h3>
      <p className="text-sm text-muted mb-4">{caption}</p>
      {data.length === 0 || series.length === 0 ? (
        <p className="text-sm text-muted py-12 text-center">No reservations in this window.</p>
      ) : (
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={labeled}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
              <XAxis
                dataKey="week"
                stroke="#525252"
                fontSize={11}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: string) => formatPeriodTick(v)}
                interval={Math.max(Math.floor(data.length / 8), 0)}
              />
              <YAxis
                stroke="#525252"
                fontSize={11}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                tickFormatter={(v) => formatNumber(v)}
              />
              <Tooltip content={<CustomTooltip grain={grain} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={(props: { cx?: number; cy?: number; payload?: WeeklyPoint; index?: number }) => {
                    const { cx = 0, cy = 0, payload, index } = props;
                    const opacity = payload?.partial ? 0.35 : 1;
                    return (
                      <circle
                        key={`${s.key}-${index}`}
                        cx={cx}
                        cy={cy}
                        r={3}
                        fill={s.color}
                        fillOpacity={opacity}
                        stroke="none"
                      />
                    );
                  }}
                  activeDot={{ r: 4 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {data.some((d) => d.partial) && (
        <p className="text-xs text-muted mt-3">
          Faded points are incomplete {grain === 'month' ? 'months' : 'weeks'} (range start, or data through mid-period).
        </p>
      )}
    </div>
  );
}
