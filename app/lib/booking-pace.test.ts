import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  alignedCompareDate,
  buildPaceSeries,
  compareAsOf,
  defaultDayRange,
  type PacePayment,
  type PacePoint,
} from './booking-pace.ts'

function pay(paid: string, amount: number): PacePayment {
  return {
    txnId: `${paid}-${amount}`,
    paid,
    amount,
    accountId: null,
    party: null,
    isFirstPayment: true,
    event: null,
    eventSource: 'test',
    eventConflict: false,
    group: null,
    type: 'Party',
    status: 'booked',
  }
}

const focus = [pay('2026-10-15', 100), pay('2026-11-20', 50)]
const compare = [
  pay('2025-10-15', 80),
  pay('2025-11-20', 40),
  pay('2025-11-28', 20),
  pay('2025-12-10', 10),
]

function labels(points: PacePoint[]): string[] {
  return points.map((point) => point.label)
}

function point(points: PacePoint[], label: string): PacePoint {
  const found = points.find((row) => row.label === label)
  assert.ok(found, `missing ${label} in ${labels(points).join(', ')}`)
  return found
}

test('day window is 7 days back through the end of that month', () => {
  assert.deepEqual(defaultDayRange('2026-11-23', '2026-12'), ['2026-11-16', '2026-11-30'])
  assert.deepEqual(defaultDayRange('2026-11-17', '2026-12'), ['2026-11-10', '2026-11-30'])
  assert.deepEqual(defaultDayRange('2026-12-10', '2026-12'), ['2026-12-03', '2026-12-31'])
  assert.deepEqual(defaultDayRange('2026-11-28', '2026-11'), ['2026-11-21', '2026-11-30'])
})

test('a finished event month opens on that whole month', () => {
  assert.deepEqual(defaultDayRange('2027-01-15', '2026-12'), ['2026-12-01', '2026-12-31'])
  assert.deepEqual(defaultDayRange('2026-12-10', '2026-11'), ['2026-11-01', '2026-11-30'])
})

test('compare days stay the same distance from the event month', () => {
  assert.equal(alignedCompareDate('2026-11-23', '2026-12', 2025), '2025-11-23')
  assert.equal(alignedCompareDate('2026-11-23', '2026-12', 2025), compareAsOf('2026-11-23', '2026-12', 2025))
  assert.equal(alignedCompareDate('2024-02-29', '2024-03', 2025), '2025-02-28')
})

test('week grain is unchanged when the grain option is omitted', () => {
  const implied = buildPaceSeries(focus, compare, '2026-12', 2025, '2026-11-23', '2025-11-23', { fullMonth: false })
  const explicit = buildPaceSeries(focus, compare, '2026-12', 2025, '2026-11-23', '2025-11-23', { fullMonth: false, grain: 'week' })
  assert.deepEqual(explicit, implied)
  assert.deepEqual(labels(implied), ['6w', '5w', '4w', '3w', '2w', '11/23'])
  assert.equal(point(implied, '6w').focusDollars, 100)
  assert.equal(point(implied, '6w').compareDollars, 80)
  assert.equal(point(implied, '2w').focusDollars, 100)
  assert.equal(point(implied, '11/23').focusDollars, 150)
  assert.equal(point(implied, '11/23').compareDollars, 120)
  assert.equal(point(implied, '11/23').compareAheadDollars, null)
})

test('full month keeps the week buckets and the dashed remainder', () => {
  const points = buildPaceSeries(focus, compare, '2026-12', 2025, '2026-11-23', '2025-11-23', { fullMonth: true })
  const names = labels(points)
  const asOf = names.indexOf('11/23')
  assert.equal(names[asOf + 1], '1w')
  assert.ok(names.includes('Start'))
  assert.equal(names[names.length - 1], '+5w')
  assert.equal(point(points, '1w').focusDollars, null)
  assert.equal(point(points, '1w').compareAheadDollars, 120)
  assert.equal(point(points, 'Start').compareAheadDollars, 140)
  assert.equal(point(points, '+1w').compareAheadDollars, 140)
  assert.equal(point(points, '+2w').compareAheadDollars, 150)
})

test('day grain stays inside the range and keeps earlier deposits in the total', () => {
  const points = buildPaceSeries(focus, compare, '2026-12', 2025, '2026-11-23', '2025-11-23', {
    grain: 'day',
    range: ['2026-11-20', '2026-11-30'],
  })
  assert.deepEqual(labels(points), [
    '11/20', '11/21', '11/22', '11/23', '11/24', '11/25', '11/26', '11/27', '11/28', '11/29', '11/30',
  ])
  assert.equal(point(points, '11/20').focusDollars, 150)
  assert.equal(point(points, '11/20').compareDollars, 120)
  assert.equal(point(points, '11/20').compareAheadDollars, null)
  assert.equal(point(points, '11/23').compareDollars, 120)
  assert.equal(point(points, '11/23').compareAheadDollars, 120)
  assert.equal(point(points, '11/24').focusDollars, null)
  assert.equal(point(points, '11/24').compareDollars, null)
  assert.equal(point(points, '11/24').compareAheadDollars, 120)
  assert.equal(point(points, '11/28').compareAheadDollars, 140)
})

test('a day range keeps quiet days the user asked to see', () => {
  const points = buildPaceSeries(focus, compare, '2026-12', 2025, '2026-11-23', '2025-11-23', {
    grain: 'day',
    range: ['2026-10-14', '2026-10-15'],
  })
  assert.deepEqual(labels(points), ['10/14', '10/15'])
  assert.equal(point(points, '10/14').focusDollars, 0)
  assert.equal(point(points, '10/15').focusDollars, 100)
  assert.equal(point(points, '10/15').compareDollars, 80)
})

test('month grain uses month-ends and stops on the as-of day', () => {
  const points = buildPaceSeries(focus, compare, '2026-12', 2025, '2026-11-23', '2025-11-23', {
    grain: 'month',
    fullMonth: false,
  })
  assert.deepEqual(labels(points), ['Oct', '11/23'])
  assert.equal(point(points, 'Oct').focusDollars, 100)
  assert.equal(point(points, 'Oct').compareDollars, 80)
  assert.equal(point(points, 'Oct').hint, 'Through 10/31')
  assert.equal(point(points, '11/23').focusDollars, 150)
  assert.equal(point(points, '11/23').compareDollars, 120)
})

test('full month adds the rest of this month and the event month', () => {
  const points = buildPaceSeries(focus, compare, '2026-12', 2025, '2026-11-23', '2025-11-23', {
    grain: 'month',
    fullMonth: true,
  })
  assert.deepEqual(labels(points), ['Oct', '11/23', 'Nov', 'Dec'])
  assert.equal(point(points, '11/23').compareAheadDollars, 120)
  assert.equal(point(points, 'Nov').focusDollars, null)
  assert.equal(point(points, 'Nov').compareAheadDollars, 140)
  assert.equal(point(points, 'Dec').compareAheadDollars, 150)
  assert.equal(point(points, 'Dec').hint, 'Through 12/31')
})

test('a month more than a year out is labeled so it does not collide', () => {
  const points = buildPaceSeries(focus, [...compare, pay('2024-11-15', 5)], '2026-12', 2025, '2026-11-23', '2025-11-23', {
    grain: 'month',
    fullMonth: false,
  })
  assert.equal(labels(points)[0], 'Nov -1')
  assert.equal(point(points, 'Nov -1').compareDollars, 5)
  assert.equal(labels(points).at(-1), '11/23')
  assert.ok(labels(points).includes('Dec -1'))
})
