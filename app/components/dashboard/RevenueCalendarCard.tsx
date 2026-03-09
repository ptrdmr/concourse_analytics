'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCompact } from '@/lib/format';
import type { Transaction } from '@/types';

export interface DailyData {
  date: string;
  revenue: number;
  transactions: number;
  items: Transaction[];
}

interface Props {
  dailyRevenue: DailyData[];
  dateRange: [string, string] | null;
  department: string;
  onDayClick: (date: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function getDaysInMonth(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days: Date[] = [];
  for (let d = 1; d <= last.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  return days;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function RevenueCalendarCard({ dailyRevenue, dateRange, department, onDayClick }: Props) {
  const revenueByDate = useMemo(() => {
    const map = new Map<string, DailyData>();
    for (const d of dailyRevenue) {
      map.set(d.date, d);
    }
    return map;
  }, [dailyRevenue]);

  const [viewYear, viewMonth] = useMemo(() => {
    if (dateRange) {
      const [_, end] = dateRange;
      const d = new Date(end + 'T00:00:00');
      return [d.getFullYear(), d.getMonth()];
    }
    const now = new Date();
    return [now.getFullYear(), now.getMonth()];
  }, [dateRange]);

  const [currentYear, setCurrentYear] = useState(viewYear);
  const [currentMonth, setCurrentMonth] = useState(viewMonth);

  const days = useMemo(() => getDaysInMonth(currentYear, currentMonth), [currentYear, currentMonth]);
  const firstDayOfWeek = days[0]?.getDay() ?? 0;
  const leadingBlanks = firstDayOfWeek;
  const totalCells = Math.ceil((leadingBlanks + days.length) / 7) * 7;
  const gridCells: (Date | null)[] = [];
  for (let i = 0; i < leadingBlanks; i++) gridCells.push(null);
  for (const d of days) gridCells.push(d);
  while (gridCells.length < totalCells) gridCells.push(null);

  const [rangeStart, rangeEnd] = dateRange
    ? [new Date(dateRange[0] + 'T00:00:00'), new Date(dateRange[1] + 'T00:00:00')]
    : [null, null];

  function isInRange(d: Date | null): boolean {
    if (!d || !rangeStart || !rangeEnd) return true;
    return d >= rangeStart && d <= rangeEnd;
  }

  function goPrev() {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  }

  function goNext() {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  }

  const subtitle = `${department === 'All' ? 'All departments' : department} — All time`;

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-4 mb-1">
        <h3 className="text-lg font-semibold text-white">Sales by Day</h3>
        <span className="text-xs text-muted/80 shrink-0">Click to expand</span>
      </div>
      <p className="text-sm text-muted mb-4">{subtitle} — click a day for details</p>

      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          className="p-2 rounded-lg bg-white/5 text-secondary hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-base font-medium text-white">
          {MONTH_NAMES[currentMonth]} {currentYear}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          className="p-2 rounded-lg bg-white/5 text-secondary hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Next month"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="text-xs text-muted font-medium py-1">
            {wd}
          </div>
        ))}
        {gridCells.map((cell, i) => {
          if (!cell) {
            return <div key={`empty-${i}`} className="aspect-square" />;
          }
          const dateKey = toDateKey(cell);
          const data = revenueByDate.get(dateKey);
          const inRange = isInRange(cell);
          const hasRevenue = data && data.revenue > 0;
          const isClickable = inRange && hasRevenue;

          return (
            <button
              key={dateKey}
              type="button"
              onClick={(e) => {
                if (isClickable) {
                  e.stopPropagation();
                  onDayClick(dateKey);
                }
              }}
              disabled={!isClickable}
              className={`
                aspect-square rounded-lg text-sm transition-colors flex flex-col items-center justify-center gap-0.5 min-w-0
                ${!inRange ? 'text-muted/50' : ''}
                ${hasRevenue
                  ? 'bg-accent/15 border border-accent/40 text-white hover:bg-accent/25 focus:outline-none focus:ring-2 focus:ring-accent/50'
                  : inRange
                    ? 'bg-white/5 text-muted hover:bg-white/10'
                    : 'bg-transparent text-muted/50'}
              `}
            >
              <span className="font-medium">{cell.getDate()}</span>
              {hasRevenue && (
                <span className="text-xs font-mono text-accent truncate w-full px-0.5">
                  {formatCompact(data!.revenue)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
