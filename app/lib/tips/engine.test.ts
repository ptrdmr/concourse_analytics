import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  allocateByCoverage,
  buildWorksheet,
  classifyDay,
  latestWorkedDay,
  payPeriodOf,
  splitEven,
  zonedMs,
} from './engine.ts'
import { emptyDecisions, payoutTotal, type DayDecisions, type DirectoryPerson, type TipRules, type TipTab, type Worksheet } from './types.ts'

const RULES: TipRules = {
  daypartHour: 17,
  businessDayCutoffHour: 4,
  floorPercent: 10,
  kitchenPercent: 10,
  coordinatorPercent: 60,
  bartenderSalesPercent: 10,
  pools: {
    bar: ['Bartender', 'Server'],
    cafe: ['Cafe Front'],
    coordinator: ['Party Server'],
    floor: ['Front Desk', 'Scoretech'],
    kitchen: ['Dish/Prep', 'Line', 'Prep/Pizza'],
  },
  partyBartenderRoles: ['Bartender'],
}

const HOUR = 60 * 60 * 1000

test('5pm is a different UTC instant before and after daylight saving', () => {
  assert.equal(zonedMs('2026-11-07', 17), Date.parse('2026-11-08T01:00:00.000Z'))
  assert.equal(zonedMs('2026-10-19', 17), Date.parse('2026-10-20T00:00:00.000Z'))
})

test('floor tool Monday night: $42 over 8 hours, three people', () => {
  const coverage = [{ id: 'bar', start: 0, end: 8 * HOUR }]
  const recipients = [
    { id: 'nathan', start: 0, end: 8 * HOUR },
    { id: 'joseph', start: 0, end: 5 * HOUR },
    { id: 'chris', start: 0, end: 5 * HOUR },
  ]
  const shares = allocateByCoverage(4200, coverage, recipients, { start: 0, end: 8 * HOUR }, () => 0)
  assert.equal(shares.get('nathan'), 2450)
  assert.equal(shares.get('joseph'), 875)
  assert.equal(shares.get('chris'), 875)
  assert.equal([...shares.values()].reduce((sum, cents) => sum + cents, 0), 4200)
})

test('an hour with no floor staff goes back to the bartender on that hour', () => {
  const coverage = [{ id: 'ciera', start: 0, end: 2 * HOUR }]
  const recipients = [{ id: 'desk', start: 0, end: 1 * HOUR }]
  const shares = allocateByCoverage(1000, coverage, recipients, { start: 0, end: 2 * HOUR }, () => 0)
  assert.equal(shares.get('desk'), 500)
  assert.equal(shares.get('ciera'), 500)
})

test('leftover cents go to the first person to clock in', () => {
  const shares = splitEven(100, ['late', 'early', 'mid'], (id) => ({ early: 1, mid: 2, late: 3 })[id] ?? 0)
  assert.equal(shares.get('early'), 34)
  assert.equal(shares.get('mid'), 33)
  assert.equal(shares.get('late'), 33)
})

const DIRECTORY: DirectoryPerson[] = [
  { id: 'ciera', name: 'Ciera Jackson', posNames: ['ciera'], userId: 1 },
  { id: 'tony', name: 'Tony Saavedra', posNames: ['tony s.'], userId: 2 },
  { id: 'night', name: 'Nicole Reyes', posNames: ['nicole'], userId: 3 },
  { id: 'desk', name: 'Nathan Penner', posNames: ['nathan p.'], userId: 4 },
  { id: 'allyssa', name: 'Allyssa Boone', posNames: ['allyssa'], userId: 5 },
  { id: 'sasha', name: 'Sasha Salcedo', posNames: ['sasha'], userId: 6 },
  { id: 'line', name: 'Cody Hill', posNames: ['cody'], userId: 7 },
  { id: 'cafe', name: 'Angela Garcia', posNames: ['angela'], userId: 8 },
  { id: 'manager', name: 'Christopher Saavedra', posNames: ['christopher'], userId: 9 },
]

function punch(userId: number, name: string, role: string, start: string, end: string) {
  return { userId, name, role, clockIn: start, in: start, out: end }
}

