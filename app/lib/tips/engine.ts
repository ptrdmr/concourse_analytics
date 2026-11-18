import type {
  AmountOverride,
  CardDecision,
  DayDecisions,
  DayPerson,
  DayState,
  DayTile,
  DirectoryPerson,
  GroupTotal,
  Payout,
  PoolName,
  StaffOption,
  TipCard,
  TipIssue,
  TipPunch,
  TipReservation,
  TipRules,
  TipSplit,
  TipTab,
  TileState,
  TimelineParty,
  TimelinePunch,
  Worksheet,
  WorksheetTotals,
} from './types'

const TIME_ZONE = 'America/Los_Angeles'

export interface Span {
  id: string
  start: number
  end: number
}

interface Window {
  start: number
  end: number
}

interface DirectoryIndex {
  byId: Map<string, DirectoryPerson>
  byUser: Map<number, DirectoryPerson>
  byName: Map<string, DirectoryPerson | 'ambiguous'>
}

interface PartyGroup {
  id: string
  title: string
  tabs: TipTab[]
  reservation: TipReservation | null
  windowStart: string
  windowEnd: string
  windowSource: 'reservation' | 'items' | 'tab'
}

interface TabPot {
  tab: TipTab
  cents: number
  close: number
}

interface HeldTip {
  id: string
  kind: 'unmatched' | 'unpooled'
  name: string
  employeeId?: string
  role?: string
  cents: number
  tabs: Set<string>
}

export function zonedMs(day: string, hour: number, minute = 0): number {
  const [year, month, date] = day.split('-').map(Number)
  const utcGuess = Date.UTC(year, month - 1, date, hour, minute, 0)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(utcGuess)).map((part) => [part.type, part.value]),
  )
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  )
  return utcGuess - (asUtc - utcGuess)
}

export function addDays(day: string, count: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(year, month - 1, date))
  dt.setUTCDate(dt.getUTCDate() + count)
  return dt.toISOString().slice(0, 10)
}

export const DEFAULT_PAY_PERIOD_START = '2026-10-19'
export const DEFAULT_PAY_PERIOD_DAYS = 14

export function daysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDate] = from.split('-').map(Number)
  const [toYear, toMonth, toDate] = to.split('-').map(Number)
  const span = Date.UTC(toYear, toMonth - 1, toDate) - Date.UTC(fromYear, fromMonth - 1, fromDate)
  return Math.round(span / (24 * 60 * 60 * 1000))
}

export function payPeriodContaining(day: string, start: string, length: number): { from: string; to: string } {
  const size = length > 0 ? Math.trunc(length) : DEFAULT_PAY_PERIOD_DAYS
  const index = Math.floor(daysBetween(start, day) / size)
  const from = addDays(start, index * size)
  return { from, to: addDays(from, size - 1) }
}

export function payPeriodOf(
  day: string,
  rules?: Pick<TipRules, 'payPeriodStart' | 'payPeriodDays'> | null,
): { from: string; to: string } {
  return payPeriodContaining(
    day,
    rules?.payPeriodStart || DEFAULT_PAY_PERIOD_START,
    rules?.payPeriodDays || DEFAULT_PAY_PERIOD_DAYS,
  )
}

export function latestWorkedDay(days: Record<string, { tabs?: unknown[]; punches?: unknown[] } | undefined>): string | null {
  let latest: string | null = null
  for (const [day, facts] of Object.entries(days)) {
    if (!facts) continue
    const tabs = facts.tabs?.length ?? 0
    const punches = facts.punches?.length ?? 0
    if (tabs === 0 && punches === 0) continue
    if (!latest || day > latest) latest = day
  }
  return latest
}

export function classifyDay(input: {
  date: string
  monthLoaded: boolean
  /** Latest day in the file that has tips or clock-ins. Reservation-only days do not count. */
  lastWorked: string | null
  dayInFile: boolean
  worksheet: Worksheet | null
  decisions: DayDecisions | null
}): DayState {
  if (!input.monthLoaded) return 'no-data'
  if (!input.dayInFile) {
    if (input.lastWorked && input.date < input.lastWorked) return 'nothing'
    return 'no-data'
  }
  const worksheet = input.worksheet
  if (!worksheet) return 'no-data'
  if (worksheet.totals.collectedCents === 0 && worksheet.issues.length === 0) {
    // A day that only has reservations booked, after the last day anyone worked, has not happened yet.
    if (worksheet.punches.length === 0 && input.lastWorked && input.date > input.lastWorked) return 'no-data'
    return 'nothing'
  }
  const saved = input.decisions
  const tilesReady = worksheet.tiles.every((tile) => tile.state === 'confirmed')
  const closedClean = Boolean(
    saved?.closedAt
    && saved.closedFingerprint === worksheet.fingerprint
    && worksheet.totals.waitingCents === 0
    && tilesReady,
  )
  if (closedClean) return 'processed'
  if (saved?.closedAt && saved.closedFingerprint && saved.closedFingerprint !== worksheet.fingerprint) return 'changed'
  return 'not-closed'
}

export function fingerprintOf(value: unknown): string {
  const json = JSON.stringify(value)
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5 ^ json.length
  for (let i = 0; i < json.length; i += 1) {
    const code = json.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193)
    h2 = Math.imul(h2 ^ code, 0x01000193)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

export function splitEven(
  total: number,
  ids: string[],
  clockOrder: (id: string) => number,
): Map<string, number> {
  const unique = [...new Set(ids)]
  const out = new Map<string, number>()
  if (!unique.length || total === 0) return out
  const base = Math.trunc(total / unique.length)
  const remainder = total - base * unique.length
  unique.sort((a, b) => clockOrder(a) - clockOrder(b) || a.localeCompare(b))
  for (const id of unique) out.set(id, base)
  const first = unique[0]
  out.set(first, (out.get(first) ?? 0) + remainder)
  return out
}

export function allocateByCoverage(
  poolCents: number,
  coverage: Span[],
  recipients: Span[],
  window: Window,
  clockOrder: (id: string) => number,
): Map<string, number> {
  const out = new Map<string, number>()
  if (poolCents === 0) return out
  const cover = clipSpans(coverage, window)
  const receive = clipSpans(recipients, window)
  if (!cover.length) return out

  const points = new Set<number>([window.start, window.end])
  for (const span of [...cover, ...receive]) {
    points.add(span.start)
    points.add(span.end)
  }
  const sorted = [...points].filter((point) => point >= window.start && point <= window.end).sort((a, b) => a - b)
  const shares = new Map<string, number>()
  let weight = 0
  const slices: { duration: number; who: string[] }[] = []
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i]
    const end = sorted[i + 1]
    if (end <= start) continue
    const present = idsOverlapping(cover, start, end)
    if (!present.length) continue
    const floor = idsOverlapping(receive, start, end)
    weight += end - start
    slices.push({ duration: end - start, who: floor.length ? floor : present })
  }
  if (weight <= 0) return out
  for (const slice of slices) {
    const sliceCents = (poolCents * slice.duration) / weight
    const each = sliceCents / slice.who.length
    for (const id of slice.who) shares.set(id, (shares.get(id) ?? 0) + each)
  }
  return settleCents(shares, poolCents, clockOrder)
}

