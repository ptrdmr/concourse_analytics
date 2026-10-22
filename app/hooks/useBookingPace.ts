'use client';

import { useEffect, useState } from 'react';
import type { BookingPaceFile } from '@/lib/booking-pace';

const LOAD_TIMEOUT_MS = 30000;

function fetchWithTimeout(url: string): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Load timeout')), LOAD_TIMEOUT_MS);
    }),
  ]);
}

export function useBookingPace() {
  const [data, setData] = useState<BookingPaceFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchWithTimeout('/data/booking_pace.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json();
      })
      .then((payload: BookingPaceFile) => {
        setData(payload && Array.isArray(payload.payments) ? payload : null);
        setError(!payload || !Array.isArray(payload.payments));
        setLoading(false);
      })
      .catch(() => {
        setData(null);
        setError(true);
        setLoading(false);
      });
  }, []);

  return { data, loading, error };
}