test('bar tips split by who was clocked in at close, after the floor 10%', () => {
  const tab: TipTab = {
    txnId: '100',
    opened: '2026-11-07T17:00:00-08:00',
    closed: '2026-11-07T18:00:00-08:00',
    user: 'Ciera',
    terminal: 'BAR1',
    partyName: null,
    accountNames: [],
    serviceChargeCents: 0,
    gratuity: [
      { name: 'ciera', cents: 500 },
      { name: 'Tony S.', cents: 500 },
    ],
    barSalesCents: 0,
    coordinators: [],
    firstItem: null,
    lastItem: null,
  }
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [tab],
    punches: [
      punch(1, 'Ciera Jackson', 'Bartender', '2026-11-07T16:00:00-08:00', '2026-11-07T22:00:00-08:00'),
      punch(2, 'Tony Saavedra', 'Bartender', '2026-11-07T16:30:00-08:00', '2026-11-07T22:00:00-08:00'),
      punch(4, 'Nathan Penner', 'Front Desk', '2026-11-07T16:00:00-08:00', '2026-11-07T22:00:00-08:00'),
    ],
    reservations: [],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))

  const bar = worksheet.cards.find((card) => card.id === 'bar')
  const floor = worksheet.cards.find((card) => card.id === 'floor')
  assert.ok(bar)
  assert.ok(floor)
  assert.equal(bar.moneyInCents, 900)
  assert.equal(bar.payouts.find((row) => row.employeeId === 'ciera')?.gratuityCents, 450)
  assert.equal(bar.payouts.find((row) => row.employeeId === 'tony')?.gratuityCents, 450)
  assert.equal(floor.moneyInCents, 100)
  assert.equal(floor.payouts.find((row) => row.employeeId === 'desk')?.gratuityCents, 100)
  assert.equal(bar.unassignedCents + floor.unassignedCents, 0)
})

test('a bartender who straddles 5pm shares a tab that closes while both waves are on', () => {
  const tab: TipTab = {
    txnId: '101',
    opened: '2026-11-07T16:00:00-08:00',
    closed: '2026-11-07T16:45:00-08:00',
    user: 'Ciera',
    terminal: 'BAR1',
    partyName: null,
    accountNames: [],
    serviceChargeCents: 0,
    gratuity: [{ name: 'ciera', cents: 1000 }],
    barSalesCents: 0,
    coordinators: [],
    firstItem: null,
    lastItem: null,
  }
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [tab],
    punches: [
      punch(1, 'Ciera Jackson', 'Bartender', '2026-11-07T10:00:00-08:00', '2026-11-07T17:15:00-08:00'),
      punch(3, 'Nicole Reyes', 'Bartender', '2026-11-07T16:30:00-08:00', '2026-11-07T22:00:00-08:00'),
      punch(4, 'Nathan Penner', 'Scoretech', '2026-11-07T10:00:00-08:00', '2026-11-07T22:00:00-08:00'),
    ],
    reservations: [],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  const bar = worksheet.cards.find((card) => card.id === 'bar')
  assert.ok(bar)
  assert.equal(bar.payouts.find((row) => row.employeeId === 'ciera')?.gratuityCents, 450)
  assert.equal(bar.payouts.find((row) => row.employeeId === 'night')?.gratuityCents, 450)
})

test('a manager tip is held for the GM instead of entering a pool', () => {
  const tab: TipTab = {
    txnId: '102',
    opened: '2026-11-07T18:00:00-08:00',
    closed: '2026-11-07T19:00:00-08:00',
    user: 'Christopher',
    terminal: 'BAR1',
    partyName: null,
    accountNames: [],
    serviceChargeCents: 0,
    gratuity: [{ name: 'Christopher', cents: 4000 }],
    barSalesCents: 0,
    coordinators: [],
    firstItem: null,
    lastItem: null,
  }
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [tab],
    punches: [
      punch(9, 'Christopher Saavedra', 'Floor Manager', '2026-11-07T12:00:00-08:00', '2026-11-07T22:00:00-08:00'),
      punch(1, 'Ciera Jackson', 'Bartender', '2026-11-07T16:00:00-08:00', '2026-11-07T22:00:00-08:00'),
    ],
    reservations: [],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  const bar = worksheet.cards.find((card) => card.id === 'bar')
  assert.equal(bar?.moneyInCents, 0)
  assert.equal(worksheet.issues.some((issue) => issue.kind === 'unpooled' && issue.cents === 4000), true)
})

