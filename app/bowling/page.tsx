'use client';

import { useState, useEffect } from 'react';
import { Nav } from '@/components/Nav';
import { SeasonalityChart } from '@/components/dashboard/SeasonalityChart';
import { ForecastChart } from '@/components/dashboard/ForecastChart';
import { formatCompact } from '@/lib/format';

interface SeasonalityData {
  byYearWeek: Record<string, Array<{ week: number; revenue: number }>>;
  dateRange: { start: string; end: string };
  totalRevenue: number;
  yearColors: string[];
  years: number[];
}

interface ForecastItem {
  weekStart: string;
  weekOfYear: number;
  year: number;
  predictedRevenue: number;
}

interface ForecastData {
  forecasts: Record<string, ForecastItem[]>;
  generatedAt: string;
}

export default function BowlingPage() {
  const [seasonality, setSeasonality] = useState<SeasonalityData | null>(null);
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/data/bowling_seasonality.json').then(r => r.json()),
      fetch('/data/bowling_forecast.json').then(r => r.json()),
    ]).then(([s, f]) => {
      setSeasonality(s);
      setForecast(f);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-secondary animate-pulse text-lg">Loading bowling data...</div>
      </div>
    );
  }

  return (
    <main className="min-h-screen">
      <Nav />

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {seasonality && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="card p-5">
                <div className="text-sm text-secondary mb-1">Total Revenue</div>
                <div className="text-2xl font-bold font-mono text-gradient">
                  {formatCompact(seasonality.totalRevenue)}
                </div>
              </div>
              <div className="card p-5">
                <div className="text-sm text-secondary mb-1">Years of Data</div>
                <div className="text-2xl font-bold font-mono">
                  {seasonality.years.length}
                </div>
              </div>
              <div className="card p-5">
                <div className="text-sm text-secondary mb-1">Date Range</div>
                <div className="text-lg font-medium">
                  {seasonality.dateRange.start} — {seasonality.dateRange.end}
                </div>
              </div>
            </div>

            <SeasonalityChart data={seasonality} />
          </>
        )}

        {forecast && <ForecastChart data={forecast} />}
      </div>
    </main>
  );
}
