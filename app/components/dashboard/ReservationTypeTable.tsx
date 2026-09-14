'use client';

import { formatNumber } from '@/lib/format';
import {
  RESERVATION_GROUPS,
  formatPctChange,
  pctChange,
  type SeriesTotals,
  type WeeklyPoint,
} from '@/lib/reservations';

interface Props {
  weeks: WeeklyPoint[];
  types: string[];
  selectedGroupIds: string[];
  totals: SeriesTotals;
  distinctTabs: number;
  weekTabs?: Record<string, number>;
  compare?: boolean;
  totalsB?: SeriesTotals;
  fullSelection?: boolean;
  currentLabel?: string;
  baselineLabel?: string;
  onTypeClick: (type: string) => void;
}

function weekLabel(week: string): string {
  return week.slice(5);
}

export function ReservationTypeTable({
  weeks,
  types,
  selectedGroupIds,
  totals,
  distinctTabs,
  weekTabs,
  compare,
  totalsB,
  fullSelection = true,
  currentLabel = 'Current',
  baselineLabel = 'Baseline',
  onTypeClick,
}: Props) {
  const typeSet = new Set(types);
  const groups = RESERVATION_GROUPS.filter((g) => selectedGroupIds.includes(g.id));
  const cellSum = totals.cellSum;
  const delta = cellSum - distinctTabs;

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-border">
        <h3 className="text-lg font-semibold text-foreground">
          {compare ? `${currentLabel} vs ${baselineLabel}` : 'Weekly matrix'}
        </h3>
        <p className="text-sm text-muted">
          {compare
            ? 'Type totals for each year. Click a type to isolate it on the chart.'
            : 'Distinct tabs per type per Monday week. Click a type to isolate it.'}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-secondary">
              <th className="px-4 py-3 font-medium sticky left-0 bg-card z-10 min-w-[11rem]">Type</th>
              {compare ? (
                <>
                  <th className="px-4 py-3 font-medium text-right">{currentLabel}</th>
                  <th className="px-4 py-3 font-medium text-right">{baselineLabel}</th>
                  <th className="px-4 py-3 font-medium text-right">Δ%</th>
                </>
              ) : (
                <>
                  {weeks.map((w) => (
                    <th
                      key={w.week}
                      className={`px-3 py-3 font-medium text-right whitespace-nowrap ${w.partial ? 'opacity-50' : ''}`}
                    >
                      {weekLabel(w.week)}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const groupTypes = group.types.filter((t) => typeSet.has(t));
              if (groupTypes.length === 0) return null;
              return (
                <GroupRows
                  key={group.id}
                  label={group.label}
                  color={group.color}
                  types={groupTypes}
                  weeks={weeks}
                  totals={totals}
                  totalsB={totalsB}
                  compare={compare}
                  colSpan={compare ? 4 : weeks.length + 2}
                  onTypeClick={onTypeClick}
                />
              );
            })}
            <tr className="border-t border-border bg-overlay/5 font-medium">
              <td className="px-4 py-3 sticky left-0 bg-overlay/5 z-10">
                {fullSelection ? 'Distinct tabs' : 'Type total'}
              </td>
              {compare && totalsB ? (
                <>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatNumber(fullSelection ? distinctTabs : cellSum)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatNumber(fullSelection ? totalsB.distinctTabs : totalsB.cellSum)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatPctChange(pctChange(
                      fullSelection ? totalsB.distinctTabs : totalsB.cellSum,
                      fullSelection ? distinctTabs : cellSum,
                    ))}
                  </td>
                </>
              ) : (
                <>
                  {weeks.map((w) => {
                    const n = fullSelection ? (weekTabs?.[w.week] || 0) : w.total;
                    return (
                    <td key={w.week} className={`px-3 py-3 text-right font-mono ${w.partial ? 'opacity-50' : ''}`}>
                      {n ? formatNumber(n) : ''}
                    </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right font-mono">
                    {formatNumber(fullSelection ? distinctTabs : cellSum)}
                  </td>
                </>
              )}
            </tr>
          </tbody>
        </table>
      </div>
      {fullSelection && delta !== 0 && (
        <p className="px-4 py-3 text-xs text-muted border-t border-border">
          Type cells sum to {formatNumber(cellSum)}; distinct tabs are {formatNumber(distinctTabs)}.
          A tab with two named programs counts in both rows ({delta > 0 ? `+${delta}` : delta}).
        </p>
      )}
    </div>
  );
}

function GroupRows({
  label,
  color,
  types,
  weeks,
  totals,
  totalsB,
  compare,
  colSpan,
  onTypeClick,
}: {
  label: string;
  color: string;
  types: string[];
  weeks: WeeklyPoint[];
  totals: SeriesTotals;
  totalsB?: SeriesTotals;
  compare?: boolean;
  colSpan: number;
  onTypeClick: (type: string) => void;
}) {
  return (
    <>
      <tr className="bg-overlay/[0.04]">
        <td
          colSpan={colSpan}
          className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-secondary sticky left-0"
        >
          <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: color }} />
          {label}
        </td>
      </tr>
      {types.map((type) => {
        const total = totals.byType[type] || 0;
        const baseline = totalsB?.byType[type] || 0;
        if (compare && total === 0 && baseline === 0) return null;
        if (!compare && total === 0) return null;
        return (
          <tr key={type} className="border-b border-border/50 hover:bg-overlay/5">
            <td className="px-4 py-2 sticky left-0 bg-card z-10">
              <button
                type="button"
                onClick={() => onTypeClick(type)}
                className="text-left hover:text-accent transition-colors"
              >
                {type}
              </button>
            </td>
            {compare ? (
              <>
                <td className="px-4 py-2 text-right font-mono">{total ? formatNumber(total) : '—'}</td>
                <td className="px-4 py-2 text-right font-mono">{baseline ? formatNumber(baseline) : '—'}</td>
                <td className={`px-4 py-2 text-right font-mono ${
                  (pctChange(baseline, total) ?? 0) >= 0 ? 'text-accent' : 'text-red-400'
                }`}>
                  {formatPctChange(pctChange(baseline, total))}
                </td>
              </>
            ) : (
              <>
                {weeks.map((w) => {
                  const n = Number(w[type]) || 0;
                  return (
                    <td
                      key={w.week}
                      className={`px-3 py-2 text-right font-mono ${w.partial ? 'opacity-50' : ''}`}
                    >
                      {n ? formatNumber(n) : ''}
                    </td>
                  );
                })}
                <td className="px-4 py-2 text-right font-mono font-medium">{formatNumber(total)}</td>
              </>
            )}
          </tr>
        );
      })}
    </>
  );
}
