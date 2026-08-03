/**
 * Locations enabled for physical counting.
 *
 * This is the ONLY place a location code is named. No screen, page or query may
 * hardcode one — the scanner reads a user's assignments, Admin reads this list.
 *
 * Deliberately a constant, not a config table: enabling a location means someone
 * will act on its variance report, so it should be a reviewed code change rather
 * than a checkbox clicked by accident. Adding Jeannette is one line here.
 *
 * All nine codes the OEIVAL cache carries, for reference when enabling:
 *   R10 Everson · R15 Rodgers · R20 Essey Tire · R25 Export · R30 Jeannette
 *   R35 King's Super Tire · W07 Uniontown · W08 Latrobe · W09 Chestnut Ridge
 */
export const COUNT_LOCATIONS: Array<{ code: string; label: string }> = [
  { code: "W09", label: "Chestnut Ridge" },
];

export function isCountLocationEnabled(code: string): boolean {
  return COUNT_LOCATIONS.some((l) => l.code === code);
}

export function countLocationLabel(code: string): string {
  return COUNT_LOCATIONS.find((l) => l.code === code)?.label ?? code;
}
