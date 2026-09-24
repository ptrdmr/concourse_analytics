'use client';

import { useLongPress } from '@/hooks/useLongPress';
import { ALL_DEPARTMENTS, nextSelection } from '@/lib/departments';

interface Props {
  /** Pill labels in display order; include 'All' to show the reset pill. */
  options: string[];
  /** Empty means all departments. */
  selected: string[];
  onChange: (next: string[]) => void;
  /** Options that cannot be combined with others (e.g. 'Modifiers'). */
  exclusive?: string[];
}

export function DepartmentPills({ options, selected, onChange, exclusive }: Props) {
  const { bind, consumeLongPress } = useLongPress();

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {options.map(dept => {
          const active = dept === ALL_DEPARTMENTS ? selected.length === 0 : selected.includes(dept);
          return (
            <button
              key={dept}
              type="button"
              aria-pressed={active}
              {...bind(() => onChange(nextSelection(selected, dept, true, exclusive)))}
              onClick={e => {
                if (consumeLongPress()) return;
                onChange(nextSelection(selected, dept, e.ctrlKey || e.metaKey, exclusive));
              }}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors select-none [-webkit-touch-callout:none] ${
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-overlay/5 text-secondary hover:bg-overlay/10 hover:text-foreground'
              }`}
            >
              {dept}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted">Ctrl/Cmd-click or press and hold to select more than one.</p>
    </div>
  );
}