export function cardIsEmpty(card: TipCard): boolean {
  return card.moneyInCents === 0 && card.unassignedCents === 0 && card.payouts.length === 0
}

export function buildWorksheet(
  date: string,
  facts: { tabs: TipTab[]; punches: TipPunch[]; reservations: TipReservation[] },
  directory: DirectoryPerson[],
  rules: TipRules,
  decisions: DayDecisions | null,
): Worksheet {
  const index = indexDirectory(directory)
  const punches = facts.punches.filter((punch) => Number.isFinite(Date.parse(punch.in)) && Number.isFinite(Date.parse(punch.out)))
  const clockOrder = (id: string) => earliestClockIn(id, punches, index)
  const windows = dayWindows(date, rules)
  const dayDecisions = decisions?.cards ?? {}
  const issueDecisions = decisions?.issues ?? {}

  for (const punch of punches) personForPunch(punch, index)

  const parties = groupParties(facts.tabs, facts.reservations)
  const partyTxn = new Set(parties.flatMap((party) => party.tabs.map((tab) => tab.txnId)))
  const issues: TipIssue[] = []
  const direct = new Map<string, number>()
  const held = new Map<string, HeldTip>()

  const barPots: TabPot[] = []
  const cafePots: TabPot[] = []

  for (const tab of facts.tabs) {
    if (partyTxn.has(tab.txnId)) continue
    const close = Date.parse(tab.closed || tab.opened || '')
    if (!Number.isFinite(close)) continue
    const pots = { bar: 0, cafe: 0 }
    for (const line of tab.gratuity) {
      if (!line.cents) continue
      const person = lookup(index, line.name)
      const known = person && person !== 'ambiguous' ? person : null
      // Decisions are one per person per day. Older per-tab keys are ignored.
      const issueId = known ? `person:${known.id}` : `name:${norm(line.name) || 'unknown'}`
      const decision = issueDecisions[issueId]
      if (decision?.assignEmployeeId) {
        direct.set(decision.assignEmployeeId, (direct.get(decision.assignEmployeeId) ?? 0) + line.cents)
        continue
      }
      if (decision?.assignPool === 'bar' || decision?.assignPool === 'cafe') {
        pots[decision.assignPool] += line.cents
        continue
      }
      if (!known) {
        holdTip(held, {
          id: issueId,
          kind: 'unmatched',
          name: line.name || 'Unknown',
          txnId: tab.txnId,
          cents: line.cents,
        })
        continue
      }
      const pool = earningPool(known, punches, index, rules, close)
      if (pool === 'bar' || pool === 'cafe') {
        pots[pool] += line.cents
        continue
      }
      const roles = workedRoles(known, punches, index)
      holdTip(held, {
        id: issueId,
        kind: 'unpooled',
        name: known.name,
        employeeId: known.id,
        role: roles.join(', '),
        txnId: tab.txnId,
        cents: line.cents,
      })
    }
    if (pots.bar) barPots.push({ tab, cents: pots.bar, close })
    if (pots.cafe) cafePots.push({ tab, cents: pots.cafe, close })
  }

  for (const entry of held.values()) {
    const tabs = entry.tabs.size === 1 ? '1 tab' : `${entry.tabs.size} tabs`
    const message = entry.kind === 'unmatched'
      ? `"${entry.name}" has ${money(entry.cents)} in tips from ${tabs}, and that name does not match one employee.`
      : entry.role
        ? `${entry.name} has ${money(entry.cents)} in tips from ${tabs}. ${entry.name} worked as ${entry.role}, which is not a tip pool.`
        : `${entry.name} has ${money(entry.cents)} in tips from ${tabs}, with no bartender, server, or cafe clock-in.`
    issues.push({
      id: entry.id,
      kind: entry.kind,
      cents: entry.cents,
      employeeId: entry.employeeId,
      tabCount: entry.tabs.size,
      message,
    })
  }

  const barCard = poolCard({
    id: 'bar',
    kind: 'bar',
    title: 'Bar and servers',
    detail: '90% of bartender and server tips, split evenly among whoever was clocked in when each tab closed.',
    pots: barPots,
    rules,
    pool: 'bar',
    percentToOthers: rules.floorPercent,
    punches,
    index,
    windows,
    decision: dayDecisions.bar,
    clockOrder,
    issues,
    otherLabel: 'floor',
  })
  const cafeCard = poolCard({
    id: 'cafe',
    kind: 'cafe',
    title: 'Cafe',
    detail: '90% of cafe tips, split evenly among cafe staff clocked in when each tab closed.',
    pots: cafePots,
    rules,
    pool: 'cafe',
    percentToOthers: rules.kitchenPercent,
    punches,
    index,
    windows,
    decision: dayDecisions.cafe,
    clockOrder,
    issues,
    otherLabel: 'kitchen',
  })

  const floorCard = tipOutCard({
    id: 'floor',
    kind: 'floor',
    title: 'Floor',
    detail: '10% of bartender and server tips, spread evenly across the hours they were on the clock. Front desk and scoretechs working that hour split it. An hour with nobody on the floor goes back to the bartenders and servers who were on.',
    pots: barPots,
    source: barCard.tipOut,
    rules,
    coveragePool: 'bar',
    recipientPool: 'floor',
    punches,
    index,
    windows,
    decision: dayDecisions.floor,
    clockOrder,
    returnedNote: 'Some hours had no front desk or scoretech on the clock, so that share went back to the bartenders and servers working then.',
  })
  const kitchenCard = tipOutCard({
    id: 'kitchen',
    kind: 'kitchen',
    title: 'Kitchen',
    detail: '10% of cafe tips, spread the same way across cafe hours. Kitchen staff working that hour split it. An hour with nobody in the kitchen goes back to the cafe.',
    pots: cafePots,
    source: cafeCard.tipOut,
    rules,
    coveragePool: 'cafe',
    recipientPool: 'kitchen',
    punches,
    index,
    windows,
    decision: dayDecisions.kitchen,
    clockOrder,
    returnedNote: 'Some hours had no kitchen staff on the clock, so that share went back to the cafe staff working then.',
  })

  const partyCards = parties.map((party) =>
    partyCard(party, punches, index, rules, dayDecisions[party.id], clockOrder, issues),
  )
  const assigned = assignedCard(direct, index, clockOrder)

  const cards = [...partyCards, barCard.card, cafeCard.card, floorCard, kitchenCard]
  if (assigned) cards.push(assigned)

  const timeline: TimelinePunch[] = punches.map((punch) => {
    const person = personForPunch(punch, index)
    return {
      employeeId: person.id,
      name: person.name,
      role: punch.role,
      pool: poolOf(punch.role, rules),
      in: punch.in,
      out: punch.out,
    }
  })
  const partyBands: TimelineParty[] = parties.map((party) => ({
    id: party.id,
    label: party.title,
    start: party.windowStart,
    end: party.windowEnd,
  }))
  const staff = staffOptions(index, timeline)
  const totals = worksheetTotals(cards, issues)
  const groups = groupTotals(cards, dayDecisions)
  const people = dayPeople(cards)
  const tiles = dayTiles(cards, issues, dayDecisions)

  return {
    date,
    cards,
    issues,
    punches: timeline,
    parties: partyBands,
    staff,
    daypartHour: rules.daypartHour,
    fingerprint: fingerprintOf({
      cards: cards.map((card) => [card.id, card.fingerprint]),
      issues: issues.map((issue) => [issue.id, issue.cents]).sort(),
    }),
    groups,
    people,
    totals,
    tiles,
  }
}

