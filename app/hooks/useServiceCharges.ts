'use client';

import { useState, useEffect, useMemo } from 'react';
import type { ServiceChargeData } from '@/types';

const LOAD_TIMEOUT_MS = 15000;

function fetchWithTimeout(url: string, timeout = LOAD_TIMEOUT_MS, passcode?: string): Promise<Response> {
  return Promise.race([
    fetch(url, passcode ? { headers: { 'x-tip-passcode': passcode } } : undefined),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Load timeout')), timeout),
    ),
  ]);
}

export function useServiceCharges(passcode: string) {
  const [data, setData] = useState<ServiceChargeData | null>(null);
  const [loading, setLoading] = useState(Boolean(passcode));
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!passcode) {
      setData(null);
      setLoading(false);
      setAvailable(false);
      return;
    }
    const dev = process.env.NODE_ENV === 'development';
    fetchWithTimeout(dev ? '/data/service_charges.json' : '/api/tip-data?file=service_charges', LOAD_TIMEOUT_MS, dev ? undefined : passcode)
      .then((res) => {
        if (res.status === 404) {
          setAvailable(false);
          setLoading(false);
          return null;
        }
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json();
      })
      .then((json: ServiceChargeData | null) => {
        if (json?.tabs) {
          setData(json);
          setAvailable(true);
        }
        setLoading(false);
      })
      .catch(() => {
        setAvailable(false);
        setLoading(false);
      });
  }, [passcode]);

  const dates = useMemo(
    () => [...new Set((data?.tabs ?? []).map((tab) => tab.date))].sort(),
    [data],
  );

  return { data, dates, loading, available };
}
