/* Shared preview window: full previews and new tips follow the same rule. */
(function () {
  'use strict';
  const day = now => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now);
  function availability(match, season, now = new Date()) {
    if (!match || match.type === 'training' || match.cancelledAt || match.isCancelled || match.stage === 'final-four' || match.stage === 'final_four') return null;
    if (match.team1?.playerIds?.length !== 2 || match.team2?.playerIds?.length !== 2) return null;
    const matches = season?.matches || [];
    const cup = ['knockout-redraw', 'knockout_redraw'].includes(season?.competition?.tournamentMode);
    if (!cup && match.stage === 'semifinal' && matches.some(m => m.stage === 'league' && !m.cancelledAt && m.sieger == null)) return null;
    if (match.sieger != null) return 'analysis';
    if (match.countsForElo !== true) return null;
    if (match.matchAt || (!cup && match.stage === 'semifinal')) return 'preview';
    if (cup) {
      const stages = ['quarterfinal', 'semifinal', 'final'];
      const active = stages.find(stage => matches.some(m => m.stage === stage && m.sieger == null && !m.cancelledAt));
      return match.stage === active ? 'preview' : 'basic';
    }
    const today = day(now);
    const windows = [...(season?.matchdays || [])].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || a.spieltag - b.spieltag);
    const own = windows.find(d => Number(d.spieltag) === Number(match.spieltag));
    if (own?.endDate < today) return 'preview';
    const upcoming = windows.filter(d => d.endDate >= today).slice(0, 2);
    return upcoming.some(d => Number(d.spieltag) === Number(match.spieltag)) ? 'preview' : 'basic';
  }
  // The window only moves when a matchday window ends, so the day after each end date is a candidate.
  function opensOn(match, season, now = new Date()) {
    if (availability(match, season, now) !== 'basic') return null;
    const today = day(now);
    const nextDays = [...new Set((season?.matchdays || []).map(d => d.endDate).filter(Boolean))]
      .filter(endDate => endDate >= today)
      .map(endDate => new Date(new Date(`${endDate}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10))
      .sort();
    return nextDays.find(date => availability(match, season, new Date(`${date}T12:00:00Z`)) === 'preview') || null;
  }
  const api = { availability, opensOn };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.PadelPreviewWindow = api;
})();
