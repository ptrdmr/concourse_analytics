'use client';

import { useMemo, useState } from 'react';
import type { ServiceChargeTab } from '@/types';
import { TYPE_COLORS } from '@/lib/reservations';

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function chargeLabel(name: string): string {
  if (name === 'VIP Service Charge') return 'VIP';
  if (name === 'Party Service Charge') return 'Party';
  if (name === '15% Service Charge') return '15%';
  if (name === 'Jr. Strikers Service Charge') return 'Jr. Strikers';
  return name.replace(/ Service Charge$/, '') || name;
}

function chargeBucket(name: string): 'vip' | 'party' | 'other' {
  if (name === 'VIP Service Charge') return 'vip';
  if (name === 'Party Service Charge') return 'party';
  return 'other';
}

function partyTypeLabel(tab: ServiceChargeTab): string {
  return tab.partyTypes.length ? tab.partyTypes.join(' + ') : 'Unclassified';
}

function typeColor(label: string): string {
  const first = label.split(' + ')[0];
  return TYPE_COLORS[first] ?? '#a3a3a3';
}

function formatWhen(tab: ServiceChargeTab): string {
  const [y, m, d] = tab.date.split('-').map(Number);
  const date = y && m && d
    ? new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : tab.date;
  return tab.time ? `${date} ${tab.time}` : date;
}

interface PartyGroup {
  key: string;
  label: string;
  unnamed: boolean;
  tabs: ServiceChargeTab[];
  total: number;
}

function groupParties(tabs: ServiceChargeTab[]): PartyGroup[] {
  const groups = new Map<string, PartyGroup>();
  for (const tab of tabs) {
    const unnamed = !tab.party;
    const key = unnamed ? `txn:${tab.txnId}` : tab.party!.trim().toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: unnamed ? 'No account on tab' : tab.party!,
        unnamed,
        tabs: [],
        total: 0,
      };
      groups.set(key, group);
    }
    group.tabs.push(tab);
    group.total = round2(group.total + tab.serviceCharge);
  }
  for (const group of groups.values()) {
    group.tabs.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.txnId.localeCompare(b.txnId));
  }
  return [...groups.values()].sort((a, b) => {
    const aLast = a.tabs[a.tabs.length - 1];
    const bLast = b.tabs[b.tabs.length - 1];
    return bLast.date.localeCompare(aLast.date) || bLast.time.localeCompare(aLast.time) || b.label.localeCompare(a.label);
  });
}

