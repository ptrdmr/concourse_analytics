'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, X } from 'lucide-react';

interface Props {
  categories: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function CategoryMultiSelect({ categories, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggle(cat: string) {
    onChange(
      selected.includes(cat)
        ? selected.filter(c => c !== cat)
        : [...selected, cat],
    );
  }

  const label = selected.length === 0
    ? 'All categories'
    : selected.length === 1
      ? selected[0]
      : `${selected.length} categories`;

  return (
    <div className="space-y-2">
      <label className="text-xs text-muted uppercase tracking-wide">Category</label>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors min-w-[160px] ${
            selected.length > 0
              ? 'bg-accent/10 border-accent/40 text-accent'
              : 'bg-overlay/5 border-border text-secondary hover:bg-overlay/10'
          }`}
        >
          <span className="truncate flex-1 text-left">{label}</span>
          <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute z-20 top-full left-0 mt-1 min-w-[220px] max-h-60 overflow-y-auto rounded-lg border border-border bg-card-hover shadow-xl">
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full text-left px-3 py-2 text-xs text-muted hover:bg-overlay/5 border-b border-border"
              >
                Clear selection
              </button>
            )}
            {categories.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted">No categories</p>
            ) : (
              categories.map(cat => {
                const active = selected.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggle(cat)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                      active ? 'bg-accent/10 text-accent' : 'hover:bg-overlay/5 text-secondary'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${
                      active ? 'bg-accent border-accent' : 'border-border'
                    }`}>
                      {active && <span className="text-accent-foreground text-[10px] font-bold">✓</span>}
                    </span>
                    <span className="truncate">{cat}</span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {selected.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(cat => (
            <span
              key={cat}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs bg-overlay/5 text-secondary border border-border"
            >
              {cat}
              <button
                type="button"
                onClick={() => toggle(cat)}
                className="p-0.5 rounded-full hover:text-foreground"
                aria-label={`Remove ${cat}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
