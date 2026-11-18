'use client';

import { useState, useEffect, useMemo } from 'react';
import type { GratuityData } from '@/types';

const LOAD_TIMEOUT_MS = 15000;

function fetchWithTimeout(url: string, timeout = LOAD_TIMEOUT_MS, passcode?: string): Promise<Response> {
  return Promise.race([
    fetch(url, passcode ? { headers: { 'x-tip-passcode': passcode } } : undefined),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Load timeout')), timeout),
    ),
  ]);
}

export function useGratuity(passcode: string) {
  const [data, setData] = useState<GratuityData | null>(null);
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
    fetchWithTimeout(dev ? '/data/gratuity.json' : '/api/tip-data?file=gratuity', LOAD_TIMEOUT_MS, dev ? undefined : passcode)
      .then((res) => {
        if (res.status === 404) {
          setAvailable(false);
          setLoading(false);
          return null;
        }
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json();
      })
      .then((json: GratuityData | null) => {
        if (json?.dates) {
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

  const dates = useMemo(() => Object.keys(data?.dates ?? {}).sort(), [data]);

  return { data, dates, loading, available };
}
