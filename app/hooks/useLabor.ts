'use client';

import { useState, useEffect, useMemo } from 'react';
import type { LaborData, LaborDay } from '@/types';

const LOAD_TIMEOUT_MS = 15000;

function fetchWithTimeout(url: string, timeout = LOAD_TIMEOUT_MS): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Load timeout')), timeout)
    ),
  ]);
}

export function useLabor() {
  const [labor, setLabor] = useState<LaborData | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    fetchWithTimeout('/data/labor.json')
      .then((res) => {
        if (res.status === 404) {
          setAvailable(false);
          setLoading(false);
          return null;
        }
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json();
      })
      .then((data: LaborData | null) => {
        if (data?.days) {
          setLabor(data);
          setAvailable(true);
        }
        setLoading(false);
      })
      .catch(() => {
        setAvailable(false);
        setLoading(false);
      });
  }, []);

  const laborByDate = useMemo((): Record<string, LaborDay> => {
    return labor?.days ?? {};
  }, [labor]);

  const laborThrough = useMemo((): string | null => {
    const dates = Object.keys(laborByDate);
    if (dates.length === 0) return null;
    return dates.reduce((a, b) => (a > b ? a : b));
  }, [laborByDate]);

  return {
    labor,
    laborByDate,
    laborThrough,
    loading,
    available,
  };
}
