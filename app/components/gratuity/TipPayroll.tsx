'use client';

import { useMemo, useState } from 'react';
import { addDays, buildWorksheet, classifyDay, latestWorkedDay, payPeriodOf } from '@/lib/tips/engine';
import type { DayDecisions, DayState, TipMonthFile } from '@/lib/tips/types';
import { useTipDecisions, useTipMonths } from '@/hooks/useTipFacts';

const RANGE_CAP = 62;

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function shortDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
}

function longDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function eachDay(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to && out.length < RANGE_CAP) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

function monthsInRange(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  let cursor = from.slice(0, 7);
  const end = to.slice(0, 7);
  while (cursor <= end && out.length < 6) {
    out.push(cursor);
    const [year, month] = cursor.split('-').map(Number);
    cursor = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  }
  return out;
}

const STATE_LABEL: Record<DayState, string> = {
  processed: 'Closed',
  nothing: 'No tips',
  'not-closed': 'Not closed',
  changed: 'Changed',
  'no-data': 'No data',
};

function countsAsProcessed(state: DayState): boolean {
  return state === 'processed' || state === 'nothing';
}

interface Cell {
  service: number;
  gratuity: number;
}

interface Column {
  date: string;
  state: DayState;
  people: Map<string, Cell & { name: string }>;
}

function columnFor(day: string, files: TipMonthFile[], decisions: Record<string, DayDecisions>): Column {
  const file = files.find((item) => item.month === day.slice(0, 7));
  if (!file?.rules) return { date: day, state: 'no-data', people: new Map() };
  const lastWorked = latestWorkedDay(file.days);
  const facts = file.days[day];
  const saved = decisions[day] ?? null;
  if (!facts) {
    return {
      date: day,
      state: classifyDay({
        date: day,
        monthLoaded: true,
        lastWorked,
        dayInFile: false,
        worksheet: null,
        decisions: saved,
      }),
      people: new Map(),
    };
  }
  const worksheet = buildWorksheet(day, facts, file.directory, file.rules, saved);
  const state = classifyDay({
    date: day,
    monthLoaded: true,
    lastWorked,
    dayInFile: true,
    worksheet,
    decisions: saved,
  });
  const people = new Map<string, Cell & { name: string }>();
  if (countsAsProcessed(state)) {
    for (const person of worksheet.people) {
      people.set(person.employeeId, {
        name: person.name,
        service: person.serviceChargeCents,
        gratuity: person.gratuityCents,
      });
    }
  }
  return { date: day, state, people };
}

