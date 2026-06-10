'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { DateRange } from '@/lib/date-ranges';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string | null): s is string {
  return !!s && DATE_RE.test(s);
}

export function parseDateRangeFromUrl(from: string | null, to: string | null): DateRange | null {
  if (isValidDate(from) && isValidDate(to)) return [from, to];
  return null;
}

export function useUrlParams() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const get = useCallback((key: string) => searchParams.get(key), [searchParams]);

  const replaceParams = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value == null || value === '') next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  return { get, replaceParams, searchParams };
}

export function useUrlDateRange(defaultRange: DateRange | null) {
  const { get, replaceParams } = useUrlParams();
  const from = get('from');
  const to = get('to');

  const value = useMemo(
    () => parseDateRangeFromUrl(from, to) ?? defaultRange,
    [from, to, defaultRange],
  );

  const setValue = useCallback(
    (range: DateRange | null) => {
      if (!range) {
        replaceParams({ from: null, to: null });
      } else {
        replaceParams({ from: range[0], to: range[1] });
      }
    },
    [replaceParams],
  );

  return [value, setValue] as const;
}

export function useUrlString(key: string, defaultValue: string) {
  const { get, replaceParams } = useUrlParams();
  const raw = get(key);
  const value = raw ?? defaultValue;

  const setValue = useCallback(
    (v: string) => {
      replaceParams({ [key]: v === defaultValue ? null : v });
    },
    [key, defaultValue, replaceParams],
  );

  return [value, setValue] as const;
}

export function useUrlOptionalString(key: string) {
  const { get, replaceParams } = useUrlParams();
  const value = get(key) ?? '';

  const setValue = useCallback(
    (v: string) => replaceParams({ [key]: v || null }),
    [key, replaceParams],
  );

  return [value, setValue] as const;
}

export function useUrlStringArray(key: string) {
  const { get, replaceParams } = useUrlParams();
  const raw = get(key);

  const value = useMemo(() => {
    if (!raw) return [] as string[];
    return raw.split(',').map((s) => decodeURIComponent(s)).filter(Boolean);
  }, [raw]);

  const setValue = useCallback(
    (arr: string[]) => {
      if (arr.length === 0) replaceParams({ [key]: null });
      else replaceParams({ [key]: arr.map((s) => encodeURIComponent(s)).join(',') });
    },
    [key, replaceParams],
  );

  return [value, setValue] as const;
}

/** Compare page: period A/B dates + department + granularity */
export function useUrlCompareState(defaults: {
  periodA: DateRange;
  periodB: DateRange;
  department: string;
  granularity: string;
}) {
  const { get, replaceParams, searchParams } = useUrlParams();

  const periodA = useMemo(
    () => parseDateRangeFromUrl(get('aFrom'), get('aTo')) ?? defaults.periodA,
    [searchParams, defaults.periodA, get],
  );
  const periodB = useMemo(
    () => parseDateRangeFromUrl(get('bFrom'), get('bTo')) ?? defaults.periodB,
    [searchParams, defaults.periodB, get],
  );
  const department = get('dept') ?? defaults.department;
  const granularity = get('gran') ?? defaults.granularity;

  const setPeriodA = useCallback(
    (range: DateRange | null) => {
      if (!range) return;
      replaceParams({ aFrom: range[0], aTo: range[1] });
    },
    [replaceParams],
  );

  const setPeriodB = useCallback(
    (range: DateRange | null) => {
      if (!range) return;
      replaceParams({ bFrom: range[0], bTo: range[1] });
    },
    [replaceParams],
  );

  const setDepartment = useCallback(
    (dept: string) => replaceParams({ dept: dept === 'All' ? null : dept }),
    [replaceParams],
  );

  const setGranularity = useCallback(
    (gran: string) => replaceParams({ gran: gran === defaults.granularity ? null : gran }),
    [replaceParams, defaults.granularity],
  );

  return {
    periodA,
    periodB,
    department,
    granularity,
    setPeriodA,
    setPeriodB,
    setDepartment,
    setGranularity,
  };
}

/** Payments page: day vs range mode */
export function useUrlPaymentsState(defaults: {
  mode: 'day' | 'range';
  dayDate: string;
  rangeStart: string;
  rangeEnd: string;
}) {
  const { get, replaceParams } = useUrlParams();

  const modeParam = get('mode');
  const mode: 'day' | 'range' =
    modeParam === 'range' ? 'range' : modeParam === 'day' ? 'day' : defaults.mode;

  const dayDate = isValidDate(get('date')) ? get('date')! : defaults.dayDate;
  const rangeStart = isValidDate(get('from')) ? get('from')! : defaults.rangeStart;
  const rangeEnd = isValidDate(get('to')) ? get('to')! : defaults.rangeEnd;

  const setMode = useCallback(
    (m: 'day' | 'range') => replaceParams({ mode: m === defaults.mode ? null : m }),
    [replaceParams, defaults.mode],
  );

  const setDayDate = useCallback(
    (d: string) => replaceParams({ date: d === defaults.dayDate ? null : d, mode: mode === 'day' ? null : 'day' }),
    [replaceParams, defaults.dayDate, mode],
  );

  const setRange = useCallback(
    (start: string, end: string) => {
      replaceParams({
        mode: mode === 'range' ? null : 'range',
        from: start === defaults.rangeStart ? null : start,
        to: end === defaults.rangeEnd ? null : end,
      });
    },
    [replaceParams, defaults.rangeStart, defaults.rangeEnd, mode],
  );

  return { mode, dayDate, rangeStart, rangeEnd, setMode, setDayDate, setRange };
}
