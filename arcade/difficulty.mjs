export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ label: 'Leicht', reaction: 0.40, speed: 0.80 }),
  hard: Object.freeze({ label: 'Schwer', reaction: 0.20, speed: 1 })
});

export function requireDifficulty(value) {
  if (value !== 'easy' && value !== 'hard') throw new Error('Ungültige Schwierigkeitsstufe.');
  return value;
}

export function readDifficulty() {
  try { return requireDifficulty(localStorage.getItem('padel-arcade-difficulty')); }
  catch { return 'easy'; }
}

export function saveDifficulty(value) {
  requireDifficulty(value);
  try { localStorage.setItem('padel-arcade-difficulty', value); }
  catch { /* A browser preference is optional, including in private browsing. */ }
}
