'use client';

import { useEffect, type ReactNode } from 'react';
import type { TipRules } from '@/lib/tips/types';

function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

function roleList(roles: string[]): string {
  if (!roles.length) return 'no roles set';
  if (roles.length === 1) return roles[0];
  return `${roles.slice(0, -1).join(', ')} and ${roles[roles.length - 1]}`;
}

function Department({ title, roles, children }: { title: string; roles: string[]; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted">{roleList(roles)}</p>
      </div>
      <ul className="list-disc pl-5 space-y-1 text-sm text-secondary">{children}</ul>
    </section>
  );
}

export function TipRulesGuide({ open, onClose, rules }: { open: boolean; onClose: () => void; rules: TipRules }) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const floorCut = rules.floorPercent;
  const kitchenCut = rules.kitchenPercent;
  const coordinatorCut = rules.coordinatorPercent;
  const supportCut = 100 - coordinatorCut;
  const barSalesCut = rules.bartenderSalesPercent;
  const evening = hourLabel(rules.daypartHour);
  const dayStart = hourLabel(rules.businessDayCutoffHour);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="How tips are split"
        className="card w-full max-w-3xl max-h-[85vh] overflow-auto p-5 sm:p-6 space-y-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">How tips are split</h2>
            <p className="text-sm text-secondary mt-1">
              A tip goes to the pool of the role the person was clocked in as when the tab closed. Parties are tabs with a
              service charge and are split separately.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-secondary hover:text-foreground">
            Close
          </button>
        </div>

        <Department title="Bartenders and servers" roles={rules.pools.bar}>
          <li>Keep {100 - floorCut}% of bar and server tips, split evenly among everyone in this group on the clock when each tab closed.</li>
          <li>The other {floorCut}% goes to the floor.</li>
          <li>
            At a party, bartenders on the clock during the party split {barSalesCut}% of the party&apos;s bar sales, taken
            first from the party&apos;s tips.
          </li>
          <li>Get the floor&apos;s share back for any stretch with no front desk or scoretech on the clock.</li>
        </Department>

        <Department title="Cafe" roles={rules.pools.cafe}>
          <li>Keep {100 - kitchenCut}% of cafe tips, split evenly among cafe staff on the clock when each tab closed.</li>
          <li>The other {kitchenCut}% goes to the kitchen.</li>
          <li>Get the kitchen&apos;s share back for any stretch with nobody in the kitchen on the clock.</li>
        </Department>

        <Department title="Floor" roles={rules.pools.floor}>
          <li>
            Get {floorCut}% of bar and server tips, spread by time: the share is divided across the minutes bartenders or
            servers were working, and each stretch is split evenly among the floor staff on the clock then.
          </li>
          <li>Daytime (before {evening}) and evening are counted separately.</li>
          <li>
            At a party, split the kitchen and floor share ({supportCut}% of what is left after the bartender cut) evenly
            with kitchen staff on the clock during the party.
          </li>
        </Department>

        <Department title="Kitchen" roles={rules.pools.kitchen}>
          <li>Get {kitchenCut}% of cafe tips, spread by time across cafe hours the same way the floor&apos;s share is.</li>
          <li>Daytime (before {evening}) and evening are counted separately.</li>
          <li>
            At a party, split the kitchen and floor share ({supportCut}% of what is left after the bartender cut) evenly
            with floor staff on the clock during the party.
          </li>
        </Department>

        <Department title="Party servers (coordinators)" roles={rules.pools.coordinator}>
          <li>
            Get {coordinatorCut}% of each party&apos;s tips after the bartender cut, split evenly among the coordinators on
            that party.
          </li>
          <li>Coordinators come from the server tag on the tab, or whoever the GM picks.</li>
        </Department>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Parties, step by step</h3>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-secondary">
            <li>The party&apos;s tips are its service charge plus any extra gratuity.</li>
            <li>
              Bartenders take {barSalesCut}% of the party&apos;s bar sales first. If that is more than the tips, they get all of
              it.
            </li>
            <li>Of what is left, {coordinatorCut}% goes to the coordinators and {supportCut}% to kitchen and floor staff on during the party.</li>
          </ol>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Good to know</h3>
          <ul className="list-disc pl-5 space-y-1 text-sm text-secondary">
            <li>A business day runs from {dayStart} to {dayStart} the next morning.</li>
            <li>
              Tips for a name that doesn&apos;t match one employee, or for someone not clocked in to a tip role, wait for the GM.
              The GM can put them in a pool or give them to one person. Tips given to one person skip the tip-out.
            </li>
            <li>Leftover pennies from an even split go to whoever clocked in first.</li>
            <li>The GM can add or remove people on any tile, or change an amount with a reason, before closing the day.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
