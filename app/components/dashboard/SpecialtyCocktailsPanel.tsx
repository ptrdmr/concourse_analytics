'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { formatCurrency } from '@/lib/format';

interface ItemData {
  name: string;
  revenue: number;
  quantity: number;
  category: string;
}

interface Props {
  items: ItemData[];
  colors: Record<string, string>;
}

const FALLBACK = '#10b981';

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ItemData }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-sm font-semibold text-white">{d.name}</p>
      <p className="text-xs text-muted">{d.category}</p>
      <p className="text-sm text-accent mt-1">{formatCurrency(d.revenue)}</p>
      <p className="text-xs text-muted">{d.quantity} sold</p>
    </div>
  );
}

export function SpecialtyCocktailsPanel({ items, colors }: Props) {
  const [specialtyNames, setSpecialtyNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/data/specialty_cocktails.json')
      .then((res) => res.json())
      .then((data: string[]) => {
        setSpecialtyNames(data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const specialtySet = useMemo(() => {
    return new Set(specialtyNames.map(normalizeName));
  }, [specialtyNames]);

  const specialtyItems = useMemo(() => {
    return items
      .filter((item) => specialtySet.has(normalizeName(item.name)))
      .sort((a, b) => b.revenue - a.revenue);
  }, [items, specialtySet]);

  if (loading) {
    return (
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-white mb-1">Specialty Cocktails</h3>
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Specialty Cocktails</h3>
      <p className="text-sm text-muted mb-6">Current featured drinks</p>

      {specialtyItems.length === 0 ? (
        <p className="text-secondary text-sm py-8">
          No specialty cocktail sales in this period.
        </p>
      ) : (
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={specialtyItems} layout="vertical" margin={{ left: 140 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" horizontal={false} />
              <XAxis
                type="number"
                stroke="#525252"
                fontSize={11}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCurrency(v)}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke="#525252"
                fontSize={12}
                axisLine={false}
                tickLine={false}
                width={130}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="revenue" radius={[0, 6, 6, 0]} maxBarSize={24} fillOpacity={0.85}>
                {specialtyItems.map((entry) => (
                  <Cell key={entry.name} fill={colors[entry.category] || FALLBACK} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
