'use client';

import { useEffect, useMemo, Suspense } from 'react';
import { Nav } from '@/components/Nav';
import { DateRangePicker } from '@/components/dashboard/DateRangePicker';
import { LeagueWeeklyChart } from '@/components/leagues/LeagueWeeklyChart';
import { useLeagues } from '@/hooks/useLeagues';
import { useUrlDateRange, useUrlParams } from '@/hooks/useUrlFilters';
import { getYTD } from '@/lib/date-ranges';
import { formatCurrency, formatNumber } from '@/lib/format';
import {
  canonicalLeagueName,
  leagueColor,
  leagueDetail,
  leagueNames,
  periodTotals,
  weeklyTotals,
} from '@/lib/leagues';
import { buildLeaguesSummary } from '@/lib/build-data-summary';
import { useDataContext } from '@/context/DataContext';

export default function LeaguesPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen pb-16">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 text-center text-muted animate-pulse">
          Loading leagues...
        </div>
      </main>
    }>
      <LeaguesContent />
    </Suspense>
  );
}

function LeaguesContent() {
  const { setDataSummary } = useDataContext();
  const { data, loading } = useLeagues();
  const { get, replaceParams } = useUrlParams();
  const [dateRange, setDateRange] = useUrlDateRange(getYTD(data?.dataThrough ?? null));
  const selectedName = get('league');
  const selectedLeague = selectedName ? canonicalLeagueName(selectedName) : null;

  const names = useMemo(() => (data ? leagueNames(data) : []), [data]);
  const totals = useMemo(
    () => (data ? periodTotals(data, dateRange) : null),
    [data, dateRange],
  );
  const weeks = useMemo(
    () => (data ? weeklyTotals(data, dateRange) : []),
    [data, dateRange],
  );
  const detail = useMemo(
    () => (data && selectedLeague ? leagueDetail(data, selectedLeague, dateRange) : null),
    [data, selectedLeague, dateRange],
  );
  const detailWeeks = useMemo(
    () => (data && detail ? weeklyTotals(data, dateRange, detail.name) : []),
    [data, dateRange, detail],
  );

  const summaryText = useMemo(() => {
    if (!data || !totals) return '';
    return buildLeaguesSummary({
      dateRange,
      dataThrough: data.dataThrough,
      leagues: names,
      totals,
      league: detail
        ? {
            name: detail.name,
            lineage: detail.lineage,
            prizeFund: detail.prizeFund,
            prizeFundGeneral: detail.prizeFundGeneral,
            leaguePayment: detail.leaguePayment,
            preSplit: detail.preSplit,
            since: detail.since,
          }
        : null,
    });
  }, [data, totals, dateRange, names, detail]);

  useEffect(() => {
    if (summaryText) setDataSummary(summaryText);
  }, [summaryText, setDataSummary]);

  const selectLeague = (name: string) => {
    replaceParams({ league: selectedLeague === name ? null : name });
  };

  if (loading) {
    return (
      <main className="min-h-screen pb-16">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 text-center text-muted animate-pulse">
          Loading leagues...
        </div>
      </main>
    );
  }

  if (!data || !totals) {
    return (
      <main className="min-h-screen pb-16">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 text-center">
          <h1 className="text-2xl font-bold mb-2">Leagues</h1>
          <p className="text-secondary">
            No league file yet. Run <code className="text-accent">python scripts/league_export.py --from-published</code> and refresh.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-16">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Leagues</h1>
          <p className="text-secondary mb-4">
            Lineage is house revenue. Prize fund is held for each league and is not sales.
          </p>
          <DateRangePicker value={dateRange} onChange={setDateRange} dataThrough={data.dataThrough} />
        </div>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Collections for the selected dates</h2>
          <p className="text-sm text-muted">
            Before each league moved to split pricing, lineage and prize fund rang as one fee. Those named fees are on the league. Wednesday League Payment is Super Sports. League Payment on any other day stays in the combined total.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <TotalTile
              label="Combined league fees (before split)"
              value={totals.combined}
              detail={totals.unassigned ? `Unassigned ${formatCurrency(totals.unassigned)}` : undefined}
            />
            <TotalTile
              label="Lineage — house revenue"
              value={totals.lineage + totals.leaguePayment}
              accent
              detail={totals.leaguePayment ? `League Payment ${formatCurrency(totals.leaguePayment)}` : undefined}
            />
            <TotalTile
              label="Prize fund — held for leagues"
              value={totals.prizeFund + totals.prizeFundGeneral}
              detail={`Package ${formatCurrency(totals.prizeFund)} · General ${formatCurrency(totals.prizeFundGeneral)}`}
            />
            <TotalTile label="Total collected" value={totals.total} />
          </div>
          <LeagueWeeklyChart data={weeks} title="Weekly collections" />
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-1">Leagues</h2>
          <p className="text-sm text-muted mb-4">
            Select a league to see its lineage and prize fund for these dates.
          </p>
          {names.length === 0 ? (
            <p className="text-sm text-muted">No leagues have split pricing yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {names.map((name) => {
                const selected = name === selectedLeague;
                const color = leagueColor(name);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => selectLeague(name)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      selected ? 'bg-card' : 'border-border text-secondary hover:text-foreground'
                    }`}
                    style={selected ? { borderColor: color, color } : undefined}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {detail && (
          <section className="space-y-4">
            <header
              className="rounded-xl border border-border p-6"
              style={{ borderLeftWidth: 8, borderLeftColor: detail.color }}
            >
              <h2 className="text-3xl sm:text-5xl font-bold" style={{ color: detail.color }}>
                {detail.name}
              </h2>
              <p className="text-sm text-secondary mt-2">
                {detail.since
                  ? `Split pricing since ${detail.since}`
                  : detail.leaguePayment !== 0
                    ? 'General revenue from League Payment. This is house revenue, not a split package yet.'
                    : detail.preSplit !== 0
                      ? 'These fees were rung before lineage and prize fund were split out.'
                      : 'No split-pricing package yet.'}
              </p>
            </header>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {detail.preSplit !== 0 && (
                <TotalTile label="Fees before split" value={detail.preSplit} />
              )}
              <TotalTile label="Lineage" value={detail.lineage} accent />
              {detail.leaguePayment !== 0 && (
                <TotalTile label="General revenue" value={detail.leaguePayment} detail="League Payment" accent />
              )}
              <TotalTile label="Prize fund from the package" value={detail.prizeFund} />
              <TotalTile label="Prize fund general" value={detail.prizeFundGeneral} />
              <TotalTile label="Total collected" value={detail.total} />
              <TotalTile label="Payments" value={detail.payments} plain />
              <TotalTile label="Voids" value={detail.voidValue} />
            </div>
            <p className="text-sm text-muted">
              Payments count how many times the fee was rung, not how many people bowled. Some bowlers pay for a month at a time.
            </p>

            <LeagueWeeklyChart
              data={detailWeeks}
              title={`${detail.name} by week`}
              note={detail.preSplit !== 0 ? 'Combined fees are this league only, from before the split.' : undefined}
            />

            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold">By date</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium text-right">Payments</th>
                      {detail.preSplit !== 0 && (
                        <th className="px-4 py-2 font-medium text-right">Before split</th>
                      )}
                      <th className="px-4 py-2 font-medium text-right">Lineage</th>
                      {detail.leaguePayment !== 0 && (
                        <th className="px-4 py-2 font-medium text-right">General revenue</th>
                      )}
                      <th className="px-4 py-2 font-medium text-right">Prize fund</th>
                      <th className="px-4 py-2 font-medium text-right">Prize fund general</th>
                      <th className="px-4 py-2 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.rows.length === 0 && (
                      <tr className="border-t border-border/70">
                        <td className="px-4 py-3 text-muted" colSpan={6 + (detail.leaguePayment !== 0 ? 1 : 0) + (detail.preSplit !== 0 ? 1 : 0)}>No rings in these dates.</td>
                      </tr>
                    )}
                    {detail.rows.map((night) => (
                      <tr key={night.date} className="border-t border-border/70">
                        <td className="px-4 py-2">{night.date}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatNumber(night.payments)}</td>
                        {detail.preSplit !== 0 && (
                          <td className="px-4 py-2 text-right font-mono">{formatCurrency(night.preSplit)}</td>
                        )}
                        <td className="px-4 py-2 text-right font-mono">{formatCurrency(night.lineage)}</td>
                        {detail.leaguePayment !== 0 && (
                          <td className="px-4 py-2 text-right font-mono">{formatCurrency(night.leaguePayment)}</td>
                        )}
                        <td className="px-4 py-2 text-right font-mono">{formatCurrency(night.prizeFund)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatCurrency(night.prizeFundGeneral)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatCurrency(night.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function TotalTile({
  label,
  value,
  detail,
  accent,
  plain,
  money = true,
}: {
  label: string;
  value: number | null;
  detail?: string;
  accent?: boolean;
  plain?: boolean;
  money?: boolean;
}) {
  const shown = value == null
    ? '—'
    : plain
      ? formatNumber(value)
      : money
        ? formatCurrency(value)
        : '—';
  return (
    <div className="card p-5">
      <div className="text-sm text-secondary mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono ${accent ? 'text-gradient' : ''}`}>{shown}</div>
      {detail && <p className="text-xs text-muted mt-1">{detail}</p>}
    </div>
  );
}
