'use client';

import { useState, useEffect, useMemo } from 'react';
import { Nav } from '@/components/Nav';
import { HolidaySelector } from '@/components/dashboard/HolidaySelector';
import { DepartmentFilter } from '@/components/dashboard/DepartmentFilter';
import { HolidayRanking } from '@/components/dashboard/HolidayRanking';
import { HolidayYoYTable } from '@/components/dashboard/HolidayYoYTable';
import { HolidayComparisonChart } from '@/components/dashboard/HolidayComparisonChart';

interface HolidayYearData {
  year: number;
  startDate: string;
  endDate: string;
  revenue: number;
  transactions: number;
  byDepartment: Record<string, number>;
}

interface HolidayData {
  name: string;
  years: HolidayYearData[];
}

interface HolidayAnalysisData {
  generatedAt: string;
  holidays: HolidayData[];
  yearColors: string[];
}

export default function HolidaysPage() {
  const [data, setData] = useState<HolidayAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedHoliday, setSelectedHoliday] = useState<string>('');
  const [department, setDepartment] = useState<string>('All');

  useEffect(() => {
    fetch('/data/holiday_analysis.json')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load (${r.status})`);
        return r.json();
      })
      .then((d) => {
        setData(d);
        if (d?.holidays?.length > 0 && !selectedHoliday) {
          setSelectedHoliday(d.holidays[0].name);
        }
      })
      .catch((err) => {
        console.error('Holiday data load error:', err instanceof Error ? err.message : err);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (data?.holidays?.length && !data.holidays.some((h) => h.name === selectedHoliday)) {
      setSelectedHoliday(data.holidays[0].name);
    }
  }, [data, selectedHoliday]);

  const selectedData = useMemo(() => {
    if (!data) return null;
    return data.holidays.find((h) => h.name === selectedHoliday) ?? null;
  }, [data, selectedHoliday]);

  const availableDepartments = useMemo(() => {
    if (!selectedData?.years) return [];
    const depts = new Set<string>();
    for (const y of selectedData.years) {
      if (y.byDepartment) {
        Object.keys(y.byDepartment).forEach((d) => depts.add(d));
      }
    }
    return Array.from(depts).sort();
  }, [selectedData]);

  const rankingYears = useMemo(() => {
    if (!selectedData) return [];
    const rev = department === 'All'
      ? (y: HolidayYearData) => y.revenue
      : (y: HolidayYearData) => (y.byDepartment?.[department] ?? 0);
    return selectedData.years.map((y) => ({
      year: y.year,
      revenue: rev(y),
      transactions: y.transactions,
    }));
  }, [selectedData, department]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-secondary animate-pulse text-lg">Loading holiday data...</div>
      </div>
    );
  }

  if (!data?.holidays?.length) {
    return (
      <main className="min-h-screen">
        <Nav />
        <div className="max-w-7xl mx-auto px-6 py-12 text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Holiday Analysis</h2>
          <p className="text-secondary">
            No holiday data available. Run <code className="text-accent">python scripts/export_dashboards.py</code> to generate.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <Nav />

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h2 className="text-3xl font-bold text-white mb-2">Holiday Analysis</h2>
          <p className="text-secondary">
            Year-over-year performance for US holidays. Variable-date holidays (Easter, Thanksgiving, etc.) are computed per year.
          </p>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-medium text-secondary">Select Holiday</h3>
          <HolidaySelector
            holidays={data.holidays.map((h) => h.name)}
            selected={selectedHoliday}
            onChange={setSelectedHoliday}
          />
        </div>

        {selectedData && (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <DepartmentFilter
                value={department}
                onChange={setDepartment}
                available={availableDepartments}
              />
            </div>

            <HolidayRanking years={rankingYears} yearColors={data.yearColors} />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
              <HolidayComparisonChart
                years={selectedData.years}
                department={department}
                yearColors={data.yearColors}
              />
              <HolidayYoYTable years={selectedData.years} department={department} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
