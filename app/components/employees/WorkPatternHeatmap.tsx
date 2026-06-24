'use client';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PARTS = ['Morning', 'Midday', 'Evening', 'Late'];

interface Props {
  grid: number[][];
}

export function WorkPatternHeatmap({ grid }: Props) {
  const max = Math.max(...grid.flat(), 0.01);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[280px]">
        <div className="grid grid-cols-[48px_repeat(4,1fr)] gap-1 text-[10px] text-muted mb-1">
          <div />
          {PARTS.map((p) => (
            <div key={p} className="text-center truncate">{p}</div>
          ))}
        </div>
        {grid.map((row, di) => (
          <div key={DAYS[di]} className="grid grid-cols-[48px_repeat(4,1fr)] gap-1 mb-1">
            <div className="text-xs text-secondary flex items-center">{DAYS[di]}</div>
            {row.map((val, pi) => {
              const intensity = val / max;
              return (
                <div
                  key={`${di}-${pi}`}
                  className="h-8 rounded-md border border-border/50 flex items-center justify-center text-[10px] font-mono tabular-nums"
                  style={{
                    backgroundColor: val > 0 ? `rgba(56, 189, 248, ${0.15 + intensity * 0.75})` : 'transparent',
                  }}
                  title={`${DAYS[di]} ${PARTS[pi]}: ${val.toFixed(1)} hrs`}
                >
                  {val > 0 ? val.toFixed(0) : ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted mt-2">Hours by day (approximate daypart from activity level)</p>
    </div>
  );
}
