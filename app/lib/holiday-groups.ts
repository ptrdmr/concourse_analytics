/**
 * Groups holiday names for the selector UI.
 * Related days (e.g. Thanksgiving + Black Friday + weekend) are grouped under a parent.
 * Order of groups determines display order.
 */
export const HOLIDAY_GROUPS: Record<string, string[]> = {
  'Thanksgiving Weekend': [
    'Black Friday',
    'Thanksgiving Weekend Saturday',
    'Thanksgiving Weekend Sunday',
  ],
  'Christmas': [
    'Day after Christmas',
  ],
  'New Year\'s': [
    'New Year\'s Eve',
    'New Year\'s Day',
  ],
  'Easter': [
    'Easter Saturday',
    'Easter',
    'Easter Monday',
  ],
  'Independence Day': [
    'Day before Independence Day',
    'Independence Day',
    'Day after Independence Day',
  ],
  'Memorial Day': [
    'Memorial Day Weekend Friday',
    'Memorial Day Weekend Saturday',
    'Memorial Day Weekend Sunday',
    'Memorial Day',
  ],
  'Labor Day': [
    'Labor Day Weekend Friday',
    'Labor Day Weekend Saturday',
    'Labor Day Weekend Sunday',
    'Labor Day',
  ],
  'Single-Day Holidays': [
    'Valentine\'s Day',
    'St. Patrick\'s Day',
    'Presidents\' Day',
    'Martin Luther King Jr. Day',
    'Columbus Day',
    'Juneteenth National Independence Day',
    'Veterans Day',
  ],
};

/** All holiday names that belong to a group (for lookup). */
const ALL_GROUPED = new Set(
  Object.values(HOLIDAY_GROUPS).flat()
);

/** Get the group label for a holiday, or null if ungrouped. */
export function getGroupForHoliday(holiday: string): string | null {
  for (const [group, members] of Object.entries(HOLIDAY_GROUPS)) {
    if (members.includes(holiday)) return group;
  }
  return null;
}

/** Build grouped structure from available holidays. Returns [groupLabel, holidays[]][]. */
export function buildGroupedHolidays(available: string[]): [string, string[]][] {
  const availableSet = new Set(available);
  const result: [string, string[]][] = [];

  for (const [group, members] of Object.entries(HOLIDAY_GROUPS)) {
    const present = members.filter((m) => availableSet.has(m));
    if (present.length > 0) {
      result.push([group, present]);
    }
  }

  // Append any holidays not in any group (fallback)
  const ungrouped = available.filter((h) => !ALL_GROUPED.has(h));
  if (ungrouped.length > 0) {
    result.push(['Other', ungrouped]);
  }

  return result;
}
