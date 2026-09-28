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
  inSeasonLeagues,
  leagueDetail,
  periodTotals,
  weeklyTotals,
  type LeagueCard,
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

  const cards = useMemo(
    () => (data ? inSeasonLeagues(data, dateRange) : []),
    [data, dateRange],
  );
  const totals = useMemo(
    () => (data ? periodTotals(data, dateRange) : null),
    [data, dateRange],
  );
  const weeks = useMemo(
    () => (data ? weeklyTotals(data, dateRange) : []),
    [data, dateRange],
  );
  const detail = useMemo(
    () => (data && selectedName ? leagueDetail(data, selectedName, dateRange) : null),
    [data, selectedName, dateRange],
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
      inSeason: cards.map((card) => card.name),
      totals,
      league: detail
        ? {
            name: detail.name,
            lineage: detail.lineage,
            prizeFund: detail.prizeFund,
            prizeFundGeneral: detail.prizeFundGeneral,
            nights: detail.nights,
            since: detail.since,
          }
        : null,
    });
  }, [data, totals, dateRange, cards, detail]);

  useEffect(() => {
    if (summaryText) setDataSummary(summaryText);
  }, [summaryText, setDataSummary]);

  const selectLeague = (name: string) => {
    replaceParams({ league: selectedName === name ? null : name });
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

        <section>
          <h2 className="text-lg font-semibold mb-1">In season now</h2>
          <p className="text-sm text-muted mb-4">
            Leagues with a split-pricing ring in the 14 days through {data.dataThrough}. Amounts use the dates selected above.
          </p>
          {cards.length === 0 ? (
            <p className="text-sm text-muted">No leagues have rung lineage or prize fund in the last 14 days.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cards.map((card) => (
                <LeagueSeasonCard
                  key={card.name}
                  card={card}
                  selected={card.name === selectedName}
                  onSelect={() => selectLeague(card.name)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Collections for the selected dates</h2>
          <p className="text-sm text-muted">
            Before each league moved to split pricing, lineage and prize fund rang as one fee. Those nights stay in combined fees and are not split by league.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <TotalTile label="Combined league fees (before split)" value={totals.combined} />
            <TotalTile label="Lineage — house revenue" value={totals.lineage} accent />
            <TotalTile
              label="Prize fund — held for leagues"
              value={totals.prizeFund + totals.prizeFundGeneral}
              detail={`Package ${formatCurrency(totals.prizeFund)} · General ${formatCurrency(totals.prizeFundGeneral)}`}
            />
            <TotalTile label="Total collected" value={totals.total} />
          </div>
          <LeagueWeeklyChart data={weeks} title="Weekly collections" />
        </section>

        {detail && (
          <section className="space-y-4">
            <header
              className="rounded-xl border border-border p-6"
              style={{ borderLeftWidth: 8, borderLeftColor: detail.color }}
            >
              <p className="text-xs uppercase tracking-[0.2em] mb-1" style={{ color: detail.color }}>
                {detail.night} · {detail.usualTime}
              </p>
              <h2 className="text-3xl sm:text-5xl font-bold" style={{ color: detail.color }}>
                {detail.name}
              </h2>
              <p className="text-sm text-secondary mt-2">Split pricing since {detail.since}</p>
            </header>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <TotalTile label="Lineage" value={detail.lineage} accent />
              <TotalTile label="Prize fund from the package" value={detail.prizeFund} />
              <TotalTile label="Prize fund general" value={detail.prizeFundGeneral} />
              <TotalTile label="Total collected" value={detail.total} />
              <TotalTile label="Nights bowled" value={detail.nights} plain />
              <TotalTile label="Payments" value={detail.payments} plain />
              <TotalTile
                label="Average lineage per night"
                value={detail.avgLineagePerNight}
                money={detail.avgLineagePerNight != null}
              />
              <TotalTile label="Voids" value={detail.voidValue} />
            </div>
            <p className="text-sm text-muted">
              Payments count how many times lineage was rung, not how many people bowled. Some bowlers pay for a month at a time.
            </p>

            <LeagueWeeklyChart data={detailWeeks} title={`${detail.name} by week`} />

            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold">Night by night</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium text-right">Payments</th>
                      <th className="px-4 py-2 font-medium text-right">Lineage</th>
                      <th className="px-4 py-2 font-medium text-right">Prize fund</th>
                      <th className="px-4 py-2 font-medium text-right">General</th>
                      <th className="px-4 py-2 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.rows.map((night) => (
                      <tr key={night.date} className="border-t border-border/70">
                        <td className="px-4 py-2">{night.date}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatNumber(night.payments)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatCurrency(night.lineage)}</td>
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

function LeagueSeasonCard({
  card,
  selected,
  onSelect,
}: {
  card: LeagueCard;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`card p-4 text-left border transition-colors ${
        selected ? 'border-accent' : 'border-transparent hover:border-border'
      }`}
      style={{ borderLeftWidth: 6, borderLeftColor: card.color }}
    >
      <p className="text-xs text-muted">{card.night} · {card.usualTime}</p>
      <h3 className="text-lg font-semibold mt-1" style={{ color: card.color }}>{card.name}</h3>
      <p className="text-xs text-secondary mt-1">Last bowled {card.lastBowled}</p>
      <div className="mt-3 space-y-1 text-sm">
        <MoneyLine label="Lineage" value={card.lineage} />
        <MoneyLine label="Prize fund" value={card.prizeFund + card.prizeFundGeneral} />
      </div>
    </button>
  );
}

function MoneyLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-secondary">{label}</span>
      <span className="font-mono">{formatCurrency(value)}</span>
    </div>
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