function poolCard(args: {
  id: string
  kind: 'bar' | 'cafe'
  title: string
  detail: string
  pots: TabPot[]
  rules: TipRules
  pool: 'bar' | 'cafe'
  percentToOthers: number
  punches: TipPunch[]
  index: DirectoryIndex
  windows: { day: Window; night: Window }
  decision: CardDecision | undefined
  clockOrder: (id: string) => number
  issues: TipIssue[]
  otherLabel: string
}): { card: TipCard; tipOut: { day: number; night: number } } {
  const totals = new Map<string, number>()
  const tipOut = { day: 0, night: 0 }
  const notes: string[] = []
  const cuts: { part: 'day' | 'night'; cut: number; ids: string[] }[] = []
  let stranded = 0
  let strandedTabs = 0
  for (const pot of args.pots) {
    const found = peopleInPoolNear(args.punches, args.index, args.rules, args.pool, pot.close)
    const part = found.at >= args.windows.night.start && found.at < args.windows.night.end ? 'night' as const : 'day' as const
    let recipients = applyRoster(found.ids, args.decision)
    if (!recipients.length) {
      stranded += pot.cents
      strandedTabs += 1
      continue
    }
    const cut = Math.floor((pot.cents * args.percentToOthers) / 100)
    const keep = pot.cents - cut
    tipOut[part] += cut
    cuts.push({ part, cut, ids: recipients })
    for (const [id, cents] of splitEven(keep, recipients, args.clockOrder)) addMap(totals, id, cents)
  }
  for (const part of ['day', 'night'] as const) {
    if (!tipOut[part]) continue
    const coverage = spansFor(args.punches, args.index, args.rules, args.pool, args.windows[part])
    if (coverage.length) continue
    for (const item of cuts) {
      if (item.part !== part || !item.cut) continue
      for (const [id, cents] of splitEven(item.cut, item.ids, args.clockOrder)) addMap(totals, id, cents)
    }
    const when = part === 'day' ? 'daytime' : 'evening'
    notes.push(`The ${when} ${args.otherLabel} tip-out had nobody from this pool on that shift, so it went back to the people who shared those tabs.`)
    tipOut[part] = 0
  }
  if (stranded) {
    const label = args.pool === 'bar' ? 'bar and server' : 'cafe'
    args.issues.push({
      id: `noclock:${args.pool}`,
      kind: 'no-clock',
      cents: stranded,
      tabCount: strandedTabs,
      message: `${money(stranded)} in ${label} tips had nobody from that pool working this day. Add the people who should share it.`,
    })
  }
  const overridden = applyOverrides(totals, args.decision?.overrides)
  const pooled = args.pots.reduce((sum, pot) => sum + pot.cents, 0) - stranded
  const kept = pooled - tipOut.day - tipOut.night
  const card = finishCard({
    id: args.id,
    kind: args.kind,
    title: args.title,
    detail: args.detail,
    serviceChargeCents: 0,
    gratuityCents: kept,
    totals: overridden,
    index: args.index,
    clockOrder: args.clockOrder,
    notes,
    fingerprint: fingerprintOf({
      pots: args.pots.map((pot) => [pot.tab.txnId, pot.cents, pot.tab.closed]).sort(),
      punches: punchFacts(args.punches, args.index, args.rules, [args.pool, args.pool === 'bar' ? 'floor' : 'kitchen']),
    }),
  })
  const tipped = tipOut.day + tipOut.night
  card.breakdown = `Collected ${money(pooled)} · ${args.percentToOthers}% to ${args.otherLabel} ${money(tipped)}`
  return { card, tipOut }
}

function tipOutCard(args: {
  id: string
  kind: 'floor' | 'kitchen'
  title: string
  detail: string
  pots: TabPot[]
  source: { day: number; night: number }
  rules: TipRules
  coveragePool: 'bar' | 'cafe'
  recipientPool: 'floor' | 'kitchen'
  punches: TipPunch[]
  index: DirectoryIndex
  windows: { day: Window; night: Window }
  decision: CardDecision | undefined
  clockOrder: (id: string) => number
  returnedNote: string
}): TipCard {
  const totals = new Map<string, number>()
  const returnedTotals = new Map<string, number>()
  let unspread = 0
  for (const part of ['day', 'night'] as const) {
    const pool = args.source[part]
    if (!pool) continue
    const window = args.windows[part]
    const coverage = spansFor(args.punches, args.index, args.rules, args.coveragePool, window)
    const removed = new Set(args.decision?.removed ?? [])
    const recipients = spansFor(args.punches, args.index, args.rules, args.recipientPool, window)
      .filter((span) => !removed.has(span.id))
    for (const id of args.decision?.added ?? []) {
      recipients.push({ id, start: window.start, end: window.end })
    }
    const allocated = allocateByCoverage(pool, coverage, recipients, window, args.clockOrder)
    if (!allocated.size) {
      unspread += pool
      continue
    }
    const coverageIds = new Set(coverage.map((span) => span.id))
    const recipientIds = new Set(recipients.map((span) => span.id))
    for (const [id, cents] of allocated) {
      addMap(totals, id, cents)
      // A person who is only in the source pool got this hour because nobody in the receiving pool was on.
      if (coverageIds.has(id) && !recipientIds.has(id)) addMap(returnedTotals, id, cents)
    }
  }
  const notes: string[] = []
  const returned = [...returnedTotals.entries()]
    .filter(([, cents]) => cents > 0)
    .map(([employeeId, cents]) => ({ employeeId, cents }))
    .sort((a, b) => b.cents - a.cents || a.employeeId.localeCompare(b.employeeId))
  if (returned.length) notes.push(args.returnedNote)
  if (unspread) notes.push(`${money(unspread)} could not be spread because nobody from the source pool was on the clock.`)
  const pool = args.source.day + args.source.night
  const overridden = applyOverrides(totals, args.decision?.overrides)
  const card = finishCard({
    id: args.id,
    kind: args.kind,
    title: args.title,
    detail: args.detail,
    serviceChargeCents: 0,
    gratuityCents: pool,
    totals: overridden,
    index: args.index,
    clockOrder: args.clockOrder,
    notes,
    fingerprint: fingerprintOf({
      pots: args.pots.map((pot) => [pot.tab.txnId, pot.cents, pot.tab.closed]).sort(),
      punches: punchFacts(args.punches, args.index, args.rules, [args.coveragePool, args.recipientPool]),
    }),
  })
  const from = args.coveragePool === 'bar' ? 'bar and server tips' : 'cafe tips'
  card.breakdown = `From ${from} · ${money(pool)}`
  if (returned.length) card.returned = returned
  return card
}

