'use client';

import { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import type { DateRange } from '@/lib/date-ranges';

const MIN_YEAR = 2010;
const MAX_YEAR = 2030;

function isValidDate(value: string): boolean {
  if (!value || value.length < 10) return false;
  const year = parseInt(value.slice(0, 4), 10);
  return !isNaN(year) && year >= MIN_YEAR && year <= MAX_YEAR;
}

interface Props {
  periodA: DateRange | null;
  periodB: DateRange | null;
  onPeriodAChange: (range: DateRange | null) => void;
  onPeriodBChange: (range: DateRange | null) => void;
}

const dateConstraints = {
  min: `${MIN_YEAR}-01-01`,
  max: `${MAX_YEAR}-12-31`,
};

export function ComparisonPeriodPicker({
  periodA,
  periodB,
  onPeriodAChange,
  onPeriodBChange,
}: Props) {
  const [localA, setLocalA] = useState<[string, string]>(() => periodA ?? ['', '']);
  const [localB, setLocalB] = useState<[string, string]>(() => periodB ?? ['', '']);

  useEffect(() => {
    if (periodA) setLocalA(periodA);
  }, [periodA?.[0], periodA?.[1]]);
  useEffect(() => {
    if (periodB) setLocalB(periodB);
  }, [periodB?.[0], periodB?.[1]]);

  function commitA(start: string, end: string) {
    if (!isValidDate(start) || !isValidDate(end)) {
      if (periodA) setLocalA(periodA);
      return;
    }
    const s = start <= end ? start : end;
    const e = start <= end ? end : start;
    onPeriodAChange([s, e]);
    setLocalA([s, e]);
  }
  function commitB(start: string, end: string) {
    if (!isValidDate(start) || !isValidDate(end)) {
      if (periodB) setLocalB(periodB);
      return;
    }
    const s = start <= end ? start : end;
    const e = start <= end ? end : start;
    onPeriodBChange([s, e]);
    setLocalB([s, e]);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="card p-5">
        <div className="flex items-center gap-2 text-secondary mb-3">
          <Calendar className="w-4 h-4" />
          <span className="text-sm font-medium">Period A</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            type="date"
            value={localA[0]}
            min={dateConstraints.min}
            max={dateConstraints.max}
            onChange={e => setLocalA([e.target.value, localA[1]])}
            onBlur={() => commitA(localA[0], localA[1])}
            className="px-3 py-2 rounded-lg bg-white/5 border border-border text-sm text-white focus:outline-none focus:border-accent/50 [color-scheme:dark]"
          />
          <span className="text-muted self-center">to</span>
          <input
            type="date"
            value={localA[1]}
            min={dateConstraints.min}
            max={dateConstraints.max}
            onChange={e => setLocalA([localA[0], e.target.value])}
            onBlur={() => commitA(localA[0], localA[1])}
            className="px-3 py-2 rounded-lg bg-white/5 border border-border text-sm text-white focus:outline-none focus:border-accent/50 [color-scheme:dark]"
          />
        </div>
        {periodA && (
          <p className="text-xs text-muted mt-2">{periodA[0]} → {periodA[1]}</p>
        )}
      </div>
      <div className="card p-5">
        <div className="flex items-center gap-2 text-secondary mb-3">
          <Calendar className="w-4 h-4" />
          <span className="text-sm font-medium">Period B</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            type="date"
            value={localB[0]}
            min={dateConstraints.min}
            max={dateConstraints.max}
            onChange={e => setLocalB([e.target.value, localB[1]])}
            onBlur={() => commitB(localB[0], localB[1])}
            className="px-3 py-2 rounded-lg bg-white/5 border border-border text-sm text-white focus:outline-none focus:border-accent/50 [color-scheme:dark]"
          />
          <span className="text-muted self-center">to</span>
          <input
            type="date"
            value={localB[1]}
            min={dateConstraints.min}
            max={dateConstraints.max}
            onChange={e => setLocalB([localB[0], e.target.value])}
            onBlur={() => commitB(localB[0], localB[1])}
            className="px-3 py-2 rounded-lg bg-white/5 border border-border text-sm text-white focus:outline-none focus:border-accent/50 [color-scheme:dark]"
          />
        </div>
        {periodB && (
          <p className="text-xs text-muted mt-2">{periodB[0]} → {periodB[1]}</p>
        )}
      </div>
    </div>
  );
}
