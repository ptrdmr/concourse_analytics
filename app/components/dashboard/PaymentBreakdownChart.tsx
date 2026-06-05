'use client';

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';
import { formatCompact, formatCurrency, formatPercent } from '@/lib/format';
import {
  PAYMENT_TYPE_COLORS,
  PAYMENT_TYPE_LABELS,
  type PaymentTypeKey,
} from '@/lib/payments';

interface TypeSlice {
  paymentType: PaymentTypeKey;
  label: string;
  amount: number;
  transactions: number;
}

export interface NameSlice {
  name: string;
  amount: number;
  transactions: number;
  paymentType: PaymentTypeKey;
}

const FALLBACK_COLORS = [
  '#2563eb', '#60a5fa', '#f59e0b', '#ef4444', '#8b5cf6',
  '#f97316', '#ec4899', '#84cc16', '#06b6d4', '#e879f9',
  '#a78bfa', '#14b8a6', '#f43f5e', '#eab308', '#6366f1',
];

function getNameColor(entry: NameSlice, index: number): string {
  if (index === 0) return PAYMENT_TYPE_COLORS[entry.paymentType];
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

interface DailyPoint {
  date: string;
  cash: number;
  credit: number;
  storedValue: number;
  total: number;
}

function PieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: TypeSlice }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-sm font-semibold text-white">{d.label}</p>
      <p className="text-sm text-accent">{formatCurrency(d.amount)}</p>
      <p className="text-xs text-muted mt-1">{d.transactions.toLocaleString()} payments</p>
    </div>
  );
}

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-sm font-semibold text-white mb-2">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-sm" style={{ color: entry.color }}>
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

function NamePieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: NameSlice }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 shadow-xl">
      <p className="text-sm font-semibold text-white">{d.name}</p>
      <p className="text-sm text-accent">{formatCurrency(d.amount)}</p>
      <p className="text-xs text-muted mt-1">{d.transactions.toLocaleString()} payments</p>
    </div>
  );
}

export function PaymentNamePieChart({
  title,
  subtitle,
  data,
}: {
  title: string;
  subtitle: string;
  data: NameSlice[];
}) {
  const pieData = data.filter((d) => d.amount > 0);
  const total = data.reduce((s, d) => s + d.amount, 0);

  if (!data.length) {
    return (
      <div className="card p-6 h-full">
        <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
        <p className="text-sm text-muted mb-2">{subtitle}</p>
        <p className="text-sm text-muted">No payment data for the selected period.</p>
      </div>
    );
  }

  return (
    <div className="card p-6 h-full">
      <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
      <p className="text-sm text-muted mb-6">{subtitle}</p>
      <div className="flex flex-col gap-6">
        {pieData.length > 0 && (
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="amount"
                  nameKey="name"
                >
                  {pieData.map((entry, i) => (
                    <Cell key={entry.name} fill={getNameColor(entry, i)} />
                  ))}
                </Pie>
                <Tooltip content={<NamePieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2">
          {data.map((d, i) => (
            <div key={d.name} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: d.amount > 0 ? getNameColor(d, i) : '#444' }}
                />
                <span className={d.amount > 0 ? 'text-secondary truncate' : 'text-muted truncate'}>
                  {d.name}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`font-mono ${d.amount > 0 ? 'text-white' : 'text-muted'}`}>
                  {formatCompact(d.amount)}
                </span>
                <span className="text-muted text-xs w-12 text-right">
                  {total > 0 ? formatPercent((d.amount / total) * 100) : '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PaymentTypePieChart({ data }: { data: TypeSlice[] }) {
  const total = data.reduce((s, d) => s + d.amount, 0);

  if (!data.length || total === 0) {
    return (
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-white mb-2">Payment Mix</h3>
        <p className="text-sm text-muted">No payment data for the selected period.</p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Payment Mix</h3>
      <p className="text-sm text-muted mb-6">Share of tender by payment type</p>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="h-[280px] flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={110}
                paddingAngle={2}
                dataKey="amount"
                nameKey="label"
              >
                {data.map((entry) => (
                  <Cell key={entry.paymentType} fill={PAYMENT_TYPE_COLORS[entry.paymentType]} />
                ))}
              </Pie>
              <Tooltip content={<PieTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-2">
          {data.map((d) => (
            <div key={d.paymentType} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: PAYMENT_TYPE_COLORS[d.paymentType] }}
                />
                <span className="text-secondary">{d.label}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono text-white">{formatCompact(d.amount)}</span>
                <span className="text-muted text-xs w-12 text-right">
                  {formatPercent((d.amount / total) * 100)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PaymentDailyTrendChart({ data }: { data: DailyPoint[] }) {
  if (data.length < 2) return null;

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-white mb-1">Daily Payment Trend</h3>
      <p className="text-sm text-muted mb-6">Payment type mix over the selected range</p>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="date"
              tick={{ fill: '#888', fontSize: 11 }}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              tick={{ fill: '#888', fontSize: 11 }}
              tickFormatter={(v: number) => formatCompact(v)}
            />
            <Tooltip content={<TrendTooltip />} />
            <Legend />
            <Bar dataKey="cash" name={PAYMENT_TYPE_LABELS.PaymentCash} stackId="a" fill={PAYMENT_TYPE_COLORS.PaymentCash} />
            <Bar dataKey="credit" name={PAYMENT_TYPE_LABELS.PaymentCredit} stackId="a" fill={PAYMENT_TYPE_COLORS.PaymentCredit} />
            <Bar dataKey="storedValue" name={PAYMENT_TYPE_LABELS.PaymentStoredValue} stackId="a" fill={PAYMENT_TYPE_COLORS.PaymentStoredValue} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