function partyCard(
  party: PartyGroup,
  punches: TipPunch[],
  index: DirectoryIndex,
  rules: TipRules,
  decision: CardDecision | undefined,
  clockOrder: (id: string) => number,
  issues: TipIssue[],
): TipCard {
  const serviceChargeCents = party.tabs.reduce((sum, tab) => sum + tab.serviceChargeCents, 0)
  const gratuityCents = party.tabs.reduce(
    (sum, tab) => sum + tab.gratuity.reduce((inner, line) => inner + line.cents, 0),
    0,
  )
  const pool = serviceChargeCents + gratuityCents
  const barSales = party.tabs.reduce((sum, tab) => sum + tab.barSalesCents, 0)
  let cut = Math.floor((barSales * rules.bartenderSalesPercent) / 100)
  const notes: string[] = []
  if (party.windowSource === 'reservation') notes.push('Party time comes from the reservation.')
  else if (party.windowSource === 'items') notes.push('Party time is the first and last item rung. No reservation time was linked.')
  else notes.push('Party time is the tab open and close. No reservation time or item time was available.')
  if (cut > pool) {
    issues.push({
      id: `short:${party.id}`,
      kind: 'bartenders',
      cents: cut - pool,
      message: `${party.title}: 10% of bar sales is ${money(cut)}, which is more than the ${money(pool)} pool. Bartenders get the whole pool.`,
    })
    cut = pool
  }
  const remainder = pool - cut
  const coordinatorCut = Math.floor((remainder * rules.coordinatorPercent) / 100)
  const supportCut = remainder - coordinatorCut
  const start = Date.parse(party.windowStart)
  const end = Date.parse(party.windowEnd)

  const tagged = coordinatorsFromTags(party.tabs.flatMap((tab) => tab.coordinators), index, party.id, issues)
  const coordinators = decision?.coordinators
    ? [...decision.coordinators]
    : tagged.ids
  const support = decision?.support
    ? [...decision.support]
    : peopleOverlapping(punches, index, rules, ['kitchen', 'floor'], start, end)

  const bartenders = decision?.bartenders
    ? [...decision.bartenders]
    : peopleOverlapping(punches, index, rules, ['bar'], start, end).filter((id) => {
      const person = index.byId.get(id)
      if (!person?.userId) return false
      return punches.some((punch) => punch.userId === person.userId && partyBartender(punch.role, rules) && overlaps(punch, start, end))
    })

  const totals = new Map<string, number>()
  const bartenderShares = cut > 0 && bartenders.length ? splitEven(cut, bartenders, clockOrder) : new Map<string, number>()
  const coordinatorShares = coordinatorCut > 0 && coordinators.length ? splitEven(coordinatorCut, coordinators, clockOrder) : new Map<string, number>()
  const supportShares = supportCut > 0 && support.length ? splitEven(supportCut, support, clockOrder) : new Map<string, number>()
  for (const [id, cents] of bartenderShares) addMap(totals, id, cents)
  for (const [id, cents] of coordinatorShares) addMap(totals, id, cents)
  for (const [id, cents] of supportShares) addMap(totals, id, cents)
  if (cut > 0 && !bartenders.length) {
    issues.push({
      id: `bartenders:${party.id}`,
      kind: 'bartenders',
      cents: cut,
      message: `${party.title} has ${money(barSales)} in bar sales, but no bartender was on the clock during the party. ${money(cut)} is waiting for you to add one.`,
    })
  }
  if (coordinatorCut > 0 && !coordinators.length) {
    issues.push({
      id: `coordinators:${party.id}`,
      kind: 'party',
      cents: coordinatorCut,
      message: `${party.title} has no party server tagged. ${money(coordinatorCut)} (60%) is unassigned until you pick the coordinators.`,
    })
  }
  if (supportCut > 0 && !support.length) {
    issues.push({
      id: `support:${party.id}`,
      kind: 'party',
      cents: supportCut,
      message: `${party.title} has nobody proposed for the kitchen and floor 40%. ${money(supportCut)} is unassigned until you pick them.`,
    })
  }

  const overridden = applyOverrides(totals, decision?.overrides)
  const when = `${clockLabel(party.windowStart)}–${clockLabel(party.windowEnd)}`
  const detail = [
    when,
    `Service charge ${money(serviceChargeCents)}`,
    `Additional gratuity ${money(gratuityCents)}`,
    barSales ? `Bar sales ${money(barSales)}, bartender cut ${money(Math.min(cut, pool))}` : 'No bar sales',
  ].join(' · ')

  const card = finishCard({
    id: party.id,
    kind: 'party',
    title: party.title,
    detail,
    serviceChargeCents,
    gratuityCents,
    totals: overridden,
    index,
    clockOrder,
    notes,
    fingerprint: fingerprintOf({
      tabs: party.tabs.map((tab) => [
        tab.txnId,
        tab.serviceChargeCents,
        tab.barSalesCents,
        tab.gratuity,
        tab.coordinators,
        tab.opened,
        tab.closed,
        tab.firstItem,
        tab.lastItem,
      ]),
      reservation: party.reservation
        ? [party.reservation.id, party.reservation.start, party.reservation.end, party.reservation.txnIds]
        : null,
      punches: punchFacts(punches, index, rules, ['bar', 'floor', 'kitchen', 'coordinator']),
    }),
  })
  card.roster = { bartenders, coordinators, support }
  card.facts = { window: when, barSalesCents: barSales }
  const splits: TipSplit[] = [
    {
      key: 'coordinators',
      label: 'Coordinators',
      hint: '60% after the bartender cut',
      cents: coordinatorCut,
      people: namedShares(coordinatorShares, index),
    },
    {
      key: 'support',
      label: 'Kitchen and floor',
      hint: '40% after the bartender cut',
      cents: supportCut,
      people: namedShares(supportShares, index),
    },
  ]
  if (barSales > 0 || cut > 0) {
    splits.push({
      key: 'bartenders',
      label: 'Bartenders',
      hint: '10% of bar sales. None of this goes to the floor.',
      cents: cut,
      people: namedShares(bartenderShares, index),
    })
  }
  card.splits = splits
  return card
}

