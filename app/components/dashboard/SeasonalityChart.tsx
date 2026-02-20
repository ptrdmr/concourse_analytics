'use client';

import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { formatCompact, formatCurrency } from '@/lib/format';

interface SeasonalityData {
  byYearWeek: Record<string, Array<{ week: number; revenue: number }>>;
  yearColors: string[];
  years: number[];
}

interface Props {
  data: SeasonalityData;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-2">Week {label}</p>
      {payload
        .filter(p => p.value > 0)
        .sort((a, b) => b.value - a.value)
        .map(p => (
          <p key={p.dataKey} className="text-sm">
            <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ background: p.color }} />
            <span className="text-secondary">{p.dataKey}: </span>
            <span className="text-white font-mono">{formatCurrency(p.value)}</span>
          </p>
        ))}
    </div>
  );
}

export function SeasonalityChart({ data }: Props) {
  const [visibleYears, setVisibleYears] = useState<Set<number>>(
    new Set(data.years)
  );

  const chartData = useMemo(() => {
    const weeks: Record<number, Record<string, number>> = {};
    for (let w = 1; w <= 52; w++) {
      weeks[w] = { week: w };
    }

    for (const [yearStr, weekData] of Object.entries(data.byYearWeek)) {
      for (const { week, revenue } of weekData) {
        if (weeks[week]) {
          weeks[week][yearStr] = revenue;
        }
      }
    }

    return Object.values(weeks).sort((a, b) => (a.week as number) - (b.week as number));
  }, [data]);

  function toggleYear(year: number) {
    setVisibleYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Bowling Revenue Seasonality</h3>
      <p className="text-sm text-muted mb-4">Weekly revenue by year — 52-week overlay</p>

      <div className="flex flex-wrap gap-2 mb-6">
        {data.years.map((year, i) => {
          const active = visibleYears.has(year);
          const color = data.yearColors[i % data.yearColors.length];
          return (
            <button
              key={year}
              onClick={() => toggleYear(year)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                active ? 'bg-white/10 text-white' : 'bg-white/5 text-muted'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ background: color, opacity: active ? 1 : 0.3 }}
              />
              {year}
            </button>
          );
        })}
      </div>

      <div className="h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
            <XAxis
              dataKey="week"
              stroke="#525252"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              interval={3}
            />
            <YAxis
              stroke="#525252"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => formatCompact(v)}
            />
            <Tooltip content={<CustomTooltip />} />
            {data.years.map((year, i) => (
              visibleYears.has(year) && (
                <Line
                  key={year}
                  type="monotone"
                  dataKey={String(year)}
                  stroke={data.yearColors[i % data.yearColors.length]}
                  strokeWidth={year === data.years[data.years.length - 1] ? 2.5 : 1.5}
                  dot={false}
                  activeDot={{ r: 4, stroke: '#000', strokeWidth: 2 }}
                  connectNulls
                />
              )
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