test('a tagged party pays bartenders from bar sales, then 60/40, with no floor cut', () => {
  const tab: TipTab = {
    txnId: '848253',
    opened: '2026-11-07T16:02:00-08:00',
    closed: '2026-11-07T20:22:00-08:00',
    user: 'Sasha',
    terminal: 'MPOS6',
    partyName: 'Kimberly Hilburn',
    accountNames: ['KImberly Hilburn 11.07.26'],
    serviceChargeCents: 28800,
    gratuity: [{ name: 'Sasha', cents: 10000 }],
    barSalesCents: 100000,
    coordinators: ['Allyssa Boone', 'Sasha Salcedo'],
    firstItem: '2026-11-07T16:10:00-08:00',
    lastItem: '2026-11-07T20:00:00-08:00',
  }
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [tab],
    punches: [
      punch(1, 'Ciera Jackson', 'Bartender', '2026-11-07T15:00:00-08:00', '2026-11-07T21:00:00-08:00'),
      punch(5, 'Allyssa Boone', 'Party Server', '2026-11-07T15:00:00-08:00', '2026-11-07T21:00:00-08:00'),
      punch(6, 'Sasha Salcedo', 'Party Server', '2026-11-07T15:00:00-08:00', '2026-11-07T21:00:00-08:00'),
      punch(7, 'Cody Hill', 'Line', '2026-11-07T14:00:00-08:00', '2026-11-07T21:00:00-08:00'),
      punch(4, 'Nathan Penner', 'Front Desk', '2026-11-07T14:00:00-08:00', '2026-11-07T21:00:00-08:00'),
      punch(3, 'Nicole Reyes', 'Server', '2026-11-07T15:00:00-08:00', '2026-11-07T21:00:00-08:00'),
    ],
    reservations: [{
      id: 9,
      title: 'Kimberly Hilburn',
      type: 'Kingpin Suite',
      event: '2026-11-07',
      txnIds: ['848253'],
      start: '2026-11-07T16:00:00-08:00',
      end: '2026-11-07T20:00:00-08:00',
    }],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))

  const party = worksheet.cards.find((card) => card.kind === 'party')
  assert.ok(party)
  assert.equal(party.moneyInCents, 38800)
  assert.equal(party.unassignedCents, 0)
  const get = (id: string) => {
    const row = party.payouts.find((payout) => payout.employeeId === id)
    return (row?.serviceChargeCents ?? 0) + (row?.gratuityCents ?? 0)
  }
  assert.equal(get('ciera'), 10000)
  assert.equal(get('night'), 0)
  assert.equal(get('allyssa'), 8640)
  assert.equal(get('sasha'), 8640)
  assert.equal(get('line'), 5760)
  assert.equal(get('desk'), 5760)
  const service = party.payouts.reduce((sum, row) => sum + row.serviceChargeCents, 0)
  const gratuity = party.payouts.reduce((sum, row) => sum + row.gratuityCents, 0)
  assert.equal(service, 28800)
  assert.equal(gratuity, 10000)
  assert.equal(worksheet.cards.find((card) => card.id === 'floor')?.moneyInCents, 0)
  assert.deepEqual(party.splits?.map((split) => split.key), ['coordinators', 'support', 'bartenders'])
  assert.equal(party.splits?.[0]?.cents, 17280)
  assert.equal(party.facts?.barSalesCents, 100000)
  assert.match(party.facts?.window ?? '', /–/)
})

test('an untagged party leaves the 60% for the GM', () => {
  const tab: TipTab = {
    txnId: '200',
    opened: '2026-11-07T18:00:00-08:00',
    closed: '2026-11-07T20:00:00-08:00',
    user: 'Sasha',
    terminal: 'MPOS6',
    partyName: 'Open House',
    accountNames: [],
    serviceChargeCents: 10000,
    gratuity: [],
    barSalesCents: 0,
    coordinators: [],
    firstItem: '2026-11-07T18:00:00-08:00',
    lastItem: '2026-11-07T20:00:00-08:00',
  }
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [tab],
    punches: [
      punch(7, 'Cody Hill', 'Line', '2026-11-07T14:00:00-08:00', '2026-11-07T21:00:00-08:00'),
    ],
    reservations: [],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  const party = worksheet.cards.find((card) => card.kind === 'party')
  assert.ok(party)
  assert.equal(party.unassignedCents, 6000)
  assert.equal(party.payouts.find((row) => row.employeeId === 'line')?.serviceChargeCents, 4000)
  assert.equal(worksheet.issues.some((issue) => issue.id === `coordinators:${party.id}`), true)
})

