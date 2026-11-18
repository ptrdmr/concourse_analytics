import { readFileSync } from 'node:fs'
import { buildWorksheet } from '../app/lib/tips/engine.ts'
import { emptyDecisions, payoutTotal, type TipMonthFile } from '../app/lib/tips/types.ts'

interface SheetPerson {
  name: string
  position: string
  days: Record<string, number>
}

interface SheetFile {
  dates: string[]
  totals: Record<string, number>
  people: SheetPerson[]
}

function money(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}$${(abs / 100).toFixed(2)}`
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const sheet = JSON.parse(readFileSync(process.argv[2], 'utf8')) as SheetFile
const facts = JSON.parse(readFileSync(process.argv[3], 'utf8')) as TipMonthFile

console.log('Week of 2026-10-19, old tip sheet vs the new worksheet (no GM edits).')
console.log('Sheet total is what was typed as "Total Daily Tips".')
console.log('Worksheet total is every service charge and tip the cards and held-out issues account for.')
console.log('')

let sheetSum = 0
let engineSum = 0
for (const day of sheet.dates) {
  const dayFacts = facts.days[day] ?? { tabs: [], punches: [], reservations: [] }
  const worksheet = buildWorksheet(day, dayFacts, facts.directory, facts.rules, emptyDecisions(day))
  const decide = worksheet.issues.filter((issue) => issue.kind === 'unmatched' || issue.kind === 'unpooled' || issue.kind === 'no-clock')
  const held = decide.reduce((sum, issue) => sum + issue.cents, 0)
  const engine = worksheet.totals.collectedCents
  const sheetTotal = sheet.totals[day] ?? 0
  sheetSum += sheetTotal
  engineSum += engine
  const punches = dayFacts.punches.length
  console.log(
    `${day}  sheet ${money(sheetTotal).padStart(10)}  worksheet ${money(engine).padStart(10)}  `
    + `delta ${money(engine - sheetTotal).padStart(10)}  punches ${punches}  `
    + `decide ${String(decide.length).padStart(2)}  held ${money(held)}`,
  )
  for (const issue of decide) console.log(`         ${issue.message}`)
}
console.log(
  `week     sheet ${money(sheetSum).padStart(10)}  worksheet ${money(engineSum).padStart(10)}  `
  + `delta ${money(engineSum - sheetSum).padStart(10)}`,
)

const focus = '2026-10-19'
const dayFacts = facts.days[focus] ?? { tabs: [], punches: [], reservations: [] }
const worksheet = buildWorksheet(focus, dayFacts, facts.directory, facts.rules, emptyDecisions(focus))
const enginePeople = new Map<string, { name: string; cents: number }>()
for (const card of worksheet.cards) {
  for (const payout of card.payouts) {
    const current = enginePeople.get(payout.employeeId) ?? { name: payout.name, cents: 0 }
    current.cents += payoutTotal(payout)
    enginePeople.set(payout.employeeId, current)
  }
}

console.log('')
console.log(`${focus} person totals. The sheet paid the old manual split. The worksheet uses the new rules,`)
console.log('so these columns are not expected to match person by person.')
console.log('')
const sheetPeople = sheet.people.filter((person) => person.days[focus])
const used = new Set<string>()
for (const person of [...enginePeople.values()].sort((a, b) => b.cents - a.cents)) {
  const key = norm(person.name)
  const match = sheetPeople.find((row) => {
    const sheetKey = norm(row.name)
    return sheetKey === key || sheetKey.split(' ').every((part) => key.includes(part))
  })
  if (match) used.add(match.name)
  const sheetCents = match?.days[focus] ?? 0
  console.log(
    `${person.name.padEnd(24)} worksheet ${money(person.cents).padStart(10)}  `
    + `sheet ${money(sheetCents).padStart(10)}  ${match ? match.position : 'not on sheet'}`,
  )
}
for (const person of sheetPeople) {
  if (used.has(person.name)) continue
  console.log(`${person.name.padEnd(24)} worksheet ${money(0).padStart(10)}  sheet ${money(person.days[focus]).padStart(10)}  ${person.position} (no worksheet match)`)
}