function assignedCard(
  direct: Map<string, number>,
  index: DirectoryIndex,
  clockOrder: (id: string) => number,
): TipCard | null {
  if (![...direct.values()].some((cents) => cents !== 0)) return null
  const total = [...direct.values()].reduce((sum, cents) => sum + cents, 0)
  return finishCard({
    id: 'assigned',
    kind: 'assigned',
    title: 'Assigned by the GM',
    detail: 'Tips that were not in a pool, paid to the person you chose. These do not pay the 10% tip-out.',
    serviceChargeCents: 0,
    gratuityCents: total,
    totals: direct,
    index,
    clockOrder,
    notes: [],
    fingerprint: fingerprintOf([...direct.entries()].sort()),
  })
}

function finishCard(args: {
  id: string
  kind: TipCard['kind']
  title: string
  detail: string
  serviceChargeCents: number
  gratuityCents: number
  totals: Map<string, number>
  index: DirectoryIndex
  clockOrder: (id: string) => number
  notes: string[]
  fingerprint: string
}): TipCard {
  const pool = args.serviceChargeCents + args.gratuityCents
  const entries = [...args.totals.entries()].filter(([id, cents]) => id && cents !== 0)
  const paid = entries.reduce((sum, [, cents]) => sum + cents, 0)
  const unassigned = pool - paid
  const attributed = attributeAmounts(
    [...entries.map(([id, cents]) => ({ id, cents })), { id: '', cents: unassigned }],
    args.serviceChargeCents,
    args.gratuityCents,
    args.clockOrder,
  )
  const payouts: Payout[] = attributed
    .filter((row) => row.id && (row.sc !== 0 || row.grat !== 0))
    .map((row) => ({
      employeeId: row.id,
      name: args.index.byId.get(row.id)?.name || row.id,
      serviceChargeCents: row.sc,
      gratuityCents: row.grat,
    }))
    .sort((a, b) => (b.serviceChargeCents + b.gratuityCents) - (a.serviceChargeCents + a.gratuityCents) || a.name.localeCompare(b.name))
  const unassignedRow = attributed.find((row) => row.id === '')
  return {
    id: args.id,
    kind: args.kind,
    title: args.title,
    detail: args.detail,
    moneyInCents: pool,
    serviceChargeCents: args.serviceChargeCents,
    gratuityCents: args.gratuityCents,
    payouts,
    unassignedCents: (unassignedRow?.sc ?? 0) + (unassignedRow?.grat ?? 0),
    fingerprint: args.fingerprint,
    notes: args.notes,
  }
}

function attributeAmounts(
  entries: { id: string; cents: number }[],
  serviceChargeCents: number,
  gratuityCents: number,
  clockOrder: (id: string) => number,
): { id: string; sc: number; grat: number }[] {
  const pool = serviceChargeCents + gratuityCents
  const rows = entries.map((entry) => {
    if (pool === 0 || entry.cents === 0) return { id: entry.id, sc: 0, grat: entry.cents }
    const sc = Math.trunc((entry.cents * serviceChargeCents) / pool)
    return { id: entry.id, sc, grat: entry.cents - sc }
  })
  const scDiff = serviceChargeCents - rows.reduce((sum, row) => sum + row.sc, 0)
  const gratDiff = gratuityCents - rows.reduce((sum, row) => sum + row.grat, 0)
  const people = rows.filter((row) => row.id).sort((a, b) => clockOrder(a.id) - clockOrder(b.id) || a.id.localeCompare(b.id))
  const target = people[0] ?? rows.find((row) => row.id === '')
  if (target) {
    target.sc += scDiff
    target.grat += gratDiff
  }
  return rows
}

function applyOverrides(totals: Map<string, number>, overrides: AmountOverride[] | undefined): Map<string, number> {
  const next = new Map(totals)
  for (const override of overrides ?? []) {
    if (!override.reason || !override.reason.trim()) continue
    if (!Number.isFinite(override.cents)) continue
    next.set(override.employeeId, Math.round(override.cents))
  }
  return next
}

function applyRoster(ids: string[], decision: CardDecision | undefined): string[] {
  const removed = new Set(decision?.removed ?? [])
  const out = ids.filter((id) => !removed.has(id))
  for (const id of decision?.added ?? []) {
    if (!out.includes(id)) out.push(id)
  }
  return out
}

function groupParties(tabs: TipTab[], reservations: TipReservation[]): PartyGroup[] {
  const partyTabs = tabs.filter((tab) => tab.serviceChargeCents > 0)
  const byTxn = new Map(partyTabs.map((tab) => [tab.txnId, tab]))
  const used = new Set<string>()
  const groups: PartyGroup[] = []
  for (const reservation of [...reservations].sort((a, b) => a.id - b.id)) {
    const members = reservation.txnIds
      .map((id) => byTxn.get(String(id)))
      .filter((tab): tab is TipTab => {
        if (!tab) return false
        return !used.has(tab.txnId)
      })
    if (!members.length) continue
    members.forEach((tab) => used.add(tab.txnId))
    groups.push(makeParty(`party:res-${reservation.id}`, members, reservation))
  }
  const byName = new Map<string, TipTab[]>()
  for (const tab of partyTabs) {
    if (used.has(tab.txnId)) continue
    const key = norm(tab.partyName || '') || `tab:${tab.txnId}`
    const list = byName.get(key) ?? []
    list.push(tab)
    byName.set(key, list)
  }
  for (const [key, members] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const slug = key.startsWith('tab:') ? key.slice(4) : `${slugify(key)}-${members[0].txnId}`
    groups.push(makeParty(`party:${slug}`, members, null))
  }
  groups.sort((a, b) => a.windowStart.localeCompare(b.windowStart) || a.title.localeCompare(b.title))
  return groups
}

function makeParty(id: string, tabs: TipTab[], reservation: TipReservation | null): PartyGroup {
  const window = partyWindow(tabs, reservation)
  const name = tabs.map((tab) => tab.partyName).find((value) => value) || reservation?.title || `Tab ${tabs[0].txnId}`
  const type = reservation?.type ? ` (${reservation.type})` : ''
  return {
    id,
    title: `${name}${type}`,
    tabs,
    reservation,
    windowStart: window.start,
    windowEnd: window.end,
    windowSource: window.source,
  }
}

