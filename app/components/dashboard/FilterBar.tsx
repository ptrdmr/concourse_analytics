'use client';

import { Search, X } from 'lucide-react';
import type { Filters } from '@/types';
import { DateRangePicker } from './DateRangePicker';
import type { DateRange } from '@/lib/date-ranges';

interface Props {
  departments: string[];
  categories: string[];
  filters: Filters;
  onChange: (filters: Filters) => void;
}

export function FilterBar({ departments, categories, filters, onChange }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {departments.map(dept => (
          <button
            key={dept}
            onClick={() => onChange({ ...filters, department: dept, categories: [] })}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              filters.department === dept
                ? 'bg-accent text-black'
                : 'bg-white/5 text-secondary hover:bg-white/10 hover:text-white'
            }`}
          >
            {dept}
          </button>
        ))}
      </div>

      <DateRangePicker
        value={filters.dateRange}
        onChange={(range: DateRange | null) => onChange({ ...filters, dateRange: range })}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search items..."
            value={filters.searchTerm}
            onChange={e => onChange({ ...filters, searchTerm: e.target.value })}
            className="w-full pl-10 pr-8 py-2 rounded-lg bg-white/5 border border-border text-sm placeholder:text-muted focus:outline-none focus:border-accent/50"
          />
          {filters.searchTerm && (
            <button
              onClick={() => onChange({ ...filters, searchTerm: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {categories.slice(0, 12).map(cat => {
            const active = filters.categories.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => {
                  const next = active
                    ? filters.categories.filter(c => c !== cat)
                    : [...filters.categories, cat];
                  onChange({ ...filters, categories: next });
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  active
                    ? 'bg-accent/20 text-accent border border-accent/40'
                    : 'bg-white/5 text-muted hover:text-secondary border border-transparent'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
