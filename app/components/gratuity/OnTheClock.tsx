'use client';

import { useEffect } from 'react';
import { StaffTimeline } from './StaffTimeline';
import { clockRange } from './StaffPicker';
import type { TimelineParty, TimelinePunch } from '@/lib/tips/types';

const ROLE_ORDER = [
  'Bartender',
  'Server',
  'Cafe Front',
  'Party Server',
  'Front Desk',
  'Scoretech',
  'Dish/Prep',
  'Line',
  'Prep/Pizza',
];

export function OnTheClock({
  open,
  onClose,
  date,
  punches,
  parties,
  daypartHour,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  punches: TimelinePunch[];
  parties: TimelineParty[];
  daypartHour: number;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const byRole = new Map<string, Map<string, { name: string; shifts: { role: string; in: string; out: string }[] }>>();
  for (const punch of punches) {
    const role = punch.role || 'Other';
    const people = byRole.get(role) ?? new Map();
    const person = people.get(punch.employeeId) ?? { name: punch.name, shifts: [] };
    person.shifts.push({ role: punch.role, in: punch.in, out: punch.out });
    people.set(punch.employeeId, person);
    byRole.set(role, people);
  }
  const roles = [...byRole.keys()].sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a);
    const bi = ROLE_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Who was on the clock"
        className="card w-full max-w-3xl max-h-[85vh] overflow-auto p-5 sm:p-6 space-y-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Who was on the clock</h2>
          <button type="button" onClick={onClose} className="text-sm text-secondary hover:text-foreground">
            Close
          </button>
        </div>
        {roles.length === 0 && <p className="text-sm text-muted">Nobody clocked in this day.</p>}
        {roles.map((role) => (
          <section key={role}>
            <h3 className="text-sm font-semibold text-foreground mb-2">{role}</h3>
            <ul className="space-y-1">
              {[...(byRole.get(role)?.values() ?? [])]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((person) => (
                  <li key={person.name} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="text-foreground">{person.name}</span>
                    <span className="text-secondary">{person.shifts.map((shift) => clockRange(shift.in, shift.out)).join(' · ')}</span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
        <StaffTimeline date={date} punches={punches} parties={parties} daypartHour={daypartHour} />
      </div>
    </div>
  );
}
