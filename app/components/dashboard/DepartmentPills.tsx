'use client';

import { useLongPress } from '@/hooks/useLongPress';
import { ALL_DEPARTMENTS, nextSelection } from '@/lib/departments';

interface Props {
  /** Pill labels in display order; include 'All' to show the reset pill. */
  options: string[];
  /** Empty means all revenue departments. */
  selected: string[];
  onChange: (next: string[]) => void;
  /** Options that cannot be combined with others (e.g. 'Modifiers'). */
  exclusive?: string[];
  /** Shown after a divider. Selecting one clears every revenue department. */
  nonRevenue?: string[];
}

function PillButton({
  dept,
  active,
  dashed,
  onSelect,
}: {
  dept: string;
  active: boolean;
  dashed: boolean;
  onSelect: (additive: boolean) => void;
}) {
  const { bind, consumeLongPress } = useLongPress();
  return (
    <button
      type="button"
      aria-pressed={active}
      {...bind(() => onSelect(true))}
      onClick={e => {
        if (consumeLongPress()) return;
        onSelect(e.ctrlKey || e.metaKey);
      }}
      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors select-none [-webkit-touch-callout:none] ${
        dashed
          ? active
            ? 'bg-accent text-accent-foreground border border-dashed border-accent'
            : 'bg-transparent text-secondary border border-dashed border-secondary/50 hover:bg-overlay/10 hover:text-foreground'
          : active
            ? 'bg-accent text-accent-foreground'
            : 'bg-overlay/5 text-secondary hover:bg-overlay/10 hover:text-foreground'
      }`}
    >
      {dept}
    </button>
  );
}

export function DepartmentPills({ options, selected, onChange, exclusive, nonRevenue = [] }: Props) {
  const held = new Set(nonRevenue);
  const locked = [...new Set([...(exclusive ?? []), ...nonRevenue])];
  const main = options.filter(dept => !held.has(dept));
  const extra = options.filter(dept => held.has(dept));

  const select = (dept: string, additive: boolean) => {
    onChange(nextSelection(selected, dept, additive, locked));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {main.map(dept => (
          <PillButton
            key={dept}
            dept={dept}
            dashed={false}
            active={dept === ALL_DEPARTMENTS ? selected.length === 0 : selected.includes(dept)}
            onSelect={additive => select(dept, additive)}
          />
        ))}
      </div>
      {extra.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Non-revenue</span>
          {extra.map(dept => (
            <PillButton
              key={dept}
              dept={dept}
              dashed
              active={selected.includes(dept)}
              onSelect={additive => select(dept, additive)}
            />
          ))}
        </div>
      )}
      <p className="text-xs text-muted">Ctrl/Cmd-click or press and hold to select more than one.</p>
    </div>
  );
}

export function NonRevenueNotice({ label }: { label: string }) {
  return (
    <p className="text-sm text-secondary rounded-lg border border-dashed border-secondary/40 px-3 py-2">
      {label}. This is collected for someone else and is not counted as sales.
    </p>
  );
}
