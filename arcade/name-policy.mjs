// Deliberately narrow short-word matches avoid blocking ordinary names such as Nazim or Marschall.
// Supabase applies the same initial rules independently; its table can be extended by migration.
export const NAME_MAX_LENGTH = 16;
export const BLOCKED_NAME_RULES = Object.freeze([
  ['arschloch', 'contains'], ['hurensohn', 'contains'], ['hurenkind', 'contains'],
  ['fotze', 'contains'], ['wichser', 'contains'], ['missgeburt', 'contains'],
  ['schlampe', 'contains'], ['drecksau', 'contains'], ['scheisse', 'contains'],
  ['motherfucker', 'contains'], ['fuck', 'contains'], ['bitch', 'contains'],
  ['nigger', 'contains'], ['neger', 'exact'], ['kanake', 'contains'],
  ['schwuchtel', 'contains'], ['faggot', 'contains'], ['judensau', 'contains'],
  ['heilhitler', 'contains'], ['siegheil', 'contains'], ['hitler', 'contains'],
  ['goebbels', 'contains'], ['himmler', 'contains'], ['hermanngoering', 'contains'],
  ['hermanngoring', 'contains'], ['rudolfhess', 'contains'], ['josefmengele', 'contains'],
  ['josephmengele', 'contains'], ['adolfeichmann', 'contains'],
  ['arsch', 'exact'], ['idiot', 'exact'], ['nazi', 'exact']
].map(([term, match]) => Object.freeze({ term, match })));
export function nameKey(value) {
  const replacements = { ä: 'a', ö: 'o', ü: 'u', ß: 'ss', 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };
  return value.toLowerCase()
    .replace(/[äöüß0134578]/g, character => replacements[character]).replace(/(.)\1+/gu, '$1');
}
export function normalizeName(value) {
  const name = value.trim().normalize('NFC');
  if (!name || [...name].length > NAME_MAX_LENGTH || !/^[\p{L}\p{Nd}]+$/u.test(name)) {
    throw new Error('Bitte verwende 1 bis 16 Buchstaben oder Zahlen, ohne Leerzeichen und Sonderzeichen.');
  }
  const key = nameKey(name);
  const withoutEdgeDigits = nameKey(name.replace(/^[0-9]+|[0-9]+$/g, ''));
  if (BLOCKED_NAME_RULES.some(({ term, match }) => match === 'exact' ? (key === nameKey(term) || withoutEdgeDigits === nameKey(term)) : key.includes(nameKey(term)))) {
    throw new Error('Dieser Name ist nicht erlaubt. Bitte wähle einen anderen.');
  }
  return name;
}
