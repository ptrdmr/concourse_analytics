'use client';

import { useState, useEffect, useMemo } from 'react';
import type { GratuityData } from '@/types';

const LOAD_TIMEOUT_MS = 15000;

function fetchWithTimeout(url: string, timeout = LOAD_TIMEOUT_MS): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Load timeout')), timeout),
    ),
  ]);
}

export function useGratuity() {
  const [data, setData] = useState<GratuityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    fetchWithTimeout('/data/gratuity.json')
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
  }, []);

  const dates = useMemo(() => Object.keys(data?.dates ?? {}).sort(), [data]);

  return { data, dates, loading, available };
}
