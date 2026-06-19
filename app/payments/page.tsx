'use client';

import { useMemo, Suspense, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { usePayments } from '@/hooks/useTransactions';
import {
  PaymentDailyTrendChart,
  PaymentNamePieChart,
} from '@/components/dashboard/PaymentBreakdownChart';
import {
  aggregateByName,
  aggregateDailyByType,
  filterPayments,
  getPaymentDateBounds,
  getYesterday,
  shiftDate,
  PAYMENT_TYPE_COLORS,
  PAYMENT_TYPE_LABELS,
} from '@/lib/payments';
import { formatCurrency, formatNumber } from '@/lib/format';
import { useUrlPaymentsState } from '@/hooks/useUrlFilters';
import { buildPaymentsSummary } from '@/lib/build-data-summary';
import { useDataContext } from '@/context/DataContext';

export default function PaymentsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-secondary animate-pulse text-lg">Loading payment data...</div>
      </div>
    }>
      <PaymentsContent />
    </Suspense>
  );
}

function PaymentsContent() {
  const { setDataSummary } = useDataContext();
  const { payments, loading } = usePayments();

  const defaultRangeEnd = getYesterday();
  const defaultRangeStart = (() => {
    const start = new Date(defaultRangeEnd + 'T00:00:00');
    start.setDate(start.getDate() - 6);
    return start.toISOString().slice(0, 10);
  })();

  const {
    mode,
    dayDate,
    rangeStart,
    rangeEnd,
    setMode,
    setDayDate,
    setRange,
  } = useUrlPaymentsState({
    mode: 'day',
    dayDate: defaultRangeEnd,
    rangeStart: defaultRangeStart,
    rangeEnd: defaultRangeEnd,
  });

  const filtered = useMemo(
    () => filterPayments(payments, mode, dayDate, rangeStart, rangeEnd),
    [payments, mode, dayDate, rangeStart, rangeEnd],
  );

  const byName = useMemo(() => aggregateByName(filtered), [filtered]);
  const dailyTrend = useMemo(() => aggregateDailyByType(filtered), [filtered]);

  const cashKpi = useMemo(() => {
    const row = byName.find((d) => d.name === 'Cash');
    return { amount: row?.amount ?? 0, transactions: row?.transactions ?? 0 };
  }, [byName]);

  const creditKpi = useMemo(() => {
    return byName
      .filter((d) => d.paymentType === 'PaymentCredit')
      .reduce(
        (acc, row) => ({
          amount: acc.amount + row.amount,
          transactions: acc.transactions + row.transactions,
        }),
        { amount: 0, transactions: 0 },
      );
  }, [byName]);

  const cashSideNames = useMemo(
    () => byName.filter((d) => d.paymentType === 'PaymentCash' || d.paymentType === 'PaymentStoredValue'),
    [byName],
  );

  const creditNames = useMemo(
    () => byName.filter((d) => d.paymentType === 'PaymentCredit'),
    [byName],
  );

  const totalAmount = useMemo(
    () => byName.reduce((sum, row) => sum + row.amount, 0),
    [byName],
  );

  const dateBounds = useMemo(() => getPaymentDateBounds(payments), [payments]);

  const canGoPrevDay = dateBounds ? dayDate > dateBounds.min : false;
  const canGoNextDay = dateBounds ? dayDate < dateBounds.max : false;

  const periodLabel = useMemo(() => {
    if (mode === 'day') return dayDate;
    if (rangeStart === rangeEnd) return rangeStart;
    return `${rangeStart} to ${rangeEnd}`;
  }, [mode, dayDate, rangeStart, rangeEnd]);

  const summaryText = useMemo(() => {
    if (loading || !payments.length) return '';
    return buildPaymentsSummary({
      periodLabel,
      cashAmount: cashKpi.amount,
      cashTransactions: cashKpi.transactions,
      creditAmount: creditKpi.amount,
      creditTransactions: creditKpi.transactions,
      totalAmount,
      topPayments: byName.map((r) => ({ name: r.name, amount: r.amount, transactions: r.transactions })),
    });
  }, [loading, payments.length, periodLabel, cashKpi, creditKpi, totalAmount, byName]);

  useEffect(() => {
    if (summaryText) setDataSummary(summaryText);
  }, [summaryText, setDataSummary]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-secondary animate-pulse text-lg">Loading payment data...</div>
      </div>
    );
  }

  if (!payments.length) {
    return (
      <main className="min-h-screen">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">Payments</h2>
          <p className="text-secondary">
            No payment data available. Run <code className="text-accent">python scripts/export_dashboards.py</code> to generate.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <Nav />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Payments</h2>
          <p className="text-secondary">
            How customers paid for the selected period. Totals reflect tender rung in at the POS.
          </p>
        </div>

        <div className="card p-4 sm:p-5">
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              type="button"
              onClick={() => setMode('day')}
              className={`px-4 py-2 rounded-full text-sm transition-colors ${
                mode === 'day'
                  ? 'bg-accent/15 text-accent'
                  : 'text-secondary hover:bg-overlay/5 hover:text-foreground'
              }`}
            >
              Day
            </button>
            <button
              type="button"
              onClick={() => setMode('range')}
              className={`px-4 py-2 rounded-full text-sm transition-colors ${
                mode === 'range'
                  ? 'bg-accent/15 text-accent'
                  : 'text-secondary hover:bg-overlay/5 hover:text-foreground'
              }`}
            >
              Custom Range
            </button>
          </div>

          {mode === 'day' ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-secondary">Date</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDayDate(shiftDate(dayDate, -1))}
                  disabled={!canGoPrevDay}
                  className="p-2 rounded-lg bg-overlay/5 text-secondary hover:bg-overlay/10 hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Previous day"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <input
                  id="payment-day"
                  type="date"
                  value={dayDate}
                  min={dateBounds?.min}
                  max={dateBounds?.max}
                  onChange={(e) => setDayDate(e.target.value)}
                  className="bg-background/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                />
                <button
                  type="button"
                  onClick={() => setDayDate(shiftDate(dayDate, 1))}
                  disabled={!canGoNextDay}
                  className="p-2 rounded-lg bg-overlay/5 text-secondary hover:bg-overlay/10 hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Next day"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-secondary" htmlFor="payment-start">
                From
              </label>
              <input
                id="payment-start"
                type="date"
                value={rangeStart}
                onChange={(e) => setRange(e.target.value, rangeEnd)}
                className="bg-background/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              />
              <label className="text-sm text-secondary" htmlFor="payment-end">
                To
              </label>
              <input
                id="payment-end"
                type="date"
                value={rangeEnd}
                onChange={(e) => setRange(rangeStart, e.target.value)}
                className="bg-background/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              />
            </div>
          )}

          <p className="text-xs text-muted mt-3">Showing {periodLabel}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="card p-5 sm:p-6">
            <p className="text-sm text-secondary mb-1">Cash</p>
            <p className="text-3xl sm:text-4xl font-bold text-gradient">
              {formatCurrency(cashKpi.amount)}
            </p>
            <p className="text-sm text-muted mt-2">
              {formatNumber(cashKpi.transactions)} payment{cashKpi.transactions === 1 ? '' : 's'}
            </p>
            <div
              className="h-1 rounded-full mt-4"
              style={{ background: PAYMENT_TYPE_COLORS.PaymentCash }}
            />
          </div>
          <div className="card p-5 sm:p-6">
            <p className="text-sm text-secondary mb-1">Credit / Card</p>
            <p className="text-3xl sm:text-4xl font-bold text-gradient">
              {formatCurrency(creditKpi.amount)}
            </p>
            <p className="text-sm text-muted mt-2">
              {formatNumber(creditKpi.transactions)} payment{creditKpi.transactions === 1 ? '' : 's'}
            </p>
            <div
              className="h-1 rounded-full mt-4"
              style={{ background: PAYMENT_TYPE_COLORS.PaymentCredit }}
            />
          </div>
        </div>

        <div className="card p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-secondary">Total Tender</p>
            <p className="text-xl font-bold text-foreground">{formatCurrency(totalAmount)}</p>
          </div>
          <p className="text-sm text-muted">{periodLabel}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <PaymentNamePieChart
            title="Cash & Check"
            subtitle="Non-card tenders by payment name"
            data={cashSideNames}
          />
          <PaymentNamePieChart
            title="Credit & Card"
            subtitle="Card and credit tenders by payment name"
            data={creditNames}
          />
        </div>

        {mode === 'range' && <PaymentDailyTrendChart data={dailyTrend} />}

        <div className="card p-6">
          <h3 className="text-lg font-semibold text-foreground mb-1">Payment Detail</h3>
          <p className="text-sm text-muted mb-6">Breakdown by card brand or tender name</p>
          {byName.length === 0 ? (
            <p className="text-secondary text-sm">No payments for the selected period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-border">
                    <th className="py-3 pr-4 font-medium">Name</th>
                    <th className="py-3 pr-4 font-medium">Type</th>
                    <th className="py-3 pr-4 font-medium text-right">Amount</th>
                    <th className="py-3 font-medium text-right">Payments</th>
                  </tr>
                </thead>
                <tbody>
                  {byName.map((row) => (
                    <tr key={row.name} className="border-b border-border/60">
                      <td className="py-3 pr-4 text-foreground">{row.name}</td>
                      <td className="py-3 pr-4 text-secondary">
                        {PAYMENT_TYPE_LABELS[row.paymentType]}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-foreground">
                        {formatCurrency(row.amount)}
                      </td>
                      <td className="py-3 text-right font-mono text-secondary">
                        {formatNumber(row.transactions)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
