export type PoolName = 'bar' | 'cafe' | 'coordinator' | 'floor' | 'kitchen'

export interface TipRules {
  daypartHour: number
  businessDayCutoffHour: number
  floorPercent: number
  kitchenPercent: number
  coordinatorPercent: number
  bartenderSalesPercent: number
  pools: Record<PoolName, string[]>
  partyBartenderRoles: string[]
  /** First day of a known pay period. Periods repeat every payPeriodDays. */
  payPeriodStart?: string
  payPeriodDays?: number
}

export interface DirectoryPerson {
  id: string
  name: string
  posNames: string[]
  userId: number | null
}

export interface TipGratuityLine {
  name: string
  cents: number
}

export interface TipTab {
  txnId: string
  opened: string | null
  closed: string | null
  user: string
  terminal: string
  partyName: string | null
  accountNames: string[]
  serviceChargeCents: number
  gratuity: TipGratuityLine[]
  barSalesCents: number
  coordinators: string[]
  firstItem: string | null
  lastItem: string | null
}

export interface TipPunch {
  userId: number
  name: string
  role: string
  clockIn: string
  in: string
  out: string
}

export interface TipResource {
  name: string
  start: string | null
  end: string | null
}

export interface TipReservation {
  id: number
  title: string
  type: string
  event: string | null
  txnIds: string[]
  start: string | null
  end: string | null
  resources?: TipResource[]
}

export interface TipDayFacts {
  tabs: TipTab[]
  punches: TipPunch[]
  reservations: TipReservation[]
}

export interface TipMonthFile {
  generatedAt: string
  month: string
  rules: TipRules
  directory: DirectoryPerson[]
  days: Record<string, TipDayFacts>
}

export interface AmountOverride {
  employeeId: string
  cents: number
  reason: string
}

export interface CardDecision {
  confirmedAt?: string
  confirmedFingerprint?: string
  balanceNote?: string
  coordinators?: string[]
  support?: string[]
  bartenders?: string[]
  removed?: string[]
  added?: string[]
  overrides?: AmountOverride[]
}

export interface IssueDecision {
  resolved?: boolean
  note?: string
  assignPool?: 'bar' | 'cafe'
  assignEmployeeId?: string
}

export interface DayDecisions {
  version: 1
  date: string
  savedAt?: string
  cards: Record<string, CardDecision>
  issues: Record<string, IssueDecision>
  closedAt?: string
  closedFingerprint?: string
}

export type CardKind = 'party' | 'bar' | 'cafe' | 'floor' | 'kitchen' | 'assigned'

export interface Payout {
  employeeId: string
  name: string
  serviceChargeCents: number
  gratuityCents: number
}

export interface TipCard {
  id: string
  kind: CardKind
  title: string
  detail: string
  moneyInCents: number
  serviceChargeCents: number
  gratuityCents: number
  payouts: Payout[]
  unassignedCents: number
  fingerprint: string
  notes: string[]
  /** One line under the title, such as "Collected $680.44 · 10% to floor $68.04". */
  breakdown?: string
  /** Party cards: the three cuts, with who is in each. Coordinators come first. */
  splits?: TipSplit[]
  /** Party cards: the time and bar sales behind the subtotal boxes. */
  facts?: PartyFacts
  /** Who the card currently includes. Party cards use this for the pick lists. */
  roster?: {
    bartenders: string[]
    coordinators: string[]
    support: string[]
  }
  /**
   * On a floor or kitchen card, the cents that went back to the source pool
   * because nobody in the receiving pool was on that hour.
   */
  returned?: { employeeId: string; cents: number }[]
}

export interface TipSplitPerson {
  employeeId: string
  name: string
  cents: number
}

export type SplitKey = 'coordinators' | 'support' | 'bartenders'

export interface PartyFacts {
  /** Clock range shown above the subtotal boxes, such as "2:59 PM–6:17 PM". */
  window: string
  barSalesCents: number
}

export interface TipSplit {
  key: SplitKey
  label: string
  hint: string
  cents: number
  people: TipSplitPerson[]
}

export type GroupId = 'bar' | 'cafe' | 'floor' | 'kitchen' | 'parties'

export interface GroupTotal {
  id: GroupId
  title: string
  totalCents: number
  headcount: number
  detail: string
  /** Parties that still need a person picked or a confirmation. */
  toReview?: number
}

export interface DayPerson {
  employeeId: string
  name: string
  serviceChargeCents: number
  gratuityCents: number
}

export interface WorksheetTotals {
  collectedCents: number
  paidCents: number
  waitingCents: number
}

/** processed: closed and the source still matches. nothing: no tips that day, counts as processed. */
export type DayState = 'processed' | 'not-closed' | 'changed' | 'nothing' | 'no-data'

export type IssueKind = 'unmatched' | 'unpooled' | 'no-clock' | 'party' | 'bartenders'

export interface TipIssue {
  id: string
  kind: IssueKind
  message: string
  cents: number
  /** Set when the line is one person's tips for the day. */
  employeeId?: string
  /** How many tabs were rolled into this line. */
  tabCount?: number
}

export interface TimelinePunch {
  employeeId: string
  name: string
  role: string
  pool: PoolName | null
  in: string
  out: string
}

export interface TimelineParty {
  id: string
  label: string
  start: string
  end: string
}

export interface StaffShift {
  role: string
  in: string
  out: string
}

export interface StaffOption {
  id: string
  name: string
  /** Clocked in on this business day. */
  worked: boolean
  roles: string[]
  shifts: StaffShift[]
}

export type TileState = 'review' | 'confirmed' | 'decide' | 'changed'

export interface TilePart {
  label: string
  cents: number
}

export interface DayTile {
  id: string
  kind: 'bar' | 'cafe' | 'party'
  title: string
  totalCents: number
  /** Headcount for a source tile, or the party time. */
  subtitle: string
  state: TileState
  status: string
  /** Cards confirmed together. Bar covers bar and floor; cafe covers cafe and kitchen. */
  cardIds: string[]
  /** The line under the headline, such as Bar $369.47 · Floor $41.05. */
  parts: TilePart[]
}

export interface Worksheet {
  date: string
  cards: TipCard[]
  issues: TipIssue[]
  punches: TimelinePunch[]
  parties: TimelineParty[]
  staff: StaffOption[]
  daypartHour: number
  fingerprint: string
  groups: GroupTotal[]
  people: DayPerson[]
  totals: WorksheetTotals
  /** One tile per tip source (bar with its floor share, cafe with its kitchen share) and one per party. */
  tiles: DayTile[]
}

export function emptyDecisions(date: string): DayDecisions {
  return { version: 1, date, cards: {}, issues: {} }
}

export function payoutTotal(payout: Payout): number {
  return payout.serviceChargeCents + payout.gratuityCents
}