test('changing a tip changes the card fingerprint', () => {
  const base: TipTab = {
    txnId: '100',
    opened: '2026-11-07T18:00:00-08:00',
    closed: '2026-11-07T19:00:00-08:00',
    user: 'Ciera',
    terminal: 'BAR1',
    partyName: null,
    accountNames: [],
    serviceChargeCents: 0,
    gratuity: [{ name: 'ciera', cents: 1000 }],
    barSalesCents: 0,
    coordinators: [],
    firstItem: null,
    lastItem: null,
  }
  const facts = {
    punches: [punch(1, 'Ciera Jackson', 'Bartender', '2026-11-07T16:00:00-08:00', '2026-11-07T22:00:00-08:00')],
    reservations: [],
  }
  const first = buildWorksheet('2026-11-07', { ...facts, tabs: [base] }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  const second = buildWorksheet('2026-11-07', {
    ...facts,
    tabs: [{ ...base, gratuity: [{ name: 'ciera', cents: 1200 }] }],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  const bar = (worksheet: { cards: { id: string; fingerprint: string }[] }) =>
    worksheet.cards.find((card) => card.id === 'bar')?.fingerprint
  assert.notEqual(bar(first), bar(second))
})

test('a POS nickname with no 7shifts id uses the one matching full name', () => {
  const directory: DirectoryPerson[] = [
    { id: 'angela-stub', name: 'Angela', posNames: ['angela'], userId: null },
    { id: 'angela-garcia', name: 'Angela Garcia', posNames: [], userId: 8 },
  ]
  const tab: TipTab = {
    txnId: '301',
    opened: '2026-11-07T11:00:00-08:00',
    closed: '2026-11-07T12:00:00-08:00',
    user: 'Angela',
    terminal: 'CAFE1',
    partyName: null,
    accountNames: [],
    serviceChargeCents: 0,
    gratuity: [{ name: 'angela', cents: 1000 }],
    barSalesCents: 0,
    coordinators: [],
    firstItem: null,
    lastItem: null,
  }
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [tab],
    punches: [
      punch(8, 'Angela Garcia', 'Cafe Front', '2026-11-07T09:00:00-08:00', '2026-11-07T15:00:00-08:00'),
    ],
    reservations: [],
  }, directory, RULES, emptyDecisions('2026-11-07'))
  const cafe = worksheet.cards.find((card) => card.id === 'cafe')
  assert.equal(cafe?.payouts[0]?.employeeId, 'angela-garcia')
  assert.equal(cafe?.payouts[0]?.gratuityCents, 900)
  assert.equal(worksheet.issues.some((issue) => issue.kind === 'unpooled'), false)
})

test('cafe tips pay 10% to the kitchen and pool the rest', () => {
  const tab: TipTab = {
    txnId: '300',
    opened: '2026-11-07T11:00:00-08:00',
    closed: '2026-11-07T12:00:00-08:00',
    user: 'Angela',
    terminal: 'CAFE1',
    partyName: null,
    accountNames: [],
    serviceChargeCents: 0,
    gratuity: [{ name: 'angela', cents: 1000 }],
    barSalesCents: 0,
    coordinators: [],
    firstItem: null,
    lastItem: null,
  }
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [tab],
    punches: [
      punch(8, 'Angela Garcia', 'Cafe Front', '2026-11-07T09:00:00-08:00', '2026-11-07T15:00:00-08:00'),
      punch(7, 'Cody Hill', 'Prep/Pizza', '2026-11-07T09:00:00-08:00', '2026-11-07T15:00:00-08:00'),
    ],
    reservations: [],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  assert.equal(worksheet.cards.find((card) => card.id === 'cafe')?.payouts[0]?.gratuityCents, 900)
  assert.equal(worksheet.cards.find((card) => card.id === 'kitchen')?.payouts[0]?.gratuityCents, 100)
  const cafeTile = worksheet.tiles.find((tile) => tile.id === 'cafe')
  assert.equal(cafeTile?.totalCents, 1000)
  assert.deepEqual(cafeTile?.cardIds, ['cafe', 'kitchen'])
  assert.deepEqual(cafeTile?.parts, [
    { label: 'Cafe', cents: 900 },
    { label: 'Kitchen', cents: 100 },
  ])
  assert.equal(worksheet.tiles.some((tile) => tile.id === 'kitchen'), false)
})

function assertBalanced(worksheet: Worksheet) {
  const { collectedCents, paidCents, waitingCents } = worksheet.totals
  assert.equal(collectedCents, paidCents + waitingCents)
}

test('a tab that closes after its bartender clocked out is shared by whoever is still on', () => {
  const tab: TipTab = {
    txnId: '400',
    opened: '2026-11-07T15:00:00-08:00',
    closed: '2026-11-07T18:00:00-08:00',
    user: 'Ciera',
    terminal: 'BAR1',
    partyName: null,
    accountNames: [],
    serviceChargeCents: 0,
    gratuity: [{ name: 'ciera', cents: 1000 }],
    barSalesCents: 0,
    coordinators: [],
    firstItem: null,
    lastItem: null,
  }
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [tab],
    punches: [
      punch(1, 'Ciera Jackson', 'Bartender', '2026-11-07T10:00:00-08:00', '2026-11-07T16:00:00-08:00'),
      punch(2, 'Tony Saavedra', 'Bartender', '2026-11-07T16:00:00-08:00', '2026-11-07T22:00:00-08:00'),
      punch(4, 'Nathan Penner', 'Front Desk', '2026-11-07T10:00:00-08:00', '2026-11-07T22:00:00-08:00'),
    ],
    reservations: [],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  const bar = worksheet.cards.find((card) => card.id === 'bar')
  const floor = worksheet.cards.find((card) => card.id === 'floor')
  assert.equal(bar?.payouts.find((row) => row.employeeId === 'tony')?.gratuityCents, 900)
  assert.equal(bar?.payouts.find((row) => row.employeeId === 'ciera')?.gratuityCents, undefined)
  assert.equal(floor?.payouts.find((row) => row.employeeId === 'desk')?.gratuityCents, 100)
  assert.equal(worksheet.issues.some((issue) => issue.kind === 'unpooled' || issue.kind === 'no-clock'), false)
  assertBalanced(worksheet)
})

test('a tab that closes after the pool has left goes to the last people on, and the floor still gets its cut', () => {
  const tab: TipTab = {
    txnId: '401',
    opened: '2026-11-07T15:00:00-08:00',
    closed: '2026-11-07T18:00:00-08:00',
    user: 'Ciera',
    terminal: 'BAR1',
    partyName: null,
    accountNames: [],
    serviceChargeCents: 0,
    gratuity: [{ name: 'ciera', cents: 1000 }],
    barSalesCents: 0,
    coordinators: [],
    firstItem: null,
    lastItem: null,
  }
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [tab],
    punches: [
      punch(1, 'Ciera Jackson', 'Bartender', '2026-11-07T10:00:00-08:00', '2026-11-07T16:00:00-08:00'),
      punch(2, 'Tony Saavedra', 'Server', '2026-11-07T10:00:00-08:00', '2026-11-07T15:00:00-08:00'),
      punch(4, 'Nathan Penner', 'Front Desk', '2026-11-07T10:00:00-08:00', '2026-11-07T22:00:00-08:00'),
    ],
    reservations: [],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  assert.equal(worksheet.cards.find((card) => card.id === 'bar')?.payouts.find((row) => row.employeeId === 'ciera')?.gratuityCents, 900)
  assert.equal(worksheet.cards.find((card) => card.id === 'floor')?.moneyInCents, 100)
  assert.equal(worksheet.issues.length, 0)
  assertBalanced(worksheet)
})

test('tips for someone outside the pools are one line for the day', () => {
  const directory: DirectoryPerson[] = [
    ...DIRECTORY,
    { id: 'adam', name: 'Adam Horn', posNames: ['adam h.'], userId: 11 },
  ]
  function adamTab(txnId: string, cents: number): TipTab {
    return {
      txnId,
      opened: '2026-11-07T18:00:00-08:00',
      closed: '2026-11-07T19:00:00-08:00',
      user: 'Adam',
      terminal: 'BAR1',
      partyName: null,
      accountNames: [],
      serviceChargeCents: 0,
      gratuity: [{ name: 'Adam H.', cents }],
      barSalesCents: 0,
      coordinators: [],
      firstItem: null,
      lastItem: null,
    }
  }
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [adamTab('501', 8000), adamTab('502', 4882)],
    punches: [
      punch(11, 'Adam Horn', 'Front Desk', '2026-11-07T16:00:00-08:00', '2026-11-07T22:00:00-08:00'),
      punch(1, 'Ciera Jackson', 'Bartender', '2026-11-07T16:00:00-08:00', '2026-11-07T22:00:00-08:00'),
    ],
    reservations: [],
  }, directory, RULES, emptyDecisions('2026-11-07'))
  const held = worksheet.issues.filter((issue) => issue.kind === 'unpooled')
  assert.equal(held.length, 1)
  assert.equal(held[0].id, 'person:adam')
  assert.equal(held[0].employeeId, 'adam')
  assert.equal(held[0].cents, 12882)
  assert.equal(held[0].tabCount, 2)
  assert.equal(held[0].message.includes('501'), false)
  assert.equal(worksheet.totals.waitingCents, 12882)
  assert.equal(worksheet.totals.collectedCents, worksheet.totals.paidCents + worksheet.totals.waitingCents)
})

