// A round's ruleset is captured in its initial state, never inferred at save time.
export const RULESET = 'v2';
export function requireRuleset(value) {
  if (value !== 'classic' && value !== RULESET) throw new Error('Ungültige Spielversion.');
  return value;
}
