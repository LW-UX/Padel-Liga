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

  function getSeasonIdFromPath(pathname = window.location.pathname) {
    const segments = String(pathname).split('/').filter(Boolean).map(segment => segment.toLowerCase());
    return getSeasons().find(season => segments.includes(season.route?.toLowerCase()))?.id || null;
  }

  function getRequestedSeasonId() {
    const requested = new URLSearchParams(window.location.search).get('saison');
    return normalizeSeasonId(requested) || getSeasonIdFromPath();
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
    const localFile = base.protocol === 'file:';
    const url = !localFile && season?.route
      ? new URL(`${season.route}/`, base)
      : new URL(base);

    if (options.preserveSearch) url.search = new URL(window.location.href).search;
    if (options.preserveHash) url.hash = new URL(window.location.href).hash;
    url.searchParams.delete('saison');
    if ((localFile || !season?.route) && seasonId) url.searchParams.set('saison', normalizeSeasonId(seasonId));
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
    if (seasonUrl.protocol === 'file:' || !slug) {
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
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
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
    if (seasonUrl.protocol === 'file:' || !slug) {
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
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
  }

  function normalizeCurrentUrl(area = 'league') {
    const requested = new URLSearchParams(window.location.search).get('saison');
    if (!requested) return false;
    const normalized = normalizeSeasonId(requested);
    const url = getSeasonUrl(normalized, area, { preserveSearch: true, preserveHash: true });
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
  }

  window.PadelSeasonRouting = Object.freeze({
    getRequestedSeasonId,
    getRequestedMatchId,
    getMatchIdFromPath,
    getMatchSlug,
    getMatchUrl,
    getLiveRouteFromPath,
    getLiveSlug,
    getLiveUrl,
    getRequestedLiveRoute,
    getSeasonIdFromPath,
    getSeasonUrl,
    normalizeCurrentMatchUrl,
    normalizeCurrentLiveUrl,
    normalizeCurrentUrl,
    normalizeSeasonId
  });
})();
