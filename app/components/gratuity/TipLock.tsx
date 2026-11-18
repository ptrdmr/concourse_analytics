'use client';

import { useState } from 'react';

export function TipLock({
  unlocked,
  checking,
  error,
  idleDiscarded,
  dev,
  onUnlock,
  onLock,
}: {
  unlocked: boolean;
  checking: boolean;
  error: string | null;
  idleDiscarded: boolean;
  dev: boolean;
  onUnlock: (code: string) => void;
  onLock: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');

  if (unlocked) {
    return (
      <button type="button" onClick={onLock} className="px-4 py-2 rounded-full text-sm bg-overlay/5 text-foreground">
        Lock
      </button>
    );
  }

  return (
    <div className="card p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Locked</p>
          <p className="text-sm text-secondary mt-1">
            Enter the passcode to see tips and make changes. Refreshing or leaving this page locks it again.
          </p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="px-4 py-2 rounded-full text-sm bg-accent/15 text-accent">
            Unlock
          </button>
        )}
      </div>
      {idleDiscarded && (
        <p className="text-sm text-amber-300">Locked after 30 minutes with no activity. Unsaved changes were discarded.</p>
      )}
      {dev && <p className="text-xs text-muted">Development: any code unlocks.</p>}
      {open && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const next = code.trim();
            if (!next || checking) return;
            onUnlock(next);
          }}
        >
          <label className="text-sm text-secondary">
            Passcode
            <input
              type="password"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="mt-1 block rounded-lg bg-background/40 border border-border px-3 py-2 text-sm text-foreground"
              autoComplete="current-password"
              autoFocus
            />
          </label>
          <button type="submit" disabled={checking || !code.trim()} className="px-4 py-2 rounded-full text-sm bg-accent/15 text-accent disabled:opacity-40">
            {checking ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-amber-300">{error}</p>}
    </div>
  );
}
