'use client';

import { DollarSign, ShoppingCart, TrendingUp, Package } from 'lucide-react';
import { formatCompact, formatNumber } from '@/lib/format';

interface Props {
  kpis: {
    totalRevenue: number;
    totalQuantity: number;
    totalTransactions: number;
    uniqueItems: number;
  };
}

export function KpiRow({ kpis }: Props) {
  const cards = [
    { icon: <DollarSign className="w-5 h-5" />, label: 'Revenue', value: formatCompact(kpis.totalRevenue), accent: true },
    { icon: <ShoppingCart className="w-5 h-5" />, label: 'Quantity Sold', value: formatNumber(kpis.totalQuantity) },
    { icon: <TrendingUp className="w-5 h-5" />, label: 'Transactions', value: formatNumber(kpis.totalTransactions) },
    { icon: <Package className="w-5 h-5" />, label: 'Unique Items', value: String(kpis.uniqueItems) },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className="card p-5">
          <div className="flex items-center gap-2 text-secondary mb-1.5">
            {c.icon}
            <span className="text-sm">{c.label}</span>
          </div>
          <div className={`text-2xl font-bold font-mono ${c.accent ? 'text-gradient' : ''}`}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}
