'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { PosRecords } from '@/components/gratuity/PosRecords';
import { TipLock } from '@/components/gratuity/TipLock';
import { TipPayroll } from '@/components/gratuity/TipPayroll';
import { TipWorksheet } from '@/components/gratuity/TipWorksheet';
import { checkTipPasscode, clearTipCache } from '@/hooks/useTipFacts';

const IDLE_MS = 30 * 60 * 1000;
const DEV = process.env.NODE_ENV === 'development';

type Section = 'day' | 'payroll' | 'records';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function shiftIso(iso: string, days: number): string {
  const [year, month, date] = iso.split('-').map(Number);
  const dt = new Date(year, month - 1, date);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatDateLabel(iso: string): string {
  const [year, month, date] = iso.split('-').map(Number);
  if (!year || !month || !date) return iso;
  return new Date(year, month - 1, date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function GratuityPage() {
  const [section, setSection] = useState<Section>('day');
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [passcode, setPasscode] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [idleDiscarded, setIdleDiscarded] = useState(false);
  const [dirty, setDirty] = useState(false);

  const lock = useCallback((idle: boolean) => {
    clearTipCache();
    setPasscode(null);
    setDirty(false);
    setLockError(null);
    setIdleDiscarded(idle);
  }, []);

  async function unlock(code: string) {
    setChecking(true);
    setLockError(null);
    const result = await checkTipPasscode(code);
    setChecking(false);
    if (!result.ok) {
      setLockError(result.error || 'Wrong passcode');
      return;
    }
    setIdleDiscarded(false);
    setPasscode(code);
  }

  useEffect(() => {
    if (!passcode) return;
    let timer = window.setTimeout(() => lock(true), IDLE_MS);
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => lock(true), IDLE_MS);
    };
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    document.addEventListener('scroll', bump, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
      document.removeEventListener('scroll', bump, true);
    };
  }, [passcode, lock]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest('a');
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === '/gratuity') return;
      if (!window.confirm('You have unsaved changes. Leave anyway?')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty]);

  return (
    <main className="min-h-screen pb-16">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gradient">Gratuity</h1>
            <p className="text-secondary text-sm mt-1">
              {!passcode
                ? 'Unlock to review tips.'
                : section === 'day'
                  ? 'Open a tile to review it. Confirm every tile, then close the day.'
                  : section === 'payroll'
                    ? 'Pick a pay period. Totals include only days that have been closed.'
                    : 'The POS records the worksheet is built from.'}
            </p>
          </div>
          {passcode && <TipLock unlocked checking={false} error={null} idleDiscarded={false} dev={DEV} onUnlock={unlock} onLock={() => lock(false)} />}
        </div>

        {!passcode && (
          <TipLock
            unlocked={false}
            checking={checking}
            error={lockError}
            idleDiscarded={idleDiscarded}
            dev={DEV}
            onUnlock={unlock}
            onLock={() => lock(false)}
          />
        )}

        {passcode && (
        <>
        <div className="flex flex-wrap items-center gap-2">
          <SectionButton active={section === 'day'} onClick={() => setSection('day')}>Day</SectionButton>
          <SectionButton active={section === 'payroll'} onClick={() => setSection('payroll')}>Payroll</SectionButton>
          <SectionButton active={section === 'records'} onClick={() => setSection('records')}>POS records</SectionButton>
        </div>

        {section === 'day' && (
          <div className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-secondary">Date</span>
              <button
                type="button"
                onClick={() => setSelectedDate(shiftIso(selectedDate, -1))}
                className="p-2 rounded-lg bg-overlay/5 text-secondary hover:text-foreground"
                aria-label="Previous day"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground"
              />
              <button
                type="button"
                onClick={() => setSelectedDate(shiftIso(selectedDate, 1))}
                className="p-2 rounded-lg bg-overlay/5 text-secondary hover:text-foreground"
                aria-label="Next day"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <span className="text-sm text-secondary">{formatDateLabel(selectedDate)}</span>
            </div>
          </div>
        )}

        {section === 'day' && <TipWorksheet date={selectedDate} passcode={passcode} onDirty={setDirty} />}
        {section === 'payroll' && (
          <TipPayroll passcode={passcode} onOpenDay={(day) => { setSelectedDate(day); setSection('day'); }} />
        )}
        {section === 'records' && <PosRecords initialDate={selectedDate} passcode={passcode} />}
        </>
        )}
      </div>
    </main>
  );
}

function SectionButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm transition-colors ${
        active ? 'bg-accent/15 text-accent' : 'text-secondary hover:bg-overlay/5 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
