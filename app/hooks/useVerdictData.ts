'use client';

import { useEffect, useState } from 'react';
import type { DaypartBaselinesData } from '@/lib/verdict';

export interface ForecastWeekActual {
  weekStart: string;
  revenue: number;
}

export interface ForecastWeekPredicted {
  weekStart: string;
  predictedRevenue: number;
}

export interface DeptForecast {
  actual: ForecastWeekActual[];
  forecast: ForecastWeekPredicted[];
}

export interface VerdictForecastData {
  generatedAt: string;
  departments: Record<string, DeptForecast>;
  house: DeptForecast;
}

export function useVerdictForecast() {
  const [data, setData] = useState<VerdictForecastData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/data/verdict_forecast.json')
      .then((r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return r.json();
      })
      .then((json: VerdictForecastData) => {
        if (json?.house) setData(json);
        else setData(null);
        setLoading(false);
      })
      .catch(() => {
        setData(null);
        setLoading(false);
      });
  }, []);

  return { data, loading };
}

export function useDaypartBaselines() {
  const [data, setData] = useState<DaypartBaselinesData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/data/daypart_baselines.json')
      .then((r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return r.json();
      })
      .then((json: DaypartBaselinesData) => {
        if (json?.rows) setData(json);
        else setData(null);
        setLoading(false);
      })
      .catch(() => {
        setData(null);
        setLoading(false);
      });
  }, []);

  return { data, loading };
}
