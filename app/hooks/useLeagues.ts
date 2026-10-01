'use client';

import { useEffect, useState } from 'react';
import type { LeaguesData } from '@/lib/leagues';

export function useLeagues() {
  const [data, setData] = useState<LeaguesData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/data/leagues.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load leagues (${res.status})`);
        return res.json();
      })
      .then((payload: LeaguesData) => setData(payload))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading };
}
