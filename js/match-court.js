/* Public court labels come only from the linked booking's courtCode. */
(function () {
  'use strict';
  function shortLabel(match) {
    const code = String(match?.courtCode || '').trim().toUpperCase();
    return /^(?:H[1-4]|C(?:10|[1-9]))$/.test(code) ? code : '';
  }
  function fullLabel(match) {
    const code = shortLabel(match);
    return code ? `${code.startsWith('H') ? 'Indoor' : 'Outdoor'} ${code}` : '';
  }
  // One protected and one regular space per side keep both spaces visible
  // while still allowing a line break in narrow cards.
  const separator = '\u00a0 · \u00a0';
  const api = { shortLabel, fullLabel, separator };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.PadelMatchCourt = api;
})();