test('the GM can put one person\'s day into the bar pool', () => {
  const decisions = emptyDecisions('2026-11-07')
  decisions.issues['person:manager'] = { assignPool: 'bar' }
  const tab: TipTab = {
    txnId: '102',
    opened: '2026-11-07T18:00:00-08:00',
    closed: '2026-11-07T19:00:00-08:00',
    user: 'Christopher',
    terminal: 'BAR1',
    partyName: null,
    accountNames: [],
    serviceChargeCents: 0,
    gratuity: [{ name: 'Christopher', cents: 1000 }],
    barSalesCents: 0,
    coordinators: [],
    firstItem: null,
    lastItem: null,
  }
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [tab],
    punches: [
      punch(9, 'Christopher Saavedra', 'Floor Manager', '2026-11-07T12:00:00-08:00', '2026-11-07T22:00:00-08:00'),
      punch(1, 'Ciera Jackson', 'Bartender', '2026-11-07T16:00:00-08:00', '2026-11-07T22:00:00-08:00'),
    ],
    reservations: [],
  }, DIRECTORY, RULES, decisions)
  assert.equal(worksheet.issues.some((issue) => issue.kind === 'unpooled'), false)
  assert.equal(worksheet.cards.find((card) => card.id === 'bar')?.payouts.find((row) => row.employeeId === 'ciera')?.gratuityCents, 900)
  assertBalanced(worksheet)
  assert.equal(worksheet.totals.waitingCents, 0)
})