function partyWindow(tabs: TipTab[], reservation: TipReservation | null): { start: string; end: string; source: PartyGroup['windowSource'] } {
  if (reservation?.start && reservation.end && Date.parse(reservation.end) > Date.parse(reservation.start)) {
    return { start: reservation.start, end: reservation.end, source: 'reservation' }
  }
  const itemTimes = tabs.flatMap((tab) => [tab.firstItem, tab.lastItem]).filter((value): value is string => Boolean(value)).sort()
  if (itemTimes.length) {
    return widen(itemTimes[0], itemTimes[itemTimes.length - 1], 'items')
  }
  const opens = tabs.map((tab) => tab.opened || tab.closed).filter((value): value is string => Boolean(value)).sort()
  const closes = tabs.map((tab) => tab.closed || tab.opened).filter((value): value is string => Boolean(value)).sort()
  const start = opens[0] || closes[0] || new Date(0).toISOString()
  const end = closes[closes.length - 1] || start
  return widen(start, end, 'tab')
}

function widen(start: string, end: string, source: PartyGroup['windowSource']): { start: string; end: string; source: PartyGroup['windowSource'] } {
  if (Date.parse(end) > Date.parse(start)) return { start, end, source }
  return { start, end: new Date(Date.parse(start) + 15 * 60 * 1000).toISOString(), source }
}

function coordinatorsFromTags(tags: string[], index: DirectoryIndex, partyId: string, issues: TipIssue[]): { ids: string[] } {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    const key = norm(tag)
    if (seen.has(key)) continue
    seen.add(key)
    const person = lookup(index, tag)
    if (!person || person === 'ambiguous') {
      issues.push({
        id: `tag:${partyId}:${key}`,
        kind: 'party',
        cents: 0,
        message: `The tab is tagged for "${tag}", and that name does not match one employee. Pick the coordinator yourself.`,
      })
      continue
    }
    ids.push(person.id)
  }
  return { ids }
}

function holdTip(
  held: Map<string, HeldTip>,
  entry: { id: string; kind: HeldTip['kind']; name: string; employeeId?: string; role?: string; txnId: string; cents: number },
): void {
  const current = held.get(entry.id) ?? {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    employeeId: entry.employeeId,
    role: entry.role,
    cents: 0,
    tabs: new Set<string>(),
  }
  current.cents += entry.cents
  current.tabs.add(entry.txnId)
  if (entry.role) current.role = entry.role
  held.set(entry.id, current)
}

function earningPool(
  person: DirectoryPerson,
  punches: TipPunch[],
  index: DirectoryIndex,
  rules: TipRules,
  close: number,
): 'bar' | 'cafe' | null {
  const pooled = punches.filter((punch) => {
    if (personForPunch(punch, index).id !== person.id) return false
    const pool = poolOf(punch.role, rules)
    return pool === 'bar' || pool === 'cafe'
  })
  const kinds = new Set(pooled.map((punch) => poolOf(punch.role, rules)))
  if (kinds.size === 0) return null
  if (kinds.size === 1) return kinds.has('bar') ? 'bar' : 'cafe'
  const covering = pooled.filter((punch) => covers(punch, close))
  if (covering.length) {
    covering.sort((a, b) => Date.parse(b.clockIn) - Date.parse(a.clockIn))
    return poolOf(covering[0].role, rules) === 'cafe' ? 'cafe' : 'bar'
  }
  const nearest = nearestPunch(pooled, close)
  if (!nearest) return null
  return poolOf(nearest.role, rules) === 'cafe' ? 'cafe' : 'bar'
}

function workedRoles(person: DirectoryPerson, punches: TipPunch[], index: DirectoryIndex): string[] {
  const roles: string[] = []
  for (const punch of punches) {
    if (personForPunch(punch, index).id !== person.id) continue
    if (punch.role && !roles.includes(punch.role)) roles.push(punch.role)
  }
  return roles
}

function nearestPunch(punches: TipPunch[], at: number): TipPunch | null {
  let best: TipPunch | null = null
  let bestDist = Number.POSITIVE_INFINITY
  let bestPoint = 0
  for (const punch of punches) {
    const start = Date.parse(punch.in)
    const end = Date.parse(punch.out)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    if (at >= start && at < end) return punch
    const after = at >= end
    const dist = after ? at - (end - 1) : start - at
    const point = after ? end - 1 : start
    const closer = dist < bestDist || (dist === bestDist && point <= at && bestPoint > at)
    if (closer) {
      best = punch
      bestDist = dist
      bestPoint = point
    }
  }
  return best
}

function peopleInPoolNear(
  punches: TipPunch[],
  index: DirectoryIndex,
  rules: TipRules,
  pool: PoolName,
  at: number,
): { ids: string[]; at: number } {
  const present = peopleInPoolAt(punches, index, rules, pool, at)
  if (present.length) return { ids: present, at }
  const pooled = punches.filter((punch) => poolOf(punch.role, rules) === pool)
  const nearest = nearestPunch(pooled, at)
  if (!nearest) return { ids: [], at }
  const start = Date.parse(nearest.in)
  const end = Date.parse(nearest.out)
  const moment = at < start ? start : at >= end ? end - 1 : at
  return { ids: peopleInPoolAt(punches, index, rules, pool, moment), at: moment }
}

function namedShares(shares: Map<string, number>, index: DirectoryIndex): TipSplit['people'] {
  return [...shares.entries()]
    .filter(([, cents]) => cents !== 0)
    .map(([id, cents]) => ({ employeeId: id, name: index.byId.get(id)?.name || id, cents }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name))
}

function worksheetTotals(cards: TipCard[], issues: TipIssue[]): WorksheetTotals {
  const paidCents = cards.reduce(
    (sum, card) => sum + card.payouts.reduce((inner, row) => inner + row.serviceChargeCents + row.gratuityCents, 0),
    0,
  )
  const unassigned = cards.reduce((sum, card) => sum + card.unassignedCents, 0)
  const held = issues
    .filter((issue) => issue.kind === 'unmatched' || issue.kind === 'unpooled' || issue.kind === 'no-clock')
    .reduce((sum, issue) => sum + issue.cents, 0)
  const waitingCents = unassigned + held
  return { collectedCents: paidCents + waitingCents, paidCents, waitingCents }
}

function dayPeople(cards: TipCard[]): DayPerson[] {
  const rows = new Map<string, DayPerson>()
  for (const card of cards) {
    for (const payout of card.payouts) {
      if (payout.serviceChargeCents === 0 && payout.gratuityCents === 0) continue
      const row = rows.get(payout.employeeId) ?? {
        employeeId: payout.employeeId,
        name: payout.name,
        serviceChargeCents: 0,
        gratuityCents: 0,
      }
      row.serviceChargeCents += payout.serviceChargeCents
      row.gratuityCents += payout.gratuityCents
      rows.set(payout.employeeId, row)
    }
  }
  return [...rows.values()].sort((a, b) => {
    const diff = (b.serviceChargeCents + b.gratuityCents) - (a.serviceChargeCents + a.gratuityCents)
    return diff || a.name.localeCompare(b.name)
  })
}

const GROUP_TITLES = {
  bar: 'Bar and servers',
  cafe: 'Cafe',
  floor: 'Floor',
  kitchen: 'Kitchen',
} as const

