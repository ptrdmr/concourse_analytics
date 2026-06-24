'use client';

import type { ReactNode } from 'react';
import type { EmployeeProfile, EmployeeRankings, EmployeeRollup } from '@/types';
import { computeRoleAverages, workPatternGrid } from '@/lib/employee-metrics';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';
import { MetricTile, formatMetricCurrency, formatMetricNumber, formatMetricPercent } from './MetricTile';
import { TrendSparkline } from './TrendSparkline';
import { SalesMixBar } from './SalesMixBar';
import { WorkPatternHeatmap } from './WorkPatternHeatmap';
import { AlertCircle, Award, Clock, DollarSign, Info, TrendingUp, Wallet } from 'lucide-react';

interface Props {
  rollup: EmployeeRollup;
  profile: EmployeeProfile;
  rankings: EmployeeRankings;
  allRollups: EmployeeRollup[];
}

function RankBadge({ rank, percentile, label }: { rank: number | null; percentile: number | null; label: string }) {
  if (rank == null) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-accent/10 text-accent border border-accent/20">
      <Award className="w-3 h-3" />
      #{rank} {label}
      {percentile != null ? ` · top ${percentile}%` : ''}
    </span>
  );
}

function SectionHeader({
  title,
  icon,
  subtitle,
}: {
  title: string;
  icon: ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        {icon}
        {title}
      </h3>
      {subtitle ? <p className="text-xs text-muted mt-1">{subtitle}</p> : null}
    </div>
  );
}

