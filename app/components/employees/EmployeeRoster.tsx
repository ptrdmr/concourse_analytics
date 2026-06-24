'use client';

import type { EmployeeRollup } from '@/types';
import { formatCurrency } from '@/lib/format';
import { ChevronRight } from 'lucide-react';

export type RosterSortKey = 'sales' | 'tipsPerHour' | 'salesPerHour' | 'hours' | 'name';

interface Props {
  rollups: EmployeeRollup[];
  selectedId: string | null;
  sortKey: RosterSortKey;
  onSelect: (id: string) => void;
}

function sortValue(r: EmployeeRollup, key: RosterSortKey): number | string {
  switch (key) {
    case 'sales':
      return r.sales;
    case 'tipsPerHour':
      return r.tipsPerHour ?? -1;
    case 'salesPerHour':
      return r.salesPerHour ?? -1;
    case 'hours':
      return r.hours;
    default:
      return r.displayName.toLowerCase();
  }
}

function metricLabel(r: EmployeeRollup, key: RosterSortKey): string {
  switch (key) {
    case 'sales':
      return formatCurrency(r.sales);
    case 'tipsPerHour':
      return r.tipsPerHour != null ? `${formatCurrency(r.tipsPerHour)}/hr` : '—';
    case 'salesPerHour':
      return r.salesPerHour != null ? `${formatCurrency(r.salesPerHour)}/hr` : '—';
    case 'hours':
      return `${r.hours.toFixed(0)} hrs`;
    default:
      return '';
  }
}

export function EmployeeRoster({ rollups, selectedId, sortKey, onSelect }: Props) {
  const sorted = [...rollups].sort((a, b) => {
    const av = sortValue(a, sortKey);
    const bv = sortValue(b, sortKey);
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv);
    return (bv as number) - (av as number);
  });

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-overlay/[0.03]">
        <h2 className="text-sm font-semibold text-foreground">Team roster</h2>
        <p className="text-xs text-muted mt-0.5">{sorted.length} employees in period</p>
      </div>
      <div className="max-h-[520px] overflow-y-auto divide-y divide-border/80">
        {sorted.map((r, idx) => {
          const active = r.employeeId === selectedId;
          return (
            <button
              key={r.employeeId}
              type="button"
              onClick={() => onSelect(r.employeeId)}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                active ? 'bg-accent/10' : 'hover:bg-overlay/[0.04]'
              }`}
            >
              <span className="text-xs text-muted w-5 shrink-0 tabular-nums">{idx + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{r.displayName}</p>
                <p className="text-xs text-secondary truncate">
                  {r.roles.length ? r.roles.join(', ') : 'POS only'}
                  {!r.laborLinked ? ' · no 7shifts link' : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-mono tabular-nums text-accent">{metricLabel(r, sortKey)}</p>
              </div>
              <ChevronRight className={`w-4 h-4 shrink-0 ${active ? 'text-accent' : 'text-muted'}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
