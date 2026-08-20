/**
 * Per-special weekly targets for Monday Verdict findings.
 *
 * Owner fills this in. Keys must match item names in transactions.json.
 * unit: 'dollars' compares weekly revenue; 'units' compares weekly quantity.
 *
 * Leave empty to disable specials findings entirely.
 */
export interface SpecialTarget {
  targetPerWeek: number;
  unit: 'dollars' | 'units';
}

export const SPECIALS_TARGETS: Record<string, SpecialTarget> = {
  // Example:
  // 'Summer Pins & Pints': { targetPerWeek: 1500, unit: 'dollars' },
};