function groupTotals(cards: TipCard[], decisions: Record<string, CardDecision>): GroupTotal[] {
  const groups: GroupTotal[] = []
  for (const id of ['bar', 'cafe', 'floor', 'kitchen'] as const) {
    const card = cards.find((item) => item.id === id)
    if (!card) continue
    const people = new Set(
      card.payouts.filter((row) => row.serviceChargeCents !== 0 || row.gratuityCents !== 0).map((row) => row.employeeId),
    )
    groups.push({
      id,
      title: GROUP_TITLES[id],
      totalCents: card.moneyInCents,
      headcount: people.size,
      detail: card.breakdown || card.detail,
    })
  }
  const parties = cards.filter((card) => card.kind === 'party')
  const partyPeople = new Set<string>()
  let partyTotal = 0
  let toReview = 0
  for (const card of parties) {
    partyTotal += card.moneyInCents
    for (const row of card.payouts) {
      if (row.serviceChargeCents !== 0 || row.gratuityCents !== 0) partyPeople.add(row.employeeId)
    }
    if (cardIsEmpty(card)) continue
    const decision = decisions[card.id]
    const confirmed = Boolean(decision?.confirmedAt && decision.confirmedFingerprint === card.fingerprint)
    if (card.unassignedCents !== 0 || !confirmed) toReview += 1
  }
  groups.push({
    id: 'parties',
    title: 'Parties',
    totalCents: partyTotal,
    headcount: partyPeople.size,
    detail: parties.length === 1 ? '1 party' : `${parties.length} parties`,
    toReview,
  })
  return groups
}

const TILE_STATUS: Record<TileState, string> = {
  review: 'Review',
  confirmed: 'Confirmed',
  decide: 'Needs a decision',
  changed: 'Confirm again',
}

function tileState(card: TipCard, decision: CardDecision | undefined, needsDecision: boolean): TileState {
  if (needsDecision) return 'decide'
  if (decision?.confirmedAt && decision.confirmedFingerprint === card.fingerprint) return 'confirmed'
  if (decision?.confirmedFingerprint && decision.confirmedFingerprint !== card.fingerprint) return 'changed'
  return 'review'
}

function mergedState(states: TileState[]): TileState {
  if (states.some((state) => state === 'decide')) return 'decide'
  if (states.some((state) => state === 'changed')) return 'changed'
  if (states.length > 0 && states.every((state) => state === 'confirmed')) return 'confirmed'
  return 'review'
}

function sideWaiting(card: TipCard, issues: TipIssue[]): boolean {
  return card.unassignedCents !== 0 || issues.some((issue) => issue.id === `noclock:${card.id}`)
}

function sideActive(card: TipCard, issues: TipIssue[]): boolean {
  return card.moneyInCents !== 0 || card.payouts.length > 0 || sideWaiting(card, issues)
}

const SOURCE_TILES = [
  {
    id: 'bar',
    kind: 'bar' as const,
    title: 'Bar and servers',
    sides: [
      { id: 'bar', label: 'Bar' },
      { id: 'floor', label: 'Floor' },
    ],
  },
  {
    id: 'cafe',
    kind: 'cafe' as const,
    title: 'Cafe',
    sides: [
      { id: 'cafe', label: 'Cafe' },
      { id: 'kitchen', label: 'Kitchen' },
    ],
  },
]

function dayTiles(cards: TipCard[], issues: TipIssue[], decisions: Record<string, CardDecision>): DayTile[] {
  const tiles: DayTile[] = []
  for (const source of SOURCE_TILES) {
    const sides = source.sides.flatMap((side) => {
      const card = cards.find((item) => item.id === side.id)
      return card && sideActive(card, issues) ? [{ ...side, card }] : []
    })
    if (!sides.length) continue
    const people = new Set<string>()
    let total = 0
    const states: TileState[] = []
    for (const side of sides) {
      const waiting = sideWaiting(side.card, issues)
      for (const row of side.card.payouts) {
        if (row.serviceChargeCents !== 0 || row.gratuityCents !== 0) people.add(row.employeeId)
      }
      total += side.card.moneyInCents
      if (waiting && side.card.moneyInCents === 0) {
        total += issues
          .filter((issue) => issue.id === `noclock:${side.id}`)
          .reduce((sum, issue) => sum + issue.cents, 0)
      }
      states.push(tileState(side.card, decisions[side.id], waiting))
    }
    const state = mergedState(states)
    tiles.push({
      id: source.id,
      kind: source.kind,
      title: source.title,
      totalCents: total,
      subtitle: people.size === 1 ? '1 person' : `${people.size} people`,
      state,
      status: TILE_STATUS[state],
      cardIds: sides.map((side) => side.id),
      parts: sides.map((side) => ({ label: side.label, cents: side.card.moneyInCents })),
    })
  }
  for (const card of cards.filter((item) => item.kind === 'party' && !cardIsEmpty(item))) {
    const state = tileState(card, decisions[card.id], card.unassignedCents !== 0)
    const time = card.detail.split(' · ')[0] || ''
    tiles.push({
      id: card.id,
      kind: 'party',
      title: card.title,
      totalCents: card.moneyInCents,
      subtitle: time,
      state,
      status: TILE_STATUS[state],
      cardIds: [card.id],
      parts: [],
    })
  }
  return tiles
}

function staffOptions(index: DirectoryIndex, punches: TimelinePunch[]): StaffOption[] {
  const shifts = new Map<string, StaffOption['shifts']>()
  for (const punch of punches) {
    const list = shifts.get(punch.employeeId) ?? []
    list.push({ role: punch.role, in: punch.in, out: punch.out })
    shifts.set(punch.employeeId, list)
  }
  return [...index.byId.values()]
    .map((person) => {
      const mine = (shifts.get(person.id) ?? []).sort((a, b) => a.in.localeCompare(b.in))
      const roles: string[] = []
      for (const shift of mine) {
        if (shift.role && !roles.includes(shift.role)) roles.push(shift.role)
      }
      return { id: person.id, name: person.name, worked: mine.length > 0, roles, shifts: mine }
    })
    .sort((a, b) => Number(b.worked) - Number(a.worked) || a.name.localeCompare(b.name))
}

