'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

const MOVE_TOLERANCE_PX = 10;

/**
 * Touch/pen long-press. Mouse input is ignored so desktop keeps plain clicks.
 * One timer is shared, so `bind` can be spread onto many buttons in a list.
 */
export function useLongPress(delayMs = 500) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const bind = useCallback(
    (onLongPress: () => void) => ({
      onPointerDown: (e: ReactPointerEvent) => {
        if (e.pointerType === 'mouse') return;
        clear();
        // Reset here, not on click: some browsers never send a click after a long-press.
        fired.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => {
          timer.current = null;
          fired.current = true;
          navigator.vibrate?.(10);
          onLongPress();
        }, delayMs);
      },
      onPointerMove: (e: ReactPointerEvent) => {
        if (!origin.current) return;
        const dx = e.clientX - origin.current.x;
        const dy = e.clientY - origin.current.y;
        if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu: (e: ReactMouseEvent) => {
        if (origin.current || fired.current) e.preventDefault();
      },
    }),
    [clear, delayMs],
  );

  /** True once after a long-press fired, so the trailing click can be ignored. */
  const consumeLongPress = useCallback(() => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  }, []);

  return { bind, consumeLongPress };
}