export function TipPayroll({ onOpenDay, passcode }: { onOpenDay: (day: string) => void; passcode: string }) {
  const initial = payPeriodOf(todayIso());
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const days = useMemo(() => eachDay(start, end), [start, end]);
  const months = useTipMonths(useMemo(() => monthsInRange(start, end), [start, end]), passcode);
  const decisions = useTipDecisions(days[0] ?? '', days[days.length - 1] ?? '', passcode);
  const rules = months.files[months.files.length - 1]?.rules ?? months.files[0]?.rules;

  const table = useMemo(() => {
    const columns = days.map((day) => columnFor(day, months.files, decisions.days));
    const rows = new Map<string, { name: string; cells: Record<string, Cell> }>();
    for (const column of columns) {
      if (!countsAsProcessed(column.state)) continue;
      for (const [id, cell] of column.people) {
        const row = rows.get(id) ?? { name: cell.name, cells: {} };
        row.cells[column.date] = { service: cell.service, gratuity: cell.gratuity };
        rows.set(id, row);
      }
    }
    return {
      columns,
      people: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [days, months.files, decisions.days]);

  const unprocessed = table.columns.filter((column) => !countsAsProcessed(column.state));
  const settled = !decisions.loading && !months.loading;
  const exportReady = settled && unprocessed.length === 0 && table.columns.length > 0;
  const capped = daysBetweenInclusive(start, end) > RANGE_CAP;

  function applyPeriod(which: 'this' | 'last') {
    const current = payPeriodOf(todayIso(), rules);
    if (which === 'this') {
      setFrom(current.from);
      setTo(current.to);
      return;
    }
    setFrom(addDays(current.from, -(rules?.payPeriodDays || 14)));
    setTo(addDays(current.from, -1));
  }

  function exportText(): string {
    const header = ['Employee', ...table.columns.map((column) => column.date), 'Total'];
    const lines = [header.join(',')];
    for (const person of table.people) {
      let total = 0;
      const cells = table.columns.map((column) => {
        const cell = person.cells[column.date];
        if (!cell || !countsAsProcessed(column.state)) return '';
        total += cell.service + cell.gratuity;
        return dollars(cell.service + cell.gratuity);
      });
      lines.push([csv(person.name), ...cells, dollars(total)].join(','));
    }
    return lines.join('\n');
  }

  function download() {
    const blob = new Blob([exportText()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tips-${start}-to-${end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(exportText());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => applyPeriod('this')} className="px-4 py-2 rounded-full text-sm bg-accent/15 text-accent">
            This pay period
          </button>
          <button type="button" onClick={() => applyPeriod('last')} className="px-4 py-2 rounded-full text-sm bg-overlay/5 text-foreground">
            Last pay period
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-secondary" htmlFor="payroll-from">From</label>
          <input
            id="payroll-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground"
          />
          <label className="text-sm text-secondary" htmlFor="payroll-to">To</label>
          <input
            id="payroll-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground"
          />
        </div>
        <div className="space-y-1">
          {(decisions.loading || months.loading) ? (
            <p className="text-sm text-secondary">Checking which days are closed…</p>
          ) : unprocessed.length === 0 ? (
            <p className="text-sm text-accent">All {table.columns.length} days processed.</p>
          ) : (
            <p className="text-sm text-amber-300">
              {unprocessed.length} of {table.columns.length} days are not processed:{' '}
              {unprocessed.map((column, index) => (
                <span key={column.date}>
                  {index > 0 ? ', ' : ''}
                  <button type="button" className="underline" onClick={() => onOpenDay(column.date)}>
                    {longDay(column.date)}
                  </button>
                  {' '}({STATE_LABEL[column.state]})
                </span>
              ))}
              .
            </p>
          )}
          <p className="text-xs text-muted">Unprocessed days are not included in the totals until they are processed.</p>
          {capped && <p className="text-xs text-muted">Showing the first {RANGE_CAP} days of this range.</p>}
          {decisions.note && <p className="text-sm text-amber-200/90">{decisions.note}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void copy()} disabled={!exportReady} className="px-4 py-2 rounded-full text-sm bg-overlay/5 text-foreground disabled:opacity-40">
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={download} disabled={!exportReady} className="px-4 py-2 rounded-full text-sm bg-overlay/5 text-foreground disabled:opacity-40">
            Download CSV
          </button>
          {!exportReady && <span className="text-xs text-muted">Export stays off until every day in the range is processed.</span>}
        </div>
      </div>

      {!settled ? (
        <p className="text-secondary">Loading payroll…</p>
      ) : (
        <div className="card p-4 sm:p-5 overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-xs text-muted text-left">
                <th className="font-medium pb-2">Employee</th>
                {table.columns.map((column) => (
                  <th key={column.date} className={`font-medium pb-2 text-right ${countsAsProcessed(column.state) ? '' : 'text-amber-300/80'}`}>
                    <button type="button" className="hover:text-foreground" onClick={() => onOpenDay(column.date)}>
                      {shortDay(column.date)}
                    </button>
                    <span className="block font-normal">{STATE_LABEL[column.state]}</span>
                  </th>
                ))}
                <th className="font-medium pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {table.people.length === 0 && (
                <tr>
                  <td colSpan={table.columns.length + 2} className="py-3 text-secondary">No processed tips in this range yet.</td>
                </tr>
              )}
              {table.people.map((person) => {
                let service = 0;
                let gratuity = 0;
                for (const column of table.columns) {
                  const cell = person.cells[column.date];
                  if (!cell) continue;
                  service += cell.service;
                  gratuity += cell.gratuity;
                }
                const open = Boolean(openRows[person.name]);
                return (
                  <tr key={person.name} className="border-t border-border/60">
                    <td className="py-2 text-foreground">
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => setOpenRows((prev) => ({ ...prev, [person.name]: !prev[person.name] }))}
                      >
                        {person.name}
                        <span className="block text-[10px] text-muted">{open ? 'Hide split' : 'Service charge and gratuity'}</span>
                      </button>
                    </td>
                    {table.columns.map((column) => {
                      if (!countsAsProcessed(column.state)) {
                        return <td key={column.date} className="py-2 text-right text-muted">—</td>;
                      }
                      const cell = person.cells[column.date];
                      if (!cell) return <td key={column.date} className="py-2 text-right text-muted">—</td>;
                      return (
                        <td key={column.date} className="py-2 text-right tabular-nums">
                          {money(cell.service + cell.gratuity)}
                          {open && (
                            <span className="block text-[10px] text-muted">
                              {money(cell.service)} sc · {money(cell.gratuity)} tip
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-2 text-right tabular-nums text-accent">
                      {money(service + gratuity)}
                      {open && (
                        <span className="block text-[10px] text-muted">
                          {money(service)} sc · {money(gratuity)} tip
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {table.people.length > 0 && (
              <tfoot>
                <tr className="border-t border-border text-foreground">
                  <td className="py-2 font-medium">Total</td>
                  {table.columns.map((column) => {
                    if (!countsAsProcessed(column.state)) return <td key={column.date} className="py-2 text-right text-muted">—</td>;
                    let sum = 0;
                    for (const person of table.people) {
                      const cell = person.cells[column.date];
                      if (cell) sum += cell.service + cell.gratuity;
                    }
                    return <td key={column.date} className="py-2 text-right tabular-nums font-medium">{money(sum)}</td>;
                  })}
                  <td className="py-2 text-right tabular-nums font-medium text-accent">
                    {money(table.people.reduce((sum, person) => {
                      return sum + table.columns.reduce((inner, column) => {
                        const cell = person.cells[column.date];
                        return inner + (cell ? cell.service + cell.gratuity : 0);
                      }, 0);
                    }, 0))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

function daysBetweenInclusive(from: string, to: string): number {
  const [fromYear, fromMonth, fromDate] = from.split('-').map(Number);
  const [toYear, toMonth, toDate] = to.split('-').map(Number);
  const span = Date.UTC(toYear, toMonth - 1, toDate) - Date.UTC(fromYear, fromMonth - 1, fromDate);
  return Math.round(span / 86400000) + 1;
}

function csv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
