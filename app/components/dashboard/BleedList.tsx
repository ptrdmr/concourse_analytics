'use client';

import { formatVerdictDollars, type DaypartBaselinesData } from '@/lib/verdict';

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const WINDOW_DISPLAY: Record<string, string> = {
  lunch: 'lunch (11am–3pm)',
  afternoon: 'afternoon (3–6pm)',
  evening: 'evening (6–9pm)',
  late: 'late (9pm–4am)',
};

function Sparkline({ weeks }: { weeks: Array<{ revenue: number }> }) {
  if (!weeks.length) return null;
  const values = weeks.map((w) => w.revenue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 64;
  const h = 20;
  const pts = values
    .map((v, i) => {
      const x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      width={w}
      height={h}
      className="shrink-0 text-accent print:text-black"
      aria-hidden
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={pts}
      />
    </svg>
  );
}

interface Props {
  data: DaypartBaselinesData | null;
  loading?: boolean;
}

export function BleedList({ data, loading }: Props) {
  if (loading || !data?.rows?.length) return null;

  const rows = data.rows
    .filter(
      (r) =>
        r.department === 'All' &&
        ['lunch', 'afternoon', 'evening', 'late'].includes(r.window) &&
        r.gapDollars > 0 &&
        r.underStreak >= 1,
    )
    .sort((a, b) => b.gapDollars - a.gapDollars)
    .slice(0, 3);

  if (rows.length === 0) return null;

  return (
    <section className="card p-5 sm:p-6 mt-8 print:shadow-none print:border print:border-black print:bg-white print:text-black print:break-inside-avoid">
      <div className="mb-4">
        <h3 className="text-lg font-semibold print:text-black">Where it&apos;s leaking</h3>
        <p className="text-sm text-muted print:text-gray-700">
          vs trailing 15-week typical for that time slot
        </p>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => {
          const weekday = WEEKDAY_NAMES[r.dow] ?? `Day ${r.dow}`;
          const win = WINDOW_DISPLAY[r.window] || r.window;
          return (
            <li
              key={`${r.dow}-${r.window}`}
              className="flex items-start justify-between gap-3 text-sm print:break-inside-avoid"
            >
              <div className="min-w-0">
                <p className="font-medium print:text-black">
                  {weekday} {win}
                </p>
                <p className="text-secondary print:text-gray-800">
                  about {formatVerdictDollars(r.gapDollars)} under typical
                </p>
                <p className="text-xs text-muted print:text-gray-600">
                  under in {r.underStreak} straight week{r.underStreak === 1 ? '' : 's'}
                </p>
              </div>
              <Sparkline weeks={r.weeks} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
