'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { Nav } from '@/components/Nav';
import { useTicketMonths, useTicketDetail } from '@/hooks/useTickets';
import type { Ticket, TicketLineItem } from '@/types';
import { X, Receipt, ChevronDown, ChevronUp } from 'lucide-react';
import { buildTicketsSummary } from '@/lib/build-data-summary';
import { useDataContext } from '@/context/DataContext';

const PAGE_SIZE = 50;

function formatMonthLabel(ym: string): string {
  if (ym === 'unknown') return 'Unknown date';
  if (!ym || ym.length < 7) return ym;
  const y = Number(ym.slice(0, 4));
  const mo = Number(ym.slice(5, 7));
  if (!y || !mo) return ym;
  return new Date(y, mo - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function primaryDeptFromItems(ticket: Ticket): string {
  const counts = new Map<string, number>();
  for (const line of ticket.items) {
    const d = line.dept?.trim();
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function lineAmount(line: TicketLineItem): number {
  if (line.total !== 0) return line.total;
  const q = line.qty || 0;
  return q ? line.unitAmount * q : line.unitAmount;
}

function receiptSections(ticket: Ticket) {
  const items = ticket.items;
  const subtotalTypes = new Set(['Product', 'Modifier', 'Package']);
  let subtotal = 0;
  const adjustments: TicketLineItem[] = [];
  const taxLines: TicketLineItem[] = [];
  const gratuity: TicketLineItem[] = [];
  const payments: TicketLineItem[] = [];
  const cancels: TicketLineItem[] = [];

  for (const line of items) {
    const t = line.itemType;
    if (subtotalTypes.has(t)) {
      subtotal += lineAmount(line);
    } else if (t === 'Adjustment') {
      adjustments.push(line);
    } else if (t === 'Tax') {
      taxLines.push(line);
    } else if (t === 'GratuityIn') {
      gratuity.push(line);
    } else if (t === 'PaymentCredit' || t === 'PaymentCash' || t === 'PaymentStoredValue' || t === 'Account') {
      payments.push(line);
    } else if (t === 'Cancel') {
      cancels.push(line);
    }
  }

  return { subtotal, adjustments, taxLines, gratuity, payments, cancels };
}

function TicketReceipt({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { subtotal, adjustments, taxLines, gratuity, payments, cancels } = receiptSections(ticket);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-title"
    >
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-2xl animate-fade-in"
      >
        <div className="sticky top-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-[#0d0d0d]/95 backdrop-blur z-10">
          <div className="flex items-center gap-2 text-accent">
            <Receipt className="w-5 h-5 shrink-0" />
            <span id="receipt-title" className="font-semibold text-sm">
              Receipt
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-secondary hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 text-sm">
          <div className="text-center space-y-1 border-b border-border pb-4">
            <p className="text-xs tracking-[0.2em] text-secondary uppercase">Concourse Bowl Bar Grill</p>
            <p className="text-lg font-semibold text-white">Ticket #{ticket.txnId}</p>
            <p className="text-secondary">
              {ticket.date} · {ticket.time}
              {ticket.closedTime ? ` · Closed ${ticket.closedTime}` : ''}
            </p>
            <p className="text-secondary">
              Server {ticket.user} · {ticket.terminal} · {ticket.type}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Items</p>
            {ticket.items.map((line) => {
              const t = line.itemType;
              if (t !== 'Product' && t !== 'Modifier' && t !== 'Package') {
                return null;
              }
              const isChild = t === 'Modifier' && line.parentItemId != null;
              const amt = lineAmount(line);
              return (
                <div
                  key={line.itemId}
                  className={`flex justify-between gap-3 text-foreground ${isChild ? 'pl-4 border-l-2 border-accent/30' : ''}`}
                >
                  <span className={`min-w-0 ${isChild ? 'text-secondary text-xs' : ''}`}>
                    {line.qty > 1 && !isChild ? (
                      <span className="text-muted mr-1">{line.qty}×</span>
                    ) : null}
                    {line.name}
                    {isChild ? (
                      <span className="text-muted ml-1 text-[10px]">(modifier)</span>
                    ) : null}
                  </span>
                  <span className="font-mono tabular-nums shrink-0 text-xs sm:text-sm">
                    {amt !== 0 ? amt.toFixed(2) : '—'}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="border-t border-border pt-3 space-y-2 font-mono text-sm">
            <div className="flex justify-between text-secondary">
              <span>Subtotal</span>
              <span className="tabular-nums">{subtotal.toFixed(2)}</span>
            </div>
            {(adjustments.length > 0 || cancels.length > 0) && (
              <div className="space-y-1">
                <p className="text-xs text-muted uppercase tracking-wide">Adjustments</p>
                {adjustments.map((a) => (
                  <div key={a.itemId} className="flex justify-between gap-2 text-xs">
                    <span className="text-secondary truncate min-w-0">{a.name}</span>
                    <span className="tabular-nums shrink-0">{lineAmount(a).toFixed(2)}</span>
                  </div>
                ))}
                {cancels.map((c) => (
                  <div key={c.itemId} className="flex justify-between gap-2 text-xs">
                    <span className="text-secondary truncate min-w-0">Cancel · {c.name}</span>
                    <span className="tabular-nums shrink-0">{lineAmount(c).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
            {taxLines.map((t) => (
              <div key={t.itemId} className="flex justify-between text-secondary">
                <span>Tax{t.name ? ` · ${t.name}` : ''}</span>
                <span className="tabular-nums">{lineAmount(t).toFixed(2)}</span>
              </div>
            ))}
            {gratuity.map((g) => (
              <div key={g.itemId} className="flex justify-between text-secondary">
                <span>Gratuity{g.name ? ` · ${g.name}` : ''}</span>
                <span className="tabular-nums">{lineAmount(g).toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between text-lg font-semibold text-white pt-2 border-t border-border">
              <span>Total</span>
              <span className="tabular-nums">{ticket.total.toFixed(2)}</span>
            </div>
          </div>

          {payments.length > 0 && (
            <div className="border-t border-border pt-3 space-y-1">
              <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Payment</p>
              {payments.map((p) => (
                <div key={p.itemId} className="flex justify-between gap-2 text-sm">
                  <span className="text-secondary">
                    {p.itemType}
                    {p.name ? ` · ${p.name}` : ''}
                  </span>
                  <span className="font-mono tabular-nums">{lineAmount(p).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type SortKey = 'date' | 'total';

export default function TicketsPage() {
  const { setDataSummary } = useDataContext();
  const { months, loading: monthsLoading } = useTicketMonths();
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const resolvedMonth =
    selectedMonth ?? (months.length > 0 ? months[months.length - 1] : null);

  const { tickets: monthTickets, loading: detailLoading } = useTicketDetail(resolvedMonth);

  const [txnSearch, setTxnSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [userFilter, setUserFilter] = useState('');
  const [terminalFilter, setTerminalFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Ticket | null>(null);

  useEffect(() => {
    setTxnSearch('');
    setDeptFilter('All');
    setUserFilter('');
    setTerminalFilter('All');
    setDateFrom('');
    setDateTo('');
    setVisible(PAGE_SIZE);
    setSelected(null);
  }, [resolvedMonth]);

  const enriched = useMemo(
    () =>
      monthTickets.map((t) => ({
        ticket: t,
        primaryDept: primaryDeptFromItems(t),
      })),
    [monthTickets]
  );

  const departments = useMemo(() => {
    const s = new Set<string>();
    for (const { primaryDept } of enriched) {
      if (primaryDept) s.add(primaryDept);
    }
    return ['All', ...Array.from(s).sort((a, b) => a.localeCompare(b))];
  }, [enriched]);

  const terminals = useMemo(() => {
    const s = new Set<string>();
    for (const { ticket } of enriched) {
      const t = ticket.terminal?.trim();
      if (t) s.add(t);
    }
    return ['All', ...Array.from(s).sort((a, b) => a.localeCompare(b))];
  }, [enriched]);

  const dateRange = useMemo(() => {
    if (enriched.length === 0) return { min: '', max: '' };
    let min = enriched[0].ticket.date;
    let max = enriched[0].ticket.date;
    for (const { ticket } of enriched) {
      if (ticket.date < min) min = ticket.date;
      if (ticket.date > max) max = ticket.date;
    }
    return { min, max };
  }, [enriched]);

  const filtered = useMemo(() => {
    let rows = enriched;
    const q = txnSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => r.ticket.txnId.toLowerCase().includes(q));
    }
    if (deptFilter && deptFilter !== 'All') {
      rows = rows.filter((r) => r.primaryDept === deptFilter);
    }
    const uq = userFilter.trim().toLowerCase();
    if (uq) {
      rows = rows.filter((r) => r.ticket.user.toLowerCase().includes(uq));
    }
    if (terminalFilter && terminalFilter !== 'All') {
      rows = rows.filter((r) => r.ticket.terminal === terminalFilter);
    }
    if (dateFrom) {
      rows = rows.filter((r) => r.ticket.date >= dateFrom);
    }
    if (dateTo) {
      rows = rows.filter((r) => r.ticket.date <= dateTo);
    }
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'date') {
        const da = `${a.ticket.date}T${a.ticket.time || '00:00'}`;
        const db = `${b.ticket.date}T${b.ticket.time || '00:00'}`;
        cmp = da.localeCompare(db);
      } else {
        cmp = a.ticket.total - b.ticket.total;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [enriched, txnSearch, deptFilter, userFilter, terminalFilter, dateFrom, dateTo, sortKey, sortDir]);

  const pageRows = useMemo(() => filtered.slice(0, visible), [filtered, visible]);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('desc');
      return key;
    });
  }, []);

  const summaryText = useMemo(() => {
    if (monthsLoading || detailLoading) return '';
    return buildTicketsSummary({
      month: resolvedMonth,
      monthLabel: resolvedMonth ? formatMonthLabel(resolvedMonth) : '',
      ticketCount: monthTickets.length,
      filteredCount: filtered.length,
      departments: departments.filter((d) => d !== 'All'),
    });
  }, [monthsLoading, detailLoading, resolvedMonth, monthTickets.length, filtered.length, departments]);

  useEffect(() => {
    if (summaryText) setDataSummary(summaryText);
  }, [summaryText, setDataSummary]);

  if (monthsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-secondary animate-pulse text-lg mb-2">Loading ticket months…</div>
          <p className="text-sm text-muted">Preparing month list</p>
        </div>
      </div>
    );
  }

  if (months.length === 0) {
    return (
      <main className="min-h-screen pb-16">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <h1 className="text-2xl font-bold text-gradient">Ticket Lookup</h1>
          <p className="text-secondary mt-2">No ticket month files found. Run the export script to generate data.</p>
        </div>
      </main>
    );
  }

  const loadingMonthLabel = resolvedMonth ? formatMonthLabel(resolvedMonth) : '';

  return (
    <main className="min-h-screen pb-16">
      <Nav />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gradient">Ticket Lookup</h1>
          <p className="text-secondary text-sm mt-1">
            Choose a month, then search by transaction ID, department, or server. Click a row for the full receipt.
          </p>
        </div>

        <div className="card p-4 sm:p-5">
          <label className="flex flex-col gap-1.5 text-xs text-muted max-w-xs">
            Month
            <select
              value={resolvedMonth ?? ''}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-lg bg-black/40 border border-border px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {months.map((ym) => (
                <option key={ym} value={ym}>
                  {formatMonthLabel(ym)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {detailLoading && (
          <div className="card p-8 text-center">
            <div className="text-secondary animate-pulse text-lg mb-2">
              Loading tickets for {loadingMonthLabel}…
            </div>
            <p className="text-sm text-muted">Fetching monthly receipt data</p>
          </div>
        )}

        {!detailLoading && resolvedMonth && (
          <>
            <div className="card p-4 sm:p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  From Date
                  <input
                    type="date"
                    value={dateFrom}
                    min={dateRange.min}
                    max={dateTo || dateRange.max}
                    onChange={(e) => {
                      setDateFrom(e.target.value);
                      setVisible(PAGE_SIZE);
                    }}
                    className="rounded-lg bg-black/40 border border-border px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  To Date
                  <input
                    type="date"
                    value={dateTo}
                    min={dateFrom || dateRange.min}
                    max={dateRange.max}
                    onChange={(e) => {
                      setDateTo(e.target.value);
                      setVisible(PAGE_SIZE);
                    }}
                    className="rounded-lg bg-black/40 border border-border px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Terminal
                  <select
                    value={terminalFilter}
                    onChange={(e) => {
                      setTerminalFilter(e.target.value);
                      setVisible(PAGE_SIZE);
                    }}
                    className="rounded-lg bg-black/40 border border-border px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    {terminals.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Transaction ID
                  <input
                    type="search"
                    value={txnSearch}
                    onChange={(e) => {
                      setTxnSearch(e.target.value);
                      setVisible(PAGE_SIZE);
                    }}
                    placeholder="Partial match"
                    className="rounded-lg bg-black/40 border border-border px-3 py-2 text-sm text-white placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Department
                  <select
                    value={deptFilter}
                    onChange={(e) => {
                      setDeptFilter(e.target.value);
                      setVisible(PAGE_SIZE);
                    }}
                    className="rounded-lg bg-black/40 border border-border px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Server (partial)
                  <input
                    type="search"
                    value={userFilter}
                    onChange={(e) => {
                      setUserFilter(e.target.value);
                      setVisible(PAGE_SIZE);
                    }}
                    placeholder="e.g. Mike"
                    className="rounded-lg bg-black/40 border border-border px-3 py-2 text-sm text-white placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </label>
              </div>
              <p className="text-xs text-muted">
                Showing {Math.min(visible, filtered.length)} of {filtered.length.toLocaleString()} matches in{' '}
                {loadingMonthLabel}
                {filtered.length !== enriched.length
                  ? ` (${enriched.length.toLocaleString()} tickets in month)`
                  : ''}
              </p>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-white/[0.03] text-secondary border-b border-border">
                    <tr>
                      <th className="px-4 py-3 font-medium">Transaction ID</th>
                      <th className="px-4 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => toggleSort('date')}
                          className="inline-flex items-center gap-1 hover:text-accent transition-colors"
                        >
                          Date / Time
                          {sortKey === 'date' ? (
                            sortDir === 'desc' ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronUp className="w-4 h-4" />
                            )
                          ) : null}
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium text-right">
                        <button
                          type="button"
                          onClick={() => toggleSort('total')}
                          className="inline-flex items-center gap-1 ml-auto hover:text-accent transition-colors"
                        >
                          Total
                          {sortKey === 'total' ? (
                            sortDir === 'desc' ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronUp className="w-4 h-4" />
                            )
                          ) : null}
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">Department</th>
                      <th className="px-4 py-3 font-medium">Terminal</th>
                      <th className="px-4 py-3 font-medium text-right">Items</th>
                      <th className="px-4 py-3 font-medium">Server</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(({ ticket: row, primaryDept }) => (
                      <tr
                        key={row.txnId}
                        onClick={() => setSelected(row)}
                        className={`border-b border-border/80 cursor-pointer transition-colors ${
                          selected?.txnId === row.txnId ? 'bg-accent/10' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        <td className="px-4 py-2.5 font-mono text-xs sm:text-sm">{row.txnId}</td>
                        <td className="px-4 py-2.5 text-secondary whitespace-nowrap">
                          {row.date} {row.time}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{row.total.toFixed(2)}</td>
                        <td className="px-4 py-2.5 max-w-[140px] truncate" title={primaryDept}>
                          {primaryDept || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-secondary text-xs whitespace-nowrap">{row.terminal}</td>
                        <td className="px-4 py-2.5 text-right">{row.items.length}</td>
                        <td className="px-4 py-2.5 max-w-[120px] truncate" title={row.user}>
                          {row.user}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {visible < filtered.length && (
                <div className="p-4 border-t border-border flex justify-center">
                  <button
                    type="button"
                    onClick={() => setVisible((v) => v + PAGE_SIZE)}
                    className="px-4 py-2 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 text-sm font-medium transition-colors"
                  >
                    Load more ({(filtered.length - visible).toLocaleString()} remaining)
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {selected && <TicketReceipt ticket={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}
