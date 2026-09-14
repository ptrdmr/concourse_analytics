'use client';

import { GitCompare } from 'lucide-react';

interface Props {
  compare: boolean;
  onCompareChange: (on: boolean) => void;
  years: number[];
  vsYear: number;
  onYearChange: (year: number) => void;
}

export function ReservationComparePicker({
  compare,
  onCompareChange,
  years,
  vsYear,
  onYearChange,
}: Props) {
  return (
    <>
      <span className="w-px h-4 bg-border mx-0.5 shrink-0 hidden sm:block" aria-hidden />
      <button
        type="button"
        onClick={() => onCompareChange(!compare)}
        className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-medium transition-colors ${
          compare
            ? 'bg-accent/20 text-accent border border-accent/40'
            : 'bg-overlay/5 text-secondary hover:bg-overlay/10 hover:text-foreground border border-transparent'
        }`}
      >
        <GitCompare className="w-3.5 h-3.5" />
        Compare
      </button>
      {years.map((year) => (
        <button
          key={year}
          type="button"
          onClick={() => onYearChange(year)}
          className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-medium transition-colors ${
            compare && vsYear === year
              ? 'bg-accent/20 text-accent border border-accent/40'
              : 'bg-overlay/5 text-secondary hover:bg-overlay/10 hover:text-foreground border border-transparent'
          }`}
        >
          {year}
        </button>
      ))}
    </>
  );
}
