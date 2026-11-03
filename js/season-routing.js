/* Kurze, teilbare Saison- und Partiepfade samt Kompatibilität zu bisherigen Query-Links. */
(function () {
  'use strict';

  const LEGACY_SEASON_IDS = Object.freeze({
    '2026': '2026-sommer',
    'sommer-2026': '2026-sommer',
    'winter-2026': '2026-winter',
    'cup-2027': '2027-cup',
    'test-2026': '2026-test'
  });

  function normalizeSeasonId(id) {
    return LEGACY_SEASON_IDS[id] || id || null;
  }

  function getSeasons() {
    return Array.isArray(window.PADEL_SEASONS) ? window.PADEL_SEASONS : [];
  }

  function getSeasonById(id) {
    const normalized = normalizeSeasonId(id);
    return getSeasons().find(season => season.id === normalized) || null;
  }

  // Ohne <base> würden relative Skripte und Links nach dem Pfadwechsel unter dem Kurzpfad gesucht.
  function ensureDocumentBase(url) {
    if (url.pathname !== window.location.pathname && !document.querySelector('base')) {
      const base = document.createElement('base');
      base.href = new URL('./', document.baseURI).href;
      document.head.prepend(base);
    }
  }

  function replaceCurrentUrl(url) {
    ensureDocumentBase(url);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function getSeasonIdFromPath(pathname = window.location.pathname) {
    const segments = String(pathname).split('/').filter(Boolean).map(segment => segment.toLowerCase());
    return getSeasons().find(season => segments.includes(season.route?.toLowerCase()))?.id || null;
  }

  function getRequestedSeasonId() {
    const requested = new URLSearchParams(window.location.search).get('saison');
    return normalizeSeasonId(requested) || getSeasonIdFromPath();
  }

  function usesQueryRoutes(url) {
    const hostname = String(url.hostname || '').toLowerCase();
    return url.protocol === 'file:'
      || ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'].includes(hostname);
  }

  function getAreaBaseUrl(area) {
    const base = new URL(document.baseURI);
    const isTipBase = /\/tipp\/(?:index\.html)?$/.test(base.pathname);
    if (base.protocol === 'file:') {
      if (area === 'tipp') return isTipBase ? base : new URL('tipp/index.html', base);
      return isTipBase ? new URL('../index.html', base) : base;
    }
    if (area === 'tipp') return isTipBase ? base : new URL('tipp/', base);
    return isTipBase ? new URL('../', base) : base;
  }

  function getSeasonUrl(seasonId, area = 'league', options = {}) {
    const season = getSeasonById(seasonId);
    const base = getAreaBaseUrl(area);
    const queryRoutes = usesQueryRoutes(base);
    const url = !queryRoutes && season?.route
      ? new URL(`${season.route}/`, base)
      : new URL(base);

    if (options.preserveSearch) url.search = new URL(window.location.href).search;
    if (options.preserveHash) url.hash = new URL(window.location.href).hash;
    url.searchParams.delete('saison');
    if ((queryRoutes || !season?.route) && seasonId) url.searchParams.set('saison', normalizeSeasonId(seasonId));
    if (options.clearDetails) {
      ['partie', 'live', 'liveView', 'spielerprofil'].forEach(parameter => url.searchParams.delete(parameter));
    }
    return url;
  }

  function getMatchSlug(match) {
    const record = typeof match === 'string' ? { id: match } : match;
    const id = String(record?.id || '').toLowerCase();
    const stage = record?.stage || (record?.countsForRanking === false ? 'final-four' : null);
    if (!id || stage === 'final-four') return null;

    const leagueNumber = id.match(/(?:^|-)partie-?(\d+)$/)?.[1];
    if (leagueNumber) return String(Number(leagueNumber));
    const roundNumber = id.match(/-(quarterfinal|semifinal|final)-(\d+)$/);
    if (!roundNumber) return null;
    if (roundNumber[1] === 'quarterfinal') return `viertelfinale-${Number(roundNumber[2])}`;
    if (roundNumber[1] === 'semifinal') return `halbfinale-${Number(roundNumber[2])}`;
    return Number(roundNumber[2]) === 1 ? 'finale' : `finale-${Number(roundNumber[2])}`;
  }

  function getMatchIdFromPath(matches = [], pathname = window.location.pathname) {
    const segments = String(pathname).split('/').filter(Boolean).map(segment => decodeURIComponent(segment).toLowerCase());
    const detailIndex = segments.lastIndexOf('partie');
    const slug = detailIndex === -1 ? null : segments[detailIndex + 1];
    if (!slug) return null;
    return matches.find(match => getMatchSlug(match) === slug)?.id || null;
  }

  function getRequestedMatchId(matches = []) {
    return new URLSearchParams(window.location.search).get('partie') || getMatchIdFromPath(matches);
  }

  function getMatchUrl(seasonId, match, options = {}) {
    const seasonUrl = getSeasonUrl(seasonId, 'league', options);
    const slug = getMatchSlug(match);
    if (usesQueryRoutes(seasonUrl) || !slug) {
      if (match?.id || typeof match === 'string') seasonUrl.searchParams.set('partie', match?.id || match);
      return seasonUrl;
    }
    const url = new URL(`partie/${encodeURIComponent(slug)}/`, seasonUrl);
    url.search = seasonUrl.search;
    url.hash = seasonUrl.hash;
    url.searchParams.delete('partie');
    return url;
  }

  function normalizeCurrentMatchUrl(seasonId, matches = []) {
    const requested = new URLSearchParams(window.location.search).get('partie');
    const match = matches.find(item => item.id === requested);
    if (!match || !getMatchSlug(match)) return false;
    const url = getMatchUrl(seasonId, match, { preserveSearch: true, preserveHash: true });
    replaceCurrentUrl(url);
    return true;
  }

  function getPlayerIdFromPath(players = [], pathname = window.location.pathname) {
    const segments = String(pathname).split('/').filter(Boolean).map(segment => decodeURIComponent(segment).toLowerCase());
    const detailIndex = segments.lastIndexOf('spieler');
    const slug = detailIndex === -1 ? null : segments[detailIndex + 1];
    if (!slug) return null;
    return players.find(player => String(player?.id || '').toLowerCase() === slug)?.id || null;
  }

  function getRequestedPlayerProfileId(players = []) {
    return new URLSearchParams(window.location.search).get('spielerprofil') || getPlayerIdFromPath(players);
  }

  function getPlayerProfileUrl(seasonId, playerId, options = {}) {
    const seasonUrl = getSeasonUrl(seasonId, 'league', options);
    ['partie', 'live', 'liveView', 'spielerprofil'].forEach(parameter => seasonUrl.searchParams.delete(parameter));
    if (!playerId) return seasonUrl;
    const season = getSeasonById(seasonId);
    if (usesQueryRoutes(seasonUrl) || !season?.route) {
      seasonUrl.searchParams.set('spielerprofil', playerId);
      return seasonUrl;
    }
    const url = new URL(`spieler/${encodeURIComponent(playerId)}/`, seasonUrl);
    url.search = seasonUrl.search;
    url.hash = seasonUrl.hash;
    return url;
  }

  function normalizeCurrentPlayerProfileUrl(seasonId, players = []) {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('spielerprofil');
    if (!requested || params.has('partie') || params.has('live')) return false;
    if (!players.some(player => player.id === requested)) return false;
    const url = getPlayerProfileUrl(seasonId, requested, { preserveSearch: true, preserveHash: true });
    if (url.searchParams.has('spielerprofil')) return false;
    replaceCurrentUrl(url);
    return true;
  }

  function getLiveSlug(match) {
    const record = typeof match === 'string' ? { id: match } : match;
    const id = String(record?.id || '').toLowerCase();
    const isFinalFour = record?.stage === 'final-four'
      || (!record?.stage && record?.countsForRanking === false && record?.format === 'single-set');
    if (!id || (typeof match !== 'string' && !isFinalFour)) return null;
    const number = id.match(/(?:partie-|final-?)(\d+)$/)?.[1] || id.match(/(\d+)$/)?.[1];
    return number ? String(Number(number)) : null;
  }

  function getLiveRouteFromPath(matches = [], pathname = window.location.pathname) {
    const segments = String(pathname).split('/').filter(Boolean).map(segment => decodeURIComponent(segment).toLowerCase());
    const liveIndex = segments.lastIndexOf('live');
    if (liveIndex === -1) return null;
    const slug = segments[liveIndex + 1] || null;
    const finalFourMatches = matches.filter(match => getLiveSlug(match));
    const match = slug
      ? finalFourMatches.find(item => getLiveSlug(item) === slug)
      : finalFourMatches[0];
    return match ? { matchId: match.id, view: slug ? 'match' : 'overview' } : null;
  }

  function getRequestedLiveRoute(matches = []) {
    const params = new URLSearchParams(window.location.search);
    const matchId = params.get('live');
    if (matchId) return { matchId, view: params.get('liveView') === 'overview' ? 'overview' : 'match' };
    return getLiveRouteFromPath(matches);
  }

  function getLiveUrl(seasonId, match, view = 'match', options = {}) {
    const seasonUrl = getSeasonUrl(seasonId, 'league', options);
    const slug = getLiveSlug(match);
    if (usesQueryRoutes(seasonUrl) || !slug) {
      if (match?.id || typeof match === 'string') seasonUrl.searchParams.set('live', match?.id || match);
      if (view === 'overview') seasonUrl.searchParams.set('liveView', 'overview');
      return seasonUrl;
    }
    const suffix = view === 'overview' ? 'live/' : `live/${encodeURIComponent(slug)}/`;
    const url = new URL(suffix, seasonUrl);
    url.search = seasonUrl.search;
    url.hash = seasonUrl.hash;
    url.searchParams.delete('live');
    url.searchParams.delete('liveView');
    return url;
  }

  function normalizeCurrentLiveUrl(seasonId, matches = []) {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('live');
    if (!requested || params.has('partie')) return false;
    const match = matches.find(item => item.id === requested);
    if (!match || !getLiveSlug(match)) return false;
    const view = params.get('liveView') === 'overview' ? 'overview' : 'match';
    const url = getLiveUrl(seasonId, match, view, { preserveSearch: true, preserveHash: true });
    replaceCurrentUrl(url);
    return true;
  }

  function normalizeCurrentUrl(area = 'league') {
    const requested = new URLSearchParams(window.location.search).get('saison');
    if (!requested) return false;
    const normalized = normalizeSeasonId(requested);
    const url = getSeasonUrl(normalized, area, { preserveSearch: true, preserveHash: true });
    replaceCurrentUrl(url);
    return true;
  }

  window.PadelSeasonRouting = Object.freeze({
    ensureDocumentBase,
    getRequestedSeasonId,
    getRequestedMatchId,
    getMatchIdFromPath,
    getMatchSlug,
    getMatchUrl,
    getLiveRouteFromPath,
    getLiveSlug,
    getLiveUrl,
    getRequestedLiveRoute,
    getPlayerIdFromPath,
    getPlayerProfileUrl,
    getRequestedPlayerProfileId,
    getSeasonIdFromPath,
    getSeasonUrl,
    normalizeCurrentMatchUrl,
    normalizeCurrentLiveUrl,
    normalizeCurrentPlayerProfileUrl,
    normalizeCurrentUrl,
    normalizeSeasonId
  });
})();