function peopleInPoolAt(punches: TipPunch[], index: DirectoryIndex, rules: TipRules, pool: PoolName, at: number): string[] {
  const ids: string[] = []
  for (const punch of punches) {
    if (poolOf(punch.role, rules) !== pool) continue
    if (!covers(punch, at)) continue
    const id = personForPunch(punch, index).id
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

function peopleOverlapping(
  punches: TipPunch[],
  index: DirectoryIndex,
  rules: TipRules,
  pools: PoolName[],
  start: number,
  end: number,
): string[] {
  const ids: string[] = []
  for (const punch of punches) {
    const pool = poolOf(punch.role, rules)
    if (!pool || !pools.includes(pool)) continue
    if (pools.includes('bar') && pool === 'bar' && !partyBartender(punch.role, rules) && pools.length === 1) continue
    if (!overlaps(punch, start, end)) continue
    const id = personForPunch(punch, index).id
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

function partyBartender(role: string, rules: TipRules): boolean {
  return (rules.partyBartenderRoles || []).includes(role)
}

function spansFor(
  punches: TipPunch[],
  index: DirectoryIndex,
  rules: TipRules,
  pool: PoolName,
  window: Window,
): Span[] {
  const spans: Span[] = []
  for (const punch of punches) {
    if (poolOf(punch.role, rules) !== pool) continue
    const start = Date.parse(punch.in)
    const end = Date.parse(punch.out)
    if (end <= window.start || start >= window.end) continue
    spans.push({ id: personForPunch(punch, index).id, start, end })
  }
  return spans
}

function punchFacts(punches: TipPunch[], index: DirectoryIndex, rules: TipRules, pools: PoolName[]): unknown[] {
  return punches
    .filter((punch) => {
      const pool = poolOf(punch.role, rules)
      return pool !== null && pools.includes(pool)
    })
    .map((punch) => [personForPunch(punch, index).id, punch.role, punch.in, punch.out, punch.clockIn])
    .sort((a, b) => String(a[2]).localeCompare(String(b[2])) || String(a[0]).localeCompare(String(b[0])))
}

function dayWindows(day: string, rules: TipRules): { day: Window; night: Window } {
  const cutoff = rules.businessDayCutoffHour
  const split = rules.daypartHour
  const start = zonedMs(day, cutoff)
  const middle = zonedMs(day, split)
  const end = zonedMs(addDays(day, 1), cutoff)
  return {
    day: { start, end: middle },
    night: { start: middle, end },
  }
}

function settleCents(shares: Map<string, number>, total: number, clockOrder: (id: string) => number): Map<string, number> {
  const rows = [...shares.entries()]
    .filter(([, exact]) => exact > 0)
    .map(([id, exact]) => ({ id, cents: Math.floor(exact + 1e-6) }))
  const out = new Map<string, number>()
  for (const row of rows) out.set(row.id, row.cents)
  const used = rows.reduce((sum, row) => sum + row.cents, 0)
  const remainder = total - used
  if (remainder !== 0 && rows.length) {
    rows.sort((a, b) => clockOrder(a.id) - clockOrder(b.id) || a.id.localeCompare(b.id))
    out.set(rows[0].id, (out.get(rows[0].id) ?? 0) + remainder)
  }
  return out
}

function clipSpans(spans: Span[], window: Window): Span[] {
  const out: Span[] = []
  for (const span of spans) {
    const start = Math.max(span.start, window.start)
    const end = Math.min(span.end, window.end)
    if (end > start) out.push({ id: span.id, start, end })
  }
  return out
}

function idsOverlapping(spans: Span[], start: number, end: number): string[] {
  const ids: string[] = []
  for (const span of spans) {
    if (span.start < end && span.end > start && !ids.includes(span.id)) ids.push(span.id)
  }
  return ids
}

function indexDirectory(directory: DirectoryPerson[]): DirectoryIndex {
  const index: DirectoryIndex = { byId: new Map(), byUser: new Map(), byName: new Map() }
  const add = (key: string, person: DirectoryPerson) => {
    if (!key) return
    const existing = index.byName.get(key)
    if (!existing) index.byName.set(key, person)
    else if (existing !== 'ambiguous' && existing.id !== person.id) index.byName.set(key, 'ambiguous')
  }
  for (const person of directory) {
    index.byId.set(person.id, person)
    if (person.userId) index.byUser.set(person.userId, person)
    add(norm(person.name), person)
    for (const pos of person.posNames) add(norm(pos), person)
  }
  return index
}

function personForPunch(punch: TipPunch, index: DirectoryIndex): DirectoryPerson {
  const existing = index.byUser.get(punch.userId)
  if (existing) return existing
  const created: DirectoryPerson = {
    id: `user-${punch.userId}`,
    name: punch.name || `User ${punch.userId}`,
    posNames: [],
    userId: punch.userId,
  }
  index.byUser.set(punch.userId, created)
  index.byId.set(created.id, created)
  index.byName.set(norm(created.name), created)
  return created
}

function lookup(index: DirectoryIndex, raw: string): DirectoryPerson | 'ambiguous' | null {
  const hit = index.byName.get(norm(raw)) ?? null
  if (!hit || hit === 'ambiguous' || hit.userId) return hit
  // A POS nickname sometimes exists as its own directory row with no 7shifts id,
  // beside the real person ("angela" and "Angela Garcia"). Prefer the real person
  // when exactly one longer name starts with the nickname.
  const prefix = norm(hit.name)
  const better = [...index.byId.values()].filter((person) => {
    if (!person.userId || person.id === hit.id) return false
    const name = norm(person.name)
    return name === prefix || name.startsWith(`${prefix} `)
  })
  return better.length === 1 ? better[0] : hit
}

function earliestClockIn(id: string, punches: TipPunch[], index: DirectoryIndex): number {
  let best = Number.POSITIVE_INFINITY
  for (const punch of punches) {
    if (personForPunch(punch, index).id !== id) continue
    const at = Date.parse(punch.clockIn || punch.in)
    if (Number.isFinite(at) && at < best) best = at
  }
  return best
}

function punchCovering(punches: TipPunch[], userId: number | null, at: number): TipPunch | null {
  if (!userId || !Number.isFinite(at)) return null
  let best: TipPunch | null = null
  for (const punch of punches) {
    if (punch.userId !== userId || !covers(punch, at)) continue
    if (!best || Date.parse(punch.clockIn) > Date.parse(best.clockIn)) best = punch
  }
  if (best) return best
  for (const punch of punches) {
    if (punch.userId !== userId) continue
    const start = Date.parse(punch.in)
    const end = Date.parse(punch.out)
    if (start <= at && at <= end && (!best || Date.parse(punch.clockIn) > Date.parse(best.clockIn))) best = punch
  }
  return best
}

function covers(punch: TipPunch, at: number): boolean {
  return Date.parse(punch.in) <= at && at < Date.parse(punch.out)
}

function overlaps(punch: TipPunch, start: number, end: number): boolean {
  return Date.parse(punch.in) < end && Date.parse(punch.out) > start
}

function poolOf(role: string, rules: TipRules): PoolName | null {
  for (const pool of Object.keys(rules.pools) as PoolName[]) {
    if ((rules.pools[pool] || []).includes(role)) return pool
  }
  return null
}

function addMap(map: Map<string, number>, id: string, cents: number): void {
  map.set(id, (map.get(id) ?? 0) + cents)
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function slugify(value: string): string {
  return norm(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'party'
}

function money(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`
}

function clockLabel(iso: string): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return iso
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at))
}

export function moneyLabel(cents: number): string {
  return money(cents)
}
