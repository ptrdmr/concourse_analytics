'use client';

interface Props {
  value: string;
  onChange: (dept: string) => void;
  available: string[];
}

export function DepartmentFilter({ value, onChange, available }: Props) {
  const options = ['All', ...available];
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-secondary">Department:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white/5 border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent/50"
      >
        {options.map((d) => (
          <option key={d} value={d} className="bg-gray-900">
            {d}
          </option>
        ))}
      </select>
    </div>
  );
}