export function EmployeeSnapshot({ rollup, profile, rankings, allRollups }: Props) {
  const roleAvg = computeRoleAverages(allRollups, rankings.roleLabel);
  const hasLaborWindow = Boolean(rollup.laborPeriodStart && rollup.laborPeriodEnd);
  const laborClamped = hasLaborWindow && rollup.laborPeriodStart > rollup.periodStart;
  const pattern = hasLaborWindow
    ? workPatternGrid(profile.days, rollup.laborPeriodStart, rollup.laborPeriodEnd)
    : workPatternGrid(profile.days, rollup.periodStart, rollup.periodEnd);
  const tenureYears = rollup.hiredAt
    ? Math.max(0, (Date.now() - new Date(rollup.hiredAt).getTime()) / (365.25 * 86400000))
    : null;

  return (
    <div className="space-y-6">
      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gradient">{rollup.displayName}</h2>
            <p className="text-secondary text-sm mt-1">
              {rollup.roles.length ? rollup.roles.join(' · ') : 'No 7shifts role linked'}
              {rollup.wage > 0 ? ` · $${rollup.wage.toFixed(2)}/hr` : ''}
              {tenureYears != null && !Number.isNaN(tenureYears) ? ` · ${tenureYears.toFixed(1)} yr tenure` : ''}
              {!rollup.active ? ' · inactive' : ''}
            </p>
            <p className="text-xs text-muted mt-2">
              Selected period: {rollup.periodStart} → {rollup.periodEnd}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <RankBadge rank={rankings.salesRank} percentile={rankings.salesPercentile} label="sales" />
            <RankBadge rank={rankings.tipsPerHourRank} percentile={rankings.tipsPerHourPercentile} label="tips/hr" />
            <RankBadge rank={rankings.splhRank} percentile={rankings.splhPercentile} label="SPLH" />
          </div>
        </div>
        {!rollup.laborLinked && (
          <p className="mt-4 text-xs text-amber-400/90 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Hours and wage metrics require a 7shifts link in config/employee_map.txt
          </p>
        )}
      </div>

      <div className="card p-4 sm:p-5">
        <SectionHeader
          title="Sales"
          icon={<DollarSign className="w-4 h-4 text-accent" />}
          subtitle={`${rollup.periodStart} → ${rollup.periodEnd}`}
        />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <MetricTile label="Total sales" value={formatMetricCurrency(rollup.sales)} accent />
          <MetricTile label="Avg check" value={rollup.avgCheck != null ? formatCurrency(rollup.avgCheck) : '—'} />
          <MetricTile label="Tickets" value={formatNumber(rollup.tickets)} />
        </div>
        <div className="grid lg:grid-cols-2 gap-4 mt-4">
          <div>
            <h4 className="text-sm font-medium mb-3">Sales trend</h4>
            <TrendSparkline data={rollup.dailyTrend} metric="sales" />
          </div>
          <div>
            <h4 className="text-sm font-medium mb-3">Sales mix</h4>
            <SalesMixBar deptMix={rollup.deptMix} />
          </div>
        </div>
        {rollup.topItems.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <h4 className="text-sm font-medium mb-3">Top items (all-time POS profile)</h4>
            <div className="space-y-2">
              {rollup.topItems.map((item) => (
                <div key={item.name} className="flex justify-between gap-2 text-sm">
                  <span className="text-secondary truncate">{item.name}</span>
                  <span className="font-mono tabular-nums shrink-0">{formatCurrency(item.revenue)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card p-4 sm:p-5">
        <SectionHeader
          title="Tips"
          icon={<Wallet className="w-4 h-4 text-[#f97316]" />}
          subtitle={`${rollup.periodStart} → ${rollup.periodEnd}`}
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricTile label="Total tips" value={formatMetricCurrency(rollup.totalTips)} accent />
          <MetricTile label="Gratuity" value={formatMetricCurrency(rollup.gratuity)} />
          <MetricTile label="VIP svc charge" value={formatMetricCurrency(rollup.serviceChargeVip)} sub="Ticket owner" />
          <MetricTile label="Party svc charge" value={formatMetricCurrency(rollup.serviceChargeParty)} sub="Ticket owner" />
          <MetricTile
            label="Tip rate"
            value={formatMetricPercent(rollup.tipRate)}
            sub={roleAvg.avgTipRate != null ? `Role avg ${formatPercent(roleAvg.avgTipRate)}` : undefined}
          />
          <MetricTile label="Other svc charges" value={formatMetricCurrency(rollup.serviceChargeOther)} />
        </div>
        <div className="mt-4">
          <h4 className="text-sm font-medium mb-3">Tips trend</h4>
          <TrendSparkline data={rollup.dailyTrend} metric="tips" />
        </div>
        <p className="text-[10px] text-muted mt-2">
          VIP and party service charges are attributed to the ticket owner (POS server), not tip-pool recipients.
        </p>
      </div>

      <div className="card p-4 sm:p-5">
        <SectionHeader
          title="Hours, wage & efficiency"
          icon={<Clock className="w-4 h-4 text-violet-400" />}
          subtitle={
            hasLaborWindow
              ? `7shifts data: ${rollup.laborPeriodStart} → ${rollup.laborPeriodEnd}`
              : 'No 7shifts labor data in this period'
          }
        />
        {laborClamped && (
          <p className="mb-4 text-xs text-sky-300/90 flex items-start gap-2 rounded-lg border border-sky-400/20 bg-sky-400/5 px-3 py-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            Labor data starts {rollup.laborPeriodStart}. Blended metrics below use only sales and tips within that
            window so ratios stay accurate.
          </p>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricTile label="Hours worked" value={formatMetricNumber(rollup.hours, 1)} accent />
          <MetricTile label="Avg hrs / week" value={formatMetricNumber(rollup.avgHoursPerWeek, 1)} />
          <MetricTile label="Shifts (days)" value={formatMetricNumber(rollup.shiftCount, 0)} />
          <MetricTile
            label="Avg shift length"
            value={rollup.avgShiftLength != null ? `${rollup.avgShiftLength.toFixed(1)} hrs` : '—'}
          />
          {rollup.scheduledShifts > 0 && (
            <>
              <MetricTile label="Late minutes" value={formatMetricNumber(rollup.lateMinutes, 0)} />
              <MetricTile label="No-shows" value={formatMetricNumber(rollup.noShows, 0)} />
            </>
          )}
        </div>
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Wage & blended efficiency
            {hasLaborWindow ? (
              <span className="text-xs font-normal text-muted">
                ({rollup.laborPeriodStart} → {rollup.laborPeriodEnd})
              </span>
            ) : null}
          </h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricTile label="Hourly wage" value={rollup.wage > 0 ? `$${rollup.wage.toFixed(2)}` : '—'} />
            <MetricTile label="Labor cost" value={formatMetricCurrency(rollup.laborCost)} />
            <MetricTile
              label="Sales / labor hr"
              value={rollup.salesPerHour != null ? `${formatCurrency(rollup.salesPerHour)}/hr` : '—'}
              sub={rankings.splhRank != null ? `#${rankings.splhRank} among peers` : undefined}
            />
            <MetricTile
              label="Tips / hour"
              value={rollup.tipsPerHour != null ? `${formatCurrency(rollup.tipsPerHour)}/hr` : '—'}
            />
            <MetricTile
              label="Sales per $1 wage"
              value={rollup.salesPerWageDollar != null ? `$${rollup.salesPerWageDollar.toFixed(0)}` : '—'}
            />
            <MetricTile label="Personal labor %" value={formatMetricPercent(rollup.personalLaborPct)} />
            {hasLaborWindow && laborClamped && (
              <>
                <MetricTile label="Sales (labor window)" value={formatMetricCurrency(rollup.laborSales)} />
                <MetricTile label="Tips (labor window)" value={formatMetricCurrency(rollup.laborTips)} />
              </>
            )}
          </div>
        </div>
        {hasLaborWindow && (
          <div className="mt-4 pt-4 border-t border-border">
            <h4 className="text-sm font-medium mb-3">Work pattern</h4>
            <WorkPatternHeatmap grid={pattern} />
          </div>
        )}
      </div>

      {rollup.bestDay && (
        <p className="text-xs text-muted text-center">
          Best sales day in period: {rollup.bestDay.date} ({formatCurrency(rollup.bestDay.sales)})
          {rankings.peerCount > 0 ? ` · ranked among ${rankings.peerCount} peers` : ''}
        </p>
      )}
    </div>
  );
}
