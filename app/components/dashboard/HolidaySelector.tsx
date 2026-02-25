'use client';

import { useMemo } from 'react';
import { buildGroupedHolidays } from '@/lib/holiday-groups';

interface Props {
  holidays: string[];
  selected: string;
  onChange: (holiday: string) => void;
}

export function HolidaySelector({ holidays, selected, onChange }: Props) {
  const grouped = useMemo(() => buildGroupedHolidays(holidays), [holidays]);

  // Derive active group from selected holiday
  const activeGroup = useMemo(() => {
    for (const [group, members] of grouped) {
      if (members.includes(selected)) return group;
    }
    return grouped[0]?.[0] ?? '';
  }, [grouped, selected]);

  const activeMembers = useMemo(() => {
    const found = grouped.find(([g]) => g === activeGroup);
    return found ? found[1] : [];
  }, [grouped, activeGroup]);

  function handleGroupChange(groupLabel: string) {
    const found = grouped.find(([g]) => g === groupLabel);
    if (found && found[1].length > 0) {
      onChange(found[1][0]);
    }
  }

  if (grouped.length === 0) return null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
      <div className="flex-shrink-0">
        <label htmlFor="holiday-group" className="sr-only">
          Select holiday group
        </label>
        <select
          id="holiday-group"
          value={activeGroup || grouped[0][0]}
          onChange={(e) => {
            const value = e.target.value;
            if (value) handleGroupChange(value);
          }}
          className="w-full sm:w-56 bg-white/5 border border-border rounded-lg px-4 py-3 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          {grouped.map(([groupLabel]) => (
            <option key={groupLabel} value={groupLabel} className="bg-gray-900">
              {groupLabel}
            </option>
          ))}
        </select>
      </div>

      {activeMembers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeMembers.map((name) => {
            const isSelectedDay = selected === name;
            return (
              <button
                key={name}
                onClick={() => onChange(name)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  isSelectedDay
                    ? 'bg-accent/20 text-accent border border-accent/50'
                    : 'bg-white/5 text-secondary hover:bg-white/10 hover:text-white border border-transparent'
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
