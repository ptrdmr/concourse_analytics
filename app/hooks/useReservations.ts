'use client';

import { useState, useEffect } from 'react';
import type { ReservationCountsData } from '@/types';
import { emptyReservationData } from '@/lib/reservations';

const LOAD_TIMEOUT_MS = 30000;

function fetchWithTimeout(url: string, timeout = LOAD_TIMEOUT_MS): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Load timeout')), timeout)
    ),
  ]);
}

export function useReservations() {
  const [data, setData] = useState<ReservationCountsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithTimeout('/data/reservation_counts.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json();
      })
      .then((payload: ReservationCountsData) => {
        setData(payload && Array.isArray(payload.rows) ? payload : emptyReservationData());
        setLoading(false);
      })
      .catch(() => {
        setData(emptyReservationData());
        setLoading(false);
      });
  }, []);

  return { data, loading };
}
