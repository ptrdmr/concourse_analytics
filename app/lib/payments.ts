import type { PaymentRecord } from '@/types';

export type PaymentTypeKey = PaymentRecord['paymentType'];

export const PAYMENT_TYPE_LABELS: Record<PaymentTypeKey, string> = {
  PaymentCash: 'Cash',
  PaymentCredit: 'Credit',
  PaymentStoredValue: 'Stored Value',
};

export const PAYMENT_TYPE_COLORS: Record<PaymentTypeKey, string> = {
  PaymentCash: '#22c55e',
  PaymentCredit: '#00b0ff',
  PaymentStoredValue: '#bb86fc',
};

export function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function shiftDate(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function getPaymentDateBounds(payments: PaymentRecord[]): { min: string; max: string } | null {
  if (!payments.length) return null;
  let min = payments[0].date;
  let max = payments[0].date;
  for (const p of payments) {
    if (p.date < min) min = p.date;
    if (p.date > max) max = p.date;
  }
  return { min, max };
}

export function filterPayments(
  payments: PaymentRecord[],
  mode: 'day' | 'range',
  dayDate: string,
  rangeStart: string,
  rangeEnd: string,
): PaymentRecord[] {
  if (mode === 'day') {
    return payments.filter((p) => p.date === dayDate);
  }
  return payments.filter((p) => p.date >= rangeStart && p.date <= rangeEnd);
}

export function aggregateByPaymentType(payments: PaymentRecord[]) {
  const map = new Map<PaymentTypeKey, { amount: number; transactions: number }>();
  for (const p of payments) {
    const entry = map.get(p.paymentType) || { amount: 0, transactions: 0 };
    entry.amount += p.amount;
    entry.transactions += p.transactions;
    map.set(p.paymentType, entry);
  }
  return (['PaymentCash', 'PaymentCredit', 'PaymentStoredValue'] as PaymentTypeKey[])
    .map((paymentType) => ({
      paymentType,
      label: PAYMENT_TYPE_LABELS[paymentType],
      amount: map.get(paymentType)?.amount ?? 0,
      transactions: map.get(paymentType)?.transactions ?? 0,
    }))
    .filter((d) => d.amount > 0 || d.transactions > 0);
}

export function aggregateByName(payments: PaymentRecord[]) {
  const map = new Map<string, { amount: number; transactions: number; paymentType: PaymentTypeKey }>();
  for (const p of payments) {
    const entry = map.get(p.name) || { amount: 0, transactions: 0, paymentType: p.paymentType };
    entry.amount += p.amount;
    entry.transactions += p.transactions;
    map.set(p.name, entry);
  }
  return Array.from(map.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.amount - a.amount);
}

export function aggregateDailyByType(payments: PaymentRecord[]) {
  const map = new Map<string, Record<PaymentTypeKey, number>>();
  for (const p of payments) {
    const entry = map.get(p.date) || {
      PaymentCash: 0,
      PaymentCredit: 0,
      PaymentStoredValue: 0,
    };
    entry[p.paymentType] += p.amount;
    map.set(p.date, entry);
  }
  return Array.from(map.entries())
    .map(([date, amounts]) => ({
      date,
      cash: amounts.PaymentCash,
      credit: amounts.PaymentCredit,
      storedValue: amounts.PaymentStoredValue,
      total: amounts.PaymentCash + amounts.PaymentCredit + amounts.PaymentStoredValue,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
