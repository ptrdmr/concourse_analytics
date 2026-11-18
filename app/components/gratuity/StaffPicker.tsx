'use client';

import { useMemo, useState } from 'react';
import type { StaffOption, StaffShift } from '@/lib/tips/types';

const TIME_ZONE = 'America/Los_Angeles';

function clock(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at));
}

export function clockRange(start: string, end: string): string {
  return `${clock(start)}–${clock(end)}`;
}

export function shiftText(shift: StaffShift): string {
  return `${shift.role}, ${clockRange(shift.in, shift.out)}`;
}

export function personShiftText(person: StaffOption): string {
  if (!person.shifts.length) return '';
  return person.shifts.map(shiftText).join(' · ');
}

export function StaffPicker({
  staff,
  selected,
  onToggle,
  roles,
}: {
  staff: StaffOption[];
  selected: string[];
  onToggle: (id: string) => void;
  /** When set, the list starts as people who worked this day in these roles. */
  roles?: string[];
}) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const worked = useMemo(() => staff.filter((person) => person.worked), [staff]);
  const inRole = useMemo(() => {
    if (!roles) return [];
    const wanted = new Set(roles);
    return staff.filter((person) => person.worked && person.roles.some((role) => wanted.has(role)));
  }, [staff, roles]);
  const shortList = useMemo(() => {
    if (!roles) return [];
    const seen = new Set(inRole.map((person) => person.id));
    const outliers = staff.filter((person) => selected.includes(person.id) && !seen.has(person.id));
    return [...inRole, ...outliers];
  }, [roles, inRole, staff, selected]);
  const shortIds = useMemo(() => new Set(shortList.map((person) => person.id)), [shortList]);
  const restWorked = useMemo(
    () => worked.filter((person) => !shortIds.has(person.id)),
    [worked, shortIds],
  );
  const others = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return staff.filter((person) => !person.worked && !shortIds.has(person.id) && (!needle || person.name.toLowerCase().includes(needle)));
  }, [staff, query, shortIds]);

  if (roles) {
    return (
      <div className="space-y-3">
        {shortList.length === 0 ? (
          <p className="text-sm text-muted">Nobody in this role worked this day.</p>
        ) : (
          <ul className="space-y-1">
            {shortList.map((person) => (
              <PickerRow key={person.id} person={person} picked={selected.includes(person.id)} highlight={person.worked} onToggle={onToggle} />
            ))}
          </ul>
        )}
        <button type="button" onClick={() => setShowAll((value) => !value)} className="text-sm text-accent">
          {showAll ? 'Hide full list' : 'Show all employees'}
        </button>
        {showAll && (
          <div className="space-y-4">
            {restWorked.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted mb-2">Also worked this day</p>
                <ul className="space-y-1">
                  {restWorked.map((person) => (
                    <PickerRow key={person.id} person={person} picked={selected.includes(person.id)} highlight onToggle={onToggle} />
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-wide text-muted mb-2">Everyone else</p>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search employees"
                className="mb-2 w-full rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground"
                aria-label="Search employees who did not work this day"
              />
              <ul className="max-h-48 overflow-auto space-y-1">
                {others.length === 0 && <li className="text-sm text-muted">No matches.</li>}
                {others.map((person) => (
                  <PickerRow key={person.id} person={person} picked={selected.includes(person.id)} onToggle={onToggle} />
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted mb-2">Worked this day</p>
        {worked.length === 0 ? (
          <p className="text-sm text-muted">Nobody clocked in.</p>
        ) : (
          <ul className="space-y-1">
            {worked.map((person) => (
              <PickerRow key={person.id} person={person} picked={selected.includes(person.id)} highlight onToggle={onToggle} />
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted mb-2">Everyone else</p>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search employees"
          className="mb-2 w-full rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground"
          aria-label="Search employees who did not work this day"
        />
        <ul className="max-h-48 overflow-auto space-y-1">
          {others.length === 0 && <li className="text-sm text-muted">No matches.</li>}
          {others.map((person) => (
            <PickerRow key={person.id} person={person} picked={selected.includes(person.id)} onToggle={onToggle} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function PickerRow({
  person,
  picked,
  highlight,
  onToggle,
}: {
  person: StaffOption;
  picked: boolean;
  highlight?: boolean;
  onToggle: (id: string) => void;
}) {
  const detail = personShiftText(person);
  return (
    <li>
      <button
        type="button"
        aria-pressed={picked}
        onClick={() => onToggle(person.id)}
        className={`w-full text-left rounded-lg px-3 py-2 ${
          highlight ? 'bg-accent/15' : 'bg-overlay/5'
        } ${picked ? 'ring-1 ring-accent' : ''}`}
      >
        <span className="block text-sm text-foreground">{person.name}</span>
        {detail && <span className="block text-xs text-secondary">{detail}</span>}
        {!person.worked && picked && <span className="block text-xs text-amber-300">Did not work this day</span>}
      </button>
    </li>
  );
}
