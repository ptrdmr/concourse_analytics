'use client';

import { useState, useEffect, useRef } from 'react';
import type { Ticket } from '@/types';

const LOAD_TIMEOUT_MS = 120000;

function fetchWithTimeout(url: string, timeout = LOAD_TIMEOUT_MS): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Load timeout')), timeout)
    ),
  ]);
}

export function useTicketMonths() {
  const [months, setMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithTimeout('/data/tickets/months.json', 10000)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json();
      })
      .then((data: string[]) => {
        setMonths(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return { months, loading };
}

export function useTicketDetail(yearMonth: string | null) {
  const cacheRef = useRef<Record<string, Ticket[]>>({});
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!yearMonth) {
      setTickets([]);
      return;
    }

    const cached = cacheRef.current[yearMonth];
    if (cached) {
      setTickets(cached);
      return;
    }

    setLoading(true);
    fetchWithTimeout(`/data/tickets/${yearMonth}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json();
      })
      .then((data: Ticket[]) => {
        const list = Array.isArray(data) ? data : [];
        cacheRef.current[yearMonth] = list;
        setTickets(list);
      })
      .catch(() => {
        setTickets([]);
      })
      .finally(() => setLoading(false));
  }, [yearMonth]);

  return { tickets, loading };
}
