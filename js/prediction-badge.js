/* Kleiner PadelTipp-Zähler ohne Laden des vollständigen Tippspiel-Moduls. */
(function () {
  'use strict';

  function countOpenPredictions({ season, matches, predictionIds, bonusQuestions, playerId, now = Date.now(), availability }) {
    if (!season || season.completedAt || season.competition?.predictionsEnabled === false) return 0;
    const databaseMatches = new Map(matches.map(match => [match.id, match]));
    const matchCount = (season.allMatches || season.matches || []).filter(match => {
      const row = databaseMatches.get(match.id);
      if (!match.team1?.playerIds?.length || !match.team2?.playerIds?.length
        || (playerId && [...match.team1.playerIds, ...match.team2.playerIds].includes(playerId))
        || !row || row.betting_open !== true || row.actual_sets || match.saetze || match.sets
        || row.cancelled_at || match.cancelledAt || match.sieger != null || match.winner != null
        || predictionIds.has(match.id)) return false;
      if (row.match_at) return new Date(row.match_at).getTime() > now;
      return availability({ ...match, matchAt: null }, season, new Date(now)) !== 'basic';
    }).length;
    const bonusCount = bonusQuestions.filter(question => question.is_open === true
      && new Date(question.lock_at).getTime() > now
      && (question.answers || []).length < Number(question.max_selections || 1)).length;
    return matchCount + bonusCount;
  }

  if (typeof module !== 'undefined') module.exports = { countOpenPredictions };
  if (typeof document === 'undefined' || document.documentElement?.classList.contains('is-detail-embed')) return;
  const link = document.getElementById('tipp-link');
  if (!link) return;
  const badge = link.querySelector('[data-open-predictions-count]');
  let season = null;
  let databaseSeasonId = null;
  let request = 0;
  let snapshot = null;

  function render() {
    const userId = window.PadelKonto?.getSession?.()?.user?.id;
    const count = userId && snapshot?.userId === userId ? countOpenPredictions({
      ...snapshot, season, playerId: window.PadelKonto?.getProfile?.()?.player_id,
      availability: window.PadelPreviewWindow.availability
    }) : 0;
    badge.hidden = !count;
    badge.textContent = count ? String(count) : '';
    const label = count ? `PadelTipp öffnen · ${count} ${count === 1 ? 'offener Tipp' : 'offene Tipps'}` : 'PadelTipp öffnen';
    link.setAttribute('aria-label', label);
    link.title = count ? label : 'PadelTipp';
  }

  async function refresh() {
    const currentRequest = ++request;
    const userId = window.PadelKonto?.getSession?.()?.user?.id;
    snapshot = null;
    render();
    const client = window.PadelKonto?.getClient?.();
    if (!userId || !client || !season || season.completedAt || season.competition?.predictionsEnabled === false) return;
    try {
      const [matches, predictions, bonus] = await Promise.all([
        client.from('matches').select('id,betting_open,actual_sets,match_at,cancelled_at').eq('season_id', databaseSeasonId),
        client.from('predictions').select('match_id').eq('user_id', userId),
        client.rpc('get_prediction_bonus_state', { p_season_id: databaseSeasonId })
      ]);
      if (currentRequest !== request || window.PadelKonto?.getSession?.()?.user?.id !== userId) return;
      if (matches.error || predictions.error || bonus.error) throw matches.error || predictions.error || bonus.error;
      snapshot = { userId, matches: matches.data || [], predictionIds: new Set((predictions.data || []).map(row => row.match_id)), bonusQuestions: bonus.data || [] };
      render();
    } catch (error) {
      if (currentRequest === request) console.warn('Offene Tipps konnten nicht geladen werden:', error);
    }
  }

  window.PadelPredictionBadge = {
    setSeason(data, id) {
      season = data;
      databaseSeasonId = id;
      void refresh();
    }
  };
  for (const event of ['padel:auth-state-changed', 'padel:match-forecast-changed', 'padel:official-result-changed']) {
    window.addEventListener(event, () => { void refresh(); });
  }
  window.addEventListener('focus', () => { void refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });
  // Bereits geladene Werte folgen dem Tippschluss auch ohne erneute Datenabfrage.
  setInterval(render, 30_000);
})();
