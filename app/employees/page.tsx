'use client';

import { useEffect, useMemo, useState } from 'react';
import { Nav } from '@/components/Nav';
import { useEmployees } from '@/hooks/useEmployees';
import { EmployeeRoster, type RosterSortKey } from '@/components/employees/EmployeeRoster';
import { EmployeeSnapshot } from '@/components/employees/EmployeeSnapshot';
import {
  allRoles,
  computeEmployeeRankings,
  rollupEmployee,
} from '@/lib/employee-metrics';
import type { EmployeePeriod } from '@/types';

const PERIODS: { value: EmployeePeriod; label: string }[] = [
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '365 days' },
  { value: 'all', label: 'All time' },
];

const SORT_OPTIONS: { value: RosterSortKey; label: string }[] = [
  { value: 'sales', label: 'Sales' },
  { value: 'tipsPerHour', label: 'Tips / hr' },
  { value: 'salesPerHour', label: 'Sales / hr' },
  { value: 'hours', label: 'Hours' },
  { value: 'name', label: 'Name' },
];

export default function EmployeesPage() {
  const { employees, dateRange, laborDateRange, loading, available } = useEmployees();
  const [period, setPeriod] = useState<EmployeePeriod>(90);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [sortKey, setSortKey] = useState<RosterSortKey>('sales');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const roles = useMemo(() => allRoles(employees), [employees]);

  const rollups = useMemo(() => {
    return employees
      .map((e) => rollupEmployee(e, period, dateRange, laborDateRange))
      .filter((r) => {
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          if (!r.displayName.toLowerCase().includes(q)) return false;
        }
        if (roleFilter !== 'All') {
          if (!r.roles.some((x) => x.toLowerCase() === roleFilter.toLowerCase())) return false;
        }
        return r.sales > 0 || r.totalTips > 0 || r.hours > 0;
      });
  }, [employees, period, dateRange, laborDateRange, search, roleFilter]);

  useEffect(() => {
    if (rollups.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !rollups.some((r) => r.employeeId === selectedId)) {
      setSelectedId(rollups[0].employeeId);
    }
  }, [rollups, selectedId]);

  const selectedRollup = rollups.find((r) => r.employeeId === selectedId) ?? null;
  const selectedProfile = employees.find((e) => e.id === selectedId) ?? null;
  const rankings = useMemo(() => {
    if (!selectedRollup) {
      return {
        salesRank: null,
        salesPercentile: null,
        tipsPerHourRank: null,
        tipsPerHourPercentile: null,
        splhRank: null,
        splhPercentile: null,
        hoursRank: null,
        hoursPercentile: null,
        peerCount: 0,
        roleLabel: null,
      };
    }
    return computeEmployeeRankings(rollups, selectedRollup, employees);
  }, [rollups, selectedRollup, employees]);

  const formatRangeLabel = (start: string, end: string) => {
    if (!start || !end) return '';
    const fmt = (iso: string) => {
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', year: 'numeric', day: 'numeric' });
    };
    return `${fmt(start)} – ${fmt(end)}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-secondary animate-pulse text-lg mb-2">Loading employees…</div>
          <p className="text-sm text-muted">Fetching employee snapshot data</p>
        </div>
      </div>
    );
  }

  if (!available) {
    return (
      <main className="min-h-screen pb-16">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <h1 className="text-2xl font-bold text-gradient">Employees</h1>
          <p className="text-secondary mt-2">
            No employee data found. Run <code className="text-accent">npm run etl</code>,{' '}
            <code className="text-accent">npm run labor</code>, then{' '}
            <code className="text-accent">npm run employees</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-16">
      <Nav />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gradient">Employees</h1>
          <p className="text-secondary text-sm mt-1">
            Per-employee snapshot: POS sales & tips (gratuity + VIP/party service charges) with 7shifts hours & wage.
          </p>
        </div>

        <div className="card p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Period
              <select
                value={String(period)}
                onChange={(e) => {
                  const v = e.target.value;
                  setPeriod(v === 'all' ? 'all' : (Number(v) as EmployeePeriod));
                }}
                className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {PERIODS.map((p) => (
                  <option key={String(p.value)} value={String(p.value)}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Role
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="All">All roles</option>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Sort roster by
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as RosterSortKey)}
                className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Search
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name…"
                className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </label>
          </div>
          <p className="text-xs text-muted mt-3">
            Showing {rollups.length} active employees
            {dateRange[0] && dateRange[1] ? (
              <>
                {' '}
                · POS {formatRangeLabel(dateRange[0], dateRange[1])}
              </>
            ) : null}
            {laborDateRange[0] && laborDateRange[1] ? (
              <>
                {' '}
                · 7shifts {formatRangeLabel(laborDateRange[0], laborDateRange[1])}
              </>
            ) : null}
          </p>
        </div>

        <div className="grid lg:grid-cols-[minmax(280px,360px)_1fr] gap-6 items-start">
          <EmployeeRoster
            rollups={rollups}
            selectedId={selectedId}
            sortKey={sortKey}
            onSelect={setSelectedId}
          />
          {selectedRollup && selectedProfile ? (
            <EmployeeSnapshot
              rollup={selectedRollup}
              profile={selectedProfile}
              rankings={rankings}
              allRollups={rollups}
            />
          ) : (
            <div className="card p-8 text-center text-secondary">Select an employee from the roster</div>
          )}
        </div>
      </div>
    </main>
  );
}
