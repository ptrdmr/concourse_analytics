'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X } from 'lucide-react';

export interface ItemOption {
  name: string;
  category: string;
}

interface Props {
  items: ItemOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

const MAX_SUGGESTIONS = 25;

export function DaypartItemFilter({ items, selected, onChange }: Props) {
  const [query, setQuery] = useState('');
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

  const suggestions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];

    const selectedSet = new Set(selected);
    return items
      .filter(item => !selectedSet.has(item.name))
      .filter(item => item.name.toLowerCase().includes(term))
      .slice(0, MAX_SUGGESTIONS);
  }, [items, query, selected]);

  function addItem(name: string) {
    if (!selected.includes(name)) {
      onChange([...selected, name]);
    }
    setQuery('');
    setOpen(true);
  }

  function removeItem(name: string) {
    onChange(selected.filter(n => n !== name));
  }

  return (
    <div className="space-y-2">
      <label className="text-xs text-muted uppercase tracking-wide">Items</label>
      <div ref={containerRef} className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
        <input
          type="text"
          placeholder="Search to add items..."
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="w-full pl-10 pr-8 py-2 rounded-lg bg-white/5 border border-border text-sm placeholder:text-muted focus:outline-none focus:border-accent/50"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(''); setOpen(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-white"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {open && query.trim() && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-[#141414] shadow-xl">
            {suggestions.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted">No matching items</p>
            ) : (
              suggestions.map(item => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => addItem(item.name)}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
                >
                  <span className="text-sm text-white block truncate">{item.name}</span>
                  <span className="text-xs text-muted">{item.category}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(name => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs bg-accent/15 text-accent border border-accent/30"
            >
              {name}
              <button
                type="button"
                onClick={() => removeItem(name)}
                className="p-0.5 rounded-full hover:bg-accent/20 transition-colors"
                aria-label={`Remove ${name}`}
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
