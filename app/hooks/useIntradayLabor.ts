'use client';

import { useState, useEffect, useMemo } from 'react';
import type { IntradayLaborData, IntradayLaborDay } from '@/types';

const LOAD_TIMEOUT_MS = 15000;

function fetchWithTimeout(url: string, timeout = LOAD_TIMEOUT_MS): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Load timeout')), timeout),
    ),
  ]);
}

export function useIntradayLabor() {
  const [labor, setLabor] = useState<IntradayLaborData | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    fetchWithTimeout('/data/labor_intraday.json')
      .then((res) => {
        if (res.status === 404) {
          setAvailable(false);
          setLoading(false);
          return null;
        }
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json();
      })
      .then((data: IntradayLaborData | null) => {
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

  const laborDays = useMemo((): Record<string, IntradayLaborDay> => {
    return labor?.days ?? {};
  }, [labor]);

  return {
    labor,
    laborDays,
    loading,
    available,
  };
}
