'use client';

import { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { DATE_PRESETS, findPresetId, type DateRange } from '@/lib/date-ranges';

interface Props {
  value: DateRange | null;
  onChange: (range: DateRange | null) => void;
  /** Last date with sales data; presets end here instead of on today. */
  dataThrough?: string | null;
}

export function DateRangePicker({ value, onChange, dataThrough }: Props) {
  const [forceCustom, setForceCustom] = useState(false);
  const detectedId = findPresetId(value, dataThrough);
  const activeId = forceCustom ? 'custom' : detectedId;

  const [customStart, setCustomStart] = useState(value?.[0] || '');
  const [customEnd, setCustomEnd] = useState(value?.[1] || '');

  useEffect(() => {
    if (value) {
      setCustomStart(value[0]);
      setCustomEnd(value[1]);
    }
  }, [value]);

  function selectPreset(id: string, range: DateRange | null) {
    setForceCustom(false);
    onChange(range);
  }

  function applyCustom(start: string, end: string) {
    if (start && end && start <= end) {
      onChange([start, end]);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Calendar className="w-4 h-4 text-muted shrink-0" />
        {DATE_PRESETS.map(preset => (
          <button
            key={preset.id}
            onClick={() => selectPreset(preset.id, preset.range(dataThrough))}
            className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-medium transition-colors ${
              activeId === preset.id
                ? 'bg-accent/20 text-accent border border-accent/40'
                : 'bg-overlay/5 text-secondary hover:bg-overlay/10 hover:text-foreground border border-transparent'
            }`}
          >
            {preset.label}
          </button>
        ))}
        <button
          onClick={() => setForceCustom(true)}
          className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-medium transition-colors ${
            activeId === 'custom'
              ? 'bg-accent/20 text-accent border border-accent/40'
              : 'bg-overlay/5 text-secondary hover:bg-overlay/10 hover:text-foreground border border-transparent'
          }`}
        >
          Custom
        </button>
      </div>

      {activeId === 'custom' && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={customStart}
            onChange={e => {
              setCustomStart(e.target.value);
              applyCustom(e.target.value, customEnd);
            }}
            className="px-3 py-1.5 rounded-lg bg-overlay/5 border border-border text-sm text-foreground focus:outline-none focus:border-accent/50"
          />
          <span className="text-muted text-sm">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={e => {
              setCustomEnd(e.target.value);
              applyCustom(customStart, e.target.value);
            }}
            className="px-3 py-1.5 rounded-lg bg-overlay/5 border border-border text-sm text-foreground focus:outline-none focus:border-accent/50"
          />
        </div>
      )}

      {value && (
        <p className="text-xs text-muted">
          Showing {value[0]} to {value[1]}
        </p>
      )}
    </div>
  );
}
