'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DayDecisions, TipMonthFile } from '@/lib/tips/types';

const months = new Map<string, TipMonthFile>();
const missingMonths = new Set<string>();

const DEV = process.env.NODE_ENV === 'development';

function tipHeaders(passcode: string): HeadersInit {
  return { 'x-tip-passcode': passcode };
}

async function fetchTipMonth(month: string, passcode: string): Promise<Response> {
  if (DEV) return fetch(`/data/tips/${encodeURIComponent(month)}.json`);
  return fetch(`/api/tip-data?month=${encodeURIComponent(month)}`, { headers: tipHeaders(passcode) });
}

export function clearTipCache(): void {
  months.clear();
  missingMonths.clear();
}

export async function checkTipPasscode(code: string): Promise<{ ok: boolean; error?: string }> {
  if (DEV) return { ok: true };
  const res = await fetch('/api/tip-data?check=1', { headers: tipHeaders(code) });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => ({})) as { error?: string };
  return { ok: false, error: body.error || 'Wrong passcode' };
}

function shiftDay(iso: string, count: number): string {
  const [year, month, date] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, date));
  dt.setUTCDate(dt.getUTCDate() + count);
  return dt.toISOString().slice(0, 10);
}

/** The save API accepts at most 31 days, so a longer payroll range is fetched in pieces. */
export function decisionChunks(from: string, to: string): { from: string; to: string }[] {
  if (!from || !to || from > to) return [];
  const chunks: { from: string; to: string }[] = [];
  let cursor = from;
  while (cursor <= to && chunks.length < 12) {
    let end = cursor;
    for (let step = 1; step < 31; step += 1) {
      const next = shiftDay(end, 1);
      if (next > to) break;
      end = next;
    }
    chunks.push({ from: cursor, to: end });
    const next = shiftDay(end, 1);
    if (next <= end) break;
    cursor = next;
  }
  return chunks;
}

export function useTipMonth(month: string, passcode: string) {
  const [data, setData] = useState<TipMonthFile | null>(month && passcode ? months.get(month) ?? null : null);
  const [loading, setLoading] = useState(Boolean(month && passcode) && !months.has(month));
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!month || !passcode) {
      setData(null);
      setLoading(false);
      setMissing(false);
      setFailed(null);
      return;
    }
    const cached = months.get(month);
    if (cached) {
      setData(cached);
      setLoading(false);
      setMissing(false);
      setFailed(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    setFailed(null);
    fetchTipMonth(month, passcode)
      .then((res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json() as Promise<TipMonthFile>;
      })
      .then((json) => {
        if (cancelled) return;
        if (!json) {
          setData(null);
          setMissing(true);
          return;
        }
        months.set(month, json);
        setData(json);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(null);
        setFailed(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, passcode]);

  return { data, loading, missing, failed };
}

export function useTipDecisions(from: string, to: string, passcode: string) {
  const [days, setDays] = useState<Record<string, DayDecisions>>({});
  const [loading, setLoading] = useState(Boolean(from && to && passcode));
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(() => {
    const chunks = decisionChunks(from, to);
    if (!chunks.length || !passcode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all(chunks.map(async (chunk) => {
      const res = await fetch(`/api/tip-worksheet?from=${chunk.from}&to=${chunk.to}`, {
        headers: tipHeaders(passcode),
      });
      if (!res.ok) throw new Error('unavailable');
      return res.json() as Promise<{ days?: Record<string, DayDecisions> }>;
    }))
      .then((parts) => {
        const merged: Record<string, DayDecisions> = {};
        for (const part of parts) Object.assign(merged, part.days ?? {});
        setDays(merged);
        setNote(null);
      })
      .catch(() => {
        setNote('Saved decisions are not reachable from here. Proposed numbers still show, and a save will not stick until this is opened on the published site.');
      })
      .finally(() => setLoading(false));
  }, [from, to, passcode]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { days, setDays, loading, note, reload };
}

export function useTipMonths(needed: string[], passcode: string) {
  const key = needed.filter(Boolean).join('|');
  const [files, setFiles] = useState<TipMonthFile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const list = key ? key.split('|') : [];
    if (!list.length || !passcode) {
      setFiles([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const missing = list.filter((month) => !months.has(month) && !missingMonths.has(month));
    setFiles(list.map((month) => months.get(month)).filter((file): file is TipMonthFile => Boolean(file)));
    if (!missing.length) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all(missing.map(async (month) => {
      const res = await fetchTipMonth(month, passcode);
      if (res.status === 404) {
        missingMonths.add(month);
        return;
      }
      if (!res.ok) return;
      const json = await res.json() as TipMonthFile;
      months.set(month, json);
    }))
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        setFiles(list.map((month) => months.get(month)).filter((file): file is TipMonthFile => Boolean(file)));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key, passcode]);

  return { files, loading };
}

export async function saveTipDecisions(decisions: DayDecisions, passcode: string): Promise<DayDecisions> {
  const res = await fetch('/api/tip-worksheet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tip-passcode': passcode,
    },
    body: JSON.stringify(decisions),
  });
  const body = await res.json().catch(() => ({})) as { error?: string; decisions?: DayDecisions };
  if (!res.ok || !body.decisions) {
    throw new Error(body.error || `Save failed (${res.status})`);
  }
  return body.decisions;
}
