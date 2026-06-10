'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import type { IntradayRecord, IntradayIndex } from '@/types';
import {
  filterIntradayRecords,
  yearsInRange,
  countMatchingDays,
} from '@/lib/intraday';
import type { DateRange } from '@/lib/date-ranges';

const LOAD_TIMEOUT_MS = 60000;

function fetchWithTimeout(url: string, timeout = LOAD_TIMEOUT_MS): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Load timeout')), timeout),
    ),
  ]);
}

export interface IntradayFilters {
  department: string;
  dateRange: DateRange | null;
  daysOfWeek: number[];
  categories: string[];
  selectedItems: string[];
}

export function useIntradayIndex() {
  const [index, setIndex] = useState<IntradayIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWithTimeout('/data/intraday/index.json', 15000)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load index (${res.status})`);
        return res.json();
      })
      .then((data: IntradayIndex) => {
        setIndex(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load');
        setLoading(false);
      });
  }, []);

  return { index, loading, error };
}

function intradayDepartments(index: IntradayIndex): string[] {
  return index.departments.filter(d => d !== 'Vending Machines');
}

function mergeSalesForSelection(
  cache: Record<string, IntradayRecord[]>,
  department: string,
  departments: string[],
  years: string[],
): IntradayRecord[] {
  const depts = department === 'All' ? departments : [department];
  return depts.flatMap(dept => years.flatMap(y => cache[`${dept}/${y}`] ?? []));
}

export function useIntradayData(
  index: IntradayIndex | null,
  filters: IntradayFilters,
) {
  const salesCache = useRef<Record<string, IntradayRecord[]>>({});
  const [salesRecords, setSalesRecords] = useState<IntradayRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedKey, setLoadedKey] = useState('');

  const departments = useMemo(
    () => (index ? intradayDepartments(index) : []),
    [index],
  );

  const yearsNeeded = useMemo(() => {
    if (!index) return [];
    return yearsInRange(filters.dateRange, index.years);
  }, [index, filters.dateRange]);

  const loadKey = `${filters.department}:${yearsNeeded.join(',')}`;

  useEffect(() => {
    if (!index || !filters.department || yearsNeeded.length === 0) {
      setSalesRecords([]);
      return;
    }

    const deptsToLoad = filters.department === 'All' ? departments : [filters.department];
    const missingPairs: { dept: string; year: string }[] = [];
    for (const dept of deptsToLoad) {
      for (const year of yearsNeeded) {
        if (!salesCache.current[`${dept}/${year}`]) {
          missingPairs.push({ dept, year });
        }
      }
    }

    if (missingPairs.length === 0) {
      setSalesRecords(mergeSalesForSelection(
        salesCache.current,
        filters.department,
        departments,
        yearsNeeded,
      ));
      setLoadedKey(loadKey);
      return;
    }

    setLoading(true);
    Promise.all(
      missingPairs.map(({ dept, year }) =>
        fetchWithTimeout(`/data/intraday/${encodeURIComponent(dept)}/${year}.json`)
          .then(res => {
            if (!res.ok) throw new Error(`Failed ${dept}/${year}`);
            return res.json() as Promise<IntradayRecord[]>;
          })
          .then(data => {
            salesCache.current[`${dept}/${year}`] = Array.isArray(data) ? data : [];
          }),
      ),
    )
      .then(() => {
        setSalesRecords(mergeSalesForSelection(
          salesCache.current,
          filters.department,
          departments,
          yearsNeeded,
        ));
        setLoadedKey(loadKey);
      })
      .catch(() => setSalesRecords([]))
      .finally(() => setLoading(false));
  }, [index, filters.department, departments, yearsNeeded, loadKey]);

  const filteredSales = useMemo(
    () =>
      filterIntradayRecords(salesRecords, {
        dateRange: filters.dateRange,
        daysOfWeek: filters.daysOfWeek,
        categories: filters.categories,
        selectedItems: filters.selectedItems,
      }),
    [salesRecords, filters],
  );

  const dayCount = useMemo(
    () => countMatchingDays(filters.dateRange, filters.daysOfWeek),
    [filters.dateRange, filters.daysOfWeek],
  );

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const r of salesRecords) cats.add(r.category);
    return Array.from(cats).sort();
  }, [salesRecords]);

  const availableItems = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of salesRecords) {
      if (!map.has(r.name)) map.set(r.name, r.category);
    }
    return Array.from(map.entries())
      .map(([name, category]) => ({ name, category }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [salesRecords]);

  const isReady = loadedKey === loadKey && !loading;

  return {
    filteredSales,
    dayCount,
    categories,
    availableItems,
    loading,
    isReady,
  };
}

export function useIntradayDepartments(index: IntradayIndex | null) {
  return useMemo(() => {
    if (!index) return [];
    return ['All', ...intradayDepartments(index)];
  }, [index]);
}
