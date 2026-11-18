'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { buildWorksheet, classifyDay, latestWorkedDay } from '@/lib/tips/engine';
import type { CardDecision, DayDecisions, DayPerson, DayTile, Payout, SplitKey, StaffOption, TipCard, TipIssue, TipRules, TileState } from '@/lib/tips/types';
import { emptyDecisions, payoutTotal } from '@/lib/tips/types';
import { saveTipDecisions, useTipDecisions, useTipMonth } from '@/hooks/useTipFacts';
import { OnTheClock } from './OnTheClock';
import { StaffPicker } from './StaffPicker';

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function dollarsToCents(value: string): number | null {
  const trimmed = value.trim().replace(/^\$/, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

const TONE: Record<TileState, string> = {
  review: 'border-amber-400/70 bg-amber-400/10 hover:bg-amber-400/20',
  confirmed: 'border-emerald-400/70 bg-emerald-400/10 hover:bg-emerald-400/20',
  decide: 'border-orange-500 bg-orange-500/20 hover:bg-orange-500/30',
  changed: 'border-amber-300 bg-amber-300/15 hover:bg-amber-300/25',
};

export function TipWorksheet({
  date,
  passcode,
  onDirty,
}: {
  date: string;
  passcode: string;
  onDirty: (dirty: boolean) => void;
}) {
  const month = useTipMonth(date.slice(0, 7), passcode);
  const remote = useTipDecisions(date, date, passcode);
  const [draft, setDraft] = useState<DayDecisions>(emptyDecisions(date));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'save' | 'close' | null>(null);
  const [openTile, setOpenTile] = useState<string | null>(null);
  const [clockOpen, setClockOpen] = useState(false);

  useEffect(() => {
    setDraft(remote.days[date] ?? emptyDecisions(date));
    setError(null);
    setPending(null);
    setOpenTile(null);
  }, [date]);

  useEffect(() => {
    const incoming = remote.days[date];
    if (!incoming) return;
    setDraft((current) => {
      const untouched = JSON.stringify(current) === JSON.stringify(emptyDecisions(date));
      return untouched ? incoming : current;
    });
  }, [date, remote.days]);

  const worksheet = useMemo(() => {
    if (!month.data?.rules) return null;
    const facts = month.data.days[date] ?? { tabs: [], punches: [], reservations: [] };
    return buildWorksheet(date, facts, month.data.directory, month.data.rules, draft);
  }, [month.data, date, draft]);

  useEffect(() => {
    if (openTile && worksheet && !worksheet.tiles.some((tile) => tile.id === openTile)) setOpenTile(null);
  }, [openTile, worksheet]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(remote.days[date] ?? emptyDecisions(date));
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  if (month.loading || remote.loading) return <p className="text-secondary">Loading the day…</p>;
  if (month.missing || !month.data || !worksheet) {
    return (
      <p className="text-secondary">
        No tip file for this month yet. The nightly export writes it, or from this machine run{' '}
        <code className="text-accent">py -3 scripts/export_tips.py</code>.
      </p>
    );
  }

  const state = classifyDay({
    date,
    monthLoaded: true,
    lastWorked: latestWorkedDay(month.data.days),
    dayInFile: Boolean(month.data.days[date]),
    worksheet,
    decisions: draft.closedAt ? draft : null,
  });
  const tilesLeft = worksheet.tiles.filter((tile) => tile.state !== 'confirmed');
  const canClose = (state === 'not-closed' || state === 'changed')
    && worksheet.totals.waitingCents === 0
    && worksheet.tiles.length > 0
    && tilesLeft.length === 0;
  const assigned = worksheet.cards.find((card) => card.id === 'assigned');
  const worked = new Set(worksheet.staff.filter((person) => person.worked).map((person) => person.id));
  const active = worksheet.tiles.find((tile) => tile.id === openTile) ?? null;
  const outside = worksheet.issues.filter((issue) => issue.kind === 'unpooled' || issue.kind === 'unmatched');

  let status = 'Ready to close';
  if (state === 'no-data') status = 'No tips recorded yet';
  else if (state === 'nothing') status = 'Nothing to process';
  else if (state === 'processed') status = 'Closed';
  else if (state === 'changed') status = 'Changed since closing';
  else if (tilesLeft.some((tile) => tile.state === 'decide')) {
    const count = tilesLeft.filter((tile) => tile.state === 'decide').length;
    status = count === 1 ? '1 to decide' : `${count} to decide`;
  } else if (tilesLeft.length) {
    status = tilesLeft.length === 1 ? '1 to review' : `${tilesLeft.length} to review`;
  }

  function patch(recipe: (prev: DayDecisions) => DayDecisions) {
    setDraft((prev) => recipe({
      ...prev,
      closedAt: undefined,
      closedFingerprint: undefined,
    }));
  }

  function patchTileCard(cardId: string, next: Partial<CardDecision>) {
    if (!active) return;
    patch((prev) => {
      const cards = { ...prev.cards };
      for (const id of active.cardIds) {
        const current = { ...(cards[id] ?? {}) };
        if (id === cardId) Object.assign(current, next);
        else if (!current.confirmedAt && !current.confirmedFingerprint) continue;
        delete current.confirmedAt;
        delete current.confirmedFingerprint;
        if (Object.keys(current).length === 0) delete cards[id];
        else cards[id] = current;
      }
      return { ...prev, cards };
    });
  }

  function assignIssue(issue: TipIssue, choice: { assignPool?: 'bar' | 'cafe'; assignEmployeeId?: string }) {
    patch((prev) => ({
      ...prev,
      issues: {
        ...prev.issues,
        [issue.id]: { assignPool: choice.assignPool, assignEmployeeId: choice.assignEmployeeId },
      },
    }));
  }

  async function save(next: DayDecisions, code: string) {
    setSaving(true);
    setError(null);
    try {
      const stored = await saveTipDecisions(next, code);
      setDraft(stored);
      remote.setDays((prev) => ({ ...prev, [stored.date]: stored }));
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function closeDraft(): DayDecisions | null {
    if (!worksheet || !canClose) return null;
    return {
      ...draft,
      closedAt: new Date().toISOString(),
      closedFingerprint: worksheet.fingerprint,
    };
  }

  function request(action: 'save' | 'close') {
    const next = action === 'close' ? closeDraft() : draft;
    if (!next || !passcode) return;
    setPending(action);
    void save(next, passcode);
  }

  function confirmOpenTile() {
    if (!worksheet || !active) return;
    if (active.state === 'decide' || active.state === 'confirmed') return;
    const cards = active.cardIds
      .map((id) => worksheet.cards.find((card) => card.id === id))
      .filter((card): card is TipCard => Boolean(card));
    if (cards.some((card) => card.unassignedCents !== 0)) return;
    const at = new Date().toISOString();
    patch((prev) => {
      const nextCards = { ...prev.cards };
      for (const card of cards) {
        nextCards[card.id] = {
          ...(prev.cards[card.id] ?? {}),
          confirmedAt: at,
          confirmedFingerprint: card.fingerprint,
        };
      }
      return { ...prev, cards: nextCards };
    });
    setOpenTile(null);
  }

  return (
    <div className="space-y-6">
      <section className="card p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted">Status</p>
            <p className={`text-lg font-semibold mt-1 ${state === 'processed' ? 'text-accent' : state === 'changed' || tilesLeft.some((tile) => tile.state === 'decide') ? 'text-amber-300' : 'text-foreground'}`}>
              {status}
            </p>
          </div>
          <div className="flex flex-wrap gap-6">
            <Amount label="Collected" cents={worksheet.totals.collectedCents} />
            <Amount label="Paid out" cents={worksheet.totals.paidCents} />
            <Amount label="Waiting" cents={worksheet.totals.waitingCents} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setClockOpen(true)} className="px-4 py-2 rounded-full text-sm bg-overlay/5 text-foreground">
            Who was on the clock
          </button>
          {dirty && state !== 'processed' && (
            <button type="button" onClick={() => request('save')} disabled={saving} className="px-4 py-2 rounded-full text-sm bg-overlay/5 text-foreground disabled:opacity-40">
              {saving && pending !== 'close' ? 'Saving…' : 'Save'}
            </button>
          )}
          <button type="button" onClick={() => request('close')} disabled={saving || !canClose} className="px-4 py-2 rounded-full text-sm bg-accent/15 text-accent disabled:opacity-40">
            {saving && pending === 'close' ? 'Closing…' : state === 'processed' ? 'Closed' : 'Close day'}
          </button>
          {!canClose && (state === 'not-closed' || state === 'changed') && (
            <span className="text-xs text-muted">
              {worksheet.totals.waitingCents !== 0
                ? 'Waiting money has to be assigned before the day can close.'
                : 'Confirm every tile before the day can close.'}
            </span>
          )}
        </div>
        {state === 'no-data' && (
          <p className="text-sm text-secondary">The nightly has not recorded tips or clock-ins for this day yet, so it stays out of the payroll totals.</p>
        )}
        {remote.days[date]?.closedAt && remote.days[date]?.closedFingerprint !== worksheet.fingerprint && (
          <p className="text-sm text-amber-300">The nightly numbers changed after this day was closed. Review the tiles and close it again.</p>
        )}
        {remote.note && <p className="text-sm text-amber-200/90">{remote.note}</p>}
        {error && <p className="text-sm text-amber-300">{error}</p>}
      </section>

      {active ? (
        <TileDetail
          key={active.id}
          tile={active}
          cards={active.cardIds
            .map((id) => worksheet.cards.find((card) => card.id === id))
            .filter((card): card is TipCard => Boolean(card))}
          issues={worksheet.issues}
          decisions={draft.cards}
          rules={month.data.rules}
          staff={worksheet.staff}
          worked={worked}
          onBack={() => setOpenTile(null)}
          onClock={() => setClockOpen(true)}
          onConfirm={confirmOpenTile}
          onPatch={patchTileCard}
        />
      ) : (
        <>
          {outside.length > 0 && (
            <div className="space-y-3">
              {outside.map((issue) => (
                <OutsideRow key={issue.id} issue={issue} staff={worksheet.staff} onAssign={(choice) => assignIssue(issue, choice)} />
              ))}
            </div>
          )}
          {worksheet.tiles.length > 0 && (
            <div className="flex flex-wrap gap-4">
              {worksheet.tiles.map((tile) => (
                <button
                  key={tile.id}
                  type="button"
                  onClick={() => setOpenTile(tile.id)}
                  className={`w-[16.25rem] max-w-full aspect-square rounded-2xl border p-4 flex flex-col items-center justify-center text-center gap-2 transition hover:-translate-y-0.5 ${TONE[tile.state]}`}
                >
                  <span className="text-sm sm:text-base font-semibold text-foreground">{tile.title}</span>
                  <span className="text-3xl sm:text-4xl font-semibold text-foreground tabular-nums">{money(tile.totalCents)}</span>
                  {tile.parts.length > 0 && (
                    <span className="text-sm text-secondary">
                      {tile.parts.map((part) => `${part.label} ${money(part.cents)}`).join(' · ')}
                    </span>
                  )}
                  <span className="text-sm text-secondary">{tile.subtitle}</span>
                  <span className="text-xs uppercase tracking-wide text-foreground/80 inline-flex items-center gap-1">
                    {tile.state === 'confirmed' && <Check className="w-4 h-4" aria-hidden />}
                    {tile.status}
                  </span>
                </button>
              ))}
            </div>
          )}
          {assigned && assigned.moneyInCents !== 0 && (
            <p className="text-sm text-secondary">
              Paid to one person, not pooled: {money(assigned.moneyInCents)}. That amount is in the day totals and does not pay the 10% tip-out.
            </p>
          )}
          {worksheet.people.length > 0 && (
            <DayTotals people={worksheet.people} staff={worksheet.staff} rules={month.data.rules} />
          )}
        </>
      )}

      <OnTheClock
        open={clockOpen}
        onClose={() => setClockOpen(false)}
        date={date}
        punches={worksheet.punches}
        parties={worksheet.parties}
        daypartHour={worksheet.daypartHour}
      />
    </div>
  );
}

const DEPT_LABEL: Record<string, string> = {
  bar: 'Bar',
  cafe: 'Cafe',
  floor: 'Floor',
  kitchen: 'Kitchen',
  coordinator: 'Parties',
  other: 'Other',
};

const DEPT_ORDER = ['bar', 'cafe', 'floor', 'kitchen', 'coordinator', 'other'];

const totalCols = 'grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_7.5rem] items-center gap-x-3';

function DayTotals({
  people,
  staff,
  rules,
}: {
  people: DayPerson[];
  staff: StaffOption[];
  rules: TipRules;
}) {
  const departments = useMemo(() => groupDayTotals(people, staff, rules), [people, staff, rules]);
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-foreground mb-3">Day totals</h2>
      <div className={`${totalCols} text-xs text-muted pb-2`}>
        <span />
        <span className="text-right">Service charge</span>
        <span className="text-right">Gratuity</span>
        <span className="text-right">Total</span>
      </div>
      {departments.map((department) => (
        <details key={department.id} className="group/dept border-t border-border/60">
          <summary className={`${totalCols} py-2 cursor-pointer font-semibold text-foreground list-none [&::-webkit-details-marker]:hidden`}>
            <span className="inline-flex items-center gap-2 min-w-0">
              <ChevronRight className="w-4 h-4 shrink-0 transition-transform group-open/dept:rotate-90" />
              <span className="truncate">{department.label}</span>
              <span className="text-xs font-normal text-muted">{department.people} {department.people === 1 ? 'person' : 'people'}</span>
            </span>
            <MoneyCells service={department.service} gratuity={department.gratuity} strong />
          </summary>
          <div className="pb-1">
            {department.roles.map((role) => (
              <details key={role.label} className="group/role">
                <summary className={`${totalCols} py-1.5 cursor-pointer text-sm text-foreground list-none [&::-webkit-details-marker]:hidden`}>
                  <span className="inline-flex items-center gap-2 min-w-0 pl-6">
                    <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform group-open/role:rotate-90" />
                    <span className="truncate">{role.label}</span>
                    <span className="text-xs text-muted">{role.people.length}</span>
                  </span>
                  <MoneyCells service={role.service} gratuity={role.gratuity} />
                </summary>
                {role.people.map((person) => (
                  <div key={person.employeeId} className={`${totalCols} py-1 text-sm`}>
                    <span className="pl-14 text-foreground truncate">{person.name}</span>
                    <MoneyCells service={person.serviceChargeCents} gratuity={person.gratuityCents} />
                  </div>
                ))}
              </details>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}

function MoneyCells({ service, gratuity, strong }: { service: number; gratuity: number; strong?: boolean }) {
  const weight = strong ? 'font-semibold' : '';
  return (
    <div className="contents">
      <span className={`text-right tabular-nums ${weight}`}>{money(service)}</span>
      <span className={`text-right tabular-nums ${weight}`}>{money(gratuity)}</span>
      <span className={`text-right tabular-nums text-accent ${weight}`}>{money(service + gratuity)}</span>
    </div>
  );
}

function groupDayTotals(people: DayPerson[], staff: StaffOption[], rules: TipRules) {
  const byId = new Map(staff.map((person) => [person.id, person]));
  const roleOrder = new Map<string, string[]>();
  for (const [pool, roles] of Object.entries(rules.pools)) roleOrder.set(pool, roles);
  const buckets = new Map<string, Map<string, DayPerson[]>>();
  for (const person of people) {
    const home = roleHome(byId.get(person.employeeId), rules);
    const roles = buckets.get(home.dept) ?? new Map<string, DayPerson[]>();
    const list = roles.get(home.role) ?? [];
    list.push(person);
    roles.set(home.role, list);
    buckets.set(home.dept, roles);
  }
  return DEPT_ORDER.filter((id) => buckets.has(id)).map((id) => {
    const roles = [...(buckets.get(id)?.entries() ?? [])];
    const order = roleOrder.get(id) ?? [];
    roles.sort((a, b) => {
      const ai = order.indexOf(a[0]);
      const bi = order.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a[0].localeCompare(b[0]);
    });
    const roleRows = roles.map(([label, members]) => {
      members.sort((a, b) => (b.serviceChargeCents + b.gratuityCents) - (a.serviceChargeCents + a.gratuityCents) || a.name.localeCompare(b.name));
      return {
        label,
        people: members,
        service: members.reduce((sum, person) => sum + person.serviceChargeCents, 0),
        gratuity: members.reduce((sum, person) => sum + person.gratuityCents, 0),
      };
    });
    return {
      id,
      label: DEPT_LABEL[id] ?? id,
      people: roleRows.reduce((sum, role) => sum + role.people.length, 0),
      service: roleRows.reduce((sum, role) => sum + role.service, 0),
      gratuity: roleRows.reduce((sum, role) => sum + role.gratuity, 0),
      roles: roleRows,
    };
  });
}

function roleHome(person: StaffOption | undefined, rules: TipRules): { dept: string; role: string } {
  const roles = person?.roles ?? [];
  if (!roles.length) return { dept: 'other', role: 'No clock-in' };
  const hours = new Map<string, { ms: number; start: number }>();
  for (const shift of person?.shifts ?? []) {
    const start = Date.parse(shift.in);
    const end = Date.parse(shift.out);
    const current = hours.get(shift.role) ?? { ms: 0, start: Number.POSITIVE_INFINITY };
    if (Number.isFinite(start) && Number.isFinite(end)) current.ms += Math.max(0, end - start);
    if (Number.isFinite(start) && start < current.start) current.start = start;
    hours.set(shift.role, current);
  }
  const [role] = [...roles].sort((a, b) => {
    const left = hours.get(a);
    const right = hours.get(b);
    return (right?.ms ?? 0) - (left?.ms ?? 0) || (left?.start ?? 0) - (right?.start ?? 0) || a.localeCompare(b);
  });
  for (const [pool, list] of Object.entries(rules.pools)) {
    if ((list ?? []).includes(role)) return { dept: pool, role };
  }
  return { dept: 'other', role };
}

function Amount({ label, cents }: { label: string; cents: number }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="text-lg font-semibold text-foreground mt-1 tabular-nums">{money(cents)}</p>
    </div>
  );
}

function sectionTitle(card: TipCard): string {
  if (card.id === 'bar') return 'Bartenders and servers (90%)';
  if (card.id === 'floor') return 'Floor staff (10%)';
  if (card.id === 'cafe') return 'Cafe staff (90%)';
  if (card.id === 'kitchen') return 'Kitchen (10%)';
  return card.title;
}

function poolAccent(cardId: string): string {
  if (cardId === 'bar') return 'border-l-amber-400';
  if (cardId === 'floor') return 'border-l-sky-400';
  if (cardId === 'cafe') return 'border-l-emerald-400';
  if (cardId === 'kitchen') return 'border-l-rose-400';
  return 'border-l-border';
}

function poolRoles(card: TipCard, rules: TipRules): string[] {
  if (card.id === 'bar') return rules.pools.bar ?? [];
  if (card.id === 'floor') return rules.pools.floor ?? [];
  if (card.id === 'cafe') return rules.pools.cafe ?? [];
  if (card.id === 'kitchen') return rules.pools.kitchen ?? [];
  return [];
}

const SPLIT_TITLE: Record<SplitKey, string> = {
  coordinators: 'Coordinators (60%)',
  support: 'Kitchen and floor (40%)',
  bartenders: 'Bartenders',
};

const SPLIT_ACCENT: Record<SplitKey, { bar: string; box: string }> = {
  coordinators: { bar: 'border-l-violet-400', box: 'border-violet-400/70 bg-violet-400/15' },
  support: { bar: 'border-l-sky-400', box: 'border-sky-400/70 bg-sky-400/15' },
  bartenders: { bar: 'border-l-amber-400', box: 'border-amber-400/70 bg-amber-400/15' },
};

function splitRoles(key: SplitKey, rules: TipRules): string[] {
  if (key === 'coordinators') return rules.pools.coordinator ?? [];
  if (key === 'support') return [...(rules.pools.floor ?? []), ...(rules.pools.kitchen ?? [])];
  return rules.partyBartenderRoles ?? [];
}

function SectionHeader({
  title,
  cents,
  accent,
  actionLabel,
  onAction,
}: {
  title: string;
  cents: number;
  accent: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border/80 pt-4 pl-3 border-l-4 ${accent}`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 min-w-0">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {onAction && actionLabel && (
          <button type="button" onClick={onAction} className="text-sm text-accent underline underline-offset-2">
            {actionLabel}
          </button>
        )}
      </div>
      <p className="text-lg font-semibold tabular-nums text-foreground">{money(cents)}</p>
    </div>
  );
}

function SubtotalBoxes({ party }: { party: TipCard }) {
  const boxes: { label: string; cents: number; className: string; note?: string }[] = [
    { label: 'Service charge', cents: party.serviceChargeCents, className: 'border-emerald-400/70 bg-emerald-400/15' },
    { label: 'Additional gratuity', cents: party.gratuityCents, className: 'border-fuchsia-400/70 bg-fuchsia-400/15' },
    { label: 'Bar sales', cents: party.facts?.barSalesCents ?? 0, className: 'border-border bg-overlay/10', note: 'Not part of the total' },
  ];
  for (const split of party.splits ?? []) {
    boxes.push({ label: SPLIT_TITLE[split.key], cents: split.cents, className: SPLIT_ACCENT[split.key].box });
  }
  return (
    <div className="space-y-3">
      {party.facts?.window && <p className="text-sm text-secondary text-center">{party.facts.window}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {boxes.map((box) => (
          <div key={box.label} className={`rounded-xl border px-3 py-2 ${box.className}`}>
            <p className="text-[11px] uppercase tracking-wide text-foreground/80">{box.label}</p>
            <p className="text-xl font-semibold tabular-nums text-foreground mt-1">{money(box.cents)}</p>
            {box.note && <p className="text-[11px] text-muted mt-0.5">{box.note}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function returnedPhrase(card: TipCard): string | null {
  if (card.id === 'floor') return 'returned to bar';
  if (card.id === 'kitchen') return 'returned to cafe';
  return null;
}

function TileDetail({
  tile,
  cards,
  issues,
  decisions,
  rules,
  staff,
  worked,
  onBack,
  onClock,
  onConfirm,
  onPatch,
}: {
  tile: DayTile;
  cards: TipCard[];
  issues: TipIssue[];
  decisions: Record<string, CardDecision>;
  rules: TipRules;
  staff: StaffOption[];
  worked: Set<string>;
  onBack: () => void;
  onClock: () => void;
  onConfirm: () => void;
  onPatch: (cardId: string, patch: Partial<CardDecision>) => void;
}) {
  const [openSwap, setOpenSwap] = useState<SplitKey | null>(null);
  const [openEdit, setOpenEdit] = useState<string | null>(null);
  const party = cards.find((card) => card.kind === 'party') ?? null;
  const pools = cards.filter((card) => card.kind !== 'party');
  const source = cards.find((card) => card.id === 'bar' || card.id === 'cafe');
  const unassigned = cards.reduce((sum, card) => sum + card.unassignedCents, 0);
  const notices = issues.filter((issue) => cards.some((card) => (
    issue.id.endsWith(`:${card.id}`) || issue.id.startsWith(`tag:${card.id}:`)
  )));
  const partyDecision = party ? decisions[party.id] : undefined;

  return (
    <section className="card p-4 sm:p-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="text-sm text-accent">Back to day</button>
        <button type="button" onClick={onClock} className="text-sm text-secondary hover:text-foreground">Who was on the clock</button>
      </div>
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-semibold text-foreground">{tile.title}</h2>
        <p className="text-3xl font-semibold text-foreground tabular-nums">{money(tile.totalCents)}</p>
        {tile.parts.length > 0 && (
          <p className="text-sm text-secondary">
            {tile.parts.map((part) => `${part.label} ${money(part.cents)}`).join(' · ')}
          </p>
        )}
        {source?.breakdown && <p className="text-sm text-secondary">{source.breakdown}</p>}
      </div>
      {party && <SubtotalBoxes party={party} />}
      {cards.flatMap((card) => card.notes).map((note) => (
        <p key={note} className="text-xs text-secondary text-center">{note}</p>
      ))}
      {notices.map((issue) => <p key={issue.id} className="text-sm text-amber-300 text-center">{issue.message}</p>)}

      {pools.map((card) => (
        <div key={card.id} className="space-y-2">
          <SectionHeader
            title={sectionTitle(card)}
            cents={card.moneyInCents}
            accent={poolAccent(card.id)}
            actionLabel={openEdit === card.id ? 'Hide changes' : 'Make changes'}
            onAction={() => setOpenEdit((current) => current === card.id ? null : card.id)}
          />
          <PayoutList card={card} worked={worked} returnedLabel={returnedPhrase(card)} />
          {openEdit === card.id && (
            <EditAmounts
              card={card}
              decision={decisions[card.id]}
              staff={staff}
              roles={poolRoles(card, rules)}
              onPatch={(next) => onPatch(card.id, next)}
            />
          )}
        </div>
      ))}

      {party && (party.splits ?? []).map((split) => {
        const selected = partyDecision?.[split.key] ?? party.roster?.[split.key] ?? [];
        return (
          <div key={split.key} className="space-y-2">
            <SectionHeader
              title={SPLIT_TITLE[split.key]}
              cents={split.cents}
              accent={SPLIT_ACCENT[split.key].bar}
              actionLabel={openSwap === split.key ? 'Hide list' : 'Swap out employees'}
              onAction={() => setOpenSwap((current) => current === split.key ? null : split.key)}
            />
            <p className="text-xs text-muted pl-3">{split.hint}</p>
            {openSwap === split.key && (
              <div className="pl-3">
                <StaffPicker
                  staff={staff}
                  roles={splitRoles(split.key, rules)}
                  selected={selected}
                  onToggle={(id) => toggleList(split.key, id, selected, (next) => onPatch(party.id, next))}
                />
              </div>
            )}
            {split.people.length === 0 && split.cents > 0 && <p className="text-sm text-amber-300 pl-3">Pick who gets this.</p>}
            {split.people.map((person) => (
              <div key={person.employeeId} className="flex items-baseline justify-between gap-3 text-sm pl-3">
                <span className="text-foreground">
                  {person.name}
                  {!worked.has(person.employeeId) && <span className="block text-xs text-amber-300">Did not work this day</span>}
                </span>
                <span className="tabular-nums">{money(person.cents)}</span>
              </div>
            ))}
          </div>
        );
      })}

      {cards.filter((card) => card.unassignedCents !== 0).map((card) => (
        <p key={card.id} className="text-sm text-amber-300 text-center">
          Unassigned {money(card.unassignedCents)} in {sectionTitle(card)}. This has to be placed before it can be confirmed.
        </p>
      ))}

      {cards.length > 0 && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onConfirm}
            disabled={unassigned !== 0 || tile.state === 'decide' || tile.state === 'confirmed'}
            className="px-4 py-2 rounded-full text-sm bg-accent/15 text-accent disabled:opacity-40"
          >
            {tile.state === 'confirmed' ? 'Confirmed' : tile.state === 'changed' ? 'Confirm again' : 'Confirm'}
          </button>
        </div>
      )}
    </section>
  );
}

function PayoutList({ card, worked, returnedLabel }: { card: TipCard; worked: Set<string>; returnedLabel?: string | null }) {
  const returned = new Set((card.returned ?? []).map((row) => row.employeeId));
  if (card.payouts.length === 0) return <p className="text-sm text-muted text-center">Nobody is on this yet.</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {card.payouts.map((row) => (
          <tr key={row.employeeId} className="border-t border-border/60">
            <td className="py-1.5 text-foreground">
              {row.name}
              {returnedLabel && returned.has(row.employeeId) && <span className="block text-xs text-secondary">{returnedLabel}</span>}
              {!worked.has(row.employeeId) && <span className="block text-xs text-amber-300">Did not work this day</span>}
            </td>
            <td className="py-1.5 text-right tabular-nums">{money(payoutTotal(row))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OutsideRow({
  issue,
  staff,
  onAssign,
}: {
  issue: TipIssue;
  staff: StaffOption[];
  onAssign: (choice: { assignPool?: 'bar' | 'cafe'; assignEmployeeId?: string }) => void;
}) {
  const [picking, setPicking] = useState(false);
  const named = issue.message.match(/^(.+?) has /);
  const payLabel = named ? `Pay ${named[1].split(' ')[0]}` : 'Pay one person';
  return (
    <div className="rounded-xl border border-orange-500/40 p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-foreground">{issue.message}</p>
        <p className="text-sm font-semibold tabular-nums">{money(issue.cents)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {issue.employeeId ? (
          <button type="button" className="px-3 py-1.5 rounded-full text-xs bg-accent/15 text-accent" onClick={() => onAssign({ assignEmployeeId: issue.employeeId })}>
            {payLabel}
          </button>
        ) : (
          <button type="button" className="px-3 py-1.5 rounded-full text-xs bg-accent/15 text-accent" onClick={() => setPicking((value) => !value)}>
            Pay one person
          </button>
        )}
        <button type="button" className="px-3 py-1.5 rounded-full text-xs bg-overlay/5 text-foreground" onClick={() => onAssign({ assignPool: 'bar' })}>Bar pool</button>
        <button type="button" className="px-3 py-1.5 rounded-full text-xs bg-overlay/5 text-foreground" onClick={() => onAssign({ assignPool: 'cafe' })}>Cafe pool</button>
        <span className="text-xs text-muted">A pool pays the 10% tip-out. Paying the person does not.</span>
      </div>
      {picking && !issue.employeeId && (
        <StaffPicker staff={staff} selected={[]} onToggle={(id) => onAssign({ assignEmployeeId: id })} />
      )}
    </div>
  );
}

function EditAmounts({
  card,
  decision,
  staff,
  roles,
  onPatch,
}: {
  card: TipCard;
  decision: CardDecision | undefined;
  staff: StaffOption[];
  roles: string[];
  onPatch: (patch: Partial<CardDecision>) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      {card.payouts.map((row) => (
        <AdjustRow
          key={row.employeeId}
          row={row}
          onRemove={() => onPatch({
            removed: [...new Set([...(decision?.removed ?? []), row.employeeId])],
            added: (decision?.added ?? []).filter((id) => id !== row.employeeId),
          })}
          onOverride={(cents, reason) => onPatch({
            overrides: [
              ...(decision?.overrides ?? []).filter((item) => item.employeeId !== row.employeeId),
              { employeeId: row.employeeId, cents, reason },
            ],
          })}
        />
      ))}
      <button type="button" onClick={() => setAdding((value) => !value)} className="text-sm text-accent">
        {adding ? 'Hide employee list' : 'Add someone'}
      </button>
      {adding && (
        <StaffPicker
          staff={staff}
          roles={roles}
          selected={decision?.added ?? []}
          onToggle={(id) => onPatch({
            added: [...new Set([...(decision?.added ?? []), id])],
            removed: (decision?.removed ?? []).filter((item) => item !== id),
          })}
        />
      )}
    </div>
  );
}

function AdjustRow({
  row,
  onRemove,
  onOverride,
}: {
  row: Payout;
  onRemove: () => void;
  onOverride: (cents: number, reason: string) => void;
}) {
  const [amount, setAmount] = useState((payoutTotal(row) / 100).toFixed(2));
  const [reason, setReason] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-foreground w-40">{row.name}</span>
      <input value={amount} onChange={(event) => setAmount(event.target.value)} className="w-24 rounded-lg bg-background/40 border border-border px-2 py-1 text-sm" aria-label={`Amount for ${row.name}`} />
      <input value={reason} placeholder="Reason" onChange={(event) => setReason(event.target.value)} className="flex-1 min-w-[10rem] rounded-lg bg-background/40 border border-border px-2 py-1 text-sm" />
      <button
        type="button"
        className="text-xs text-accent"
        onClick={() => {
          const cents = dollarsToCents(amount);
          if (cents === null || !reason.trim()) return;
          onOverride(cents, reason.trim());
        }}
      >
        Apply
      </button>
      <button type="button" className="text-xs text-secondary" onClick={onRemove}>Remove</button>
    </div>
  );
}

function toggleList(
  field: 'coordinators' | 'support' | 'bartenders',
  id: string,
  current: string[],
  onPatch: (patch: Partial<CardDecision>) => void,
) {
  const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
  onPatch({ [field]: next });
}
