'use client';

interface Props {
  deptMix: Record<string, number>;
}

const COLORS = ['#38bdf8', '#f97316', '#a78bfa', '#22c55e', '#f5a623', '#ff5252', '#0ea5e9'];

export function SalesMixBar({ deptMix }: Props) {
  const entries = Object.entries(deptMix).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  if (total <= 0) {
    return <p className="text-sm text-muted">No sales mix data</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex h-3 rounded-full overflow-hidden bg-overlay/10">
        {entries.map(([dept, amt], i) => (
          <div
            key={dept}
            className="h-full"
            style={{ width: `${(amt / total) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }}
            title={`${dept}: $${amt.toFixed(0)}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {entries.map(([dept, amt], i) => (
          <div key={dept} className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            <span className="truncate text-secondary">{dept}</span>
            <span className="ml-auto font-mono tabular-nums text-foreground">{((amt / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
