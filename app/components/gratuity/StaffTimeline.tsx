'use client';

import type { ReactNode } from 'react';
import { addDays, zonedMs } from '@/lib/tips/engine';
import type { PoolName, TimelineParty, TimelinePunch } from '@/lib/tips/types';

const POOL_COLOR: Record<PoolName, string> = {
  bar: '#6ee7b7',
  cafe: '#fbbf24',
  coordinator: '#c4b5fd',
  floor: '#93c5fd',
  kitchen: '#fdba74',
};

function leftPercent(iso: string, start: number, span: number): number {
  const at = Date.parse(iso);
  if (!Number.isFinite(at) || span <= 0) return 0;
  return Math.min(100, Math.max(0, ((at - start) / span) * 100));
}

export function StaffTimeline({
  date,
  punches,
  parties,
  daypartHour,
}: {
  date: string;
  punches: TimelinePunch[];
  parties: TimelineParty[];
  daypartHour: number;
}) {
  const start = zonedMs(date, 4);
  const end = zonedMs(addDays(date, 1), 4);
  const span = end - start;
  const hours = [4, 8, 12, 16, 20, 24, 28];
  const people = new Map<string, { name: string; bars: TimelinePunch[] }>();
  for (const punch of punches) {
    const row = people.get(punch.employeeId) ?? { name: punch.name, bars: [] };
    row.bars.push(punch);
    people.set(punch.employeeId, row);
  }
  const rows = [...people.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="card p-4 sm:p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Who was here</h2>
        <p className="text-xs text-muted">4am to 4am · line at {daypartHour === 12 ? 'noon' : `${daypartHour > 12 ? daypartHour - 12 : daypartHour}${daypartHour >= 12 ? 'pm' : 'am'}`}</p>
      </div>
      <div className="relative h-6">
        {hours.map((hour) => {
          const pct = ((hour - 4) / 24) * 100;
          const labelHour = hour % 24;
          const label = labelHour === 0 ? '12a' : labelHour === 12 ? '12p' : labelHour > 12 ? `${labelHour - 12}p` : `${labelHour}a`;
          return (
            <span key={hour} className="absolute top-0 text-[10px] text-muted -translate-x-1/2" style={{ left: `${pct}%` }}>
              {label}
            </span>
          );
        })}
      </div>
      <div className="space-y-1.5">
        {parties.length > 0 && (
          <TimelineRow label="Parties" daypartHour={daypartHour}>
            {parties.map((party) => (
              <Bar
                key={party.id}
                title={party.label}
                color="#f0abfc"
                left={leftPercent(party.start, start, span)}
                width={leftPercent(party.end, start, span) - leftPercent(party.start, start, span)}
              />
            ))}
          </TimelineRow>
        )}
        {rows.length === 0 && <p className="text-sm text-muted">No clock-ins for this day yet.</p>}
        {rows.map((row) => (
          <TimelineRow key={row.name} label={row.name} daypartHour={daypartHour}>
            {row.bars.map((bar, index) => (
              <Bar
                key={`${bar.in}-${index}`}
                title={`${bar.role} ${bar.in.slice(11, 16)}–${bar.out.slice(11, 16)}`}
                color={bar.pool ? POOL_COLOR[bar.pool] : '#a3a3a3'}
                left={leftPercent(bar.in, start, span)}
                width={Math.max(0.4, leftPercent(bar.out, start, span) - leftPercent(bar.in, start, span))}
              />
            ))}
          </TimelineRow>
        ))}
      </div>
    </div>
  );
}

function TimelineRow({
  label,
  daypartHour,
  children,
}: {
  label: string;
  daypartHour: number;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 items-center">
      <p className="text-xs text-secondary truncate" title={label}>{label}</p>
      <div className="relative h-3 rounded bg-overlay/5">
        <span className="absolute inset-y-0 border-l border-accent/50" style={{ left: `${((daypartHour - 4) / 24) * 100}%` }} />
        {children}
      </div>
    </div>
  );
}

function Bar({ title, color, left, width }: { title: string; color: string; left: number; width: number }) {
  if (width <= 0) return null;
  return (
    <span
      title={title}
      className="absolute inset-y-0 rounded-sm"
      style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color }}
    />
  );
}