test('a person who works bar and cafe follows the role at close', () => {
  const morning: TipTab = {
    txnId: '601',
    opened: '2026-11-07T11:00:00-08:00',
    closed: '2026-11-07T12:00:00-08:00',
    user: 'Angela',
    terminal: 'BAR1',
    partyName: null,
    accountNames: [],
    serviceChargeCents: 0,
    gratuity: [{ name: 'angela', cents: 1000 }],
    barSalesCents: 0,
    coordinators: [],
    firstItem: null,
    lastItem: null,
  }
  const afternoon: TipTab = {
    ...morning,
    txnId: '602',
    opened: '2026-11-07T18:00:00-08:00',
    closed: '2026-11-07T19:00:00-08:00',
    terminal: 'CAFE1',
  }
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [morning, afternoon],
    punches: [
      punch(8, 'Angela Garcia', 'Bartender', '2026-11-07T09:00:00-08:00', '2026-11-07T15:00:00-08:00'),
      punch(8, 'Angela Garcia', 'Cafe Front', '2026-11-07T16:00:00-08:00', '2026-11-07T21:00:00-08:00'),
    ],
    reservations: [],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  assert.equal(worksheet.cards.find((card) => card.id === 'bar')?.moneyInCents, 900)
  assert.equal(worksheet.cards.find((card) => card.id === 'cafe')?.moneyInCents, 900)
  assert.equal(worksheet.issues.length, 0)
})

test('collected always equals paid plus waiting, including an open party', () => {
  const tab: TipTab = {
    txnId: '200',
    opened: '2026-11-07T18:00:00-08:00',
    closed: '2026-11-07T20:00:00-08:00',
    user: 'Sasha',
    terminal: 'MPOS6',
    partyName: 'Open House',
    accountNames: [],
    serviceChargeCents: 10000,
    gratuity: [{ name: 'Christopher', cents: 500 }],
    barSalesCents: 0,
    coordinators: [],
    firstItem: '2026-11-07T18:00:00-08:00',
    lastItem: '2026-11-07T20:00:00-08:00',
  }
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [tab],
    punches: [
      punch(7, 'Cody Hill', 'Line', '2026-11-07T14:00:00-08:00', '2026-11-07T21:00:00-08:00'),
      punch(9, 'Christopher Saavedra', 'Floor Manager', '2026-11-07T12:00:00-08:00', '2026-11-07T22:00:00-08:00'),
    ],
    reservations: [],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  assert.equal(worksheet.totals.collectedCents, 10500)
  assert.equal(worksheet.totals.paidCents + worksheet.totals.waitingCents, 10500)
  assert.ok(worksheet.totals.waitingCents > 0)
  const parties = worksheet.groups.find((group) => group.id === 'parties')
  assert.equal(parties?.toReview, 1)
})

