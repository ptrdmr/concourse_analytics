'use client';

import { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { DATE_PRESETS, findPresetId, type DateRange } from '@/lib/date-ranges';

interface Props {
  value: DateRange | null;
  onChange: (range: DateRange | null) => void;
}

export function DateRangePicker({ value, onChange }: Props) {
  const [forceCustom, setForceCustom] = useState(false);
  const detectedId = findPresetId(value);
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
            onClick={() => selectPreset(preset.id, preset.range())}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeId === preset.id
                ? 'bg-accent/20 text-accent border border-accent/40'
                : 'bg-white/5 text-secondary hover:bg-white/10 hover:text-white border border-transparent'
            }`}
          >
            {preset.label}
          </button>
        ))}
        <button
          onClick={() => setForceCustom(true)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            activeId === 'custom'
              ? 'bg-accent/20 text-accent border border-accent/40'
              : 'bg-white/5 text-secondary hover:bg-white/10 hover:text-white border border-transparent'
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
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-border text-sm text-white focus:outline-none focus:border-accent/50 [color-scheme:dark]"
          />
          <span className="text-muted text-sm">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={e => {
              setCustomEnd(e.target.value);
              applyCustom(customStart, e.target.value);
            }}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-border text-sm text-white focus:outline-none focus:border-accent/50 [color-scheme:dark]"
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
