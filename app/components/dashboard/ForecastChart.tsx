'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { formatCompact, formatCurrency } from '@/lib/format';

interface ForecastItem {
  weekStart: string;
  weekOfYear: number;
  year: number;
  predictedRevenue: number;
}

interface ForecastData {
  forecasts: Record<string, ForecastItem[]>;
  generatedAt: string;
}

interface Props {
  data: ForecastData;
}

const MODEL_COLORS: Record<string, string> = {
  actual: '#10b981',
  seasonal: '#22d3ee',
};

const MODEL_LABELS: Record<string, string> = {
  actual: 'Current Year Actual',
  seasonal: 'Seasonal Decomposition',
};

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const actual = payload.find(p => p.dataKey === 'actual')?.value;
  const predicted = payload.find(p => p.dataKey === 'seasonal')?.value;
  const hasBoth = actual != null && predicted != null && predicted > 0;
  const error = hasBoth ? actual - predicted : null;
  const pctError = hasBoth ? ((actual - predicted) / predicted) * 100 : null;

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-xs text-muted mb-2">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="text-sm">
          <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ background: p.color }} />
          <span className="text-secondary">{MODEL_LABELS[p.dataKey] || p.dataKey}: </span>
          <span className="text-white font-mono">{formatCurrency(p.value)}</span>
        </p>
      ))}
      {error != null && (
        <p className="text-sm mt-2 pt-2 border-t border-gray-700">
          <span className="text-secondary">Error: </span>
          <span className={`font-mono ${error >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {error >= 0 ? '+' : ''}{formatCurrency(error)}
            {pctError != null && ` (${pctError >= 0 ? '+' : ''}${pctError.toFixed(1)}%)`}
          </span>
        </p>
      )}
    </div>
  );
}

export function ForecastChart({ data }: Props) {
  const chartData = useMemo(() => {
    const allWeeks = new Map<string, Record<string, number>>();

    for (const [model, items] of Object.entries(data.forecasts)) {
      for (const item of items) {
        const existing = allWeeks.get(item.weekStart) || { weekStart: item.weekStart } as Record<string, number>;
        existing[model] = item.predictedRevenue;
        allWeeks.set(item.weekStart, existing);
      }
    }

    return Array.from(allWeeks.values()).sort((a, b) =>
      String(a.weekStart).localeCompare(String(b.weekStart))
    );
  }, [data]);

  const models = Object.keys(data.forecasts);

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Bowling Revenue Forecast</h3>
      <p className="text-sm text-muted mb-4">
        {models.includes('actual') && models.includes('seasonal')
          ? 'Actual vs predicted weekly revenue'
          : `Predicted weekly revenue — ${models.length} model${models.length !== 1 ? 's' : ''}`}
      </p>

      <div className="flex flex-wrap gap-4 mb-6">
        {models.map(model => (
          <div key={model} className="flex items-center gap-2 text-sm">
            <span
              className="w-3 h-3 rounded-full"
              style={{ background: MODEL_COLORS[model] || '#a78bfa' }}
            />
            <span className="text-secondary">{MODEL_LABELS[model] || model}</span>
          </div>
        ))}
      </div>

      <div className="h-[350px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
            <XAxis
              dataKey="weekStart"
              stroke="#525252"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => v.slice(5)}
              interval={Math.max(Math.floor(chartData.length / 10), 1)}
            />
            <YAxis
              stroke="#525252"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => formatCompact(v)}
            />
            <Tooltip content={<CustomTooltip />} />
            {models.map(model => (
              <Line
                key={model}
                type="monotone"
                dataKey={model}
                stroke={MODEL_COLORS[model] || '#a78bfa'}
                strokeWidth={2}
                dot={{ r: 3, fill: MODEL_COLORS[model] || '#a78bfa', stroke: '#000', strokeWidth: 2 }}
                activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