test('a closed day is processed, and a later change to the tips marks it changed', () => {
  const facts = {
    tabs: [{
      txnId: '100',
      opened: '2026-11-07T18:00:00-08:00',
      closed: '2026-11-07T19:00:00-08:00',
      user: 'Ciera',
      terminal: 'BAR1',
      partyName: null,
      accountNames: [],
      serviceChargeCents: 0,
      gratuity: [{ name: 'ciera', cents: 1000 }],
      barSalesCents: 0,
      coordinators: [],
      firstItem: null,
      lastItem: null,
    }],
    punches: [punch(1, 'Ciera Jackson', 'Bartender', '2026-11-07T16:00:00-08:00', '2026-11-07T22:00:00-08:00')],
    reservations: [],
  }
  const open = buildWorksheet('2026-11-07', facts, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  const base = {
    monthLoaded: true,
    lastWorked: '2026-11-07',
    dayInFile: true,
  }
  assert.equal(classifyDay({
    ...base,
    date: '2026-11-07',
    worksheet: open,
    decisions: null,
  }), 'not-closed')
  const closed: DayDecisions = {
    ...emptyDecisions('2026-11-07'),
    closedAt: '2026-11-08T12:00:00Z',
    closedFingerprint: open.fingerprint,
  }
  assert.equal(classifyDay({
    ...base,
    date: '2026-11-07',
    worksheet: open,
    decisions: closed,
  }), 'not-closed')
  const confirmed = emptyDecisions('2026-11-07')
  for (const tile of open.tiles) {
    for (const cardId of tile.cardIds) {
      const card = open.cards.find((item) => item.id === cardId)
      if (!card) continue
      confirmed.cards[cardId] = { confirmedAt: '2026-11-08T12:00:00Z', confirmedFingerprint: card.fingerprint }
    }
  }
  const ready = buildWorksheet('2026-11-07', facts, DIRECTORY, RULES, confirmed)
  assert.equal(ready.tiles.every((tile) => tile.state === 'confirmed'), true)
  confirmed.closedAt = '2026-11-08T12:00:00Z'
  confirmed.closedFingerprint = ready.fingerprint
  assert.equal(classifyDay({
    ...base,
    date: '2026-11-07',
    worksheet: ready,
    decisions: confirmed,
  }), 'processed')
  const changed = buildWorksheet('2026-11-07', {
    ...facts,
    tabs: [{ ...facts.tabs[0], gratuity: [{ name: 'ciera', cents: 1200 }] }],
  }, DIRECTORY, RULES, closed)
  assert.equal(classifyDay({
    ...base,
    date: '2026-11-07',
    worksheet: changed,
    decisions: closed,
  }), 'changed')
  assert.equal(classifyDay({
    date: '2026-11-08',
    monthLoaded: true,
    lastWorked: '2026-11-10',
    dayInFile: false,
    worksheet: null,
    decisions: null,
  }), 'nothing')
  assert.equal(classifyDay({
    date: '2026-11-12',
    monthLoaded: true,
    lastWorked: '2026-11-10',
    dayInFile: false,
    worksheet: null,
    decisions: null,
  }), 'no-data')
  const booked = buildWorksheet('2026-11-12', {
    tabs: [],
    punches: [],
    reservations: [],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-12'))
  assert.equal(classifyDay({
    date: '2026-11-12',
    monthLoaded: true,
    lastWorked: '2026-11-10',
    dayInFile: true,
    worksheet: booked,
    decisions: null,
  }), 'no-data')
  assert.equal(latestWorkedDay({
    '2026-11-10': { tabs: [{}], punches: [] },
    '2026-11-12': { tabs: [], punches: [] },
  }), '2026-11-10')
})

test('pay periods repeat every 14 days from the configured Monday', () => {
  assert.deepEqual(payPeriodOf('2026-10-19', RULES), { from: '2026-10-19', to: '2026-11-01' })
  assert.deepEqual(payPeriodOf('2026-11-01', RULES), { from: '2026-10-19', to: '2026-11-01' })
  assert.deepEqual(payPeriodOf('2026-11-11', RULES), { from: '2026-11-02', to: '2026-11-15' })
})

test('tiles start as review, a party with nobody picked needs a decision, and the staff list marks who worked', () => {
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [
      {
        txnId: '100',
        opened: '2026-11-07T18:00:00-08:00',
        closed: '2026-11-07T19:00:00-08:00',
        user: 'Ciera',
        terminal: 'BAR1',
        partyName: null,
        accountNames: [],
        serviceChargeCents: 0,
        gratuity: [{ name: 'ciera', cents: 1000 }, { name: 'Christopher', cents: 400 }],
        barSalesCents: 0,
        coordinators: [],
        firstItem: null,
        lastItem: null,
      },
      {
        txnId: '200',
        opened: '2026-11-07T18:00:00-08:00',
        closed: '2026-11-07T20:00:00-08:00',
        user: 'Sasha',
        terminal: 'MPOS6',
        partyName: 'Open House',
        accountNames: [],
        serviceChargeCents: 10000,
        gratuity: [],
        barSalesCents: 0,
        coordinators: [],
        firstItem: '2026-11-07T18:00:00-08:00',
        lastItem: '2026-11-07T20:00:00-08:00',
      },
    ],
    punches: [
      punch(1, 'Ciera Jackson', 'Bartender', '2026-11-07T16:00:00-08:00', '2026-11-07T22:00:00-08:00'),
      punch(9, 'Christopher Saavedra', 'Floor Manager', '2026-11-07T12:00:00-08:00', '2026-11-07T22:00:00-08:00'),
      punch(7, 'Cody Hill', 'Line', '2026-11-07T14:00:00-08:00', '2026-11-07T21:00:00-08:00'),
    ],
    reservations: [],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  const barTile = worksheet.tiles.find((tile) => tile.id === 'bar')
  assert.equal(barTile?.state, 'review')
  assert.equal(barTile?.totalCents, 1000)
  assert.deepEqual(barTile?.parts, [
    { label: 'Bar', cents: 900 },
    { label: 'Floor', cents: 100 },
  ])
  assert.equal(worksheet.tiles.find((tile) => tile.kind === 'party')?.state, 'decide')
  assert.equal(worksheet.tiles.some((tile) => tile.id === 'floor' || tile.id === 'kitchen' || tile.id === 'outside' || tile.id === 'parties'), false)
  const ciera = worksheet.staff.find((person) => person.id === 'ciera')
  const cafe = worksheet.staff.find((person) => person.id === 'cafe')
  assert.equal(ciera?.worked, true)
  assert.deepEqual(ciera?.roles, ['Bartender'])
  assert.equal(ciera?.shifts.length, 1)
  assert.equal(cafe?.worked, false)
  assert.ok(worksheet.staff.some((person) => !person.worked))
})

test('day totals add a person across the pools they were paid from', () => {
  const worksheet = buildWorksheet('2026-11-07', {
    tabs: [{
      txnId: '100',
      opened: '2026-11-07T18:00:00-08:00',
      closed: '2026-11-07T19:00:00-08:00',
      user: 'Ciera',
      terminal: 'BAR1',
      partyName: null,
      accountNames: [],
      serviceChargeCents: 0,
      gratuity: [{ name: 'ciera', cents: 1000 }],
      barSalesCents: 0,
      coordinators: [],
      firstItem: null,
      lastItem: null,
    }],
    punches: [
      punch(1, 'Ciera Jackson', 'Bartender', '2026-11-07T16:00:00-08:00', '2026-11-07T22:00:00-08:00'),
      punch(4, 'Nathan Penner', 'Front Desk', '2026-11-07T16:00:00-08:00', '2026-11-07T22:00:00-08:00'),
    ],
    reservations: [],
  }, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  const ciera = worksheet.people.find((person) => person.employeeId === 'ciera')
  const nathan = worksheet.people.find((person) => person.employeeId === 'desk')
  assert.equal(ciera && payoutTotal({ employeeId: '', name: '', ...ciera }), 900)
  assert.equal(nathan && payoutTotal({ employeeId: '', name: '', ...nathan }), 100)
  assert.equal(worksheet.groups.find((group) => group.id === 'bar')?.headcount, 1)
  assert.equal(worksheet.groups.find((group) => group.id === 'floor')?.totalCents, 100)
})

test('a source tile is confirmed only when both sides are, and unclaimed hours are labelled returned', () => {
  const facts = {
    tabs: [{
      txnId: '100',
      opened: '2026-11-07T18:00:00-08:00',
      closed: '2026-11-07T19:30:00-08:00',
      user: 'Ciera',
      terminal: 'BAR1',
      partyName: null,
      accountNames: [],
      serviceChargeCents: 0,
      gratuity: [{ name: 'ciera', cents: 1000 }],
      barSalesCents: 0,
      coordinators: [],
      firstItem: null,
      lastItem: null,
    }],
    punches: [
      punch(1, 'Ciera Jackson', 'Bartender', '2026-11-07T18:00:00-08:00', '2026-11-07T20:00:00-08:00'),
      punch(2, 'Tony Saavedra', 'Bartender', '2026-11-07T18:00:00-08:00', '2026-11-07T20:00:00-08:00'),
      punch(4, 'Nathan Penner', 'Front Desk', '2026-11-07T18:00:00-08:00', '2026-11-07T19:00:00-08:00'),
    ],
    reservations: [],
  }
  const open = buildWorksheet('2026-11-07', facts, DIRECTORY, RULES, emptyDecisions('2026-11-07'))
  const bar = open.cards.find((card) => card.id === 'bar')
  const floor = open.cards.find((card) => card.id === 'floor')
  assert.ok(bar)
  assert.ok(floor)
  const tile = open.tiles.find((item) => item.id === 'bar')
  assert.equal(tile?.totalCents, bar.moneyInCents + floor.moneyInCents)
  assert.equal(tile?.totalCents, 1000)
  assert.deepEqual(tile?.cardIds, ['bar', 'floor'])
  assert.equal(tile?.subtitle, '3 people')
  assert.equal(open.tiles.some((item) => item.id === 'floor' || item.id === 'kitchen' || item.id === 'outside'), false)
  assert.equal(floor.payouts.find((row) => row.employeeId === 'desk')?.gratuityCents, 50)
  const returned = floor.returned ?? []
  assert.deepEqual(returned.map((row) => row.employeeId).sort(), ['ciera', 'tony'])
  assert.equal(returned.reduce((sum, row) => sum + row.cents, 0), 50)

  const stamped = '2026-11-08T12:00:00Z'
  const oneSide = emptyDecisions('2026-11-07')
  oneSide.cards.bar = { confirmedAt: stamped, confirmedFingerprint: bar.fingerprint }
  const half = buildWorksheet('2026-11-07', facts, DIRECTORY, RULES, oneSide)
  assert.equal(half.tiles.find((item) => item.id === 'bar')?.state, 'review')

  const both = emptyDecisions('2026-11-07')
  both.cards.bar = { confirmedAt: stamped, confirmedFingerprint: bar.fingerprint }
  both.cards.floor = { confirmedAt: stamped, confirmedFingerprint: floor.fingerprint }
  const ready = buildWorksheet('2026-11-07', facts, DIRECTORY, RULES, both)
  assert.equal(ready.tiles.find((item) => item.id === 'bar')?.state, 'confirmed')

  const stale = emptyDecisions('2026-11-07')
  stale.cards.bar = { confirmedAt: stamped, confirmedFingerprint: bar.fingerprint }
  stale.cards.floor = { confirmedAt: stamped, confirmedFingerprint: 'stale' }
  const moved = buildWorksheet('2026-11-07', facts, DIRECTORY, RULES, stale)
  assert.equal(moved.tiles.find((item) => item.id === 'bar')?.state, 'changed')
})
