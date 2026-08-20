'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { VerdictResult } from '@/lib/verdict';
import { formatVerdictDollars } from '@/lib/verdict';

interface Props {
  verdict: VerdictResult;
  loading?: boolean;
  /** Optional next-week house forecast dollars. */
  nextWeekForecast?: number | null;
}

function MathExpander({
  id,
  math,
  open,
  onToggle,
}: {
  id: string;
  math: string[];
  open: boolean;
  onToggle: (id: string) => void;
}) {
  if (math.length === 0) return null;
  return (
    <div className="mt-1 print:hidden">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="inline-flex items-center gap-1 text-xs text-muted hover:text-secondary"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        show the math
      </button>
      {open && (
        <ul className="mt-1.5 space-y-0.5 font-mono text-xs text-secondary pl-4 border-l border-overlay/20">
          {math.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VerdictBlock({ verdict, loading, nextWeekForecast }: Props) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  if (loading) return null;

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const subtitle =
    verdict.weekStart && verdict.weekEnd
      ? `${verdict.weekStart} to ${verdict.weekEnd}`
      : '';
  const showForward =
    nextWeekForecast != null && Number.isFinite(nextWeekForecast) && nextWeekForecast > 0;

  return (
    <section className="card p-5 sm:p-6 mb-8 print:shadow-none print:border print:border-black print:bg-white print:text-black print:break-inside-avoid">
      <div className="mb-4">
        <h3 className="text-lg sm:text-xl font-bold print:text-black">This Week&apos;s Verdict</h3>
        {subtitle && (
          <p className="text-sm text-muted mt-0.5 print:text-gray-700">{subtitle}</p>
        )}
      </div>

      {showForward && (
        <p className="text-sm text-secondary mb-4 print:text-black">
          Forecast next week: about{' '}
          {formatVerdictDollars(Math.round(nextWeekForecast! / 1000) * 1000)}.
        </p>
      )}

      <ul className="space-y-4">
        {verdict.findings.map((f) => (
          <li key={f.id} className="print:break-inside-avoid">
            <p className="text-sm sm:text-base leading-relaxed print:text-black">{f.sentence}</p>
            {f.watchNote && (
              <p className="text-xs text-muted mt-1 print:text-gray-600">
                Watch: {f.watchNote}
              </p>
            )}
            <MathExpander
              id={f.id}
              math={f.math}
              open={openIds.has(f.id)}
              onToggle={toggle}
            />
          </li>
        ))}
      </ul>

      {verdict.action && (
        <div className="mt-5 pl-3 border-l-4 border-accent print:border-black print:break-inside-avoid">
          <p className="text-sm sm:text-base font-medium leading-relaxed print:text-black">
            {verdict.action.sentence}
          </p>
          <MathExpander
            id="action"
            math={verdict.action.math}
            open={openIds.has('action')}
            onToggle={toggle}
          />
        </div>
      )}
    </section>
  );
}