export function ServiceChargePanel({ tabs }: { tabs: ServiceChargeTab[] }) {
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const summary = useMemo(() => {
    let vip = 0;
    let party = 0;
    let other = 0;
    const names = new Set<string>();
    let unnamed = 0;
    for (const tab of tabs) {
      const bucket = chargeBucket(tab.chargeType);
      if (bucket === 'vip') vip += tab.serviceCharge;
      else if (bucket === 'party') party += tab.serviceCharge;
      else other += tab.serviceCharge;
      if (tab.party) names.add(tab.party.trim().toLowerCase());
      else unnamed += 1;
    }
    return {
      total: round2(vip + party + other),
      parties: names.size + unnamed,
      vip: round2(vip),
      party: round2(party),
      other: round2(other),
      noAccount: unnamed,
    };
  }, [tabs]);

  const byType = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const tab of tabs) {
      const label = partyTypeLabel(tab);
      const row = map.get(label) ?? { count: 0, total: 0 };
      row.count += 1;
      row.total = round2(row.total + tab.serviceCharge);
      map.set(label, row);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
  }, [tabs]);

  const byServer = useMemo(() => {
    const map = new Map<string, { display: Map<string, number>; parties: Set<string>; total: number }>();
    for (const tab of tabs) {
      const raw = tab.server.trim() || '(no server)';
      const key = raw.toLowerCase();
      let row = map.get(key);
      if (!row) {
        row = { display: new Map(), parties: new Set(), total: 0 };
        map.set(key, row);
      }
      row.display.set(raw, (row.display.get(raw) ?? 0) + 1);
      row.parties.add(tab.party ? tab.party.trim().toLowerCase() : `txn:${tab.txnId}`);
      row.total = round2(row.total + tab.serviceCharge);
    }
    return [...map.values()]
      .map((row) => ({
        name: [...row.display.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
        parties: row.parties.size,
        total: row.total,
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [tabs]);

  const visible = typeFilter ? tabs.filter((tab) => partyTypeLabel(tab) === typeFilter) : tabs;
  const groups = useMemo(() => groupParties(visible), [visible]);

  if (!tabs.length) {
    return <p className="text-secondary">No service charges in this period.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <SummaryCard label="Service charges" value={money(summary.total)} />
        <SummaryCard label="Parties" value={String(summary.parties)} />
        <SummaryCard label="VIP" value={money(summary.vip)} />
        <SummaryCard label="Party" value={money(summary.party)} />
        <SummaryCard label="Other" value={money(summary.other)} />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg sm:text-xl font-semibold text-foreground">By party type</h2>
        <div className="card p-4 sm:p-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted text-left">
                <th className="font-medium pb-2">Type</th>
                <th className="font-medium pb-2 text-right">Parties</th>
                <th className="font-medium pb-2 text-right">Service charge</th>
              </tr>
            </thead>
            <tbody>
              {byType.map(([label, row]) => {
                const selected = typeFilter === label;
                return (
                  <tr key={label} className="border-t border-border/60">
                    <td className="py-1.5">
                      <button
                        type="button"
                        onClick={() => setTypeFilter(selected ? null : label)}
                        className={`inline-flex items-center gap-2 text-left ${selected ? 'text-accent' : 'text-foreground hover:text-accent'}`}
                        aria-pressed={selected}
                      >
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: typeColor(label) }}
                        />
                        {label}
                      </button>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{row.count}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(row.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {typeFilter && (
            <button
              type="button"
              onClick={() => setTypeFilter(null)}
              className="mt-3 text-xs text-accent hover:underline"
            >
              Show all party types
            </button>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg sm:text-xl font-semibold text-foreground">Parties</h2>
          {typeFilter && <span className="text-sm text-secondary">{typeFilter}</span>}
        </div>
        {!groups.length ? (
          <p className="text-secondary">No parties of this type in this period.</p>
        ) : (
          <div className="card p-4 sm:p-5 overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-xs text-muted text-left">
                  <th className="font-medium pb-2">Party</th>
                  <th className="font-medium pb-2">Type</th>
                  <th className="font-medium pb-2">When</th>
                  <th className="font-medium pb-2">Server</th>
                  <th className="font-medium pb-2">Terminal</th>
                  <th className="font-medium pb-2">Charge</th>
                  <th className="font-medium pb-2 text-right">Service charge</th>
                  <th className="font-medium pb-2 text-right">Gratuity</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <PartyRows key={group.key} group={group} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg sm:text-xl font-semibold text-foreground">By server</h2>
        <div className="card p-4 sm:p-5 max-w-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted text-left">
                <th className="font-medium pb-2">Server</th>
                <th className="font-medium pb-2 text-right">Parties</th>
                <th className="font-medium pb-2 text-right">Service charge</th>
              </tr>
            </thead>
            <tbody>
              {byServer.map((row) => (
                <tr key={row.name} className="border-t border-border/60">
                  <td className="py-1.5 text-foreground">{row.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.parties}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted leading-relaxed max-w-3xl">
        Service charges are credited to the server who owned the tab, not to the tip pool.
        The party name is the POS account on the tab, with the event date removed.
        Cancelled tabs are excluded.
        {summary.noAccount > 0 && (
          <>
            {' '}
            {summary.noAccount} tab{summary.noAccount === 1 ? '' : 's'} in this period had no account
            line, so the party name is missing.
          </>
        )}
      </p>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="text-xl font-semibold text-foreground mt-1">{value}</p>
    </div>
  );
}

function PartyRows({ group }: { group: PartyGroup }) {
  return (
    <>
      {group.tabs.map((tab) => (
        <tr key={tab.txnId} className="border-t border-border/60">
          <td className="py-1.5 text-foreground" title={tab.accountNames.length > 1 ? tab.accountNames.join(' / ') : undefined}>
            {group.unnamed ? 'No account on tab' : group.label}
          </td>
          <td className="py-1.5">
            <span className="inline-flex items-center gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: typeColor(partyTypeLabel(tab)) }}
              />
              {partyTypeLabel(tab)}
            </span>
          </td>
          <td className="py-1.5 whitespace-nowrap">{formatWhen(tab)}</td>
          <td className="py-1.5">{tab.server || '—'}</td>
          <td className="py-1.5">{tab.terminal || '—'}</td>
          <td className="py-1.5">{chargeLabel(tab.chargeType)}</td>
          <td className="py-1.5 text-right tabular-nums">{money(tab.serviceCharge)}</td>
          <td className="py-1.5 text-right tabular-nums">{money(tab.gratuity)}</td>
        </tr>
      ))}
      {group.tabs.length > 1 && (
        <tr className="border-t border-border">
          <td className="py-1.5 text-secondary" colSpan={6}>
            {group.label} · {group.tabs.length} tabs
          </td>
          <td className="py-1.5 text-right tabular-nums text-accent">{money(group.total)}</td>
          <td className="py-1.5 text-right tabular-nums text-secondary">
            {money(round2(group.tabs.reduce((sum, tab) => sum + tab.gratuity, 0)))}
          </td>
        </tr>
      )}
    </>
  );
}
