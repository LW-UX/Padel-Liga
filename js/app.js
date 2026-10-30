// ── VIEWER ────────────────────────────────────────────────────────
const VIEWER_STORAGE_KEY_PREFIX = 'padel-liga-viewer';
const APP_HINT_DISMISSED_SESSION_KEY = 'padel-liga-app-hint-dismissed';
const LEGACY_DATABASE_SEASON_IDS = Object.freeze({
  '2026-sommer': '2026',
  '2026-winter': 'winter-2026',
  '2027-cup': 'cup-2027',
  '2026-test': 'test-2026'
});
let PADEL_DATA = null;
let selectedSeason = null;
let selectedViewerId = 'sb';
let matchScope = 'all';
let matchSortMode = 'matchday';
let matchSortDescending = false;
let rankingSortMode = 'points';
let rankingViewMode = 'compact';
let allTimeRankingViewMode = 'compact';
let allTimeRankingScope = 'league';
let allTimeRankingSortMode = 'points';
let calculatorResults = new Map();
let finalFourCalculatorResults = new Map();
let activeCalculatorMatchId = null;
let calculatorAutoTip = false;
let ownPredictionMatchIds = new Set();
let ownPredictionRequest = 0;
let homePredictionLeaderboard = [];
let homePredictionLeaderboardReady = false;
let homePredictionLeaderboardError = '';
let homePredictionLeaderboardRequest = 0;
let previousLeagueRankingAchievements = new Map();
let publicTrainingFeed = { upcoming: [], recent: [] };
let activeSeasonRefreshPromise = null;
let seasonRefreshRequested = false;
let playerProfileChart = null;
let playerProfileData = null;
let playerProfileExpanded = false;
let playerProfileMatchScope = 'past';
let playerProfileCompareId = null;
const playerProfileCompareElos = new Map();
let playerProfileRequestId = 0;
let playerProfileSeasonPayloadCache = new Map();
const PLAYER_PROFILE_CACHE_TTL = 30000;
const playerProfileCache = new Map();
let chartLibraryPromise = null;
let appReady = false;
const renderedSections = new Set();
let liveTickerReturnState = null;
let statisticsMode = 'season';
let allTimeStatisticsData = null;
let allTimeStatisticsPromise = null;
let statisticsLoadError = '';
let statisticsPlayerFilters = new Map();
const PLAYER_PROFILE_MATCH_PREVIEW_LIMIT = 10;
const PLAYER_PROFILE_ACHIEVEMENT_LIMIT = 4;
const PLAYER_PROFILE_PANEL_TRANSITION_MS = 220;
const panelLayout = window.PadelLigaPanelLayout;
const playerProfilePresentationStore = panelLayout.createPresentationPreference('padel-liga-player-profile-presentation');
const {
  renderPlayerProfileRowAttributes,
  updateSortHeaders,
  getRankingRowPositions,
  animateRankingRows,
  getDeltaClass,
  formatStatDiff,
  renderDiffValue
} = window.PadelTable;
const PLAYER_PROFILE_ROW_SELECTOR = 'tr[data-player-profile-id], #home-ranking .mini-rank-row[data-player-profile-id]';
const PROFILE_SEASON_COLOR_VARIABLES = Object.freeze({
  summer: '--season-summer',
  winter: '--season-winter',
  cup: '--season-cup',
  neutral: '--muted'
});
const themeValueCache = new Map();
const LEGACY_SEASON_IDS = Object.freeze({
  '2026': '2026-sommer',
  'sommer-2026': '2026-sommer',
  'winter-2026': '2026-winter',
  'cup-2027': '2027-cup',
  'test-2026': '2026-test'
});
const TEST_TRAINING_PLAYER_IDS = new Set(['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'test_net']);
let playerProfileLastTrigger = null;
let playerProfilePresentation = 'modal';
let playerProfilePresentationPreference = null;
let playerProfileActiveId = null;
let playerProfileForceModal = false;
let playerProfileCloseTimer = null;
let playerProfilePanelOrigin = null;
let playerProfileReturnContext = null;
let playerProfileEmbeddedPanelAvailable = false;
let detailPanelSwitchFrame = 0;
const isDetailEmbed = document.documentElement.classList.contains('is-detail-embed');

function beginDetailPanelSwitch() {
  document.body.classList.add('detail-panel-switching');
  cancelAnimationFrame(detailPanelSwitchFrame);
  detailPanelSwitchFrame = requestAnimationFrame(() => {
    detailPanelSwitchFrame = requestAnimationFrame(() => {
      document.body.classList.remove('detail-panel-switching');
      detailPanelSwitchFrame = 0;
    });
  });
}

window.PadelLigaBeginDetailPanelSwitch = beginDetailPanelSwitch;

function getViewerStorageKey() {
  return `${VIEWER_STORAGE_KEY_PREFIX}:${selectedSeason?.id || 'default'}`;
}

function getStoredViewerId() {
  try {
    return localStorage.getItem(getViewerStorageKey()) || 'sb';
  } catch (error) {
    return 'sb';
  }
}

function storeViewerId(id) {
  try {
    localStorage.setItem(getViewerStorageKey(), id);
  } catch (error) {
    // The viewer picker still works for the current page load if storage is blocked.
  }
}

function isAppHintDismissed() {
  try {
    return sessionStorage.getItem(APP_HINT_DISMISSED_SESSION_KEY) === 'true';
  } catch (error) {
    return false;
  }
}

function dismissAppHint() {
  const hint = document.querySelector('.home-app-hint');
  if (hint) hint.hidden = true;
  try {
    sessionStorage.setItem(APP_HINT_DISMISSED_SESSION_KEY, 'true');
  } catch (error) {
    // The hint still stays hidden for the current page load if storage is blocked.
  }
}

function applyAppHintVisibility() {
  const hint = document.querySelector('.home-app-hint');
  if (hint && isAppHintDismissed()) hint.hidden = true;
}

function orderSeasonOptions(seasons = []) {
  return [...seasons].sort((left, right) => String(left.id).localeCompare(String(right.id), 'de', { numeric: true }));
}

function normalizeSeasonId(id) {
  return LEGACY_SEASON_IDS[id] || id;
}

function getAllSeasonOptions() {
  return orderSeasonOptions(Array.isArray(window.PADEL_SEASONS) ? window.PADEL_SEASONS : []);
}

function getSeasonOptions() {
  return getAllSeasonOptions().filter(season => !season.hidden);
}

function getRequestedSeasonId() {
  return window.PadelSeasonRouting.getRequestedSeasonId();
}

function normalizeLegacySeasonUrl() {
  window.PadelSeasonRouting.normalizeCurrentUrl('league');
}

function getDefaultSeasonOption() {
  const seasons = getSeasonOptions();
  const requestedSeasonId = getRequestedSeasonId();
  const requestedSeason = getAllSeasonOptions().find(season => season.id === requestedSeasonId);

  return requestedSeason || seasons.find(season => season.default) || seasons[seasons.length - 1] || null;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Konnte ${src} nicht laden.`));
    document.head.appendChild(script);
  });
}

function ensureChartLibrary() {
  if (window.Chart) return Promise.resolve();
  if (!chartLibraryPromise) {
    chartLibraryPromise = loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js')
      .then(() => {
        if (!window.Chart) throw new Error('Die Diagrammbibliothek ist nicht verfügbar.');
      })
      .catch(error => {
        chartLibraryPromise = null;
        throw error;
      });
  }
  return chartLibraryPromise;
}

function getSupabaseClient() {
  if (window.PADEL_SUPABASE_CLIENT) return window.PADEL_SUPABASE_CLIENT;
  const config = window.PADEL_SUPABASE_CONFIG;
  if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) return null;
  window.PADEL_SUPABASE_CLIENT = window.supabase.createClient(config.url, config.publishableKey);
  return window.PADEL_SUPABASE_CLIENT;
}

function getBerlinDateTimeParts(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return { date: null, time: null };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).map(part => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}.${parts.minute}`
  };
}

async function mergeDatabaseResults(rawSeason) {
  if (!rawSeason.databaseResults) return rawSeason;
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase ist für die Test-Saison nicht konfiguriert.');
  const matchIds = rawSeason.matches.map(match => match.id);
  const { data: databaseMatches, error: matchError } = await client
    .from('matches')
    .select('id, match_at, result_details, actual_sets, winner, cancelled_at')
    .in('id', matchIds);
  if (matchError) throw matchError;

  const matchesById = new Map((databaseMatches || []).map(match => [match.id, match]));

  return {
    ...rawSeason,
    matches: rawSeason.matches.map(match => {
      const stored = matchesById.get(match.id);
      if (!stored) throw new Error(`Die Datenbank-Partie ${match.id} fehlt.`);
      const matchTime = getBerlinDateTimeParts(stored.match_at);
      return {
        ...match,
        matchAt: stored.match_at,
        date: matchTime.date,
        time: matchTime.time,
        result: stored.result_details,
        sets: stored.actual_sets,
        winner: stored.winner,
        cancelledAt: stored.cancelled_at
      };
    })
  };
}

async function loadDatabaseSeasonOptions() {
  const client = getSupabaseClient();
  if (!client) return;
  const { data, error } = await client.rpc('get_public_seasons');
  if (error) {
    if (error.code === 'PGRST202' || /get_public_seasons/i.test(String(error.message || ''))) return;
    throw error;
  }
  if (!Array.isArray(data) || !data.length) return;

  const staticOptions = new Map(getAllSeasonOptions().map(season => [season.id, season]));
  const databaseOptions = data.map(season => {
    const id = normalizeSeasonId(season.id);
    const staticOption = staticOptions.get(id);
    return {
      ...staticOption,
      id,
      databaseId: season.id,
      label: staticOption?.label || season.label,
      startDate: season.starts_on,
      completedAt: season.completed_at,
      visualTheme: season.visual_theme || staticOption?.visualTheme || 'neutral',
      default: Boolean(season.is_active)
    };
  });
  const databaseIds = new Set(databaseOptions.map(season => season.id));
  const staticFallbacks = [...staticOptions.values()]
    .filter(season => !databaseIds.has(season.id))
    .map(season => ({ ...season, default: false }));
  window.PADEL_SEASONS = orderSeasonOptions([...databaseOptions, ...staticFallbacks]);
}

async function loadDatabaseSeasonPayload(seasonReference) {
  const client = getSupabaseClient();
  if (!client) return null;
  const publicId = normalizeSeasonId(typeof seasonReference === 'object' ? seasonReference.id : seasonReference);
  const option = typeof seasonReference === 'object'
    ? seasonReference
    : getAllSeasonOptions().find(season => season.id === publicId);
  const databaseId = option?.databaseId || (typeof seasonReference === 'string' ? seasonReference : publicId);
  const { data, error } = await client.rpc('get_public_season', { p_season_id: databaseId });
  if (error) {
    if (error.code === 'PGRST202' || /get_public_season/i.test(String(error.message || ''))) return null;
    throw error;
  }
  if (!data) return null;
  return {
    ...data,
    id: publicId,
    databaseId,
    matches: (data.matches || []).map(match => ({
      ...match,
      seasonId: normalizeSeasonId(match.seasonId)
    }))
  };
}

async function loadDatabaseMatchForecasts(seasonReference) {
  const client = getSupabaseClient();
  if (!client) return [];
  const publicId = normalizeSeasonId(typeof seasonReference === 'object' ? seasonReference.id : seasonReference);
  const option = typeof seasonReference === 'object'
    ? seasonReference
    : getAllSeasonOptions().find(season => season.id === publicId);
  const databaseId = option?.databaseId || (typeof seasonReference === 'string' ? seasonReference : publicId);
  const { data, error } = await client.rpc('get_public_match_forecasts', { p_season_id: databaseId });
  if (error) {
    if (error.code === 'PGRST202' || /get_public_match_forecasts/i.test(String(error.message || ''))) return [];
    console.warn('Partieprognosen konnten nicht geladen werden:', error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

async function loadDatabasePredictionLeaderboard(seasonReference) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht konfiguriert.');
  const seasonId = seasonReference?.databaseId || seasonReference?.id;
  if (!seasonId) return [];
  const { data, error } = await client.rpc('get_prediction_leaderboard', { p_season_id: seasonId });
  if (error) throw error;
  if (Array.isArray(data) && data.length) return data;

  const legacySeasonId = LEGACY_DATABASE_SEASON_IDS[seasonId];
  if (!legacySeasonId) return [];
  const fallback = await client.rpc('get_prediction_leaderboard', { p_season_id: legacySeasonId });
  if (fallback.error) throw fallback.error;
  return Array.isArray(fallback.data) ? fallback.data : [];
}

function getPreviousCompletedLeagueSeason(seasonReference = selectedSeason) {
  const currentId = normalizeSeasonId(seasonReference?.id);
  const currentStart = String(seasonReference?.startDate || '');
  return getSeasonOptions()
    .filter(season =>
      normalizeSeasonId(season.id) !== currentId
      && season.completedAt
      && season.visualTheme !== 'cup'
      && (!currentStart || String(season.startDate || '') < currentStart)
    )
    .sort((left, right) =>
      String(right.startDate || '').localeCompare(String(left.startDate || ''))
      || String(right.completedAt || '').localeCompare(String(left.completedAt || ''))
      || String(left.id).localeCompare(String(right.id))
    )[0] || null;
}

async function loadPreviousLeagueRankingAchievements(seasonReference = selectedSeason) {
  const client = getSupabaseClient();
  const previousSeason = getPreviousCompletedLeagueSeason(seasonReference);
  if (!client?.from || !previousSeason) return new Map();

  try {
    const seasonId = previousSeason.databaseId
      || LEGACY_DATABASE_SEASON_IDS[previousSeason.id]
      || previousSeason.id;
    const { data, error } = await client
      .from('player_achievements')
      .select('player_id, kind')
      .eq('season_id', seasonId)
      .in('kind', ['winner', 'final_four']);
    if (error) throw error;

    const achievements = new Map();
    (data || []).forEach(achievement => {
      const current = achievements.get(achievement.player_id);
      if (!current || achievement.kind === 'winner') {
        achievements.set(achievement.player_id, {
          kind: achievement.kind,
          seasonLabel: previousSeason.label
        });
      }
    });
    return achievements;
  } catch (error) {
    console.warn('Auszeichnungen der vorherigen Ligasaison konnten nicht geladen werden:', error);
    return new Map();
  }
}

function isTestTrainingFeedItem(training) {
  return (training?.participants || []).some(participant =>
    !participant?.isGuest && TEST_TRAINING_PLAYER_IDS.has(String(participant?.id || ''))
  );
}

function getSeasonTrainingCutoffDate(completedAt = PADEL_DATA?.completedAt || selectedSeason?.completedAt) {
  return completedAt ? getBerlinDateTimeParts(completedAt).date : null;
}

function filterPublicTrainingFeedForSeason(
  items,
  seasonId = selectedSeason?.id,
  completedAt = PADEL_DATA?.completedAt || selectedSeason?.completedAt
) {
  const testMode = normalizeSeasonId(seasonId) === '2026-test';
  const cutoffDate = getSeasonTrainingCutoffDate(completedAt);
  return (items || []).filter(training =>
    (testMode || !isTestTrainingFeedItem(training))
    && (!cutoffDate || String(training?.playedOn || '') <= cutoffDate)
  );
}

async function loadDatabasePublicTrainingFeed() {
  const client = getSupabaseClient();
  if (!client) return { upcoming: [], recent: [] };
  const testMode = normalizeSeasonId(selectedSeason?.id) === '2026-test';
  const cutoffDate = getSeasonTrainingCutoffDate(selectedSeason?.completedAt);
  let response;
  try {
    response = await client.rpc('get_public_training_feed', { p_test_mode: testMode, p_until: cutoffDate });
    if (response.error?.code === 'PGRST202') {
      response = await client.rpc('get_public_training_feed', { p_test_mode: testMode });
    }
    if (response.error?.code === 'PGRST202') {
      response = await client.rpc('get_public_training_feed');
    }
  } catch (error) {
    console.warn('Öffentliche Trainingstermine konnten nicht geladen werden:', error);
    return { upcoming: [], recent: [] };
  }
  const { data, error } = response;
  if (error) {
    if (error.code === 'PGRST202' || /get_public_training_feed/i.test(String(error.message || ''))) {
      return { upcoming: [], recent: [] };
    }
    console.warn('Öffentliche Trainingstermine konnten nicht geladen werden:', error);
    return { upcoming: [], recent: [] };
  }
  const normalize = item => ({
    ...item,
    playedOn: String(item?.playedOn || ''),
    displayTime: String(item?.displayTime || '').replace(':', '.'),
    participants: Array.isArray(item?.participants) ? item.participants : [],
    roundCount: Number(item?.roundCount) || 0,
    completedSetCount: Number(item?.completedSetCount) || 0
  });
  return {
    upcoming: filterPublicTrainingFeedForSeason(Array.isArray(data?.upcoming) ? data.upcoming.map(normalize) : []),
    recent: filterPublicTrainingFeedForSeason(Array.isArray(data?.recent) ? data.recent.map(normalize) : [])
  };
}

async function refreshPublicTrainingFeed() {
  publicTrainingFeed = await loadDatabasePublicTrainingFeed();
  invalidateSections(['start']);
  renderActiveSection();
}

async function loadDatabaseAllTimeStatisticsPayload() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase ist für die All-Time-Statistik nicht konfiguriert.');
  const { data, error } = await client.rpc('get_public_all_time_statistics');
  if (error) throw error;
  if (!data?.players || !data?.matches) throw new Error('Die All-Time-Daten sind unvollständig.');
  return data;
}

function normalizeLegacySeason(rawSeason) {
  if (Array.isArray(rawSeason?.participants)) return rawSeason;
  if (!Array.isArray(rawSeason?.players) || !Array.isArray(rawSeason?.matches)) return rawSeason;
  const centralPlayers = new Map((window.PADEL_PLAYERS || []).map(player => [player.name, player.id]));
  const qualifierRanks = new Map([['Erster', 1], ['Zweiter', 2], ['Dritter', 3], ['Vierter', 4]]);
  const normalizeTeam = team => {
    const names = Array.isArray(team?.spieler) ? team.spieler : [];
    const playerIds = names.map(name => centralPlayers.get(name)).filter(Boolean);
    return playerIds.length === names.length
      ? { playerIds }
      : {
          qualifierRanks: names.map(name => qualifierRanks.get(name)).filter(Boolean),
          qualifierLabels: names
        };
  };

  return {
    ...rawSeason,
    participants: rawSeason.players.map(player => ({
      playerId: player.id,
      startElo: Number(player.history?.[0]?.elo)
    })),
    matches: rawSeason.matches.map(match => ({
      id: `${rawSeason.matchIdPrefix || `season-${rawSeason.id}`}-partie-${String(match.id).match(/\d+$/)?.[0] || match.id}`,
      type: 'season',
      stage: match.stage || (match.countsForRanking === false ? 'final-four' : 'league'),
      seasonId: rawSeason.id,
      format: match.format || 'best-of-three',
      countsForRanking: match.countsForRanking !== false,
      countsForElo: match.countsForElo !== false,
      matchday: match.spieltag,
      date: match.datum,
      time: match.uhrzeit,
      result: match.ergebnis,
      sets: match.saetze,
      winner: match.sieger,
      cancelledAt: match.cancelledAt || null,
      displayLabel: match.displayLabel,
      team1: normalizeTeam(match.team1),
      team2: normalizeTeam(match.team2)
    }))
  };
}

function countsForRanking(match) {
  return match?.countsForRanking !== false;
}

function isCancelledMatch(match) {
  return Boolean(match?.cancelledAt);
}

function getMatchStage(match) {
  if (['league', 'quarterfinal', 'semifinal', 'final-four', 'final'].includes(match?.stage)) return match.stage;
  return countsForRanking(match) ? 'league' : 'final-four';
}

function isCupSeason() {
  return getCompetitionConfig().tournamentMode === 'knockout-redraw';
}

function getCompetitionConfig() {
  const competition = PADEL_DATA?.competition || {};
  return {
    tournamentMode: competition.tournamentMode || 'none',
    qualificationPlaces: Number(competition.qualificationPlaces) || 0,
    maximumLeagueMatches: Number(competition.maximumLeagueMatches ?? selectedSeason?.maximumLeagueMatches) || 0,
    homeRankingLimit: Number(competition.homeRankingLimit) || 4,
    regularScheduleLocked: Boolean(competition.regularScheduleLocked),
    predictionsEnabled: competition.predictionsEnabled !== false
  };
}

function getMaximumLeagueMatches() {
  const configuredMaximum = getCompetitionConfig().maximumLeagueMatches;
  if (configuredMaximum > 0) return configuredMaximum;

  const appearances = new Map();
  (PADEL_DATA?.matches || [])
    .filter(match => getMatchStage(match) === 'league')
    .forEach(match => [...(match.team1?.spieler || []), ...(match.team2?.spieler || [])]
      .forEach(name => appearances.set(name, (appearances.get(name) || 0) + 1)));

  return Math.max(0, ...appearances.values());
}

function isCompletedSeasonMatch(match) {
  return isCancelledMatch(match) || (match?.sieger !== null && match?.sieger !== undefined
    && match?.saetze !== null && match?.saetze !== undefined);
}

function hasAssignedMatchPlayers(match) {
  return match?.team1?.playerIds?.length === 2 && match?.team2?.playerIds?.length === 2;
}

function getSeasonDisplayPhase(season = PADEL_DATA) {
  if (season?.completedAt) return 'completed';

  const matches = season?.matches || [];
  const competition = season?.competition || {};
  const tournamentMode = competition.tournamentMode || 'none';
  const leagueMatches = matches.filter(match => getMatchStage(match) === 'league');
  const leagueComplete = Boolean(competition.regularScheduleLocked)
    && leagueMatches.length > 0
    && leagueMatches.every(isCompletedSeasonMatch);
  if (!leagueComplete) return 'league';

  const finalFourMatches = matches.filter(match => getMatchStage(match) === 'final-four');
  const finalFourReady = finalFourMatches.length === 3 && finalFourMatches.every(hasAssignedMatchPlayers);
  if (tournamentMode === 'direct-final-four') {
    return finalFourReady ? 'final-four' : 'league';
  }

  if (tournamentMode === 'top8-semifinals') {
    const semifinalMatches = matches.filter(match => getMatchStage(match) === 'semifinal');
    if (semifinalMatches.length !== 2) return 'league';
    if (!semifinalMatches.every(isCompletedSeasonMatch)) return 'semifinal';
    return finalFourReady ? 'final-four' : 'semifinal';
  }

  return 'league';
}

function countsForElo(match) {
  return match?.countsForElo === true;
}

function isSingleSetMatch(match) {
  return match?.format === 'single-set';
}

function getQualifierLabel(rank) {
  return ({ 1: 'Erster', 2: 'Zweiter', 3: 'Dritter', 4: 'Vierter' })[rank] || `Platz ${rank}`;
}

function normalizeSeasonLeagues(rawSeason) {
  const source = Array.isArray(rawSeason.leagues) && rawSeason.leagues.length
    ? rawSeason.leagues
    : [{ id: 'main', label: rawSeason.title || rawSeason.label || 'Liga', default: true }];
  const leagueIds = new Set();
  const leagues = source.map(league => {
    if (!league?.id || leagueIds.has(league.id)) {
      throw new Error(`Doppelte oder ungültige Liga-ID ${league?.id || ''}.`);
    }
    leagueIds.add(league.id);
    return { ...league };
  });
  const defaultLeague = leagues.find(league => league.default) || leagues[0];

  return { leagues, leagueIds, defaultLeagueId: defaultLeague.id };
}

function resolveLeagueId(record, leagueConfig, recordLabel) {
  const leagueId = record?.leagueId || (
    leagueConfig.leagues.length === 1 ? leagueConfig.defaultLeagueId : null
  );

  if (!leagueId || !leagueConfig.leagueIds.has(leagueId)) {
    throw new Error(`Ungültige oder fehlende Liga für ${recordLabel}.`);
  }
  return leagueId;
}

function hydrateTeam(team, playersById) {
  const playerIds = Array.isArray(team?.playerIds) ? team.playerIds : [];
  const qualifierRanks = Array.isArray(team?.qualifierRanks) ? team.qualifierRanks : [];
  const qualifierLabels = Array.isArray(team?.qualifierLabels) ? team.qualifierLabels : [];

  playerIds.forEach(playerId => {
    if (!playersById.has(playerId)) {
      throw new Error(`Unbekannte Spieler-ID ${playerId}.`);
    }
  });

  return {
    ...team,
    playerIds,
    qualifierRanks,
    qualifierLabels,
    // Anzeigenamen werden ausschließlich aus den zentralen Stammdaten abgeleitet.
    spieler: playerIds.length
      ? playerIds.map(playerId => playersById.get(playerId).name)
      : qualifierLabels.length ? qualifierLabels : qualifierRanks.map(getQualifierLabel)
  };
}

function hydrateMatch(match, playersById) {
  const matchTime = match.matchAt ? getBerlinDateTimeParts(match.matchAt) : null;
  return {
    ...match,
    // Die Oberfläche nutzt vorerst diese bisherigen Feldnamen. Die gepflegten
    // Rohdaten verwenden für Saison- und Trainingsspiele dasselbe Schema.
    spieltag: match.matchday ?? null,
    datum: matchTime?.date ?? match.date ?? null,
    uhrzeit: matchTime?.time ?? match.time ?? null,
    ergebnis: match.result ?? null,
    saetze: match.sets ?? null,
    sieger: match.winner ?? null,
    team1: hydrateTeam(match.team1, playersById),
    team2: hydrateTeam(match.team2, playersById)
  };
}

function parseEloScore(match) {
  const normalized = String(match?.ergebnis || '').replace(/\([^)]*\)/g, '');
  const scores = [...normalized.matchAll(/(\d+)\s*:\s*(\d+)/g)]
    .map(match => [Number(match[1]), Number(match[2])]);

  const requiredSetCount = isSingleSetMatch(match) ? 1 : 2;
  if (scores.length < requiredSetCount) return null;
  return {
    regularSets: scores.slice(0, requiredSetCount),
    matchTiebreak: requiredSetCount === 2 ? scores[2] || null : null
  };
}

function getEloExpectedScore(playerElo, opponentElo) {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 500));
}

function getEloExpectedScoreAgainstTeam(playerElo, opponentElos) {
  return opponentElos.reduce(
    (sum, opponentElo) => sum + getEloExpectedScore(playerElo, opponentElo),
    0
  ) / opponentElos.length;
}

function getEloPointFactor(score) {
  return window.PadelEloForecast.getEloPointFactor(score);
}

function calculateSeasonEloHistory(season) {
  const playersById = new Map(season.players.map(player => [player.id, player]));
  const ratings = new Map(season.players.map(player => [player.id, Number(player.startElo)]));
  const startDate = season.startDate || season.matchdays?.find(day => day.startDate)?.startDate;

  season.players.forEach(player => {
    if (!Number.isFinite(ratings.get(player.id))) {
      throw new Error(`Ungültiger Start-Elo für ${player.id}.`);
    }
    player.history = [{
      date: startDate,
      elo: ratings.get(player.id),
      matchId: null,
      label: 'Start'
    }];
  });

  season.matches
    .filter(match => countsForElo(match) && match.sieger !== null)
    .sort((a, b) => getMatchOrderKey(a).localeCompare(getMatchOrderKey(b)))
    .forEach(match => {
      const team1Ids = match.team1.playerIds;
      const team2Ids = match.team2.playerIds;
      const score = parseEloScore(match);

      if (team1Ids.length !== 2 || team2Ids.length !== 2 || !score) {
        throw new Error(`Elo für ${match.id} kann nicht berechnet werden.`);
      }

      const team1Elos = team1Ids.map(playerId => ratings.get(playerId));
      const team2Elos = team2Ids.map(playerId => ratings.get(playerId));
      const pointFactor = getEloPointFactor(score);
      const updates = [
        ...team1Ids.map((playerId, index) => ({
          playerId,
          oldElo: team1Elos[index],
          expected: getEloExpectedScoreAgainstTeam(team1Elos[index], team2Elos),
          score: match.sieger === 1 ? 1 : 0
        })),
        ...team2Ids.map((playerId, index) => ({
          playerId,
          oldElo: team2Elos[index],
          expected: getEloExpectedScoreAgainstTeam(team2Elos[index], team1Elos),
          score: match.sieger === 2 ? 1 : 0
        }))
      ];

      updates.forEach(update => {
        const elo = Math.round(
          update.oldElo + pointFactor * 50 * (update.score - update.expected)
        );
        ratings.set(update.playerId, elo);
        playersById.get(update.playerId).history.push({
          date: match.datum,
          elo,
          matchId: match.id,
          label: getMatchDisplayLabel(match)
        });
      });
    });
}

function hydrateSeasonData(rawSeason) {
  if (!Array.isArray(window.PADEL_PLAYERS)) {
    throw new Error('Zentrale Spielerdaten fehlen.');
  }

  const playersById = new Map();
  window.PADEL_PLAYERS.forEach(player => {
    if (!player?.id || playersById.has(player.id)) {
      throw new Error(`Doppelte oder ungültige Spieler-ID ${player?.id || ''}.`);
    }
    if (!player.name || !player.initials || !player.firma || !['👨', '👩'].includes(player.profileEmoji)) {
      throw new Error(`Unvollständige Stammdaten für ${player.id}.`);
    }
    playersById.set(player.id, player);
  });

  const leagueConfig = normalizeSeasonLeagues(rawSeason);
  const participantIds = new Set();
  const allPlayers = rawSeason.participants.map(participant => {
    const player = playersById.get(participant.playerId);
    if (!player || participantIds.has(participant.playerId)) {
      throw new Error(`Ungültige Saison-Teilnahme ${participant.playerId}.`);
    }
    participantIds.add(participant.playerId);
    return {
      ...player,
      leagueId: resolveLeagueId(
        participant,
        leagueConfig,
        `Teilnehmer ${participant.playerId}`
      ),
      startElo: Number(participant.startElo),
      endElo: participant.endElo === null || participant.endElo === undefined
        ? null
        : Number(participant.endElo),
      currentElo: participant.currentElo === null || participant.currentElo === undefined
        ? null
        : Number(participant.currentElo),
      history: Array.isArray(participant.eloHistory)
        ? participant.eloHistory.map(entry => ({
            ...entry,
            date: entry.date || getBerlinDateTimeParts(entry.matchAt).date,
            label: entry.label || '',
            elo: Number(entry.elo),
            oldElo: entry.oldElo === null || entry.oldElo === undefined ? null : Number(entry.oldElo),
            delta: entry.delta === null || entry.delta === undefined ? null : Number(entry.delta),
            interveningEvents: Array.isArray(entry.interveningEvents) ? entry.interveningEvents : []
          }))
        : null
    };
  });

  const matchIds = new Set();
  const allMatches = rawSeason.matches.map(match => {
    if (!match?.id || matchIds.has(match.id)) {
      throw new Error(`Doppelte oder ungültige Match-ID ${match?.id || ''}.`);
    }
    if (match.type !== 'season' || match.seasonId !== rawSeason.id) {
      throw new Error(`Ungültige Saisonzuordnung für ${match.id}.`);
    }
    matchIds.add(match.id);
    const hydratedMatch = hydrateMatch({
      ...match,
      leagueId: resolveLeagueId(match, leagueConfig, `Spiel ${match.id}`)
    }, playersById);
    [...hydratedMatch.team1.playerIds, ...hydratedMatch.team2.playerIds].forEach(playerId => {
      if (!participantIds.has(playerId)) {
        throw new Error(`${playerId} nimmt nicht an Saison ${rawSeason.id} teil.`);
      }
    });
    return hydratedMatch;
  });

  const trainingMatches = (window.PADEL_TRAINING_MATCHES || [])
    .map(match => hydrateMatch(match, playersById));
  trainingMatches.forEach(match => {
    if (!match?.id || matchIds.has(match.id) || match.type !== 'training') {
      throw new Error(`Doppelte oder ungültige Trainingsspiel-ID ${match?.id || ''}.`);
    }
    matchIds.add(match.id);
    if (match.countsForRanking !== false || match.countsForElo !== false) {
      throw new Error(`Trainingsspiel ${match.id} darf weder Rangliste noch Elo verändern.`);
    }
  });

  const completeSeason = {
    ...rawSeason,
    competition: {
      tournamentMode: rawSeason.competition?.tournamentMode || 'none',
      qualificationPlaces: Number(rawSeason.competition?.qualificationPlaces) || 0,
      homeRankingLimit: Number(rawSeason.competition?.homeRankingLimit) || 4,
      regularScheduleLocked: Boolean(rawSeason.competition?.regularScheduleLocked),
      predictionsEnabled: rawSeason.competition?.predictionsEnabled !== false
    },
    leagues: leagueConfig.leagues,
    activeLeagueId: leagueConfig.defaultLeagueId,
    players: allPlayers,
    matches: allMatches,
    trainingMatches
  };
  if (completeSeason.players.every(player => Array.isArray(player.history))) {
    completeSeason.players.forEach(player => {
      player.history.sort((left, right) => String(left.matchAt || left.date || '')
        .localeCompare(String(right.matchAt || right.date || '')));
    });
  } else {
    calculateSeasonEloHistory(completeSeason);
  }

  return {
    ...completeSeason,
    allPlayers,
    allMatches,
    players: allPlayers.filter(player => player.leagueId === leagueConfig.defaultLeagueId),
    matches: allMatches.filter(match => match.leagueId === leagueConfig.defaultLeagueId)
  };
}

function hydrateAllTimeStatisticsData(rawData) {
  const centralPlayers = new Map((window.PADEL_PLAYERS || []).map(player => [player.id, player]));
  const hydratePlayer = (entry, { includeHistory = false } = {}) => {
    const player = centralPlayers.get(entry.playerId);
    if (!player) throw new Error(`Unbekannte All-Time-Spieler-ID ${entry.playerId}.`);

    return {
      ...player,
      currentElo: entry.currentElo === null || entry.currentElo === undefined
        ? null
        : Number(entry.currentElo),
      history: includeHistory ? (entry.eloHistory || []).map(historyEntry => ({
        ...historyEntry,
        date: historyEntry.date || getBerlinDateTimeParts(historyEntry.matchAt).date,
        elo: Number(historyEntry.elo),
        oldElo: historyEntry.oldElo === null || historyEntry.oldElo === undefined
          ? null
          : Number(historyEntry.oldElo),
        delta: historyEntry.delta === null || historyEntry.delta === undefined
          ? null
          : Number(historyEntry.delta),
        interveningEvents: []
      })) : []
    };
  };
  const players = rawData.players.map(entry => hydratePlayer(entry, { includeHistory: true }));
  const playerIds = new Set(players.map(player => player.id));
  const matches = rawData.matches.map(match => {
    const hydratedMatch = hydrateMatch(match, centralPlayers);
    const matchPlayerIds = [...hydratedMatch.team1.playerIds, ...hydratedMatch.team2.playerIds];
    if (matchPlayerIds.length !== 4 || matchPlayerIds.some(playerId => !playerIds.has(playerId))) {
      throw new Error(`Ungültige All-Time-Spielerzuordnung für ${match.id}.`);
    }
    return hydratedMatch;
  });
  const rankingPlayers = Array.isArray(rawData.rankingPlayers)
    ? rawData.rankingPlayers.map(entry => hydratePlayer(entry))
    : [];
  const trainingPlayers = Array.isArray(rawData.trainingPlayers)
    ? rawData.trainingPlayers.map(entry => hydratePlayer(entry))
    : [];
  // Trainingsabschnitte kommen bereits gewichtet; Gäste sind serverseitig entfernt.
  const trainingRounds = (rawData.trainingRounds || []).map(round => ({
    ...round,
    team1: { playerIds: round.team1?.playerIds || [] },
    team2: { playerIds: round.team2?.playerIds || [] },
    matchWeight: Number(round.matchWeight) || 0,
    team1Wins: Number(round.team1Wins) || 0,
    team2Wins: Number(round.team2Wins) || 0,
    team1Points: Number(round.team1Points) || 0,
    team2Points: Number(round.team2Points) || 0,
    team1Games: Number(round.team1Games) || 0,
    team2Games: Number(round.team2Games) || 0
  }));

  return {
    id: 'all-time',
    label: 'All-Time',
    players,
    rankingPlayers,
    trainingPlayers,
    trainingRounds,
    matches,
    completedAt: null,
    eloFinalDate: null
  };
}

async function loadAllTimeStatisticsData() {
  if (allTimeStatisticsData) return allTimeStatisticsData;
  if (allTimeStatisticsPromise) return allTimeStatisticsPromise;

  allTimeStatisticsPromise = loadDatabaseAllTimeStatisticsPayload()
    .then(hydrateAllTimeStatisticsData)
    .then(data => {
      allTimeStatisticsData = data;
      if (!statisticsPlayerFilters.has('all-time')) {
        statisticsPlayerFilters.set('all-time', new Set(data.players.map(player => player.id)));
      }
      return data;
    })
    .finally(() => {
      allTimeStatisticsPromise = null;
    });

  return allTimeStatisticsPromise;
}

async function loadSeasonData(season) {
  window.PADEL_SEASON = null;
  const [, databaseSeason] = await Promise.all([
    season.file ? loadScript(season.file) : Promise.resolve(),
    loadDatabaseSeasonPayload(season)
  ]);
  const staticSeason = window.PADEL_SEASON ? normalizeLegacySeason(window.PADEL_SEASON) : null;
  const databaseSeasonIsComplete = Boolean(
    databaseSeason
    && (!staticSeason || databaseSeason.matches?.length >= staticSeason.matches?.length)
  );
  const rawSeason = databaseSeasonIsComplete
    ? {
        ...databaseSeason,
        articles: staticSeason?.articles || [],
        homeAnnouncement: staticSeason?.homeAnnouncement || null,
        matchdayBreaks: staticSeason?.matchdayBreaks || [],
        shortInfo: databaseSeason.shortInfo?.length ? databaseSeason.shortInfo : staticSeason?.shortInfo || [],
        organizations: databaseSeason.organizations?.length ? databaseSeason.organizations : staticSeason?.organizations || []
      }
    : await mergeDatabaseResults(staticSeason);

  if (!rawSeason?.participants || !rawSeason?.matches) {
    throw new Error(`Saison ${season.id} ist unvollständig.`);
  }

  return hydrateSeasonData(rawSeason);
}

function applyMatchForecasts(forecastSummaries = []) {
  const forecastsByMatch = new Map(forecastSummaries.map(forecast => [forecast.matchId, forecast]));
  PADEL_DATA.matches.forEach(match => {
    match.forecast = forecastsByMatch.get(match.id) || null;
  });
}

// Eigene Tipps entscheiden nur, ob die Partienübersicht die echte Verteilung statt des Scheinbalkens zeigt.
async function loadOwnPredictionMatchIds() {
  const requestId = ++ownPredictionRequest;
  const client = window.PadelKonto?.getClient?.() || getSupabaseClient();
  const userId = window.PadelKonto?.getSession?.()?.user?.id || null;
  if (!client || !userId) {
    ownPredictionMatchIds = new Set();
    return;
  }
  const { data, error } = await client.from('predictions').select('match_id');
  if (requestId !== ownPredictionRequest) return;
  if (error) {
    console.warn('Eigene Tipps konnten nicht geladen werden:', error);
    return;
  }
  ownPredictionMatchIds = new Set((data || []).map(row => row.match_id));
}

async function loadActiveSeasonForecasts() {
  if (!selectedSeason?.id || !PADEL_DATA?.matches) return;
  const requestedSeasonId = selectedSeason.id;
  const forecastSummaries = await loadDatabaseMatchForecasts(selectedSeason);
  if (selectedSeason?.id !== requestedSeasonId || PADEL_DATA.id !== requestedSeasonId) return;
  applyMatchForecasts(forecastSummaries);
  invalidateSections(['partien']);
  renderActiveSection();
}

async function loadActiveSeason() {
  await loadDatabaseSeasonOptions();
  selectedSeason = getDefaultSeasonOption();
  if (!selectedSeason) throw new Error('Keine Saison in data/seasons.js gefunden.');
  [PADEL_DATA, publicTrainingFeed, previousLeagueRankingAchievements] = await Promise.all([
    loadSeasonData(selectedSeason),
    loadDatabasePublicTrainingFeed(),
    loadPreviousLeagueRankingAchievements(selectedSeason)
  ]);
}

function updateSeasonPhaseLayout(phase = getSeasonDisplayPhase()) {
  document.body.dataset.seasonPhase = phase;

  const rankingSection = document.getElementById('ranking-profile-main');
  const finalFourRanking = document.getElementById('final-four-ranking-section');
  if (rankingSection && finalFourRanking) {
    const finalFourIsPrimary = ['final-four', 'completed'].includes(phase) && getFinalFourMatches().length === 3;
    if (finalFourIsPrimary) rankingSection.prepend(finalFourRanking);
    else rankingSection.append(finalFourRanking);
  }

  const leagueCalculator = document.getElementById('league-calculator');
  if (leagueCalculator) leagueCalculator.hidden = phase !== 'league';
}

function applySeasonMetadata() {
  const label = PADEL_DATA.label || selectedSeason.label || selectedSeason.id;
  const title = String(PADEL_DATA.title || `PadelLiga ${label}`).replaceAll('Padel-Liga', 'PadelLiga');
  const organizations = PADEL_DATA.organizations || [];
  const organizationLabel = organizations.join('  ×  ');
  const heroOrganizations = document.getElementById('hero-orgs');
  const cupSeason = isCupSeason();
  const displayPhase = getSeasonDisplayPhase();
  const calculatorUnavailable = cupSeason || displayPhase === 'completed';

  document.title = title;
  document.querySelectorAll('[data-season-label]').forEach(element => {
    element.textContent = label;
  });
  if (heroOrganizations) heroOrganizations.textContent = organizationLabel;
  document.body.classList.toggle('is-test-season', Boolean(PADEL_DATA.resultsEntryEnabled));
  document.body.classList.toggle('is-cup-season', cupSeason);

  const heroButton = document.getElementById('hero-home-button');
  if (heroButton) {
    heroButton.innerHTML = cupSeason ? 'PADEL<em>CUP</em>' : 'PADEL<em>LIGA</em>';
    heroButton.dataset.navTarget = cupSeason ? 'partien' : 'start';
    heroButton.setAttribute('aria-label', cupSeason ? 'Zum Turnierbaum' : 'Zur Startseite');
  }
  document.querySelectorAll('nav button[data-section]').forEach(button => {
    button.hidden = (cupSeason && !['partien', 'infos'].includes(button.dataset.section))
      || (button.dataset.section === 'rechner' && calculatorUnavailable);
  });
  document.querySelectorAll('main > .section').forEach(section => {
    section.hidden = (cupSeason && !['partien', 'infos'].includes(section.id))
      || (section.id === 'rechner' && calculatorUnavailable);
  });

  const homeCalculatorLink = document.getElementById('home-calculator-link');
  if (homeCalculatorLink) homeCalculatorLink.hidden = calculatorUnavailable;
  updateSeasonPhaseLayout(displayPhase);

  const matchesNavButton = document.getElementById('partien-nav-button');
  const matchesTitle = document.getElementById('partien-title');
  if (matchesNavButton) matchesNavButton.textContent = cupSeason ? 'Turnierbaum' : 'Partien';
  if (matchesTitle) matchesTitle.textContent = cupSeason ? 'TURNIERBAUM' : 'PARTIEN';

  const viewerPicker = document.getElementById('viewer-picker');
  if (viewerPicker) viewerPicker.hidden = cupSeason;

  const seasonLabel = document.getElementById('season-picker-label');
  const seasonMenu = document.getElementById('season-menu');
  const tippLink = document.getElementById('tipp-link');
  const tippUrl = window.PadelSeasonRouting.getSeasonUrl(selectedSeason.id, 'tipp').href;
  if (tippLink) tippLink.href = tippUrl;
  const homePredictionRankingLink = document.getElementById('home-prediction-ranking-link');
  if (homePredictionRankingLink) {
    const predictionRankingUrl = window.PadelSeasonRouting.getSeasonUrl(selectedSeason.id, 'tipp');
    predictionRankingUrl.hash = 'tippuebersicht';
    homePredictionRankingLink.href = predictionRankingUrl.href;
  }
  window.dispatchEvent(new CustomEvent('padel:season-ready', {
    detail: {
      predictionsEnabled: getCompetitionConfig().predictionsEnabled,
      tippHref: tippLink?.href || 'tipp/'
    }
  }));
  if (seasonLabel && seasonMenu) {
    seasonLabel.textContent = selectedSeason.shortLabel || selectedSeason.label;
    seasonMenu.innerHTML = getSeasonOptions().map(season => `
      <button
        type="button"
        class="season-option ${season.id === selectedSeason.id ? 'active' : ''}"
        role="option"
        aria-selected="${season.id === selectedSeason.id}"
        data-season-id="${season.id}"
      >
        <span>${season.label}</span>
      </button>
    `).join('');
  }
  const sortToggle = document.getElementById('match-sort-toggle');
  const scopeToggle = document.getElementById('match-scope-toggle');
  if (sortToggle) sortToggle.hidden = cupSeason;
  if (scopeToggle) scopeToggle.hidden = cupSeason;

  if (cupSeason) nav('partien', matchesNavButton);
  else if (calculatorUnavailable && document.getElementById('rechner')?.classList.contains('active')) nav('rangliste');
}

function resetSeasonState() {
  selectedViewerId = getStoredViewerId();
  if (!getViewerOptions().some(option => option.id === selectedViewerId)) {
    selectedViewerId = 'sb';
  }
  matchScope = 'all';
  matchSortMode = 'matchday';
  matchSortDescending = false;
  rankingSortMode = 'points';
  rankingViewMode = 'compact';
  allTimeRankingViewMode = 'compact';
  allTimeRankingScope = 'league';
  allTimeRankingSortMode = 'points';
  calculatorResults = new Map();
  finalFourCalculatorResults = new Map();
  activeCalculatorMatchId = null;
  calculatorAutoTip = false;
  statisticsMode = 'season';
  allTimeStatisticsData = null;
  allTimeStatisticsPromise = null;
  statisticsLoadError = '';
  statisticsPlayerFilters = new Map([
    ['season', new Set(PADEL_DATA.players.map(player => player.id))]
  ]);
  chart?.destroy();
  placementChart?.destroy();
  chart = null;
  placementChart = null;
}

async function refreshActiveSeasonView() {
  if (!selectedSeason?.id) return null;
  seasonRefreshRequested = true;
  if (activeSeasonRefreshPromise) return activeSeasonRefreshPromise;

  activeSeasonRefreshPromise = (async () => {
    while (seasonRefreshRequested) {
      seasonRefreshRequested = false;
      const selectedSeasonId = selectedSeason.id;
      await loadDatabaseSeasonOptions();
      selectedSeason = getSeasonOptions().find(season => season.id === selectedSeasonId) || selectedSeason;
      [PADEL_DATA, publicTrainingFeed, previousLeagueRankingAchievements] = await Promise.all([
        loadSeasonData(selectedSeason),
        loadDatabasePublicTrainingFeed(),
        loadPreviousLeagueRankingAchievements(selectedSeason)
      ]);

      calculatorResults = new Map();
      finalFourCalculatorResults = new Map();
      activeCalculatorMatchId = null;
      calculatorAutoTip = false;
      allTimeStatisticsData = null;
      allTimeStatisticsPromise = null;
      playerProfileSeasonPayloadCache.clear();
      statisticsPlayerFilters.set('season', new Set(PADEL_DATA.players.map(player => player.id)));
      statisticsPlayerFilters.delete('all-time');
      if (statisticsMode === 'all-time') {
        try {
          await loadAllTimeStatisticsData();
          statisticsLoadError = '';
        } catch (error) {
          statisticsMode = 'season';
          statisticsLoadError = 'Die All-Time-Statistik konnte nicht aktualisiert werden.';
          console.error(error);
        }
      }
      chart?.destroy();
      placementChart?.destroy();
      chart = null;
      placementChart = null;

      applySeasonMetadata();
      updateViewerPicker();
      invalidateSections();
      renderActiveSection();
      await Promise.all([
        loadActiveSeasonForecasts(),
        refreshHomePredictionLeaderboard()
      ]);
    }
  })().catch(error => {
    console.error('Die Saisonansicht konnte nach dem Ergebnis nicht aktualisiert werden:', error);
  }).finally(() => {
    activeSeasonRefreshPromise = null;
  });

  return activeSeasonRefreshPromise;
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function getViewerOptions() {
  return [
    { id: 'sb', name: 'Spieler auswählen', short: '-/-', mobileLabel: 'Auswählen', menuLabel: 'Auswählen' },
    ...PADEL_DATA.players.map(player => ({
      id: player.id,
      name: player.name,
      short: player.initials,
      profileEmoji: player.profileEmoji
    }))
  ];
}

function getSelectedViewer() {
  return getViewerOptions().find(option => option.id === selectedViewerId) || getViewerOptions()[0];
}

function isParticipantView() {
  return selectedViewerId !== 'sb';
}

window.PadelLigaGetSelectedViewerId = () => isParticipantView() ? selectedViewerId : null;
window.PadelLigaGetSeasonData = () => PADEL_DATA;

// Reihenfolge zum Blättern in der Partiestatistik: Profil und Artikel behalten ihre
// eigene Liste, alle anderen Einstiege folgen dem Spielplan in seiner aktuellen Einstellung.
function getMatchStatisticsIds(container) {
  return [...new Set([...(container?.querySelectorAll('[data-match-statistics]') || [])]
    .map(element => element.dataset.matchStatistics))];
}

function getMatchStatisticsSequence(trigger, matchId) {
  const ownList = trigger?.closest('#player-profile-dialog, .article-card');
  if (ownList) {
    const ids = getMatchStatisticsIds(ownList);
    if (ids.includes(matchId)) return ids;
  }
  if (trigger) {
    ensureSectionRendered('partien');
    const ids = getMatchStatisticsIds(document.getElementById('partien'));
    if (ids.includes(matchId)) return ids;
  }
  // Direkte Links ohne Listenkontext blättern nach Partienummer durch den Spielplan.
  const ids = (PADEL_DATA?.matches || [])
    .filter(match => window.PadelMatchStatistics?.entry(match, PADEL_DATA))
    .sort(compareMatchesByNumber)
    .map(match => match.id);
  return ids.includes(matchId) ? ids : [];
}

window.PadelLigaGetMatchStatisticsSequence = getMatchStatisticsSequence;

function isSelectedPlayer(playerName) {
  return isParticipantView() && getSelectedViewer().name === playerName;
}

function isSelectedViewerFirma(firma) {
  const selectedPlayer = PADEL_DATA.players.find(player => player.id === selectedViewerId);
  return Boolean(selectedPlayer && selectedPlayer.firma === firma);
}

function isViewerMatch(match) {
  return isParticipantView() &&
    [...match.team1.spieler, ...match.team2.spieler].includes(getSelectedViewer().name);
}

function isSelectedTrainingParticipant(participant) {
  return isParticipantView()
    && !participant?.isGuest
    && String(participant?.id || '') === String(selectedViewerId);
}

function isViewerTraining(training) {
  return (training?.participants || []).some(isSelectedTrainingParticipant);
}

function normalizePlayerSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('de-DE');
}

function filterViewerOptions(query = '') {
  const menu = document.getElementById('viewer-menu');
  if (!menu) return;
  const normalizedQuery = normalizePlayerSearch(query);
  let visibleOptions = 0;
  menu.querySelectorAll('[data-viewer-id]').forEach(option => {
    const matches = !normalizedQuery
      || normalizePlayerSearch(option.dataset.viewerSearchText).includes(normalizedQuery);
    option.hidden = !matches;
    if (matches) visibleOptions += 1;
  });
  const emptyState = menu.querySelector('[data-viewer-search-empty]');
  if (emptyState) emptyState.hidden = visibleOptions > 0;
}

function keepViewerSearchVisible(searchInput) {
  if (!searchInput || !isMobileViewport()) return;
  if (searchInput.closest('[data-global-actions]')) return;
  const alignInput = () => {
    if (document.activeElement !== searchInput) return;
    const viewportTop = window.visualViewport?.offsetTop || 0;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const targetOffset = Math.min(200, Math.max(80, viewportHeight * 0.4));
    const scrollDelta = searchInput.getBoundingClientRect().top - viewportTop - targetOffset;
    if (Math.abs(scrollDelta) < 8) return;

    let scrollParent = searchInput.parentElement;
    while (scrollParent && scrollParent !== document.body) {
      const { overflowY } = window.getComputedStyle(scrollParent);
      if (/(auto|scroll|overlay)/.test(overflowY)
        && scrollParent.scrollHeight > scrollParent.clientHeight) break;
      scrollParent = scrollParent.parentElement;
    }

    const scrollTarget = scrollParent && scrollParent !== document.body ? scrollParent : window;
    scrollTarget.scrollBy({ top: scrollDelta, behavior: 'smooth' });
  };

  requestAnimationFrame(alignInput);
  window.setTimeout(alignInput, 350);
}

function toggleViewerMenu() {
  const picker = document.getElementById('viewer-picker');
  const isOpen = picker.classList.toggle('open');
  const toggle = picker.querySelector('[data-viewer-toggle]');
  const searchInput = picker.querySelector('[data-viewer-search]');
  toggle.setAttribute('aria-expanded', String(isOpen));
  searchInput?.setAttribute('aria-expanded', String(isOpen));
  if (isOpen) {
    searchInput.disabled = false;
    searchInput.value = '';
    filterViewerOptions();
    searchInput.focus({ preventScroll: true });
    keepViewerSearchVisible(searchInput);
  } else {
    closeViewerMenu();
  }
  closeSeasonMenu();
}

function closeViewerMenu() {
  const picker = document.getElementById('viewer-picker');
  if (!picker) return;
  picker.classList.remove('open');
  picker.querySelector('[data-viewer-toggle]')?.setAttribute('aria-expanded', 'false');
  const searchInput = picker.querySelector('[data-viewer-search]');
  if (searchInput) {
    searchInput.value = '';
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.blur();
    searchInput.disabled = true;
  }
  filterViewerOptions();
}

function toggleSeasonMenu() {
  const picker = document.getElementById('season-picker');
  if (!picker) return;
  const isOpen = picker.classList.toggle('open');
  picker.querySelector('[data-season-toggle]')?.setAttribute('aria-expanded', String(isOpen));
  closeViewerMenu();
}

function closeSeasonMenu() {
  const picker = document.getElementById('season-picker');
  if (!picker) return;
  picker.classList.remove('open');
  picker.querySelector('[data-season-toggle]')?.setAttribute('aria-expanded', 'false');
}

function closeSeasonDetailViews() {
  if (window.PadelMatchStatistics?.active) window.PadelMatchStatistics.restore();
  window.PadelLiveTicker?.close();
  const detailDialog = document.getElementById('detail-view-dialog');
  if (detailDialog?.open) detailDialog.close();
  if (document.getElementById('player-profile-dialog')?.open) {
    closePlayerProfile({ immediate: true, restoreFocus: false, fromHistory: true });
  }
}

function selectSeason(id) {
  if (id === selectedSeason?.id) {
    closeSeasonMenu();
    return;
  }
  closeSeasonDetailViews();
  const url = window.PadelSeasonRouting.getSeasonUrl(id, 'league', {
    preserveSearch: true,
    preserveHash: true,
    clearDetails: true
  });
  window.location.assign(url);
}

function selectViewer(id) {
  const picker = document.getElementById('viewer-picker');
  const restoreToggleFocus = picker?.classList.contains('open');
  selectedViewerId = id;
  storeViewerId(selectedViewerId);
  closeViewerMenu();
  if (!isParticipantView() && matchScope === 'mine') matchScope = 'all';
  updateViewerPicker();
  updateChartViewerFocus();
  invalidateSections(['start', 'rangliste', 'partien', 'rechner', 'verlauf']);
  renderActiveSection();
  if (restoreToggleFocus) {
    if (picker.closest('[data-global-actions]')) {
      window.PadelGlobalActions?.close({ restoreFocus: true });
    } else {
      picker.querySelector('[data-viewer-toggle]')?.focus({ preventScroll: true });
    }
  }
}

function updateViewerProfileImage(playerId = '', profileEmoji = '👤') {
  const image = document.getElementById('viewer-profile-image');
  const emoji = document.getElementById('viewer-profile-emoji');
  if (!image || !emoji) return;

  image.onload = null;
  image.onerror = null;
  image.hidden = true;
  image.removeAttribute('src');
  emoji.textContent = ['👨', '👩'].includes(profileEmoji) ? profileEmoji : '👤';
  emoji.removeAttribute('hidden');
  image.dataset.playerId = playerId;
  if (!playerId) return;

  image.onload = () => {
    if (image.dataset.playerId !== playerId) return;
    image.hidden = false;
    emoji.setAttribute('hidden', '');
  };
  image.onerror = () => {
    if (image.dataset.playerId !== playerId) return;
    image.hidden = true;
    emoji.removeAttribute('hidden');
  };
  image.src = `assets/players/${encodeURIComponent(playerId)}/profile.webp`;
}

function updateViewerPicker() {
  const selected = getSelectedViewer();
  const profileButton = document.getElementById('viewer-profile-button');
  const hasSelectedPlayer = isParticipantView();
  document.getElementById('viewer-label-full').textContent = selected.name;
  document.getElementById('viewer-label-short').textContent = selected.mobileLabel || selected.short;
  document.getElementById('viewer-picker').classList.toggle('viewer-picker--empty', selected.id === 'sb');
  profileButton.disabled = !hasSelectedPlayer;
  profileButton.toggleAttribute('data-player-profile-id', hasSelectedPlayer);
  if (hasSelectedPlayer) profileButton.dataset.playerProfileId = selected.id;
  const profileLabel = hasSelectedPlayer
    ? `Profil von ${selected.name} öffnen`
    : 'Spielerprofil öffnen';
  profileButton.setAttribute('aria-label', profileLabel);
  profileButton.title = profileLabel;
  updateViewerProfileImage(
    hasSelectedPlayer ? selected.id : '',
    hasSelectedPlayer ? selected.profileEmoji : '👤'
  );
  document.getElementById('viewer-menu').innerHTML = getViewerOptions().map(option => `
    <button
      type="button"
      class="viewer-option ${option.id === selectedViewerId ? 'active' : ''}"
      role="option"
      aria-selected="${option.id === selectedViewerId}"
      data-viewer-id="${option.id}"
      data-viewer-search-text="${escapeHtml(option.name)} ${escapeHtml(option.short)}"
    >
      <span>${option.menuLabel || option.name}</span>
      <span>${option.short}</span>
    </button>
  `).join('') + '<div class="picker-search-empty" data-viewer-search-empty hidden>Kein Spieler gefunden.</div>';
  updatePlayerProfileRankingHighlights();
}

function setAuthenticatedPlayer(playerId = null) {
  const isSeasonParticipant = Boolean(playerId && PADEL_DATA?.players.some(player => player.id === playerId));
  if (isSeasonParticipant && playerId !== selectedViewerId) selectViewer(playerId);
}

window.PadelLigaSetAuthenticatedPlayer = setAuthenticatedPlayer;
window.addEventListener('padel:authenticated-player', event => {
  setAuthenticatedPlayer(event.detail?.playerId || null);
});
window.addEventListener('padel:official-result-changed', () => {
  invalidatePlayerProfileCache();
  void refreshActiveSeasonView();
});
window.addEventListener('padel:profile-data-changed', invalidatePlayerProfileCache);
window.addEventListener('padel:live-status-changed', () => {
  invalidateSections(['start', 'partien']);
  renderActiveSection();
  if (playerProfileData) renderPlayerProfileHistory();
});
window.addEventListener('padel:auth-state-changed', async () => {
  await loadOwnPredictionMatchIds();
  if (!PADEL_DATA?.matches) return;
  invalidateSections(['start', 'partien']);
  renderActiveSection();
});
window.addEventListener('padel:match-forecast-changed', event => {
  const forecast = event.detail?.forecast;
  const match = forecast?.matchId && PADEL_DATA?.matches?.find(item => item.id === forecast.matchId);
  if (!match) return;
  if (forecast.userPrediction) ownPredictionMatchIds.add(match.id);
  match.forecast = forecast;
  invalidateSections(['partien']);
  renderActiveSection();
});

function invalidatePlayerProfileCache() {
  playerProfileCache.clear();
  playerProfileSeasonPayloadCache.clear();
  playerProfileCompareElos.clear();
}

function isMissingPlayerProfileRpc(error) {
  return error?.code === 'PGRST202'
    || /get_player_profile/i.test(String(error?.message || ''));
}

function getProfilePlayerTeam(match, playerId, playerName) {
  if (match.team1?.playerIds?.includes(playerId) || match.team1?.spieler?.includes(playerName)) return 1;
  if (match.team2?.playerIds?.includes(playerId) || match.team2?.spieler?.includes(playerName)) return 2;
  return null;
}

function getProfileRegularGameTotals(resultDetails) {
  const resultWithoutSetTiebreaks = String(resultDetails || '').replace(/\([^)]*\)/g, '');
  return [...resultWithoutSetTiebreaks.matchAll(/(\d+)\s*:\s*(\d+)/g)]
    .map(score => [Number(score[1]), Number(score[2])])
    .filter(([teamOne, teamTwo]) => teamOne <= 7 && teamTwo <= 7)
    .reduce((totals, [teamOne, teamTwo]) => [totals[0] + teamOne, totals[1] + teamTwo], [0, 0]);
}

function getPlayerProfileSeasonPayload(seasonId) {
  const publicId = normalizeSeasonId(seasonId);
  if (PADEL_DATA?.id === publicId) return Promise.resolve(PADEL_DATA);
  const cached = playerProfileSeasonPayloadCache.get(publicId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const entry = { expiresAt: Date.now() + PLAYER_PROFILE_CACHE_TTL };
  const request = loadDatabaseSeasonPayload(seasonId).catch(error => {
    if (playerProfileSeasonPayloadCache.get(publicId) === entry) playerProfileSeasonPayloadCache.delete(publicId);
    throw error;
  });
  entry.promise = request;
  playerProfileSeasonPayloadCache.set(publicId, entry);
  return request;
}

function getPlayerProfileSeasonMatchTeam(match, playerId) {
  const teamOneIds = match.team1?.playerIds || [];
  const teamTwoIds = match.team2?.playerIds || [];
  if (teamOneIds.includes(playerId)) return 1;
  if (teamTwoIds.includes(playerId)) return 2;
  return null;
}

function getPlayerProfileSeasonMatchWinner(match) {
  return match.winner ?? match.sieger ?? null;
}

function getPlayerProfileSeasonMatchResult(match) {
  return match.result ?? match.ergebnis ?? null;
}

function getPlayerProfileFinalFourRanking(matches = [], leagueRanks = null) {
  const finalFourMatches = matches
    .filter(match => getMatchStage(match) === 'final-four')
    .sort((left, right) =>
      Number(left.matchday ?? left.spieltag ?? 0) - Number(right.matchday ?? right.spieltag ?? 0)
      || String(left.id).localeCompare(String(right.id)));
  if (finalFourMatches.length !== 3
    || finalFourMatches.some(match => getPlayerProfileSeasonMatchWinner(match) === null)) return [];

  const seededPlayerIds = [...new Set(finalFourMatches.flatMap(match => [
    ...(match.team1?.playerIds || []),
    ...(match.team2?.playerIds || [])
  ]))];
  return seededPlayerIds.map((playerId, seedIndex) => {
    const stats = finalFourMatches.reduce((total, match) => {
      const team = getPlayerProfileSeasonMatchTeam(match, playerId);
      if (!team) return total;
      const [teamOneGames, teamTwoGames] = getProfileRegularGameTotals(
        getPlayerProfileSeasonMatchResult(match)
      );
      const gamesFor = team === 1 ? teamOneGames : teamTwoGames;
      const gamesAgainst = team === 1 ? teamTwoGames : teamOneGames;
      total.wins += getPlayerProfileSeasonMatchWinner(match) === team ? 1 : 0;
      total.gamesWon += gamesFor;
      total.gameDiff += gamesFor - gamesAgainst;
      return total;
    }, { wins: 0, gamesWon: 0, gameDiff: 0 });
    return { playerId, seed: leagueRanks?.get(playerId) || seedIndex + 1, ...stats };
  }).sort((left, right) =>
    right.wins - left.wins
    || right.gameDiff - left.gameDiff
    || right.gamesWon - left.gamesWon
    || left.seed - right.seed);
}

function getPlayerProfileFinalRoundOverview(seasonPayload, playerId) {
  const seasonMatches = seasonPayload?.matches || [];
  const playerMatches = seasonMatches.filter(match => {
    const stage = getMatchStage(match);
    return ['semifinal', 'final-four'].includes(stage)
      && getPlayerProfileSeasonMatchTeam(match, playerId);
  });
  if (!playerMatches.length) return null;

  const hasFinalFour = playerMatches.some(match => getMatchStage(match) === 'final-four');
  const leagueRanks = typeof PADEL_DATA !== 'undefined'
    && PADEL_DATA && seasonPayload?.id === PADEL_DATA.id
    ? new Map(getRankedPlayers(PADEL_DATA.matches).map((player, index) => [player.id, index + 1]))
    : null;
  const ranking = hasFinalFour ? getPlayerProfileFinalFourRanking(seasonMatches, leagueRanks) : [];
  const placement = ranking.findIndex(entry => entry.playerId === playerId) + 1;
  const stats = playerMatches.reduce((total, match) => {
    const winner = getPlayerProfileSeasonMatchWinner(match);
    const result = getPlayerProfileSeasonMatchResult(match);
    if (winner === null || !result) return total;
    const stage = getMatchStage(match);
    const matchWeight = stage === 'final-four' ? 0.5 : 1;
    const team = getPlayerProfileSeasonMatchTeam(match, playerId);
    const [teamOneGames, teamTwoGames] = getProfileRegularGameTotals(result);
    const teamOneGameDiff = teamOneGames - teamTwoGames;
    total.matches += matchWeight;
    total.wins += winner === team ? matchWeight : 0;
    total.gameDiff += team === 2 ? -teamOneGameDiff : teamOneGameDiff;
    return total;
  }, { matches: 0, wins: 0, gameDiff: 0 });

  return {
    ...stats,
    label: placement > 0 ? String(placement) : hasFinalFour ? 'F4' : 'HF',
    placement: placement || null,
    stage: hasFinalFour ? 'final-four' : 'semifinal'
  };
}

function isPlayerProfileParticipationActive(participation, seasonPayload) {
  return Boolean(participation?.isActive && !seasonPayload?.completedAt);
}

async function enrichPlayerProfileSeasonPhases(profile) {
  const participations = profile?.participations || [];
  const playerId = profile?.identity?.id;
  if (!playerId || !participations.length) return profile;

  const payloads = await Promise.all(participations.map(participation =>
    getPlayerProfileSeasonPayload(participation.seasonId)));
  return {
    ...profile,
    participations: participations.map((participation, index) => ({
      ...participation,
      isActive: isPlayerProfileParticipationActive(participation, payloads[index]),
      finalRound: getPlayerProfileFinalRoundOverview(payloads[index], playerId)
    }))
  };
}

function getLocalPlayerProfile(playerId) {
  const player = (PADEL_DATA?.allPlayers || PADEL_DATA?.players || []).find(item => item.id === playerId)
    || (window.PADEL_PLAYERS || []).find(item => item.id === playerId);
  if (!player) return null;

  const profileSeasonEnabled = selectedSeason?.id !== '2026-test';
  const matches = profileSeasonEnabled
    ? (PADEL_DATA?.allMatches || PADEL_DATA?.matches || [])
      .filter(match => (match.sieger !== null || isCancelledMatch(match))
        && getProfilePlayerTeam(match, player.id, player.name))
      .map(match => {
        const team = getProfilePlayerTeam(match, player.id, player.name);
        const ownTeam = team === 1 ? match.team1.spieler : match.team2.spieler;
        const opponents = team === 1 ? match.team2.spieler : match.team1.spieler;
        const kind = getMatchStage(match) === 'final-four' ? 'final-four' : 'league';
        const isCancelled = isCancelledMatch(match);
        return {
          id: match.id,
          kind,
          matchWeight: isCancelled ? 0 : kind === 'final-four' ? 0.5 : 1,
          date: isCancelled ? null : toDateKey(match.datum),
          sortDate: isCancelled ? getMatchdayInfo(match.spieltag)?.startDate || null : toDateKey(match.datum),
          seasonId: selectedSeason.id,
          seasonLabel: PADEL_DATA.label || selectedSeason.label,
          resultDetails: isCancelled ? null : match.ergebnis,
          team,
          outcome: isCancelled ? 'unfinished' : match.sieger === team ? 'win' : 'loss',
          isComplete: !isCancelled,
          isCancelled,
          partnerNames: ownTeam.filter(name => name !== player.name),
          opponentNames: opponents
        };
      })
    : [];

  let gamesFor = 0;
  let gamesAgainst = 0;
  matches.forEach(profileMatch => {
    const match = (PADEL_DATA?.allMatches || PADEL_DATA?.matches || []).find(item => item.id === profileMatch.id);
    const [teamOneGames, teamTwoGames] = getProfileRegularGameTotals(match?.ergebnis);
    gamesFor += profileMatch.team === 1 ? teamOneGames : teamTwoGames;
    gamesAgainst += profileMatch.team === 1 ? teamTwoGames : teamOneGames;
  });

  const history = profileSeasonEnabled
    ? (player.history || []).filter(item => Number.isFinite(Number(item.elo)))
    : [];
  const eloSeries = history.map(item => ({
    date: toDateKey(item.date),
    label: item.label || item.partie || '',
    elo: Number(item.elo),
    seasonId: selectedSeason?.id,
    seasonLabel: PADEL_DATA?.label || selectedSeason?.label
  }));
  const eloValues = eloSeries.map(item => item.elo);
  const weightedMatchCount = matches.reduce((total, match) => total + Number(match.matchWeight || 0), 0);
  const weightedWinCount = matches.reduce((total, match) =>
    total + (match.outcome === 'win' ? Number(match.matchWeight || 0) : 0), 0);
  const weightedLossCount = matches.reduce((total, match) =>
    total + (match.outcome === 'loss' ? Number(match.matchWeight || 0) : 0), 0);
  const rankedPlayers = profileSeasonEnabled ? getRankedPlayers(PADEL_DATA.matches) : [];
  const rankedPlayer = rankedPlayers.find(item => item.id === player.id);
  const participation = rankedPlayer ? [{
    seasonId: selectedSeason.id,
    seasonLabel: PADEL_DATA.label || selectedSeason.label,
    isActive: Boolean(selectedSeason.default && !(PADEL_DATA?.completedAt || selectedSeason.completedAt)),
    rank: rankedPlayers.findIndex(item => item.id === player.id) + 1,
    matches: rankedPlayer.stats.partien,
    wins: rankedPlayer.stats.siege,
    losses: rankedPlayer.stats.partien - rankedPlayer.stats.siege,
    points: rankedPlayer.stats.punkte,
    gameDiff: rankedPlayer.stats.spielDiff
  }] : [];

  return {
    identity: {
      id: player.id,
      displayName: player.name,
      initials: player.initials,
      company: player.firma,
      profileEmoji: player.profileEmoji
    },
    summary: {
      currentElo: eloValues.length ? eloValues[eloValues.length - 1] : null,
      peakElo: eloValues.length ? Math.max(...eloValues) : null,
      matches: weightedMatchCount,
      wins: weightedWinCount,
      losses: weightedLossCount,
      gamesFor,
      gamesAgainst,
      gameDiff: gamesFor - gamesAgainst
    },
    eloSeries,
    participations: participation,
    achievements: [],
    matches: matches.sort((a, b) => String(b.sortDate || b.date || '').localeCompare(String(a.sortDate || a.date || ''))),
    source: 'local-fallback'
  };
}

function fetchPlayerProfile(playerId) {
  const cached = playerProfileCache.get(playerId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const entry = { expiresAt: Date.now() + PLAYER_PROFILE_CACHE_TTL };
  entry.promise = loadPlayerProfile(playerId)
    .then(data => {
      entry.data = data;
      return data;
    })
    .catch(error => {
      if (playerProfileCache.get(playerId) === entry) playerProfileCache.delete(playerId);
      throw error;
    });
  playerProfileCache.set(playerId, entry);
  return entry.promise;
}

function getCachedPlayerProfile(playerId) {
  const cached = playerProfileCache.get(playerId);
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached.data || null;
}

async function loadPlayerProfile(playerId) {
  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client.rpc('get_player_profile', { p_player_id: playerId });
    if (!error && data) return enrichPlayerProfileSeasonPhases(data);
    if (error && !isMissingPlayerProfileRpc(error)) throw error;
  }

  return enrichPlayerProfileSeasonPhases(getLocalPlayerProfile(playerId));
}

function setPlayerProfileState(message, { error = false } = {}) {
  const state = document.getElementById('player-profile-state');
  const content = document.getElementById('player-profile-content');
  if (!state || !content) return;
  state.textContent = message;
  state.classList.toggle('error', error);
  state.hidden = false;
  content.hidden = true;
}

function configurePlayerProfileImage(image, placeholder, path, alt, profileEmoji) {
  if (!image || !placeholder) return;
  image.hidden = true;
  image.alt = alt;
  placeholder.textContent = ['👨', '👩'].includes(profileEmoji) ? profileEmoji : '👤';
  placeholder.hidden = false;
  image.onload = () => {
    image.hidden = false;
    placeholder.hidden = true;
  };
  image.onerror = () => {
    image.hidden = true;
    placeholder.hidden = false;
  };
  image.src = path;
}

function formatProfileSignedValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number > 0 ? `+${number}` : String(number);
}

function getPlayerProfileSignedValueClass(value) {
  const number = Number(value);
  if (number > 0) return 'positive';
  if (number < 0) return 'negative';
  return '';
}

function formatProfileMatchCount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('de-DE', {
    minimumFractionDigits: Number.isInteger(number) ? 0 : 1,
    maximumFractionDigits: 1
  });
}

function renderProfileMatchCount(value) {
  const formatted = formatProfileMatchCount(value);
  const match = formatted.match(/^(.*)(,5)$/);
  return match
    ? `${escapeHtml(match[1])}<span class="player-profile-stat-fraction">${escapeHtml(match[2])}</span>`
    : escapeHtml(formatted);
}

function formatProfileWinRate(wins, matches) {
  const winCount = Number(wins);
  const matchCount = Number(matches);
  if (!Number.isFinite(winCount) || !Number.isFinite(matchCount) || matchCount <= 0) return '—';
  return `${Math.round((winCount / matchCount) * 100)} %`;
}

function formatProfileGameDiffPerMatch(gameDiff, matches) {
  const difference = Number(gameDiff);
  const matchCount = Number(matches);
  if (!Number.isFinite(difference) || !Number.isFinite(matchCount) || matchCount <= 0) return '—';
  const average = difference / matchCount;
  const formatted = average.toLocaleString('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
  return average > 0 ? `+${formatted}` : formatted;
}

function getLongestPlayerProfileWinStreak(matches = []) {
  let longest = 0;
  let current = 0;
  matches.forEach(match => {
    if (match.kind === 'training' || match.isCancelled || match.isComplete === false) return;
    if (match.outcome === 'win') {
      current += 1;
      longest = Math.max(longest, current);
    } else if (match.outcome === 'loss') {
      current = 0;
    }
  });
  return longest;
}

function renderPlayerProfileWinStreak(matches = []) {
  const longest = getLongestPlayerProfileWinStreak(matches);
  if (longest < 1) return '—';
  return `${longest}<span class="player-profile-stat-fraction"> ${longest === 1 ? 'Sieg' : 'Siege'}</span>`;
}

function getPlayerProfileAchievementHighlights(achievements = []) {
  const kindOrder = { winner: 0, final_four: 1, finalist: 1, custom: 2 };
  return [...achievements]
    .sort((left, right) =>
      (kindOrder[left.kind] ?? 3) - (kindOrder[right.kind] ?? 3)
      || String(right.achievedOn || '').localeCompare(String(left.achievedOn || ''))
    )
    .slice(0, PLAYER_PROFILE_ACHIEVEMENT_LIMIT);
}

function getSeasonVisualTheme(seasonId, seasons = getSeasonOptions()) {
  const normalizedId = normalizeSeasonId(seasonId);
  return seasons.find(season => normalizeSeasonId(season.id) === normalizedId)?.visualTheme || 'neutral';
}

function getThemeValue(variableName) {
  if (!themeValueCache.has(variableName)) {
    themeValueCache.set(variableName, getComputedStyle(document.documentElement).getPropertyValue(variableName).trim());
  }
  return themeValueCache.get(variableName);
}

function applyThemeToChartScale(scale) {
  scale.grid.color = getThemeValue('--border');
  scale.ticks.color = getThemeValue('--muted');
  scale.ticks.font.family = getThemeValue('--font-body');
  if (!scale.title?.display) return;
  scale.title.color = getThemeValue('--dim');
  scale.title.font.family = getThemeValue('--font-body');
}

// Diagramme übernehmen Branding-Werte beim Erstellen und folgen einem Wechsel daher nicht von selbst.
function refreshThemeDependentCharts() {
  themeValueCache.clear();
  const getLiveCharts = () => [chart, placementChart].filter(instance => instance?.ctx);
  getLiveCharts().forEach(instance => {
    ['x', 'y'].forEach(scaleId => applyThemeToChartScale(instance.options.scales[scaleId]));
  });
  if (chart?.ctx) {
    updateEloChartFocus();
    renderFilter();
  }
  if (placementChart?.ctx) updatePlacementChartFocus();
  // Die Schrift eines neuen Brandings lädt erst beim Zeichnen; danach stimmen auch die Achsenbeschriftungen.
  document.fonts?.ready.then(() => getLiveCharts().forEach(instance => instance.update('none')));

  if (!playerProfileData || !document.getElementById('player-profile-dialog')?.open) return;
  renderPlayerProfileParticipations(playerProfileData.participations || [], playerProfileData.matches || []);
  renderPlayerProfileEloChart(playerProfileData.eloSeries || []);
}

function getDefaultProfileSeasonColor() {
  return getThemeValue(PROFILE_SEASON_COLOR_VARIABLES.neutral);
}

function getPlayerProfileSeasonColor(seasonId, seasons = getSeasonOptions()) {
  const variableName = PROFILE_SEASON_COLOR_VARIABLES[getSeasonVisualTheme(seasonId, seasons)];
  return variableName ? getThemeValue(variableName) : getDefaultProfileSeasonColor();
}

function getPlayerProfileAchievementContext(achievement, seasons = getSeasonOptions()) {
  return getSeasonVisualTheme(achievement?.seasonId, seasons) === 'cup' ? 'cup' : 'league';
}

function renderPlayerProfileAchievements(achievements = []) {
  const target = document.getElementById('player-profile-achievements');
  if (!target) return;
  const highlights = getPlayerProfileAchievementHighlights(achievements);
  target.hidden = highlights.length === 0;
  target.innerHTML = highlights.map(achievement => {
    const kind = achievement.kind === 'winner'
      ? 'winner'
      : achievement.kind === 'final_four'
        ? 'final-four'
        : achievement.kind === 'finalist' ? 'finalist' : 'custom';
    const title = kind === 'winner'
      ? 'Champion'
      : kind === 'final-four' ? 'Final 4'
        : kind === 'finalist' ? 'Finale' : achievement.title;
    const context = getPlayerProfileAchievementContext(achievement);
    return `
    <div class="player-profile-achievement player-profile-achievement-${kind} player-profile-achievement-${context}">
      <svg class="player-profile-achievement-laurel" aria-hidden="true" focusable="false">
        <use href="#achievement-laurel-left"></use>
      </svg>
      <div class="player-profile-achievement-copy">
        <div class="player-profile-achievement-title">${escapeHtml(title)}</div>
        ${achievement.subtitle ? `<div class="player-profile-achievement-subtitle">${escapeHtml(String(achievement.subtitle).replaceAll('Padel-Liga', 'PadelLiga'))}</div>` : ''}
      </div>
      <svg class="player-profile-achievement-laurel" aria-hidden="true" focusable="false">
        <use href="#achievement-laurel-right"></use>
      </svg>
    </div>
  `;
  }).join('');
}

function renderPlayerProfileStats(summary = {}, matches = []) {
  const target = document.getElementById('player-profile-stats');
  if (!target) return;
  const gameDiffPerMatch = Number(summary.matches) > 0
    ? Number(summary.gameDiff) / Number(summary.matches)
    : null;
  const stats = [
    [summary.currentElo ?? '—', `Elo · Peak ${summary.peakElo ?? '—'}`],
    [formatProfileWinRate(summary.wins, summary.matches), 'Siegquote'],
    [renderProfileMatchCount(summary.matches), 'Partien', '', true],
    [`${renderProfileMatchCount(summary.wins)}:${renderProfileMatchCount(summary.losses)}`, 'Partien G:V', '', true],
    [`${summary.gamesFor ?? 0}:${summary.gamesAgainst ?? 0}`, 'Spiele G:V'],
    [`${escapeHtml(formatProfileSignedValue(summary.gameDiff))}<span class="player-profile-stat-fraction player-profile-stat-symbol"> Ω</span>`, 'Spieldifferenz', getPlayerProfileSignedValueClass(summary.gameDiff), true],
    [`${escapeHtml(formatProfileGameDiffPerMatch(summary.gameDiff, summary.matches))}<span class="player-profile-stat-fraction player-profile-stat-symbol"> Ø</span>`, 'Spieldifferenz', getPlayerProfileSignedValueClass(gameDiffPerMatch), true],
    [renderPlayerProfileWinStreak(matches), 'Längste Serie', '', true]
  ];
  target.innerHTML = stats.map(([value, label, valueClass = '', valueIsHtml = false]) => `
    <div class="player-profile-stat">
      <div class="player-profile-stat-value ${valueClass}">${valueIsHtml ? value : escapeHtml(value)}</div>
      <div class="stat-meta-line">${escapeHtml(label)}</div>
    </div>
  `).join('');
}

function getPlayerProfileEloTicks(min, max) {
  const step = [50, 100, 200, 250, 500].find(candidate => (max - min) / candidate <= 8) || 1000;
  const ticks = [];
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) ticks.push(value);
  return ticks;
}

function getPlayerProfileDateTickIndexes(count, limit) {
  const tickCount = Math.min(count, Math.max(2, limit));
  if (tickCount <= 1) return [0];
  return [...new Set(Array.from({ length: tickCount }, (_, index) => Math.round(index * (count - 1) / (tickCount - 1))))];
}

function getPlayerProfileControlPoints(points, tension = 0.2) {
  return points.map((point, index) => {
    const previous = points[index - 1] || point;
    const next = points[index + 1] || point;
    const previousDistance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const nextDistance = Math.hypot(next.x - point.x, next.y - point.y);
    const totalDistance = previousDistance + nextDistance || 1;
    const previousFactor = tension * previousDistance / totalDistance;
    const nextFactor = tension * nextDistance / totalDistance;
    return {
      previous: { x: point.x - previousFactor * (next.x - previous.x), y: point.y - previousFactor * (next.y - previous.y) },
      next: { x: point.x + nextFactor * (next.x - previous.x), y: point.y + nextFactor * (next.y - previous.y) }
    };
  });
}

function renderPlayerProfileEloSegments(points, colors) {
  const controls = getPlayerProfileControlPoints(points);
  const gradients = [];
  const paths = points.slice(1).map((end, index) => {
    const start = points[index];
    const startColor = colors[index] || getDefaultProfileSeasonColor();
    const endColor = colors[index + 1] || startColor;
    let stroke = startColor;
    if (startColor !== endColor && start.x !== end.x) {
      const gradientId = `player-profile-elo-gradient-${index}`;
      gradients.push(`<linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="${start.x}" y1="0" x2="${end.x}" y2="0"><stop offset="0" stop-color="${startColor}"/><stop offset="1" stop-color="${endColor}"/></linearGradient>`);
      stroke = `url(#${gradientId})`;
    }
    const { next } = controls[index];
    const { previous } = controls[index + 1];
    return `<path class="player-profile-elo-line" stroke="${stroke}" d="M${start.x},${start.y} C${next.x},${next.y} ${previous.x},${previous.y} ${end.x},${end.y}"/>`;
  });
  return { defs: gradients.join(''), paths: paths.join('') };
}

function showPlayerProfileEloTooltip(svg, point) {
  const chartHost = { canvas: svg };
  const tooltipEl = getOrCreateChartTooltip(chartHost, 'player-profile-chart-tooltip');
  tooltipEl.innerHTML = `
    ${point.label ? `<div class="elo-tooltip-title">${escapeHtml(point.label)}</div>` : ''}
    ${renderEloStyleTooltipItem({
      playerName: point.seasonLabel,
      elo: point.elo
    })}
  `;
  positionChartTooltip(chartHost, { caretX: point.x, caretY: point.y }, tooltipEl);
}

function hidePlayerProfileEloTooltip(svg) {
  const tooltipEl = svg?.parentNode?.querySelector('.chart-custom-tooltip.player-profile-chart-tooltip');
  if (tooltipEl) tooltipEl.style.opacity = 0;
}

function drawPlayerProfileEloChart(svg, { labels, values, colors, seasonLabels }) {
  const width = svg.parentNode?.clientWidth || 0;
  const height = svg.parentNode?.clientHeight || 0;
  if (!width || !height) return [];

  const plot = { left: 44, right: width - 30, top: 10, bottom: height - 28 };
  const minElo = Math.max(0, Math.floor((Math.min(...values) - 60) / 50) * 50);
  const maxElo = Math.ceil((Math.max(...values) + 60) / 50) * 50;
  const x = index => values.length === 1
    ? (plot.left + plot.right) / 2
    : plot.left + index * (plot.right - plot.left) / (values.length - 1);
  const y = value => plot.top + (maxElo - value) * (plot.bottom - plot.top) / (maxElo - minElo);
  const points = values.map((elo, index) => ({
    x: Math.round(x(index) * 10) / 10,
    y: Math.round(y(elo) * 10) / 10,
    elo,
    label: labels[index],
    seasonLabel: seasonLabels[index]
  }));

  const yGrid = getPlayerProfileEloTicks(minElo, maxElo).map(value => `
    <line class="player-profile-elo-grid" x1="${plot.left}" x2="${plot.right}" y1="${y(value)}" y2="${y(value)}"/>
    <text class="player-profile-elo-axis-label" x="${plot.left - 8}" y="${y(value)}" text-anchor="end" dominant-baseline="middle">${value}</text>
  `).join('');
  const xGrid = getPlayerProfileDateTickIndexes(values.length, Math.floor((plot.right - plot.left) / 70)).map(index => `
    <line class="player-profile-elo-grid" x1="${points[index].x}" x2="${points[index].x}" y1="${plot.top}" y2="${plot.bottom}"/>
    <text class="player-profile-elo-axis-label" x="${points[index].x}" y="${plot.bottom + 18}" text-anchor="middle">${escapeHtml(labels[index])}</text>
  `).join('');
  const segments = renderPlayerProfileEloSegments(points, colors);
  const dots = points.map((point, index) => `
    <g class="player-profile-elo-point" data-elo-index="${index}">
      <circle class="player-profile-elo-hit" cx="${point.x}" cy="${point.y}" r="10"/>
      <circle class="player-profile-elo-dot" cx="${point.x}" cy="${point.y}" r="4" fill="${colors[index]}"/>
    </g>
  `).join('');

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `<defs>${segments.defs}</defs>${yGrid}${xGrid}${segments.paths}${dots}`;
  return points;
}

function renderPlayerProfileEloChart(eloSeries = []) {
  const svg = document.getElementById('player-profile-elo-chart');
  const range = document.getElementById('player-profile-elo-range');
  const legend = document.getElementById('player-profile-chart-legend');
  playerProfileChart?.destroy();
  playerProfileChart = null;
  if (!svg || !range || !legend) return;

  const series = eloSeries
    .filter(item => ['initial', 'match', undefined].includes(item.eventType) && Number.isFinite(Number(item.elo)))
    .sort((a, b) => String(a.matchAt || a.date || '').localeCompare(String(b.matchAt || b.date || '')));
  if (!series.length) {
    range.textContent = 'Keine Elo-Daten';
    legend.innerHTML = '';
    return;
  }

  const seasons = [...new Map(series.map(item => [item.seasonId, item.seasonLabel || item.seasonId])).entries()];
  const labels = series.map(item => formatProfileDate(item.matchAt || item.date));
  const values = series.map(item => Number(item.elo));
  range.textContent = `${values[0]} → ${values[values.length - 1]}`;
  legend.innerHTML = seasons.map(([seasonId, seasonLabel]) => `
    <span style="--profile-season-color:${getPlayerProfileSeasonColor(seasonId)}"><i></i>${escapeHtml(seasonLabel || seasonId)}</span>
  `).join('');

  const seasonColors = new Map(seasons.map(([seasonId]) => [seasonId, getPlayerProfileSeasonColor(seasonId)]));
  const chartData = {
    labels,
    values,
    colors: series.map(item => seasonColors.get(item.seasonId) || getDefaultProfileSeasonColor()),
    seasonLabels: series.map(item => item.seasonLabel || item.seasonId || 'Elo')
  };
  let points = [];
  const draw = () => {
    hidePlayerProfileEloTooltip(svg);
    points = drawPlayerProfileEloChart(svg, chartData);
  };
  const showPoint = event => {
    const point = points[Number(event.target.closest?.('[data-elo-index]')?.dataset.eloIndex)];
    if (point) showPlayerProfileEloTooltip(svg, point);
    else hidePlayerProfileEloTooltip(svg);
  };
  const hidePoint = () => hidePlayerProfileEloTooltip(svg);
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;

  svg.setAttribute('aria-label', `Elo-Verlauf von ${values[0]} auf ${values[values.length - 1]}`);
  svg.addEventListener('pointerover', showPoint);
  svg.addEventListener('pointerdown', showPoint);
  svg.addEventListener('pointerleave', hidePoint);
  resizeObserver?.observe(svg.parentNode);
  draw();
  playerProfileChart = {
    resize: draw,
    destroy() {
      resizeObserver?.disconnect();
      svg.removeEventListener('pointerover', showPoint);
      svg.removeEventListener('pointerdown', showPoint);
      svg.removeEventListener('pointerleave', hidePoint);
      hidePlayerProfileEloTooltip(svg);
      svg.replaceChildren();
    }
  };
}

function orderPlayerProfileParticipations(participations = [], seasons = getSeasonOptions()) {
  const startDates = new Map(seasons.map(season => [season.id, season.startDate || '']));
  return [...participations].sort((left, right) => {
    const leftStartDate = String(left.startDate || left.startsOn || startDates.get(normalizeSeasonId(left.seasonId)) || '');
    const rightStartDate = String(right.startDate || right.startsOn || startDates.get(normalizeSeasonId(right.seasonId)) || '');
    const dateOrder = rightStartDate.localeCompare(leftStartDate);
    return dateOrder || String(right.seasonId || '').localeCompare(String(left.seasonId || ''));
  });
}

function getPlayerProfileTrainingParticipation(matches = []) {
  return matches
    .filter(match => match.kind === 'training')
    .reduce((stats, match) => {
      const matchWeight = Number(match.matchWeight);
      const safeMatchWeight = Number.isFinite(matchWeight) && matchWeight > 0 ? matchWeight : 0;
      const winWeight = Number(match.winWeight);
      const regularResult = String(match.resultDetails || '')
        .split(/\s*[–-]\s*/, 1)[0]
        .replace(/\([^)]*\)/g, '');
      const teamOneGameDiff = [...regularResult.matchAll(/(\d+)\s*:\s*(\d+)/g)]
        .map(score => [Number(score[1]), Number(score[2])])
        .filter(([teamOne, teamTwo]) =>
          window.PadelScoreInput.classifyRegularSet(teamOne, teamTwo).state === 'complete')
        .reduce((difference, [teamOne, teamTwo]) => difference + teamOne - teamTwo, 0);

      stats.matches += safeMatchWeight;
      stats.wins += Number.isFinite(winWeight)
        ? winWeight
        : match.outcome === 'win' ? safeMatchWeight : 0;
      stats.gameDiff += Number(match.team) === 2 ? -teamOneGameDiff : teamOneGameDiff;
      return stats;
    }, { matches: 0, wins: 0, gameDiff: 0 });
}

function renderPlayerProfileParticipationStats(participation, middleLabel, middleValue) {
  const matches = escapeHtml(formatProfileMatchCount(participation.matches));
  const middle = escapeHtml(formatProfileMatchCount(middleValue));
  return `Partien: ${matches} · ${middleLabel}: ${middle} · Diff.: ${formatProfileSignedValue(participation.gameDiff)}`;
}

function configurePlayerProfileResponsiveGrid(target, itemCount) {
  if (!target) return;
  const count = Math.max(0, Number(itemCount) || 0);
  target.classList.add('player-profile-responsive-grid');
  target.classList.toggle('has-multiple-items', count > 1);
  target.classList.toggle('prefers-three-columns', count === 3 || count >= 5);
  target.dataset.gridItemCount = String(count);
}

function renderPlayerProfileParticipations(participations = [], matches = []) {
  const target = document.getElementById('player-profile-participations');
  if (!target) return;
  const orderedParticipations = orderPlayerProfileParticipations(participations);
  const seasonRows = orderedParticipations.map(participation => {
    const leagueRank = participation.rank ? `${participation.rank}.` : '—';
    const leagueRankClass = `r${Math.min(Number(participation.rank) || 4, 4)}`;
    const finalRound = participation.finalRound;
    const finalRoundLabel = finalRound?.placement ? `${finalRound.label}.` : finalRound?.label;
    return `
    <div class="player-profile-participation player-profile-season-participation" style="--profile-season-color:${getPlayerProfileSeasonColor(participation.seasonId)}">
      <div class="player-profile-participation-name">
        <span class="player-profile-participation-marker"><i></i></span>
        ${escapeHtml(participation.seasonLabel)}
        ${participation.isActive ? '<em class="player-profile-participation-status">Laufend</em>' : ''}
      </div>
      <div class="player-profile-participation-phases">
        ${finalRound ? `
          <section class="player-profile-participation-phase">
            <div class="player-profile-participation-phase-content">
              <div class="player-profile-participation-phase-heading">Finalrunde</div>
              <div class="stat-meta-line">${renderPlayerProfileParticipationStats(finalRound, 'Siege', finalRound.wins)}</div>
            </div>
            <strong class="player-profile-participation-phase-result ${finalRound.placement ? `player-profile-participation-placement r${Math.min(finalRound.placement, 4)}` : ''}">${escapeHtml(finalRoundLabel)}</strong>
          </section>
        ` : ''}
        <section class="player-profile-participation-phase">
          <div class="player-profile-participation-phase-content">
            <div class="player-profile-participation-phase-heading">Ligaphase</div>
            <div class="stat-meta-line">
              ${renderPlayerProfileParticipationStats(participation, 'Punkte', participation.points)}
            </div>
          </div>
          <strong class="player-profile-participation-phase-result player-profile-participation-placement ${leagueRankClass}">${leagueRank}</strong>
        </section>
      </div>
    </div>
  `;
  }).join('');
  const training = getPlayerProfileTrainingParticipation(matches);
  const trainingRow = training.matches > 0 ? `
    <div class="player-profile-participation player-profile-training-participation">
      <div class="player-profile-participation-name">
        <span class="player-profile-participation-marker"><i></i></span>
        Trainings
      </div>
      <div class="stat-meta-line">${renderPlayerProfileParticipationStats(training, 'Siege', training.wins)}</div>
    </div>` : '';
  target.innerHTML = seasonRows + trainingRow;
  configurePlayerProfileResponsiveGrid(
    target,
    orderedParticipations.length + (training.matches > 0 ? 1 : 0)
  );
}

function getPlayerProfileRelationshipLeaders(matches = []) {
  const partners = new Map();
  const opponents = new Map();

  const recordResult = (records, name, match) => {
    if (!name || / · Gast(?: \d+)?$/u.test(String(name))) return;
    const rawMatchWeight = Number(match.matchWeight ?? 1);
    const matchWeight = Number.isFinite(rawMatchWeight) && rawMatchWeight >= 0 ? rawMatchWeight : 1;
    if (matchWeight === 0) return;
    const fallbackWinWeight = match.outcome === 'win' ? matchWeight : 0;
    const fallbackLossWeight = match.outcome === 'loss' ? matchWeight : 0;
    const winWeight = Number.isFinite(Number(match.winWeight)) ? Number(match.winWeight) : fallbackWinWeight;
    const lossWeight = Number.isFinite(Number(match.lossWeight)) ? Number(match.lossWeight) : fallbackLossWeight;
    const drawWeight = Math.max(0, matchWeight - winWeight - lossWeight);
    const record = records.get(name) || { name, matches: 0, wins: 0, losses: 0, draws: 0 };
    record.matches += matchWeight;
    record.wins += winWeight;
    record.losses += lossWeight;
    record.draws += drawWeight;
    records.set(name, record);
  };

  matches.forEach(match => {
    [...new Set(match.partnerNames || [])]
      .forEach(name => recordResult(partners, name, match));
    [...new Set(match.opponentNames || [])]
      .forEach(name => recordResult(opponents, name, match));
  });

  const eligible = (records, minimumMatches = 3) => [...records.values()]
    .filter(record => record.matches >= minimumMatches)
    .map(record => ({ ...record, winRate: record.wins / record.matches }));
  const bestFirst = (left, right) =>
    right.winRate - left.winRate ||
    right.matches - left.matches ||
    right.wins - left.wins ||
    left.name.localeCompare(right.name, 'de');
  const worstFirst = (left, right) =>
    left.winRate - right.winRate ||
    right.matches - left.matches ||
    right.losses - left.losses ||
    left.name.localeCompare(right.name, 'de');
  const eligiblePartners = eligible(partners).sort(bestFirst);
  const eligibleOpponents = eligible(opponents);
  const tiedLeaders = (records, qualifies, compare) => {
    const qualified = records.filter(qualifies).sort(compare);
    if (!qualified.length) return [];
    const leadingWinRate = qualified[0].winRate;
    return qualified.filter(record => record.winRate === leadingWinRate);
  };

  return {
    favoritePartners: tiedLeaders(eligiblePartners, record => record.winRate > 0.5, bestFirst),
    fearedPartners: tiedLeaders(eligiblePartners, record => record.winRate < 0.5, worstFirst),
    favoriteOpponents: tiedLeaders(eligibleOpponents, record => record.winRate > 0.5, bestFirst),
    fearedOpponents: tiedLeaders(eligibleOpponents, record => record.winRate < 0.5, worstFirst)
  };
}

function renderPlayerProfileRelationships(matches = []) {
  const target = document.getElementById('player-profile-relationships');
  const heading = document.getElementById('player-profile-relationships-heading');
  if (!target) return;
  const leaders = getPlayerProfileRelationshipLeaders(matches);
  const relationships = [
    ['Erfolgspartner', leaders.favoritePartners, 'pos', 'Ab 3 gemeinsamen Partien: höchste Siegquote als Team über 50 %. Trainings werden mitgezählt.'],
    ['Angstpartner', leaders.fearedPartners, 'neg', 'Ab 3 gemeinsamen Partien: niedrigste Siegquote als Team unter 50 %. Trainings werden mitgezählt.'],
    ['Lieblingsgegner', leaders.favoriteOpponents, 'pos', 'Ab 3 Partien gegeneinander: höchste Siegquote über 50 %. Trainings werden mitgezählt.'],
    ['Angstgegner', leaders.fearedOpponents, 'neg', 'Ab 3 Partien gegeneinander: niedrigste Siegquote unter 50 %. Trainings werden mitgezählt.']
  ].filter(([, records]) => records.length);

  if (heading) heading.hidden = relationships.length > 0;
  target.classList.toggle('has-results', relationships.length > 0);
  if (!relationships.length) {
    target.innerHTML = '<div class="empty-state">Noch keine Wertung – sie zählt ab 3 gemeinsamen Partien mit einer Quote über oder unter 50 %. Dabei zählen Trainings mit.</div>';
    return;
  }

  const formatRecord = record => {
    const parts = [
      `${formatProfileMatchCount(record.matches)} Partien`,
      `${formatProfileMatchCount(record.wins)} ${record.wins === 1 ? 'Sieg' : 'Siege'}`,
      `${formatProfileMatchCount(record.losses)} ${record.losses === 1 ? 'Niederlage' : 'Niederlagen'}`
    ];
    if (record.draws) parts.push(`${formatProfileMatchCount(record.draws)} Unentschieden`);
    return parts.join(' · ');
  };

  target.innerHTML = `<div class="stat-shift-groups">
    ${relationships.map(([label, records, valueClass, helpText], index) => {
      const tooltipId = `player-profile-relationship-help-${index}`;
      return `<div class="stat-shift-group">
      <h3><span class="th-help-wrap">${escapeHtml(label)}
        <span class="help-icon" tabindex="0" role="button" aria-label="${escapeHtml(label)} erklären" aria-describedby="${tooltipId}" aria-expanded="false" data-help-tooltip-anchor>?</span>
        <span class="help-tooltip" id="${tooltipId}" role="tooltip">${escapeHtml(helpText)}</span>
      </span></h3>
      <div class="stat-shift-list">
        ${records.map(record => `<div class="stat-shift-item">
          <div class="stat-shift-head">
            <span class="stat-shift-name">${escapeHtml(record.name)}</span>
            <span class="stat-shift-value ${valueClass}">${Math.round(record.winRate * 100)} %</span>
          </div>
          <div class="stat-meta-line">${escapeHtml(formatRecord(record))}</div>
        </div>`).join('')}
      </div>
    </div>`;
    }).join('')}
  </div>`;
  configurePlayerProfileResponsiveGrid(target.querySelector('.stat-shift-groups'), relationships.length);
}

// Der Spielervergleich nutzt dieselbe gewichtete Historie wie die Beziehungen.
function getPlayerProfileMatchWeight(match) {
  const weight = Number(match?.matchWeight ?? 1);
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

function getPlayerProfileCompareOptions(profile) {
  const ownName = profile?.identity?.displayName;
  const playersByName = new Map((window.PADEL_PLAYERS || []).map(player => [player.name, player]));
  const counts = new Map();
  (profile?.matches || []).forEach(match => {
    const weight = getPlayerProfileMatchWeight(match);
    if (!weight) return;
    new Set([...(match.partnerNames || []), ...(match.opponentNames || [])]).forEach(name => {
      const player = playersByName.get(name);
      if (!player || name === ownName) return;
      counts.set(player.id, (counts.get(player.id) || 0) + weight);
    });
  });
  return [...counts].map(([id, matches]) => ({
    id,
    name: (window.PADEL_PLAYERS || []).find(player => player.id === id).name,
    matches
  })).sort((left, right) => right.matches - left.matches || left.name.localeCompare(right.name, 'de'));
}

function getProfileSetTotals(resultDetails) {
  const withoutSetTiebreaks = String(resultDetails || '').replace(/\([^)]*\)/g, '');
  return [...withoutSetTiebreaks.matchAll(/(\d+)\s*:\s*(\d+)/g)]
    .map(score => [Number(score[1]), Number(score[2])])
    .reduce((totals, [teamOne, teamTwo]) => {
      const classification = Math.max(teamOne, teamTwo) > 7
        ? window.PadelScoreInput.classifyTiebreak(teamOne, teamTwo, 10)
        : window.PadelScoreInput.classifyRegularSet(teamOne, teamTwo);
      if (classification.state !== 'complete') return totals;
      return teamOne > teamTwo ? [totals[0] + 1, totals[1]] : [totals[0], totals[1] + 1];
    }, [0, 0]);
}

function getPlayerProfileComparison(matches, otherName) {
  const comparison = { together: 0, against: 0, wins: [0, 0], sets: [0, 0], games: [0, 0] };
  const orient = (totals, team) => Number(team) === 2 ? [totals[1], totals[0]] : totals;
  matches.forEach(match => {
    const weight = getPlayerProfileMatchWeight(match);
    if (!weight) return;
    if ((match.partnerNames || []).includes(otherName)) {
      comparison.together += weight;
      return;
    }
    if (!(match.opponentNames || []).includes(otherName)) return;
    comparison.against += weight;
    comparison.wins[0] += Number.isFinite(Number(match.winWeight))
      ? Number(match.winWeight)
      : match.outcome === 'win' ? weight : 0;
    comparison.wins[1] += Number.isFinite(Number(match.lossWeight))
      ? Number(match.lossWeight)
      : match.outcome === 'loss' ? weight : 0;
    const sets = orient(getProfileSetTotals(match.resultDetails), match.team);
    const games = orient(getProfileRegularGameTotals(match.resultDetails), match.team);
    comparison.sets = [comparison.sets[0] + sets[0], comparison.sets[1] + sets[1]];
    comparison.games = [comparison.games[0] + games[0], comparison.games[1] + games[1]];
  });
  return comparison;
}

function renderPlayerProfileCompareRow(label, leftValue, rightValue, format = formatProfileMatchCount) {
  const left = Math.max(0, Number(leftValue) || 0);
  const right = Math.max(0, Number(rightValue) || 0);
  const total = left + right;
  const formatValue = value => value === null || value === undefined ? '—' : format(value);
  return `<div class="match-forecast-result player-profile-compare-row" aria-label="${escapeHtml(`${label}: ${formatValue(leftValue)} zu ${formatValue(rightValue)}`)}">
    <div class="match-forecast-percentages"><span>${formatValue(leftValue)}</span><span class="player-profile-compare-label">${escapeHtml(label)}</span><span>${formatValue(rightValue)}</span></div>
    <div class="match-forecast-bar${total ? ' has-votes' : ''}${left && right ? ' has-both-team-colors' : ''}">
      <span class="match-forecast-team-one" style="width:${total ? left / total * 50 : 0}%"></span>
      <span class="match-forecast-team-two" style="width:${total ? right / total * 50 : 0}%"></span>
    </div>
  </div>`;
}

function renderPlayerProfileCompareResult() {
  const target = document.getElementById('player-profile-compare-result');
  if (!target) return;
  const profile = playerProfileData;
  const otherId = playerProfileCompareId;
  const other = (window.PADEL_PLAYERS || []).find(player => player.id === otherId);
  if (!profile || !other) {
    target.innerHTML = '';
    return;
  }
  if (!playerProfileCompareElos.has(otherId)) {
    playerProfileCompareElos.set(otherId, undefined);
    fetchPlayerProfile(otherId)
      .then(otherProfile => playerProfileCompareElos.set(otherId, otherProfile?.summary?.currentElo ?? null))
      .catch(error => {
        playerProfileCompareElos.set(otherId, null);
        console.error(error);
      })
      .finally(() => {
        if (playerProfileData === profile && playerProfileCompareId === otherId) renderPlayerProfileCompareResult();
      });
  }
  const comparison = getPlayerProfileComparison(profile.matches || [], other.name);
  const ownElo = profile.summary?.currentElo ?? null;
  const otherElo = playerProfileCompareElos.get(otherId) ?? null;
  const sharedMatches = comparison.together + comparison.against;
  target.innerHTML = `<div class="stat-meta-line">${escapeHtml(`${formatProfileMatchCount(sharedMatches)} gemeinsame Partien`)}<br>${escapeHtml([
    `${formatProfileMatchCount(comparison.together)} miteinander`,
    `${formatProfileMatchCount(comparison.against)} gegeneinander`
  ].join(' · '))}</div>
    <div class="match-forecast-percentages player-profile-compare-names"><span>${escapeHtml(profile.identity?.displayName || '')}</span><span>${escapeHtml(other.name)}</span></div>
    ${renderPlayerProfileCompareRow('Siege im Duell', comparison.wins[0], comparison.wins[1])}
    ${renderPlayerProfileCompareRow('Sätze im Duell', comparison.sets[0], comparison.sets[1])}
    ${renderPlayerProfileCompareRow('Spiele im Duell', comparison.games[0], comparison.games[1])}
    ${renderPlayerProfileCompareRow('Aktuelles Elo', ownElo, otherElo, value => String(Math.round(Number(value))))}`;
}

function renderPlayerProfileCompare(profile) {
  const target = document.getElementById('player-profile-compare');
  if (!target) return;
  const options = getPlayerProfileCompareOptions(profile);
  const selected = options.find(option => option.id === playerProfileCompareId) || null;
  if (!selected) playerProfileCompareId = null;
  if (!options.length) {
    target.innerHTML = '<h3>Vergleich</h3><div class="empty-state">Noch keine gemeinsamen Partien mit anderen Spielern.</div>';
    return;
  }
  const label = selected?.name || 'Spieler wählen';
  target.innerHTML = `<h3>Vergleich</h3>
    <div class="training-picker" data-profile-compare-picker>
      <div class="training-picker-search-control">
        <button class="secondary-button secondary-button--dropdown training-picker-toggle" type="button" data-profile-compare-toggle aria-label="${escapeHtml(label)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="player-profile-compare-menu">
          <span class="training-picker-display"><span class="training-picker-display-line">${escapeHtml(label)}</span></span>
        </button>
        <input class="training-picker-search-input" type="search" data-profile-compare-search role="combobox" aria-label="Vergleichsspieler suchen" aria-controls="player-profile-compare-menu" aria-expanded="false" autocomplete="off" spellcheck="false" placeholder="Spieler suchen …" disabled>
      </div>
      <div class="viewer-menu training-picker-menu" id="player-profile-compare-menu" role="listbox" aria-label="Vergleichsspieler auswählen">
        ${options.map(option => `<button
          class="viewer-option training-picker-option${option.id === selected?.id ? ' active' : ''}"
          type="button"
          role="option"
          aria-label="${escapeHtml(option.name)}"
          aria-selected="${option.id === selected?.id}"
          data-profile-compare-value="${escapeHtml(option.id)}"
          data-profile-compare-search-text="${escapeHtml(option.name)}"
        ><span class="training-picker-option-label"><span class="training-picker-display-line">${escapeHtml(option.name)}</span></span><span>${escapeHtml(`${formatProfileMatchCount(option.matches)} ${option.matches === 1 ? 'Partie' : 'Partien'}`)}</span></button>`).join('')}
        <div class="picker-search-empty" data-profile-compare-search-empty hidden>Kein Spieler gefunden.</div>
      </div>
    </div>
    <div class="player-profile-compare-result" id="player-profile-compare-result"></div>`;
  renderPlayerProfileCompareResult();
}

function filterPlayerProfileCompareOptions(query = '') {
  const picker = document.querySelector('[data-profile-compare-picker]');
  if (!picker) return;
  const normalizedQuery = normalizePlayerSearch(query);
  let visibleOptions = 0;
  picker.querySelectorAll('[data-profile-compare-value]').forEach(option => {
    const matches = !normalizedQuery
      || normalizePlayerSearch(option.dataset.profileCompareSearchText).includes(normalizedQuery);
    option.hidden = !matches;
    if (matches) visibleOptions += 1;
  });
  const emptyState = picker.querySelector('[data-profile-compare-search-empty]');
  if (emptyState) emptyState.hidden = visibleOptions > 0;
}

function setPlayerProfileComparePickerOpen(open) {
  const picker = document.querySelector('[data-profile-compare-picker]');
  if (!picker) return;
  picker.classList.toggle('open', open);
  picker.querySelector('[data-profile-compare-toggle]')?.setAttribute('aria-expanded', String(open));
  const searchInput = picker.querySelector('[data-profile-compare-search]');
  if (!searchInput) return;
  searchInput.setAttribute('aria-expanded', String(open));
  searchInput.value = '';
  filterPlayerProfileCompareOptions();
  searchInput.disabled = !open;
  if (open) searchInput.focus({ preventScroll: true });
  else searchInput.blur();
}

function selectPlayerProfileCompare(playerId) {
  playerProfileCompareId = playerId;
  renderPlayerProfileCompare(playerProfileData);
  document.querySelector('[data-profile-compare-toggle]')?.focus({ preventScroll: true });
}

function formatProfileDate(value) {
  const date = value ? new Date(`${String(value).slice(0, 10)}T12:00:00`) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '—';
}

function renderPlayerProfileNames(names = [], fallback = '—') {
  if (!names.length) return escapeHtml(fallback);
  return names
    .map(name => escapeHtml(name))
    .join('<span class="mc-player-sep">&amp;</span>');
}

function orientProfileResult(resultDetails, team) {
  const value = String(resultDetails || '—');
  if (Number(team) !== 2) return value;
  return value.replace(/(\d+)\s*:\s*(\d+)/g, (_, left, right) => `${right}:${left}`);
}

function renderProfileScoreSet(rawSet, kind) {
  const value = String(rawSet || '').trim();
  const score = value.match(/^(\d+)\s*:\s*(\d+)(?:\s*\(\s*(\d+)\s*:\s*(\d+)\s*\))?$/);
  if (!score) return `<span class="player-profile-score-set">${escapeHtml(value)}</span>`;

  const [, teamOne, teamTwo, tiebreakOne, tiebreakTwo] = score;
  const classification = kind === 'training'
    ? window.PadelScoreInput.classifyRegularSet(teamOne, teamTwo)
    : { state: 'complete' };
  const partialClass = classification.state === 'complete' ? '' : ' player-profile-score-partial';
  const setTiebreak = tiebreakOne === undefined
    ? ''
    : ` <span class="player-profile-set-tiebreak">(${tiebreakOne}:${tiebreakTwo})</span>`;
  return `<span class="player-profile-score-set${partialClass}">${teamOne}:${teamTwo}${setTiebreak}</span>`;
}

function renderProfileResultDetails(match) {
  const orientedResult = orientProfileResult(match.resultDetails, match.team);
  const [regularPart = '', matchTiebreakPart = ''] = orientedResult.split(/\s*[–-]\s*/, 2);
  const regularResult = regularPart
    .split(/\s*,\s*/)
    .filter(Boolean)
    .map(part => renderProfileScoreSet(part, match.kind))
    .join('<span class="player-profile-score-divider">,</span> ');
  if (matchTiebreakPart) {
    const score = matchTiebreakPart.match(/^(\d+)\s*:\s*(\d+)$/);
    const classification = match.kind === 'training'
      ? window.PadelScoreInput.classifyTiebreak(score?.[1], score?.[2], 10)
      : { state: 'complete' };
    const partialClass = classification.state === 'complete' ? '' : ' player-profile-score-partial';
    const renderedTiebreak = score
      ? `${score[1]}:${score[2]}`
      : escapeHtml(matchTiebreakPart.trim());
    return `<span class="player-profile-result">${regularResult} <span class="player-profile-score-divider">–</span> <span class="player-profile-match-tiebreak${partialClass}">${renderedTiebreak}</span></span>`;
  }
  return `<span class="player-profile-result">${regularResult}</span>`;
}

function getPlayerProfileTrainingSessionId(match) {
  if (match?.kind !== 'training') return null;
  if (match.trainingSessionId !== null && match.trainingSessionId !== undefined) {
    return String(match.trainingSessionId);
  }
  return String(match.id || '').match(/^training-(\d+)-\d+$/)?.[1] || null;
}

function getPlayerProfileFinalFourId(match) {
  if (match?.kind !== 'final-four' || !match.seasonId) return null;
  return String(match.seasonId);
}

function getPlayerProfileMatchLabel(match) {
  if (match.kind === 'training') return 'Training';
  if (match.kind !== 'final-four') return match.seasonLabel || 'Liga';

  const seasonLabel = String(match.seasonLabel || '');
  const seasonPrefix = /^Sommer\b/i.test(seasonLabel)
    ? 'SO'
    : /^Winter\b/i.test(seasonLabel) ? 'WI' : '';
  const year = seasonLabel.match(/\b(?:20)?(\d{2})\b/)?.[1] || '';
  const seasonCode = `${seasonPrefix}${year}`;
  return seasonCode ? `FINAL4 ${seasonCode}` : 'FINAL4';
}

function groupPlayerProfileMatches(matches = []) {
  const groups = [];
  const trainingGroups = new Map();
  const finalFourGroups = new Map();
  matches.forEach(match => {
    const sessionId = getPlayerProfileTrainingSessionId(match);
    const finalFourId = getPlayerProfileFinalFourId(match);
    if (!sessionId && !finalFourId) {
      groups.push({ key: `match-${match.id}`, kind: match.kind, matches: [match] });
      return;
    }
    const isFinalFour = Boolean(finalFourId);
    const key = isFinalFour ? `final-four-${finalFourId}` : `training-${sessionId}`;
    const groupMap = isFinalFour ? finalFourGroups : trainingGroups;
    let group = groupMap.get(key);
    if (!group) {
      group = { key, kind: isFinalFour ? 'final-four' : 'training', matches: [] };
      groupMap.set(key, group);
      groups.push(group);
    }
    group.matches.push(match);
  });
  groups.forEach(group => {
    if (group.kind === 'training') {
      group.matches.sort((left, right) =>
        Number(left.trainingRoundNumber || String(left.id).split('-').at(-1))
        - Number(right.trainingRoundNumber || String(right.id).split('-').at(-1))
      );
    } else if (group.kind === 'final-four') {
      group.matches.sort((left, right) => String(left.id).localeCompare(String(right.id), 'de', { numeric: true }));
    }
  });
  return groups;
}

function getVisiblePlayerProfileMatchGroups(matches) {
  const groups = groupPlayerProfileMatches(matches);
  if (playerProfileExpanded) return groups;

  const visibleGroups = [];
  let visibleMatchCount = 0;
  for (const group of groups) {
    if (visibleMatchCount >= PLAYER_PROFILE_MATCH_PREVIEW_LIMIT) break;
    visibleGroups.push(group);
    visibleMatchCount += group.matches.length;
  }
  return visibleGroups;
}

function renderPlayerProfileHistory() {
  document.querySelectorAll('[data-player-profile-match-scope]').forEach(button => {
    const active = button.dataset.playerProfileMatchScope === playerProfileMatchScope;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (playerProfileMatchScope === 'upcoming') {
    void renderPlayerProfileUpcomingMatches();
    return;
  }
  renderPlayerProfilePastMatches();
}

function renderPlayerProfilePastMatches() {
  const target = document.getElementById('player-profile-match-list');
  const showAll = document.getElementById('player-profile-show-all');
  if (!target || !showAll) return;
  const matches = playerProfileData?.matches || [];
  const visibleGroups = getVisiblePlayerProfileMatchGroups(matches);
  if (!visibleGroups.length) {
    target.innerHTML = '<div class="empty-state">Noch keine vergangenen Partien.</div>';
  } else {
    target.innerHTML = visibleGroups.map(group => {
      const rows = group.matches.map((match, index) => {
        const isComplete = match.isComplete !== false;
        const isCancelled = match.isCancelled === true
          || (match.kind !== 'training' && !isComplete && Number(match.matchWeight) === 0);
        const hasWeightedResult = match.kind === 'training'
          ? Number(match.matchWeight) > 0
          : isComplete;
        const outcome = hasWeightedResult && ['win', 'loss', 'draw'].includes(match.outcome)
          ? match.outcome
          : 'unfinished';
        const outcomeLabel = outcome === 'win' ? 'S' : outcome === 'loss' ? 'N' : outcome === 'draw' ? 'U' : '–';
        const outcomeAriaLabel = outcome === 'win'
          ? 'Sieg'
          : outcome === 'loss' ? 'Niederlage' : outcome === 'draw' ? 'Unentschieden' : 'Abgebrochen, ohne Wertung';
        const partner = renderPlayerProfileNames(match.partnerNames, 'ohne Partner');
        const opponents = renderPlayerProfileNames(match.opponentNames);
        const showDate = index === 0;
        const showGroupLabelFirst = group.kind === 'training' || group.kind === 'final-four';
        const showSeason = showGroupLabelFirst
          ? index === 0
          : index === group.matches.length - 1;
        return `<article class="player-profile-match ${outcome}">
          <div class="player-profile-match-date">${showDate ? escapeHtml(formatProfileDate(match.date)) : ''}</div>
          <div class="player-profile-match-outcome ${outcome}" aria-label="${outcomeAriaLabel}">${outcomeLabel}</div>
          <div class="player-profile-match-teams">
            <div class="player-profile-match-team-line"><span>mit</span> ${partner}</div>
            <div class="player-profile-match-team-line"><span>vs.</span> ${opponents}</div>
          </div>
          ${isCancelled
            ? '<div class="player-profile-match-score player-profile-unrated-result">ohne Wertung</div>'
            : isComplete && window.PadelLiveTicker?.hasHistory(match.id)
            ? `<button type="button" class="player-profile-match-score" data-live-open-match="${escapeHtml(match.id)}" data-live-season-id="${escapeHtml(match.seasonId || '')}" aria-label="Spielverlauf öffnen">${renderProfileResultDetails(match)}</button>`
            : isComplete && match.hasMatchStatistics && window.PadelMatchStatistics
            ? `<button type="button" class="player-profile-match-score" data-match-statistics="${escapeHtml(match.id)}" aria-label="Partieanalyse öffnen">${renderProfileResultDetails(match)}</button>`
            : `<div class="player-profile-match-score"${isComplete ? '' : ' title="Vollständige Sätze werden einzeln gewertet"'}>${renderProfileResultDetails(match)}</div>`}
          <div class="player-profile-match-season">${showSeason ? escapeHtml(getPlayerProfileMatchLabel(match)) : ''}</div>
        </article>`;
      }).join('');
      return `<section class="player-profile-match-group ${escapeHtml(group.kind || '')}" data-profile-match-group="${escapeHtml(group.key)}">${rows}</section>`;
    }).join('');
  }
  showAll.hidden = playerProfileExpanded || matches.length <= PLAYER_PROFILE_MATCH_PREVIEW_LIMIT;
  showAll.textContent = 'Alle Partien anzeigen';
}

// Kommende Partien umfassen offene Pflichtspiele aller laufenden öffentlichen Saisons.
async function loadPlayerProfileUpcomingSeasons() {
  const seasons = getSeasonOptions().filter(season => !season.completedAt);
  const loaded = await Promise.all(seasons.map(async season => {
    try {
      const payload = await getPlayerProfileSeasonPayload(season.id);
      if (!payload) return null;
      const data = payload === PADEL_DATA ? PADEL_DATA : hydrateSeasonData(payload);
      return { ...data, label: data.label || season.label };
    } catch (error) {
      console.error(error);
      return null;
    }
  }));
  return loaded.filter(Boolean);
}

function getPlayerProfileUpcomingSortKey(match, season) {
  if (hasScheduledDateTime(match)) {
    return `0|${toDateKey(match.datum)}|${String(getMatchTimeMinutes(match)).padStart(4, '0')}`;
  }
  const matchday = (season.matchdays || []).find(item => item.spieltag === match.spieltag);
  return matchday?.startDate
    ? `1|${matchday.startDate}`
    : `2|${season.startDate || ''}|${String(match.spieltag ?? 999).padStart(3, '0')}`;
}

function getPlayerProfileUpcomingMatches(playerId, seasons) {
  return seasons.flatMap(season => (season.allMatches || season.matches || [])
    .filter(match => !isCancelledMatch(match) && match.sieger === null)
    .map(match => ({ match, season, team: getPlayerProfileSeasonMatchTeam(match, playerId) }))
    .filter(entry => entry.team))
    .map(entry => ({ ...entry, sortKey: getPlayerProfileUpcomingSortKey(entry.match, entry.season) }))
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey)
      || compareMatchesByNumber(left.match, right.match));
}

function formatPlayerProfileUpcomingDate(match, season) {
  if (hasScheduledDateTime(match)) return formatProfileDate(match.datum);
  const matchday = (season.matchdays || []).find(item => item.spieltag === match.spieltag);
  return matchday?.title || (match.spieltag ? `Spieltag ${match.spieltag}` : '');
}

function renderPlayerProfileUpcomingMatch({ match, season, team }, playerId) {
  const ownTeam = team === 1 ? match.team1 : match.team2;
  const opponentTeam = team === 1 ? match.team2 : match.team1;
  const partnerNames = ownTeam.spieler.filter((_, index) => ownTeam.playerIds[index] !== playerId);
  const probability = getMatchWinProbabilityFromElos(match, getLatestPlayerEloValue, {
    players: season.allPlayers || season.players || []
  });
  const ownProbability = probability ? probability[`team${team}`] : null;
  const probabilityContent = ownProbability === null
    ? '—'
    : `<span class="player-profile-result">${ownProbability} % <span class="player-profile-win-chance-label">Siegchance</span></span>`;
  const statistics = window.PadelMatchStatistics?.entry(match, season);
  return `<article class="player-profile-match upcoming">
    <div class="player-profile-match-date">${escapeHtml(formatPlayerProfileUpcomingDate(match, season))}</div>
    <div class="player-profile-match-outcome unfinished" aria-label="Noch nicht gespielt">–</div>
    <div class="player-profile-match-teams">
      <div class="player-profile-match-team-line"><span>mit</span> ${renderPlayerProfileNames(partnerNames, 'ohne Partner')}</div>
      <div class="player-profile-match-team-line"><span>vs.</span> ${renderPlayerProfileNames(opponentTeam.spieler)}</div>
    </div>
    ${statistics
      ? `<button type="button" class="player-profile-match-score" ${statistics.attributes}>${probabilityContent}</button>`
      : `<div class="player-profile-match-score">${probabilityContent}</div>`}
    <div class="player-profile-match-season">${escapeHtml(season.label || '')}</div>
  </article>`;
}

async function renderPlayerProfileUpcomingMatches() {
  const target = document.getElementById('player-profile-match-list');
  const showAll = document.getElementById('player-profile-show-all');
  if (!target || !showAll) return;
  const profile = playerProfileData;
  const playerId = profile?.identity?.id;
  showAll.hidden = true;
  if (!target.querySelector('.player-profile-match.upcoming')) {
    target.innerHTML = '<div class="empty-state">Kommende Partien werden geladen …</div>';
  }
  const seasons = await loadPlayerProfileUpcomingSeasons();
  if (playerProfileData !== profile || playerProfileMatchScope !== 'upcoming') return;
  const matches = getPlayerProfileUpcomingMatches(playerId, seasons);
  target.innerHTML = matches.length
    ? matches.map(entry => `<section class="player-profile-match-group">${renderPlayerProfileUpcomingMatch(entry, playerId)}</section>`).join('')
    : '<div class="empty-state">Keine kommenden Partien.</div>';
}

function isRankingSectionActive() {
  const section = document.getElementById('rangliste');
  return Boolean(section?.classList.contains('active') && !section.hidden);
}

function isAllTimeRankingSectionActive() {
  const section = document.getElementById('verlauf');
  const layout = document.getElementById('all-time-ranking-profile-layout');
  return Boolean(
    statisticsMode === 'all-time'
    && section?.classList.contains('active')
    && !section.hidden
    && layout
    && !layout.hidden
  );
}

function getPlayerProfilePanelContext() {
  const statisticsContext = window.PadelMatchStatistics?.profileContext;
  if (statisticsContext?.active) {
    return {
      id: 'match-statistics',
      hostId: 'match-statistics-panel-host',
      panelAvailable: statisticsContext.panelAvailable
    };
  }
  if (playerProfilePanelOrigin === 'match-list') {
    return {
      id: 'match-list',
      hostId: 'match-statistics-panel-host'
    };
  }
  if (playerProfilePanelOrigin === 'embedded-match-list') {
    return {
      id: 'match-statistics',
      hostId: 'match-statistics-panel-host',
      panelAvailable: playerProfileEmbeddedPanelAvailable
    };
  }
  if (isRankingSectionActive()) {
    return { id: 'ranking', hostId: 'ranking-profile-host' };
  }
  if (isAllTimeRankingSectionActive()) {
    return { id: 'all-time-ranking', hostId: 'all-time-ranking-profile-host' };
  }
  return null;
}

function getPlayerProfilePanelLayout(panelContext = getPlayerProfilePanelContext()) {
  if (panelContext?.id === 'match-list') return panelLayout.layouts.matchList;
  return panelContext?.id === 'all-time-ranking'
    ? panelLayout.layouts.allTimeRanking
    : panelLayout.layouts.ranking;
}

function hasPlayerProfilePanelSpace() {
  const panelContext = getPlayerProfilePanelContext();
  if (panelContext?.id === 'match-statistics') return Boolean(panelContext.panelAvailable);
  if (panelContext?.id === 'match-list') {
    const section = document.getElementById('partien');
    return Boolean(
      !isDetailEmbed
      && section?.classList.contains('active')
      && document.getElementById('match-statistics-panel-host')
      && panelLayout.hasPanelSpace(panelLayout.layouts.matchList)
    );
  }
  // Die Gesamtrangliste beginnt nicht am Seitenrand, sondern an ihrer tatsächlichen Position.
  const allTimeLayoutLeft = panelContext?.id === 'all-time-ranking'
    ? document.getElementById('all-time-ranking-profile-layout')?.getBoundingClientRect().left
    : null;
  return panelLayout.hasPanelSpace(
    getPlayerProfilePanelLayout(panelContext),
    Number.isFinite(allTimeLayoutLeft) ? { listLeft: allTimeLayoutLeft } : undefined
  );
}

function canPlayerProfileUsePanel() {
  const panelContext = getPlayerProfilePanelContext();
  if (panelContext?.id === 'match-statistics' || panelContext?.id === 'match-list') {
    return hasPlayerProfilePanelSpace();
  }
  return !isDetailEmbed && Boolean(panelContext) && hasPlayerProfilePanelSpace();
}

function shouldUsePlayerProfilePanel() {
  return !playerProfileForceModal
    && playerProfilePresentationPreference !== 'modal'
    && canPlayerProfileUsePanel();
}

function updatePlayerProfilePresentationToggle() {
  const toggle = document.getElementById('player-profile-presentation-toggle');
  if (!toggle) return;
  const canToggle = !playerProfileForceModal && canPlayerProfileUsePanel();
  const targetPresentation = playerProfilePresentation === 'panel' ? 'modal' : 'panel';
  const label = targetPresentation === 'panel'
    ? 'Profil als Seitenpanel öffnen'
    : 'Profil als Modal öffnen';
  toggle.hidden = !canToggle;
  toggle.dataset.targetPresentation = targetPresentation;
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
}

function updatePlayerProfilePanelMetrics() {
  if (playerProfilePresentation !== 'panel') return;
  const panelContext = getPlayerProfilePanelContext();
  if (panelContext?.id === 'match-statistics') return;
  panelLayout.applySplitLeft(
    getPlayerProfilePanelLayout(panelContext),
    panelContext?.id === 'match-list' ? '--match-statistics-split-left' : '--ranking-profile-split-left'
  );
}

function arrangePlayerProfileContent(presentation = playerProfilePresentation) {
  const content = document.getElementById('player-profile-content');
  if (!content) return;
  const selectors = presentation === 'panel'
    ? [
        '.player-profile-hero',
        '.player-profile-hero-block',
        '.player-profile-elo-panel',
        '.player-profile-participations-panel',
        '.player-profile-history',
        '.player-profile-relationships'
      ]
    : [
        '.player-profile-hero',
        '.player-profile-hero-block',
        '.player-profile-elo-panel',
        '.player-profile-participations-panel',
        '.player-profile-relationships',
        '.player-profile-history'
      ];
  selectors.forEach(selector => {
    const element = content.querySelector(selector);
    if (element) content.append(element);
  });
}

function getPlayerProfileShellScrollTop() {
  return document.querySelector('#player-profile-dialog .player-profile-shell')?.scrollTop || 0;
}

const PLAYER_PROFILE_HERO_CONDENSE_SCROLL = 48;
const PLAYER_PROFILE_HERO_EXPAND_SCROLL = 8;

function updatePlayerProfileHeroCondensed() {
  const shell = document.querySelector('#player-profile-dialog .player-profile-shell');
  const hero = document.getElementById('player-profile-hero');
  if (!shell || !hero) return;
  const scrollTop = shell.scrollTop;
  if (hero.classList.contains('is-condensed')) {
    if (scrollTop <= PLAYER_PROFILE_HERO_EXPAND_SCROLL) hero.classList.remove('is-condensed');
    return;
  }
  // Nur verdichten, wenn danach genug Scrollweg bleibt; sonst springt der Kopf zwischen beiden Größen hin und her.
  const remainingScroll = shell.scrollHeight - shell.clientHeight - hero.offsetHeight;
  if (scrollTop > PLAYER_PROFILE_HERO_CONDENSE_SCROLL && remainingScroll > PLAYER_PROFILE_HERO_CONDENSE_SCROLL) {
    hero.classList.add('is-condensed');
  }
}

function updatePlayerProfileRankingHighlights() {
  document.querySelectorAll('#rangliste tr[data-player-profile-id], #all-time-ranking-table tr[data-player-profile-id]').forEach(row => {
    const active = Boolean(playerProfileActiveId) && row.dataset.playerProfileId === playerProfileActiveId;
    row.classList.toggle('profile-open-highlight', active);
    row.querySelectorAll('[data-player-profile-id]').forEach(control => {
      control.setAttribute('aria-expanded', String(active));
      control.setAttribute('aria-controls', 'player-profile-dialog');
    });
  });
  const globalProfileButton = document.getElementById('viewer-profile-button');
  if (globalProfileButton) {
    const active = Boolean(playerProfileActiveId)
      && globalProfileButton.dataset.playerProfileId === playerProfileActiveId;
    globalProfileButton.setAttribute('aria-expanded', String(active));
    globalProfileButton.setAttribute('aria-controls', 'player-profile-dialog');
  }
}

function announcePlayerProfilePanel(name) {
  const status = document.getElementById('player-profile-panel-status');
  if (status && playerProfilePresentation === 'panel') {
    status.textContent = `Profil von ${name || 'Spieler'} geöffnet.`;
  }
}

function movePlayerProfileDialog(presentation, { reopen = false, scrollTop = 0, restoreTriggerFocus = false, persistDetailPreference = false } = {}) {
  const dialog = document.getElementById('player-profile-dialog');
  const panelContext = presentation === 'panel' ? getPlayerProfilePanelContext() : null;
  const hostId = isDetailEmbed && panelContext?.id === 'match-statistics'
    ? 'player-profile-modal-host'
    : panelContext?.hostId || 'player-profile-modal-host';
  const host = document.getElementById(hostId);
  if (!dialog || !host) return false;

  const wasOpen = dialog.open;
  if (wasOpen) dialog.close();
  playerProfilePresentation = presentation;
  dialog.dataset.presentation = presentation;
  dialog.classList.remove('is-closing');
  dialog.classList.toggle(
    'is-detail-panel-swap',
    presentation === 'panel' && document.body.classList.contains('detail-panel-switching')
  );
  if (presentation === 'panel') dialog.setAttribute('aria-modal', 'false');
  else dialog.removeAttribute('aria-modal');
  arrangePlayerProfileContent(presentation);
  host.append(dialog);
  document.body.classList.toggle('player-profile-panel-open', presentation === 'panel');
  if (panelContext?.id === 'match-list') {
    document.body.classList.toggle('match-statistics-panel-open', presentation === 'panel');
    if (presentation !== 'panel') document.body.style.removeProperty('--match-statistics-split-left');
  } else if (playerProfilePanelOrigin === 'match-list' && presentation !== 'panel') {
    document.body.classList.remove('match-statistics-panel-open');
    document.body.style.removeProperty('--match-statistics-split-left');
  }
  if (panelContext) document.body.dataset.playerProfilePanelContext = panelContext.id;
  else delete document.body.dataset.playerProfilePanelContext;
  updatePlayerProfilePanelMetrics();
  updatePlayerProfilePresentationToggle();
  window.PadelMatchStatistics?.syncProfilePresentation?.(presentation, {
    persistPreference: persistDetailPreference
  });
  if (isDetailEmbed && playerProfilePanelOrigin === 'embedded-match-list') {
    postToDetailEmbedParent({
      type: 'padel:detail-presentation',
      presentation,
      view: 'profile'
    });
  }

  if (reopen || wasOpen) {
    if (presentation === 'panel' && !isDetailEmbed) dialog.show();
    else dialog.showModal();
    requestAnimationFrame(() => {
      const shell = dialog.querySelector('.player-profile-shell');
      if (shell) shell.scrollTop = scrollTop;
      playerProfileChart?.resize?.();
      if (presentation === 'panel' && panelContext?.id === 'match-statistics') {
        dialog.querySelector('[data-player-profile-close]')?.focus({ preventScroll: true });
      } else if (presentation === 'panel' && restoreTriggerFocus && playerProfileLastTrigger?.isConnected) {
        playerProfileLastTrigger.focus({ preventScroll: true });
      }
    });
  }
  return true;
}

function reconcilePlayerProfilePresentation() {
  const dialog = document.getElementById('player-profile-dialog');
  if (!dialog?.open) return;
  const nextPresentation = shouldUsePlayerProfilePanel() ? 'panel' : 'modal';
  if (nextPresentation === playerProfilePresentation) {
    updatePlayerProfilePanelMetrics();
    updatePlayerProfilePresentationToggle();
    playerProfileChart?.resize?.();
    return;
  }
  movePlayerProfileDialog(nextPresentation, {
    reopen: true,
    scrollTop: getPlayerProfileShellScrollTop(),
    restoreTriggerFocus: nextPresentation === 'panel'
  });
}

function togglePlayerProfilePresentation() {
  const dialog = document.getElementById('player-profile-dialog');
  const toggle = document.getElementById('player-profile-presentation-toggle');
  if (!dialog?.open || !toggle || playerProfileForceModal || !canPlayerProfileUsePanel()) return;
  const nextPresentation = playerProfilePresentation === 'panel' ? 'modal' : 'panel';
  playerProfilePresentationPreference = nextPresentation;
  playerProfilePresentationStore.set(nextPresentation);
  movePlayerProfileDialog(nextPresentation, {
    reopen: true,
    scrollTop: getPlayerProfileShellScrollTop(),
    persistDetailPreference: true
  });
  requestAnimationFrame(() => toggle.focus({ preventScroll: true }));
}

function cancelPlayerProfileCloseTransition() {
  if (!playerProfileCloseTimer) return;
  clearTimeout(playerProfileCloseTimer);
  playerProfileCloseTimer = null;
  document.getElementById('player-profile-dialog')?.classList.remove('is-closing');
  if (playerProfilePresentation === 'panel') {
    document.body.classList.add('player-profile-panel-open');
    updatePlayerProfilePanelMetrics();
  }
}

function renderPlayerProfile(profile) {
  const identity = profile.identity || {};
  const knownPlayer = (window.PADEL_PLAYERS || []).find(player => player.id === identity.id);
  playerProfileData = profile;
  playerProfileActiveId = identity.id || playerProfileActiveId;
  playerProfileExpanded = false;
  playerProfileMatchScope = 'past';
  playerProfileCompareId = null;
  arrangePlayerProfileContent();
  document.getElementById('player-profile-name').textContent = identity.displayName || 'Spielerprofil';
  const profileCompany = identity.company || 'PadelLiga';
  const profileCompanyElement = document.getElementById('player-profile-company');
  const profileCompanyHasLogo = COMPANIES_WITH_LOGO.includes(profileCompany);
  profileCompanyElement.textContent = profileCompanyHasLogo ? '' : profileCompany;
  profileCompanyElement.className = 'player-profile-company firma-badge';
  profileCompanyElement.toggleAttribute('role', profileCompanyHasLogo);
  profileCompanyElement.toggleAttribute('aria-label', profileCompanyHasLogo);
  if (profileCompanyHasLogo) {
    profileCompanyElement.classList.add('firma-logo');
    profileCompanyElement.classList.add(`firma-${profileCompany}`);
    profileCompanyElement.setAttribute('role', 'img');
    profileCompanyElement.setAttribute('aria-label', profileCompany);
  }
  configurePlayerProfileImage(
    document.getElementById('player-profile-avatar-image'),
    document.getElementById('player-profile-avatar-placeholder'),
    `assets/players/${encodeURIComponent(identity.id)}/profile.webp`,
    `Profilbild von ${identity.displayName}`,
    identity.profileEmoji || knownPlayer?.profileEmoji
  );
  renderPlayerProfileAchievements(profile.achievements || []);
  renderPlayerProfileStats(profile.summary || {}, profile.matches || []);
  renderPlayerProfileParticipations(profile.participations || [], profile.matches || []);
  renderPlayerProfileRelationships(profile.matches || []);
  renderPlayerProfileCompare(profile);
  renderPlayerProfileHistory();
  document.getElementById('player-profile-state').hidden = true;
  document.getElementById('player-profile-content').hidden = false;
  updatePlayerProfileHeroCondensed();
  updatePlayerProfileRankingHighlights();
  announcePlayerProfilePanel(identity.displayName || knownPlayer?.name);
  playerProfileChart?.destroy();
  playerProfileChart = null;
  document.getElementById('player-profile-elo-chart')?.replaceChildren();
  document.getElementById('player-profile-chart-legend').innerHTML = '';
  document.getElementById('player-profile-elo-range').textContent = 'Diagramm wird geladen …';
  requestAnimationFrame(() => {
    if (playerProfileData === profile && document.getElementById('player-profile-dialog')?.open) {
      renderPlayerProfileEloChart(profile.eloSeries || []);
    }
  });
}

async function openPlayerProfile(playerId, trigger = null, options = {}) {
  const dialog = document.getElementById('player-profile-dialog');
  if (!dialog || !playerId) return;
  const profileWasOpen = dialog.open;
  cancelPlayerProfileCloseTransition();
  if (!profileWasOpen) playerProfilePresentationPreference = playerProfilePresentationStore.get();
  const statisticsTransition = window.PadelMatchStatistics?.prepareProfileOpen(
    trigger,
    playerId,
    options.fromHistory,
    options.sharedDetail
  );
  const replacesStatistics = Boolean(statisticsTransition?.replacesDetail);
  if (replacesStatistics) {
    playerProfilePresentationPreference = statisticsTransition.presentationPreference
      || statisticsTransition.presentation;
  }
  const triggerDialog = trigger?.closest?.('dialog');
  const opensFromMatchList = Boolean(
    !replacesStatistics
    && !triggerDialog
    && trigger?.closest?.('#partien')
    && document.getElementById('partien')?.classList.contains('active')
  );
  const opensFromEmbeddedMatchList = Boolean(
    isDetailEmbed
    && Object.prototype.hasOwnProperty.call(options, 'panelAvailable')
  );
  if (!profileWasOpen || opensFromEmbeddedMatchList) {
    if (opensFromEmbeddedMatchList) {
      playerProfileEmbeddedPanelAvailable = Boolean(options.panelAvailable);
    }
    playerProfilePanelOrigin = opensFromEmbeddedMatchList
      ? 'embedded-match-list'
      : opensFromMatchList ? 'match-list' : null;
    playerProfileReturnContext = (opensFromMatchList || opensFromEmbeddedMatchList)
      ? {
          trigger: trigger || document.activeElement,
          triggerMatch: null,
          scroll: window.scrollY,
          profileOpen: false
        }
      : null;
  }
  const panelContext = getPlayerProfilePanelContext();
  const opensFromAllTimeRanking = Boolean(trigger?.closest?.('#all-time-ranking-profile-main'));
  playerProfileForceModal = Boolean(
    options.forceModal
    || (statisticsTransition && !replacesStatistics)
    || (!replacesStatistics && triggerDialog && triggerDialog !== dialog)
    || (triggerDialog === dialog && playerProfileForceModal)
    || (panelContext?.id === 'all-time-ranking' && !profileWasOpen && !opensFromAllTimeRanking)
  );
  if (!(profileWasOpen && playerProfilePanelOrigin === 'match-list')) {
    playerProfileLastTrigger = trigger || document.activeElement;
  }
  playerProfileActiveId = playerId;
  updatePlayerProfileRankingHighlights();
  const knownPlayer = (PADEL_DATA?.allPlayers || PADEL_DATA?.players || [])
    .find(player => player.id === playerId)
    || (window.PADEL_PLAYERS || []).find(player => player.id === playerId);
  document.getElementById('player-profile-name').textContent = knownPlayer?.name || 'Spielerprofil';
  const requestId = ++playerProfileRequestId;
  const cachedProfile = getCachedPlayerProfile(playerId);
  if (!cachedProfile) setPlayerProfileState('Spielerprofil wird geladen …');
  const nextPresentation = shouldUsePlayerProfilePanel() ? 'panel' : 'modal';
  if (!dialog.open || nextPresentation !== playerProfilePresentation) {
    movePlayerProfileDialog(nextPresentation, {
      reopen: true,
      restoreTriggerFocus: nextPresentation === 'panel'
    });
  } else {
    const shell = dialog.querySelector('.player-profile-shell');
    if (shell) shell.scrollTop = 0;
    if (nextPresentation === 'panel' && panelContext?.id === 'match-statistics') {
      dialog.querySelector('[data-player-profile-close]')?.focus({ preventScroll: true });
    } else if (nextPresentation === 'panel' && playerProfileLastTrigger?.isConnected) {
      playerProfileLastTrigger.focus({ preventScroll: true });
    }
  }
  updatePlayerProfilePresentationToggle();

  if (cachedProfile) {
    renderPlayerProfile(cachedProfile);
    return;
  }

  try {
    const profile = await fetchPlayerProfile(playerId);
    if (requestId !== playerProfileRequestId) return;
    if (!profile?.identity) throw new Error('Spielerprofil nicht gefunden.');
    renderPlayerProfile(profile);
  } catch (error) {
    if (requestId !== playerProfileRequestId) return;
    setPlayerProfileState('Das Spielerprofil konnte nicht geladen werden.', { error: true });
    console.error(error);
  }
}

window.PadelLigaOpenPlayerProfile = openPlayerProfile;
window.PadelLigaCapturePlayerProfile = () => ({
  data: playerProfileData,
  expanded: playerProfileExpanded,
  matchScope: playerProfileMatchScope,
  compareId: playerProfileCompareId,
  scrollTop: getPlayerProfileShellScrollTop(),
  presentation: playerProfilePresentation,
  presentationPreference: playerProfilePresentationPreference,
  activeId: playerProfileActiveId,
  forceModal: playerProfileForceModal
});
window.PadelLigaGetPlayerProfileDetailContext = () => {
  const profile = document.getElementById('player-profile-dialog');
  if (!profile?.open || !['match-list', 'embedded-match-list'].includes(playerProfilePanelOrigin)) return null;
  return {
    active: true,
    origin: playerProfilePanelOrigin,
    presentation: playerProfilePresentation,
    presentationPreference: playerProfilePresentationPreference || playerProfilePresentation,
    panelAvailable: playerProfilePanelOrigin === 'embedded-match-list'
      ? playerProfileEmbeddedPanelAvailable
      : hasPlayerProfilePanelSpace(),
    returnContext: playerProfileReturnContext
  };
};
window.PadelLigaRestorePlayerProfile = snapshot => {
  const profile = document.getElementById('player-profile-dialog');
  if (!snapshot?.data || !profile) return;
  ++playerProfileRequestId;
  playerProfileActiveId = snapshot.activeId || snapshot.data.identity?.id || null;
  playerProfilePresentationPreference = ['panel', 'modal'].includes(snapshot.presentationPreference)
    ? snapshot.presentationPreference
    : null;
  playerProfileForceModal = Boolean(snapshot.forceModal);
  playerProfileLastTrigger = playerProfileLastTrigger?.isConnected ? playerProfileLastTrigger : document.activeElement;
  movePlayerProfileDialog(shouldUsePlayerProfilePanel() ? 'panel' : 'modal', {
    reopen: true,
    scrollTop: snapshot.scrollTop || 0,
    restoreTriggerFocus: shouldUsePlayerProfilePanel()
  });
  renderPlayerProfile(snapshot.data);
  playerProfileExpanded = snapshot.expanded;
  playerProfileMatchScope = snapshot.matchScope === 'upcoming' ? 'upcoming' : 'past';
  playerProfileCompareId = snapshot.compareId || null;
  renderPlayerProfileCompare(snapshot.data);
  renderPlayerProfileHistory();
  requestAnimationFrame(() => {
    const shell = profile.querySelector('.player-profile-shell');
    if (shell) shell.scrollTop = snapshot.scrollTop || 0;
  });
};
window.PadelLigaClosePlayerProfile = options => closePlayerProfile(options);
window.PadelLigaReconcilePlayerProfile = reconcilePlayerProfilePresentation;
window.PadelLigaSetEmbeddedPlayerProfilePanelAvailability = available => {
  if (playerProfilePanelOrigin !== 'embedded-match-list') return;
  playerProfileEmbeddedPanelAvailable = Boolean(available);
  reconcilePlayerProfilePresentation();
};

function finalizePlayerProfileClose({ restoreFocus = true } = {}) {
  const dialog = document.getElementById('player-profile-dialog');
  const closesMatchListPanel = playerProfilePanelOrigin === 'match-list';
  if (dialog?.open) dialog.close();
  dialog?.classList.remove('is-closing', 'is-detail-panel-swap');
  document.body.classList.remove('player-profile-panel-open');
  delete document.body.dataset.playerProfilePanelContext;
  document.body.style.removeProperty('--ranking-profile-split-left');
  if (closesMatchListPanel) {
    document.body.classList.remove('match-statistics-panel-open');
    document.body.style.removeProperty('--match-statistics-split-left');
  }
  const modalHost = document.getElementById('player-profile-modal-host');
  if (dialog && modalHost && dialog.parentElement !== modalHost) modalHost.append(dialog);
  playerProfilePresentation = 'modal';
  playerProfilePresentationPreference = null;
  if (dialog) dialog.dataset.presentation = 'modal';
  arrangePlayerProfileContent('modal');
  playerProfileChart?.destroy();
  playerProfileChart = null;
  playerProfileData = null;
  playerProfileActiveId = null;
  playerProfileForceModal = false;
  playerProfilePanelOrigin = null;
  playerProfileReturnContext = null;
  playerProfileEmbeddedPanelAvailable = false;
  updatePlayerProfilePresentationToggle();
  updatePlayerProfileRankingHighlights();
  const status = document.getElementById('player-profile-panel-status');
  if (status) status.textContent = '';
  const profileReturnTarget = playerProfileLastTrigger?.closest?.('[inert]')
    ? document.querySelector('[data-global-actions-toggle]')
    : playerProfileLastTrigger;
  if (restoreFocus) profileReturnTarget?.focus?.({ preventScroll: true });
}

function closePlayerProfile(options = {}) {
  if (!options.fromHistory && window.PadelMatchStatistics?.closeProfile()) return;
  const dialog = document.getElementById('player-profile-dialog');
  if (!dialog?.open) return;
  if (playerProfileCloseTimer) return;
  ++playerProfileRequestId;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (playerProfilePresentation !== 'panel' || options.immediate || options.fromHistory || reduceMotion) {
    finalizePlayerProfileClose({ restoreFocus: options.restoreFocus !== false });
    return;
  }
  dialog.classList.add('is-closing');
  document.body.classList.remove('player-profile-panel-open');
  if (playerProfilePanelOrigin === 'match-list') {
    document.body.classList.remove('match-statistics-panel-open');
  }
  playerProfileCloseTimer = setTimeout(() => {
    playerProfileCloseTimer = null;
    finalizePlayerProfileClose({ restoreFocus: options.restoreFocus !== false });
  }, PLAYER_PROFILE_PANEL_TRANSITION_MS);
}

document.addEventListener('pointerover', event => {
  if (event.pointerType !== 'mouse') return;
  const playerToggleControl = event.target.closest('[data-player-toggle-id]');
  if (playerToggleControl) setHoveredEloChartPlayers([playerToggleControl.dataset.playerToggleName]);
  const companyToggleControl = event.target.closest('[data-company-toggle]');
  if (companyToggleControl) {
    setHoveredEloChartPlayers(getStatisticsCompanyPlayers(companyToggleControl.dataset.companyToggle).map(player => player.name));
  }
});

document.addEventListener('pointerout', event => {
  if (event.pointerType !== 'mouse') return;
  const playerToggleControl = event.target.closest('[data-player-toggle-id]');
  if (playerToggleControl && !playerToggleControl.contains(event.relatedTarget)) setHoveredEloChartPlayers();
  const companyToggleControl = event.target.closest('[data-company-toggle]');
  if (companyToggleControl && !companyToggleControl.contains(event.relatedTarget)) setHoveredEloChartPlayers();
});

document.addEventListener('click', event => {
  const helpTooltipAnchor = event.target.closest('[data-help-tooltip-anchor]');
  if (helpTooltipAnchor) {
    const wrapper = helpTooltipAnchor.closest('.th-help-wrap');
    const willOpen = !wrapper?.classList.contains('is-open');
    closePinnedHelpTooltips(wrapper);
    positionHelpTooltip(helpTooltipAnchor);
    wrapper?.classList.toggle('is-open', willOpen);
    helpTooltipAnchor.setAttribute('aria-expanded', String(willOpen));
    if (!willOpen) helpTooltipAnchor.blur();
    return;
  }
  closePinnedHelpTooltips();

  const profileComparePicker = document.querySelector('[data-profile-compare-picker].open');
  if (profileComparePicker && !profileComparePicker.contains(event.target)) setPlayerProfileComparePickerOpen(false);

  const profileCompareToggle = event.target.closest('[data-profile-compare-toggle]');
  if (profileCompareToggle) {
    setPlayerProfileComparePickerOpen(!profileCompareToggle.closest('[data-profile-compare-picker]').classList.contains('open'));
    return;
  }

  const profileCompareOption = event.target.closest('[data-profile-compare-value]');
  if (profileCompareOption) {
    selectPlayerProfileCompare(profileCompareOption.dataset.profileCompareValue);
    return;
  }

  const detailViewBackControl = event.target.closest('[data-detail-view-back]');
  if (detailViewBackControl) {
    closeLiveTicker();
    return;
  }

  const playerProfileOpenControl = event.target.closest('[data-player-profile-id]');
  if (playerProfileOpenControl) {
    const playerProfileRow = playerProfileOpenControl.matches(PLAYER_PROFILE_ROW_SELECTOR)
      ? playerProfileOpenControl
      : null;
    const rowClickHitsControl = playerProfileRow && event.target.closest(
      'a, button, input, select, textarea, summary, [role="button"], [data-form-match-id], [data-help-tooltip-anchor]'
    );
    if (!playerProfileRow || !rowClickHitsControl) {
      openPlayerProfile(playerProfileOpenControl.dataset.playerProfileId, playerProfileOpenControl);
      return;
    }
  }

  const playerProfilePresentationToggle = event.target.closest('[data-player-profile-presentation-toggle]');
  if (playerProfilePresentationToggle) {
    togglePlayerProfilePresentation();
    return;
  }

  const playerProfileCloseControl = event.target.closest('[data-player-profile-close]');
  if (playerProfileCloseControl) {
    closePlayerProfile();
    return;
  }

  const playerProfileShowAllControl = event.target.closest('[data-player-profile-show-all]');
  if (playerProfileShowAllControl) {
    playerProfileExpanded = true;
    renderPlayerProfileHistory();
    return;
  }

  const playerProfileMatchScopeControl = event.target.closest('[data-player-profile-match-scope]');
  if (playerProfileMatchScopeControl) {
    const scope = playerProfileMatchScopeControl.dataset.playerProfileMatchScope;
    if (scope !== playerProfileMatchScope) {
      playerProfileMatchScope = scope;
      renderPlayerProfileHistory();
    }
    return;
  }

  const appHintDismissControl = event.target.closest('[data-dismiss-app-hint]');
  if (appHintDismissControl) {
    dismissAppHint();
    return;
  }

  const seasonToggle = event.target.closest('[data-season-toggle]');
  if (seasonToggle) {
    toggleSeasonMenu();
    return;
  }

  const seasonOption = event.target.closest('[data-season-id]');
  if (seasonOption) {
    selectSeason(seasonOption.dataset.seasonId);
    return;
  }

  const viewerToggle = event.target.closest('[data-viewer-toggle]');
  if (viewerToggle) {
    toggleViewerMenu();
    return;
  }

  const viewerOption = event.target.closest('[data-viewer-id]');
  if (viewerOption) {
    selectViewer(viewerOption.dataset.viewerId);
    return;
  }

  const navControl = event.target.closest('[data-nav-target], nav button[data-section]');
  if (navControl) {
    nav(navControl.dataset.navTarget || navControl.dataset.section, navControl.matches('nav button') ? navControl : null);
    return;
  }

  const matchScopeControl = event.target.closest('[data-match-scope]');
  if (matchScopeControl) {
    setMatchScope(matchScopeControl.dataset.matchScope);
    return;
  }

  const matchSortControl = event.target.closest('[data-match-sort]');
  if (matchSortControl) {
    setMatchSort(matchSortControl.dataset.matchSort);
    return;
  }

  const rankingSortControl = event.target.closest('button[data-ranking-sort]');
  if (rankingSortControl) {
    setRankingSort(rankingSortControl.dataset.rankingSort);
    return;
  }

  const rankingViewControl = event.target.closest('button[data-ranking-view]');
  if (rankingViewControl) {
    setRankingView(rankingViewControl.dataset.rankingView);
    return;
  }

  const allTimeRankingSortControl = event.target.closest('[data-all-time-ranking-sort]');
  if (allTimeRankingSortControl) {
    setAllTimeRankingSort(allTimeRankingSortControl.dataset.allTimeRankingSort);
    return;
  }

  const allTimeRankingScopeControl = event.target.closest('[data-all-time-ranking-scope]');
  if (allTimeRankingScopeControl) {
    setAllTimeRankingScope(allTimeRankingScopeControl.dataset.allTimeRankingScope);
    return;
  }

  const allTimeRankingViewControl = event.target.closest('[data-all-time-ranking-view]');
  if (allTimeRankingViewControl) {
    setAllTimeRankingView(allTimeRankingViewControl.dataset.allTimeRankingView);
    return;
  }

  const statisticsModeControl = event.target.closest('[data-statistics-mode]');
  if (statisticsModeControl) {
    void setStatisticsMode(statisticsModeControl.dataset.statisticsMode);
    return;
  }

  const homeArticleControl = event.target.closest('[data-expand-home-article]');
  if (homeArticleControl) {
    expandHomeArticle();
    return;
  }

  const infoArticleControl = event.target.closest('[data-expand-info-article]');
  if (infoArticleControl) {
    expandInfoArticle(Number(infoArticleControl.dataset.expandInfoArticle));
    return;
  }

  const infoMenuControl = event.target.closest('[data-info-menu-toggle]');
  if (infoMenuControl) {
    const expanded = infoMenuControl.getAttribute('aria-expanded') === 'true';
    infoMenuControl.setAttribute('aria-expanded', String(!expanded));
    infoMenuControl.closest('.info-menu-card')?.classList.toggle('is-expanded', !expanded);
    return;
  }

  const infoMenuLink = event.target.closest('#info-menu a');
  if (infoMenuLink && mobileViewportQuery.matches) {
    event.preventDefault();
    const infoMenuCard = infoMenuLink.closest('.info-menu-card');
    const infoMenu = infoMenuCard?.querySelector('.info-menu');
    const targetId = decodeURIComponent(infoMenuLink.hash.slice(1));
    const target = targetId ? document.getElementById(targetId) : null;
    infoMenuCard?.classList.remove('is-expanded');
    infoMenuCard?.querySelector('[data-info-menu-toggle]')?.setAttribute('aria-expanded', 'false');

    if (target) {
      let didNavigate = false;
      const navigateToTarget = () => {
        if (didNavigate) return;
        didNavigate = true;
        window.history.pushState(null, '', infoMenuLink.hash);
        target.scrollIntoView();
      };

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        window.requestAnimationFrame(navigateToTarget);
      } else {
        const handleMenuTransitionEnd = transitionEvent => {
          if (transitionEvent.propertyName !== 'grid-template-rows') return;
          infoMenu?.removeEventListener('transitionend', handleMenuTransitionEnd);
          navigateToTarget();
        };
        infoMenu?.addEventListener('transitionend', handleMenuTransitionEnd);
        window.setTimeout(() => {
          infoMenu?.removeEventListener('transitionend', handleMenuTransitionEnd);
          navigateToTarget();
        }, 300);
      }
    }
    return;
  }

  const chartToggleAllControl = event.target.closest('[data-chart-toggle-all]');
  if (chartToggleAllControl) {
    toggleAll(chartToggleAllControl.dataset.chartToggleAll === 'true');
    return;
  }

  const companyToggleControl = event.target.closest('[data-company-toggle]');
  if (companyToggleControl) {
    toggleCompany(companyToggleControl.dataset.companyToggle);
    return;
  }

  const calculatorResetControl = event.target.closest('[data-calculator-reset]');
  if (calculatorResetControl) {
    if (calculatorResetControl.dataset.calculatorReset === 'final-four') {
      finalFourCalculatorResults = new Map();
      activeCalculatorMatchId = null;
      renderFinalFourCalculator();
      syncCalculatorActiveMatchCard();
    } else resetCalculator();
    return;
  }

  const finalFourOutcome = event.target.closest('[data-final-four-score]');
  if (finalFourOutcome) {
    const matchId = finalFourOutcome.dataset.calculatorMatchId;
    getCalculatorEntry(matchId).set1 = finalFourOutcome.dataset.finalFourScore.split(':');
    setActiveCalculatorMatch(matchId, false);
    syncCalculatorScoreInputs(matchId);
    renderCalculatorMatchStatus(matchId);
    renderFinalFourCalculatorRanking();
    return;
  }

  const calculatorAutoTipControl = event.target.closest('[data-calculator-autotip]');
  if (calculatorAutoTipControl) {
    setCalculatorAutoTip(!calculatorAutoTip);
    return;
  }

  const calculatorStepControl = event.target.closest('[data-calculator-step]');
  if (calculatorStepControl) {
    stepCalculatorScore(calculatorStepControl);
    return;
  }

  const calculatorPresetControl = event.target.closest('[data-calculator-preset-team]');
  if (calculatorPresetControl) {
    applyCalculatorStraightSetsPreset(
      calculatorPresetControl.dataset.calculatorMatchId,
      Number(calculatorPresetControl.dataset.calculatorPresetTeam)
    );
    return;
  }

  const playerToggleControl = event.target.closest('[data-player-toggle-id]');
  if (playerToggleControl) {
    toggleP(
      playerToggleControl.dataset.playerToggleId,
      Number(playerToggleControl.dataset.playerToggleIndex),
      playerToggleControl
    );
    return;
  }

  const picker = document.getElementById('viewer-picker');
  if (picker && !picker.contains(event.target)) closeViewerMenu();
  const seasonPicker = document.getElementById('season-picker');
  if (seasonPicker && !seasonPicker.contains(event.target)) closeSeasonMenu();
});

document.addEventListener('input', event => {
  const viewerSearchInput = event.target.closest('[data-viewer-search]');
  if (viewerSearchInput) {
    filterViewerOptions(viewerSearchInput.value);
    return;
  }

  const profileCompareSearch = event.target.closest('[data-profile-compare-search]');
  if (profileCompareSearch) {
    filterPlayerProfileCompareOptions(profileCompareSearch.value);
    return;
  }

  const calculatorScoreInput = event.target.closest('[data-calculator-score]');
  if (!calculatorScoreInput) return;

  updateCalculatorScore(calculatorScoreInput);
});

document.addEventListener('pointerdown', event => {
  const calculatorScoreControl = event.target.closest('[data-calculator-score], [data-calculator-step]');
  if (calculatorScoreControl) {
    setActiveCalculatorScorePair(calculatorScoreControl.closest('.score-counter-pair'));
  } else if (!event.target.closest('[data-result-score], [data-result-score-step]')) {
    setActiveCalculatorScorePair(null);
  }

  const calculatorScoreInput = event.target.closest('[data-calculator-score]');
  if (!calculatorScoreInput) return;

  clearCalculatorScoreInput(calculatorScoreInput);
  setActiveCalculatorMatch(calculatorScoreInput.dataset.calculatorMatchId);
});

document.addEventListener('mouseover', event => {
  const helpIcon = event.target.closest('.help-icon, [data-help-tooltip-anchor]');
  if (helpIcon) positionHelpTooltip(helpIcon);

  const formChip = event.target.closest('[data-form-match-id]');
  if (formChip) showFormTooltip(formChip);
});

document.addEventListener('mouseout', event => {
  const formChip = event.target.closest('[data-form-match-id]');
  if (formChip && !formChip.contains(event.relatedTarget)) hideFormTooltip();
});

document.addEventListener('focusin', event => {
  const helpIcon = event.target.closest('.help-icon, [data-help-tooltip-anchor]');
  if (helpIcon) positionHelpTooltip(helpIcon);

  const calculatorScoreControl = event.target.closest('[data-calculator-score], [data-calculator-step]');
  if (calculatorScoreControl) setActiveCalculatorScorePair(calculatorScoreControl.closest('.score-counter-pair'));

  const calculatorScoreInput = event.target.closest('[data-calculator-score]');
  if (calculatorScoreInput) {
    clearCalculatorScoreInput(calculatorScoreInput);
    setActiveCalculatorMatch(calculatorScoreInput.dataset.calculatorMatchId);
  }

  const formChip = event.target.closest('[data-form-match-id]');
  if (formChip) showFormTooltip(formChip);
});

document.addEventListener('focusout', event => {
  const formChip = event.target.closest('[data-form-match-id]');
  if (formChip) hideFormTooltip();
});

document.addEventListener('keydown', event => {
  const playerProfileRow = event.target.closest(PLAYER_PROFILE_ROW_SELECTOR);
  if (event.target === playerProfileRow && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openPlayerProfile(playerProfileRow.dataset.playerProfileId, playerProfileRow);
    return;
  }

  const profileCompareSearch = event.target.closest('[data-profile-compare-search]');
  if (profileCompareSearch) {
    const visibleOptions = [...document.querySelectorAll('[data-profile-compare-value]')]
      .filter(option => !option.hidden);
    if (event.key === 'Escape') {
      event.preventDefault();
      setPlayerProfileComparePickerOpen(false);
      document.querySelector('[data-profile-compare-toggle]')?.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'ArrowDown' && visibleOptions.length) {
      event.preventDefault();
      visibleOptions[0].focus();
      return;
    }
    if (event.key === 'Enter' && profileCompareSearch.value && visibleOptions.length) {
      event.preventDefault();
      selectPlayerProfileCompare(visibleOptions[0].dataset.profileCompareValue);
      return;
    }
  }

  const viewerSearchInput = event.target.closest('[data-viewer-search]');
  if (viewerSearchInput) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeViewerMenu();
      if (!document.querySelector('[data-viewer-toggle]')?.closest('[inert]')) {
        document.querySelector('[data-viewer-toggle]')?.focus({ preventScroll: true });
      }
      return;
    }
    const visibleOptions = [...document.querySelectorAll('#viewer-menu [data-viewer-id]')]
      .filter(option => !option.hidden);
    if (event.key === 'ArrowDown' && visibleOptions.length) {
      event.preventDefault();
      visibleOptions[0].focus();
      return;
    }
    if (event.key === 'Enter' && viewerSearchInput.value && visibleOptions.length) {
      event.preventDefault();
      selectViewer(visibleOptions[0].dataset.viewerId);
      return;
    }
  }

  if (event.key === 'Enter' && event.target.matches('[data-calculator-score]')) {
    event.preventDefault();
    return;
  }
  if (event.key === 'Escape') {
    const openPickerToggle = document.querySelector('.viewer-picker.open [data-viewer-toggle], .season-picker.open [data-season-toggle]');
    closeViewerMenu();
    closeSeasonMenu();
    openPickerToggle?.focus({ preventScroll: true });
    closePinnedHelpTooltips();
    hideFormTooltip();
  }
});

function setMatchScope(scope) {
  matchScope = ['all', 'open', 'mine'].includes(scope) ? scope : 'all';
  if (matchScope === 'mine' && !isParticipantView()) matchScope = 'all';
  renderPartien();
}

function updateMatchScopeToggle() {
  const toggle = document.getElementById('match-scope-toggle');
  if (!toggle) return;

  const buttons = toggle.querySelectorAll('button');
  const canFilter = isParticipantView();
  if (!canFilter && matchScope === 'mine') matchScope = 'all';

  buttons[0].classList.toggle('active', matchScope === 'all');
  buttons[1].classList.toggle('active', matchScope === 'open');
  buttons[2].classList.toggle('active', matchScope === 'mine');
  buttons[2].disabled = !canFilter;
}

function setMatchSort(mode) {
  const nextMode = mode === 'date' ? 'date' : 'matchday';
  // Ein erneuter Klick dreht die Richtung um, ein Wechsel beginnt wieder aufsteigend.
  matchSortDescending = nextMode === matchSortMode && !matchSortDescending;
  matchSortMode = nextMode;
  renderPartien({ animateSort: true });
}

function updateMatchSortToggle() {
  const toggle = document.getElementById('match-sort-toggle');
  if (!toggle) return;

  toggle.dataset.sortDirection = matchSortDescending ? 'descending' : 'ascending';
  toggle.querySelectorAll('button').forEach(button => {
    const isActive = button.dataset.matchSort === matchSortMode;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
    if (isActive) button.setAttribute('aria-label', `${button.textContent.trim()}, ${matchSortDescending ? 'absteigend' : 'aufsteigend'}`);
    else button.removeAttribute('aria-label');
  });
}

function applyMatchSortDirection(items) {
  return matchSortDescending ? [...items].reverse() : items;
}

function setRankingSort(mode) {
  const nextMode = ['games', 'wins', 'points', 'diff', 'elo', 'form', 'winrate', 'draw-factor'].includes(mode)
    ? mode
    : 'points';
  if (nextMode === rankingSortMode) return;
  rankingSortMode = nextMode;
  renderRanking();
}

function updateRankingSortHeaders() {
  updateSortHeaders('#ranking-table [data-ranking-sort]', 'rankingSort', rankingSortMode, rankingSortMode === 'draw-factor' ? 'ascending' : 'descending');
}

function setRankingView(mode) {
  rankingViewMode = mode === 'expanded' ? 'expanded' : 'compact';
  renderRanking();
}

function updateRankingViewToggle() {
  const toggle = document.getElementById('ranking-view-toggle');
  if (!toggle) return;

  const buttons = toggle.querySelectorAll('button');
  buttons[0].classList.toggle('active', rankingViewMode === 'compact');
  buttons[1].classList.toggle('active', rankingViewMode === 'expanded');
}

function setAllTimeRankingView(mode) {
  allTimeRankingViewMode = mode === 'expanded' ? 'expanded' : 'compact';
  renderAllTimeRanking();
}

function setAllTimeRankingSort(mode) {
  const nextMode = ['games', 'wins', 'points', 'average', 'diff'].includes(mode) ? mode : 'points';
  if (nextMode === allTimeRankingSortMode) return;
  allTimeRankingSortMode = nextMode;
  renderAllTimeRanking();
}

function setAllTimeRankingScope(scope) {
  allTimeRankingScope = ALL_TIME_RANKING_SCOPES.includes(scope) ? scope : 'league';
  renderAllTimeRanking();
}

function updateAllTimeRankingViewToggle() {
  const toggle = document.getElementById('all-time-ranking-view-toggle');
  if (!toggle) return;

  const buttons = toggle.querySelectorAll('button');
  buttons[0].classList.toggle('active', allTimeRankingViewMode === 'compact');
  buttons[1].classList.toggle('active', allTimeRankingViewMode === 'expanded');
}

// ── NAV ───────────────────────────────────────────────────────────
function invalidateSections(ids = ['start', 'rangliste', 'partien', 'rechner', 'verlauf', 'infos']) {
  ids.forEach(id => renderedSections.delete(id));
}

function ensureSectionRendered(id) {
  if (!appReady || !PADEL_DATA || renderedSections.has(id)) return;
  const renderers = {
    start: renderHome,
    rangliste: renderRanking,
    partien: renderPartien,
    rechner: renderCalculator,
    verlauf: renderStatistik,
    infos: renderInfos
  };
  const render = renderers[id];
  if (!render) return;
  render();
  renderedSections.add(id);
}

function renderActiveSection() {
  const id = document.querySelector('main > .section.active')?.id;
  ensureSectionRendered(id);
  if (appReady && id === 'verlauf') initChart();
}

function nav(id, el) {
  // Vor dem Umschalten messen: Ein noch nicht gerenderter Bereich verkürzt die Seite kurzzeitig.
  const navigationPinned = isNavigationPinned();
  const panelContext = getPlayerProfilePanelContext()?.id;
  const keepsPanelContext = (panelContext === 'ranking' && id === 'rangliste')
    || (panelContext === 'all-time-ranking' && id === 'verlauf');
  const profileBelongsToMatchDetail = panelContext === 'match-statistics' && window.PadelMatchStatistics?.active;
  if (!keepsPanelContext && !profileBelongsToMatchDetail && playerProfilePresentation === 'panel') {
    closePlayerProfile({ immediate: true, restoreFocus: false });
  }
  if (id !== 'partien' && window.PadelMatchStatistics?.active) {
    window.PadelMatchStatistics.close();
  }
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const activeButton = el || document.querySelector(`nav button[data-section="${id}"]`);
  if (activeButton) activeButton.classList.add('active');
  renderActiveSection();
  if (navigationPinned || id === 'detail-view') scrollToTopInstantly();
}

async function openLiveTicker(matchId, options = {}) {
  if (!matchId) return;
  if (window.PadelMatchStatistics?.active) window.PadelMatchStatistics.restore();
  const targetSeasonId = String(normalizeSeasonId(options.seasonId) || '');
  if (targetSeasonId && targetSeasonId !== String(selectedSeason?.id || '')) {
    const url = window.PadelSeasonRouting.getLiveUrl(
      targetSeasonId,
      matchId,
      options.view === 'overview' ? 'overview' : 'match',
      { preserveSearch: true, preserveHash: true }
    );
    window.location.assign(url);
    return;
  }
  const dialog = document.getElementById('detail-view-dialog');
  if (!dialog) return;
  if (!dialog.open) {
    liveTickerReturnState = {
      trigger: document.activeElement,
      scrollY: window.scrollY
    };
    document.getElementById('final-four-view-switcher').innerHTML = '';
    document.getElementById('detail-view-body').innerHTML = '<div class="empty-state">Der Liveticker wird geladen …</div>';
    dialog.showModal();
  }
  const seasonLabel = document.getElementById('detail-view-context');
  if (seasonLabel) seasonLabel.textContent = selectedSeason?.label || PADEL_DATA?.label || '';
  await window.PadelLiveTicker?.load(matchId, {
    updateUrl: options.updateUrl !== false,
    view: options.view === 'overview' ? 'overview' : 'match'
  });
}

function closeLiveTicker(options = {}) {
  if (window.PadelMatchStatistics?.active) {
    if (!options.fromHistory) {
      if (isDetailEmbed) postToDetailEmbedParent({ type: 'padel:detail-closed' });
      window.PadelMatchStatistics.close();
    }
    return;
  }
  const liveRoute = window.PadelSeasonRouting.getRequestedLiveRoute(PADEL_DATA?.matches || []);
  if (!options.fromHistory && liveRoute) {
    window.history.back();
    return;
  }
  window.PadelLiveTicker?.close();
  const dialog = document.getElementById('detail-view-dialog');
  if (dialog?.open) dialog.close();
  const returnState = liveTickerReturnState;
  liveTickerReturnState = null;
  if (returnState) {
    const root = document.documentElement;
    root.classList.add('instant-scroll');
    window.scrollTo(0, returnState.scrollY);
    requestAnimationFrame(() => {
      root.classList.remove('instant-scroll');
      if (returnState.trigger?.isConnected) returnState.trigger.focus({ preventScroll: true });
    });
  }
}

window.PadelLigaOpenLiveTicker = openLiveTicker;
window.PadelLigaCloseLiveTicker = closeLiveTicker;

function isNavigationPinned() {
  const navigation = document.querySelector('.site-nav');
  return Boolean(navigation) && navigation.getBoundingClientRect().top <= 1;
}

function scrollToTopInstantly() {
  const root = document.documentElement;
  const navigation = document.querySelector('.site-nav');
  const header = document.querySelector('.site-header');
  const targetTop = header ? header.offsetHeight : 0;

  if (!navigation) return;

  root.classList.add('instant-scroll');
  window.scrollTo(0, targetTop);
  root.scrollTop = targetTop;
  document.body.scrollTop = targetTop;
  requestAnimationFrame(() => {
    root.classList.remove('instant-scroll');
  });
}

// ── RANKING ───────────────────────────────────────────────────────
function getPlayerStats(player, matches = PADEL_DATA.matches) {
  const played = matches.filter(m =>
    countsForRanking(m) &&
    m.sieger !== null &&
    (m.team1.spieler.includes(player.name) || m.team2.spieler.includes(player.name))
  );
  let siege = 0, punkte = 0, spielDiff = 0, myGames = 0, oppGames = 0, saetzeDiff = 0;
  played.forEach(m => {
    const inT1 = m.team1.spieler.includes(player.name);
    const won = (inT1 && m.sieger === 1) || (!inT1 && m.sieger === 2);
    const [s1, s2] = m.saetze.split(':').map(Number);
    const mySetCount = inT1 ? s1 : s2;
    const oppSetCount = inT1 ? s2 : s1;
    saetzeDiff += mySetCount - oppSetCount;
    if (mySetCount === 2 && oppSetCount === 0) punkte += 3;
    else if (mySetCount === 2 && oppSetCount === 1) punkte += 2;
    else if (mySetCount === 1 && oppSetCount === 2) punkte += 1;
    if (won) siege++;
    m.ergebnis.split(',').forEach(part => {
      const clean = part
        .split(/[–-]/)[0]
        .replace(/\s*\([^)]*\)/g, '')
        .trim();
      const match = clean.match(/^(\d+):(\d+)$/);
      if (match) {
        const g1 = parseInt(match[1]), g2 = parseInt(match[2]);
        if (g1 <= 7 && g2 <= 7) {
          myGames  += inT1 ? g1 : g2;
          oppGames += inT1 ? g2 : g1;
          spielDiff += (inT1 ? g1 : g2) - (inT1 ? g2 : g1);
        }
      }
    });
  });
  return { partien: played.length, siege, punkte, spielDiff, gewonneneSpiele: myGames, saetzeDiff, spieleGV: played.length > 0 ? `${myGames}:${oppGames}` : '—' };
}

function getLatestPlayerElo(player) {
  const elo = getLatestPlayerEloValue(player);
  return elo ?? '—';
}

function getLatestPlayerEloValue(player) {
  if (player.currentElo !== null && player.currentElo !== undefined
    && Number.isFinite(Number(player.currentElo))) return Number(player.currentElo);

  const latestHistory = (player.history || [])
    .map((h, index) => ({ ...h, index, dateValue: new Date(h.matchAt || h.date).getTime() }))
    .filter(h => Number.isFinite(h.dateValue) && Number.isFinite(Number(h.elo)))
    .sort((a, b) => b.dateValue - a.dateValue || b.index - a.index)[0];

  return latestHistory ? Number(latestHistory.elo) : null;
}

function getMatchNumber(matchOrLabel) {
  const value = typeof matchOrLabel === 'string'
    ? matchOrLabel
    : matchOrLabel?.displayLabel || matchOrLabel?.id;
  const taggedNumber = String(value || '').match(/(?:partie|final)[\s_-]*(\d+)/i);
  const trailingNumber = String(value || '').match(/(\d+)\s*$/);
  const match = taggedNumber || trailingNumber;
  return match ? Number(match[1]) : 0;
}

function getMatchOrderKey(match) {
  const dateKey = toDateKey(match?.datum) || '9999-12-31';
  const minutes = getMatchTimeMinutes(match || {});
  const matchNumber = getMatchNumber(match);

  return `${dateKey}|${String(minutes).padStart(4, '0')}|${String(matchNumber).padStart(4, '0')}`;
}

function getHistoryOrderKey(historyEntry, data = PADEL_DATA) {
  const historyMatch = historyEntry.matchId
    ? data.matches.find(match => match.id === historyEntry.matchId)
    : null;
  if (historyMatch) return getMatchOrderKey(historyMatch);

  if (historyEntry.matchAt) return `${historyEntry.matchAt}|${historyEntry.matchId || ''}`;
  const dateKey = toDateKey(historyEntry.date) || '0000-00-00';
  return `${dateKey}|0000|0000`;
}

function getPlayerEloBeforeMatch(player, match, data = PADEL_DATA) {
  const matchHistory = (player.history || []).find(historyEntry =>
    historyEntry.matchId === match?.id
      && historyEntry.oldElo !== null
      && historyEntry.oldElo !== undefined
      && Number.isFinite(Number(historyEntry.oldElo))
  );
  if (matchHistory) return Number(matchHistory.oldElo);

  const matchOrderKey = getMatchOrderKey(match);
  const latestHistoryBeforeMatch = (player.history || [])
    .map((historyEntry, index) => ({
      ...historyEntry,
      index,
      orderKey: getHistoryOrderKey(historyEntry, data)
    }))
    .filter(historyEntry =>
      historyEntry.orderKey < matchOrderKey &&
      Number.isFinite(Number(historyEntry.elo))
    )
    .sort((a, b) => b.orderKey.localeCompare(a.orderKey) || b.index - a.index)[0];

  return latestHistoryBeforeMatch ? Number(latestHistoryBeforeMatch.elo) : null;
}

function expectedScore(playerElo, opponentElo) {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 500));
}

const TEAM_ELO_WEAKER_WEIGHT = 0.7;

function getWeightedTeamElo(teamElos) {
  const [weakerElo, strongerElo] = [...teamElos].sort((a, b) => a - b);

  return weakerElo * TEAM_ELO_WEAKER_WEIGHT + strongerElo * (1 - TEAM_ELO_WEAKER_WEIGHT);
}

function getMatchWinProbabilityFromElos(match, getEloValue, data = PADEL_DATA) {
  const playersByName = new Map(data.players.map(p => [p.name, p]));
  const team1 = match.team1.spieler.map(name => playersByName.get(name));
  const team2 = match.team2.spieler.map(name => playersByName.get(name));

  if (team1.some(p => !p) || team2.some(p => !p)) return null;

  const team1Elos = team1.map(player => getEloValue(player, match));
  const team2Elos = team2.map(player => getEloValue(player, match));

  if ([...team1Elos, ...team2Elos].some(elo => elo === null)) return null;

  const team1Expected = expectedScore(getWeightedTeamElo(team1Elos), getWeightedTeamElo(team2Elos));
  const team1Probability = Math.round(team1Expected * 100);

  return {
    team1: team1Probability,
    team2: 100 - team1Probability
  };
}

function getMatchWinProbability(match) {
  return getMatchWinProbabilityFromElos(match, getLatestPlayerEloValue);
}

function getHistoricalMatchWinProbability(match, data = PADEL_DATA) {
  return getMatchWinProbabilityFromElos(
    match,
    (player, historicalMatch) => getPlayerEloBeforeMatch(player, historicalMatch, data),
    data
  );
}

function renderFirmenRanking() {
  const firmen = ['Headsquare', 'Hanako', 'Envidual'];
  const stats = firmen.map(firma => {
    const players = PADEL_DATA.players.filter(p => p.firma === firma);
    let partien = 0, siege = 0, punkte = 0, spielDiff = 0;
    players.forEach(p => {
      const s = getPlayerStats(p);
      partien   += s.partien;
      siege     += s.siege;
      punkte    += s.punkte;
      spielDiff += s.spielDiff;
    });
    const pktPerTN = players.length > 0 ? (punkte / players.length) : 0;
    return { firma, teilnehmer: players.length, partien, siege, punkte, spielDiff, pktPerTN };
  });
  stats.sort((a, b) =>
    b.pktPerTN  - a.pktPerTN  ||
    b.spielDiff - a.spielDiff
  );
  document.getElementById('fr-meta').textContent = '3 Firmen';
  document.getElementById('fr-body').innerHTML = stats.map((f, i) => {
    return `<tr class="r${i+1} ${isSelectedViewerFirma(f.firma) ? 'viewer-highlight' : ''}">
      <td class="col-rank rank-position">${i+1}</td>
      <td class="col-company"><span class="pname">${f.firma}</span></td>
      <td class="col-participants">${f.teilnehmer}</td>
      <td class="col-games">${f.partien}</td>
      <td class="col-points-per-player rank-score">${f.pktPerTN.toFixed(2)}</td>
      <td class="col-wins">${f.siege}</td>
      <td class="col-points">${f.punkte}</td>
      <td class="col-diff">${renderDiffValue(f.spielDiff, { played: f.partien > 0 })}</td>
    </tr>`;
  }).join('');
}

function getFinalFourMatches() {
  return PADEL_DATA.matches
    .filter(match => getMatchStage(match) === 'final-four')
    .sort(compareMatchesByNumber);
}

function getFinalFourDetailEntryMatchId(matches = getFinalFourMatches()) {
  if (matches.length !== 3 || !matches.every(hasAssignedMatchPlayers)) return null;

  const participantIds = new Set();
  for (const match of matches) {
    const matchParticipantIds = new Set([
      ...match.team1.playerIds,
      ...match.team2.playerIds
    ]);
    if (matchParticipantIds.size !== 4) return null;
    matchParticipantIds.forEach(playerId => participantIds.add(playerId));
  }

  return participantIds.size === 4 ? matches[0].id : null;
}

function getFinalFourPlayerNames(matches) {
  const preferredOrder = ['Erster', 'Zweiter', 'Dritter', 'Vierter'];
  const names = new Set(matches.flatMap(match => [
    ...match.team1.spieler,
    ...match.team2.spieler
  ]));

  return [
    ...preferredOrder.filter(name => names.has(name)),
    ...[...names].filter(name => !preferredOrder.includes(name))
  ];
}

function getSingleSetGameStats(match, playerName) {
  const score = String(match.ergebnis || '').match(/(\d+)\s*:\s*(\d+)/);
  if (!score) return { won: 0, lost: 0, diff: 0 };

  const teamIndex = getPlayerMatchTeamIndex({ name: playerName }, match);
  if (!teamIndex) return { won: 0, lost: 0, diff: 0 };

  const team1Games = Number(score[1]);
  const team2Games = Number(score[2]);
  const won = teamIndex === 1 ? team1Games : team2Games;
  const lost = teamIndex === 1 ? team2Games : team1Games;

  return { won, lost, diff: won - lost };
}

function getSingleSetGameDiff(match, playerName) {
  return getSingleSetGameStats(match, playerName).diff;
}

function getFinalFourStats(matches = getFinalFourMatches()) {
  const names = getFinalFourPlayerNames(matches);
  const leagueRanks = typeof getRankingPositionMap === 'function'
    ? getRankingPositionMap('points')
    : null;

  return {
    matches,
    stats: names.map((name, index) => {
      const playerMatches = matches.filter(match =>
        match.team1.spieler.includes(name) || match.team2.spieler.includes(name)
      );
      const playedMatches = playerMatches.filter(match => match.sieger !== null);
      const siege = playedMatches.filter(match => {
        const teamIndex = getPlayerMatchTeamIndex({ name }, match);
        return teamIndex && match.sieger === teamIndex;
      }).length;
      const gameStats = playedMatches.reduce((total, match) => {
        const game = getSingleSetGameStats(match, name);
        return {
          won: total.won + game.won,
          lost: total.lost + game.lost,
          diff: total.diff + game.diff
        };
      }, { won: 0, lost: 0, diff: 0 });

      return {
        name,
        seed: leagueRanks?.get(name) || index + 1,
        partien: playedMatches.length,
        siege,
        gamesWon: gameStats.won,
        gamesLost: gameStats.lost,
        diff: gameStats.diff,
        spieleGV: `${gameStats.won}:${gameStats.lost}`
      };
    }).sort((a, b) =>
      b.siege - a.siege ||
      b.diff - a.diff ||
      b.gamesWon - a.gamesWon ||
      a.seed - b.seed
    )
  };
}

function renderFinalFourRanking() {
  const body = document.getElementById('ff-body');
  const meta = document.getElementById('ff-meta');
  const note = document.getElementById('ff-ranking-note');
  const detailLink = document.getElementById('final-four-ranking-detail-link');
  if (!body || !meta) return;

  const { matches, stats } = getFinalFourStats();
  const detailEntryMatchId = getFinalFourDetailEntryMatchId(matches);
  const showSummerReplacement = normalizeSeasonId(PADEL_DATA.id) === '2026-sommer';
  meta.textContent = `${stats.length} Spieler`;
  if (note) {
    note.textContent = `Spiele: ${matches.length}  |  Sortierung: Siege · Spiel-Differenz · gewonnene Spiele · Ligaplatzierung`;
    if (showSummerReplacement) {
      const replacementNote = document.createElement('span');
      replacementNote.className = 'ranking-absence-note';
      replacementNote.textContent = '*Ludwig W. ist für Marco M. nachgerückt.';
      note.append(replacementNote);
    }
  }
  if (detailLink) {
    detailLink.hidden = !detailEntryMatchId;
    if (detailEntryMatchId) detailLink.dataset.liveOpenMatch = detailEntryMatchId;
    else delete detailLink.dataset.liveOpenMatch;
  }

  body.innerHTML = stats.map((player, index) => {
    const eloPlayer = PADEL_DATA.players.find(entry => entry.name === player.name);
    const replacementMark = showSummerReplacement && eloPlayer?.id === 'ludwig_w'
      ? '<span class="ranking-absence-mark"><span aria-hidden="true">*</span><span class="sr-only">, nachgerückt für Marco M.</span></span>'
      : '';

    const profilePlayerId = eloPlayer?.id || getPlayerIdByName(player.name);

    return `<tr class="r${index + 1}"${renderPlayerProfileRowAttributes({ id: profilePlayerId, name: player.name })}>
      <td class="col-rank rank-position">${index + 1}</td>
      <td class="col-name"><span class="player-cell-inner">${renderPlayerProfileLink(player, 'pname')}${replacementMark}</span></td>
      <td class="col-wins rank-score">${player.siege}</td>
      <td class="col-gv">${player.spieleGV}</td>
      <td class="col-diff">${renderDiffValue(player.diff)}</td>
      <td class="col-elo">${eloPlayer ? getLatestPlayerElo(eloPlayer) : '—'}</td>
    </tr>`;
  }).join('');
  updatePlayerProfileRankingHighlights();
}

function getRankingPositionMap(sortMode = 'points') {
  return new Map(getRankedPlayers(PADEL_DATA.matches, sortMode)
    .map((player, index) => [player.name, index + 1]));
}

function formatSignedInteger(value) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '±0';
  return value > 0 ? `+${value}` : `${value}`;
}

// Spieler ohne Vorschaubild werden gemerkt, damit nicht jedes Neurendern erneut eine 404-Anfrage auslöst.
const playersWithoutRankingAvatar = new Set();

document.addEventListener('error', event => {
  const image = event.target.closest?.('[data-ranking-avatar-image]');
  if (!image) return;
  playersWithoutRankingAvatar.add(image.dataset.rankingAvatarImage);
  image.hidden = true;
  image.nextElementSibling?.removeAttribute('hidden');
}, true);

// Das Bild belegt in der Punktesortierung die Lücke, die sonst der Punkte-Rang füllt.
const COMPANIES_WITH_LOGO = Object.freeze(['Envidual', 'Hanako', 'Headsquare']);

function renderCompanyIcon(company, extraClass = '') {
  const name = escapeHtml(company);
  return `<span class="firma-badge firma-icon firma-${name}${extraClass}" role="img" aria-label="Firma ${name}" title="${name}"></span>`;
}

function renderRankingCompanyBadge(player) {
  return COMPANIES_WITH_LOGO.includes(player.firma)
    ? renderCompanyIcon(player.firma)
    : `<span class="firma-badge">${escapeHtml(player.firma)}</span>`;
}

function renderRankingAvatar(player) {
  const playerId = player.id || '';
  const emoji = ['👨', '👩'].includes(player.profileEmoji) ? player.profileEmoji : '👤';
  const hasImage = playerId && !playersWithoutRankingAvatar.has(playerId);
  return `<span class="ranking-avatar" aria-hidden="true">${hasImage
    ? `<img class="ranking-avatar-image" src="assets/players/${encodeURIComponent(playerId)}/thumb.jpg" alt="" loading="lazy" data-ranking-avatar-image="${escapeHtml(playerId)}">`
    : ''}<span class="ranking-avatar-emoji"${hasImage ? ' hidden' : ''}>${emoji}</span></span>`;
}

function renderPointsRankReference(currentRank, pointsRank) {
  if (rankingSortMode === 'points' || !Number.isFinite(pointsRank)) return '';

  const delta = rankingSortMode === 'elo'
    ? currentRank - pointsRank
    : pointsRank - currentRank;
  const deltaClass = getDeltaClass(delta);
  const deltaLabel = formatSignedInteger(delta);

  return `<span class="points-rank-ref" title="Punkte-Rang ${pointsRank}, Veränderung ${deltaLabel}">
    <span class="points-rank-num">${pointsRank}</span>
    <span class="points-rank-delta ${deltaClass}">${deltaLabel}</span>
  </span>`;
}

function getPlayerMatches(player, matches = PADEL_DATA.matches) {
  return matches.filter(match =>
    match.team1.spieler.includes(player.name) || match.team2.spieler.includes(player.name)
  );
}

function getPlayerMatchTeamIndex(player, match) {
  if (match.team1.spieler.includes(player.name)) return 1;
  if (match.team2.spieler.includes(player.name)) return 2;
  return null;
}

function getPlayerMatchProbability(player, match, data = PADEL_DATA) {
  const probability = match.sieger === null
    ? getMatchWinProbability(match)
    : getHistoricalMatchWinProbability(match, data);
  const teamIndex = getPlayerMatchTeamIndex(player, match);

  if (!probability || !teamIndex) return null;
  return teamIndex === 1 ? probability.team1 : probability.team2;
}

function getPlayerWinQuote(player, matches = PADEL_DATA.matches, data = PADEL_DATA) {
  const probabilities = getPlayerMatches(player, matches)
    .filter(countsForRanking)
    .map(match => getPlayerMatchProbability(player, match, data))
    .filter(probability => Number.isFinite(probability));

  if (!probabilities.length) return null;

  return Math.round(probabilities.reduce((sum, probability) => sum + probability, 0) / probabilities.length);
}

function average(values) {
  const numericValues = values.filter(value => Number.isFinite(value));
  if (!numericValues.length) return null;

  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
}

function formatDecimal(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}

function formatSignedDecimal(value) {
  if (!Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(1));
  if (Object.is(rounded, -0) || rounded === 0) return '0.0';
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}

// Losfaktor-Referenz: All-Time „Gewertet“ nach Ø-Punkten. Vier gedachte Partien zum
// Ligaschnitt von 1,5 Punkten dämpfen Spieler mit wenigen Partien.
const DRAW_FACTOR_PRIOR_MATCHES = 4;
const DRAW_FACTOR_PRIOR_AVERAGE_POINTS = 1.5;
let drawFactorReferencePromise = null;

function requestDrawFactorReference() {
  if (allTimeStatisticsData || drawFactorReferencePromise) return;

  drawFactorReferencePromise = loadAllTimeStatisticsData()
    .then(() => renderRanking())
    .catch(error => console.error(error))
    .finally(() => {
      drawFactorReferencePromise = null;
    });
}

function getDrawFactorReferenceRankMap(data = PADEL_DATA) {
  if (!allTimeStatisticsData) return null;

  // Abgeschlossene Saisons bleiben auf dem Stand ihres offiziellen Abschlusses eingefroren.
  const frozenAt = data.completedAt ? Date.parse(data.completedAt) : null;
  const matches = getAllTimeOfficialMatches()
    .filter(match => frozenAt === null || Date.parse(match.matchAt) <= frozenAt);
  const statsByPlayer = getAllTimeScopedStats(matches.map(getAllTimeMatchContribution));
  const entries = data.players.map(player => {
    const stats = statsByPlayer.get(player.id);
    const average = stats?.partien > 0
      ? (stats.punkte + DRAW_FACTOR_PRIOR_MATCHES * DRAW_FACTOR_PRIOR_AVERAGE_POINTS) / (stats.partien + DRAW_FACTOR_PRIOR_MATCHES)
      : null;
    return { name: player.name, stats, average };
  });
  const experienced = entries
    .filter(entry => entry.average !== null)
    .sort((left, right) => right.average - left.average || compareAllTimeRankingByPoints(left, right));
  const newcomers = entries.filter(entry => entry.average === null);
  const rankMap = new Map(experienced.map((entry, index) => [entry.name, index + 1]));
  // Neulinge ohne gewertete Partie teilen sich die letzten Plätze.
  const newcomerRank = experienced.length + (newcomers.length + 1) / 2;
  newcomers.forEach(entry => rankMap.set(entry.name, newcomerRank));
  return rankMap;
}

// Das eigene Team zählt einschließlich des Spielers, weil die Auslosung Team-Elo ausgleicht.
function getPlayerDrawFactor(player, rankMap, matches = PADEL_DATA.matches) {
  if (!rankMap) return { teamAverage: null, opponentAverage: null, diff: null };

  const teamPlaces = [];
  const opponentPlaces = [];

  getPlayerMatches(player, matches).filter(countsForRanking).forEach(match => {
    const teamIndex = getPlayerMatchTeamIndex(player, match);
    if (!teamIndex) return;

    const team = teamIndex === 1 ? match.team1.spieler : match.team2.spieler;
    const opponents = teamIndex === 1 ? match.team2.spieler : match.team1.spieler;
    const teamAverage = average(team.map(name => rankMap.get(name)));
    const opponentAverage = average(opponents.map(name => rankMap.get(name)));

    if (teamAverage !== null) teamPlaces.push(teamAverage);
    if (opponentAverage !== null) opponentPlaces.push(opponentAverage);
  });

  const teamAverage = average(teamPlaces);
  const opponentAverage = average(opponentPlaces);
  const diff = teamAverage !== null && opponentAverage !== null
    ? teamAverage - opponentAverage
    : null;

  return { teamAverage, opponentAverage, diff };
}

function formatDrawFactor(factor) {
  if (!factor || !Number.isFinite(factor.diff)) return '—';

  const diffClass = getDeltaClass(factor.diff);
  return `<span class="draw-factor-muted">${formatDecimal(factor.teamAverage)}</span><span class="draw-factor-muted"> / </span><span class="draw-factor-muted">${formatDecimal(factor.opponentAverage)}</span><span class="draw-factor-muted"> / </span><span class="${diffClass}">${formatSignedDecimal(factor.diff)}</span>`;
}

function getPlayerRecentForm(player, matches = PADEL_DATA.matches) {
  return getPlayerMatches(player, matches)
    .filter(countsForRanking)
    .filter(match => match.sieger !== null)
    .sort((a, b) => getMatchOrderKey(b).localeCompare(getMatchOrderKey(a)))
    .slice(0, 3)
    .map((match, index) => {
      const teamIndex = getPlayerMatchTeamIndex(player, match);
      const [team1Sets, team2Sets] = String(match.saetze || '').split(':').map(Number);
      const mySets = teamIndex === 1 ? team1Sets : team2Sets;
      const opponentSets = teamIndex === 1 ? team2Sets : team1Sets;
      const won = match.sieger === teamIndex;
      const tieBreak = mySets === 1 && opponentSets === 2 || mySets === 2 && opponentSets === 1;
      const title = `${formatMatchNumberLabel(match)}: ${won ? 'Sieg' : 'Niederlage'}${tieBreak ? ' im Match-Tie-Break' : ''}`;

      return { match, index, won, tieBreak, title };
    });
}

function comparePlayerRecentForm(left, right, matches = PADEL_DATA.matches) {
  const leftForm = getPlayerRecentForm(left, matches);
  const rightForm = getPlayerRecentForm(right, matches);
  const winDifference = rightForm.filter(result => result.won).length - leftForm.filter(result => result.won).length;
  if (winDifference) return winDifference;

  for (let index = 0; index < 3; index += 1) {
    const leftResult = leftForm[index] ? Number(leftForm[index].won) : -1;
    const rightResult = rightForm[index] ? Number(rightForm[index].won) : -1;
    if (leftResult !== rightResult) return rightResult - leftResult;
  }
  return 0;
}

function getPlayerForm(player, matches = PADEL_DATA.matches) {
  return getPlayerRecentForm(player, matches)
    .map(result => `<span
        class="form-chip form-recency-${result.index} ${result.won ? 'form-win' : 'form-loss'} ${result.tieBreak ? 'form-tiebreak' : ''}"
        tabindex="0"
        aria-label="${escapeHtml(result.title)}"
        data-form-player="${escapeHtml(player.name)}"
        data-form-match-id="${escapeHtml(result.match.id)}"
      >${result.won ? 'S' : 'N'}</span>`)
    .reverse()
    .join('') || '<span class="neu">—</span>';
}

function getPlayerRankingExtras(player, rankMap, matches = PADEL_DATA.matches, data = PADEL_DATA) {
  return {
    winQuote: getPlayerWinQuote(player, matches, data),
    drawFactor: getPlayerDrawFactor(player, rankMap, matches),
    form: getPlayerForm(player, matches)
  };
}

function getPlayerUnratedMatchCount(player, matches = PADEL_DATA.matches) {
  return matches.filter(match =>
    isCancelledMatch(match)
    && getMatchStage(match) === 'league'
    && (match.team1.spieler.includes(player.name) || match.team2.spieler.includes(player.name))
  ).length;
}

function renderRankingMatchCount(player, matches = PADEL_DATA.matches) {
  const unratedCount = getPlayerUnratedMatchCount(player, matches);
  if (!unratedCount) return String(player.stats.partien);

  const tooltipText = `${unratedCount} ${unratedCount === 1 ? 'Partie' : 'Partien'} ohne Wertung`;
  const tooltipId = `ranking-unrated-${String(player.id || player.name).replace(/[^a-z0-9_-]+/gi, '-')}`;
  return `<span class="ranking-games-value">
    <span class="th-help-wrap ranking-unrated-wrap">
      <button class="ranking-unrated-count" type="button" aria-label="${escapeHtml(tooltipText)}" aria-describedby="${escapeHtml(tooltipId)}" aria-expanded="false" data-help-tooltip-anchor>${unratedCount}+</button>
      <span class="help-tooltip" id="${escapeHtml(tooltipId)}" role="tooltip">${escapeHtml(tooltipText)}</span>
    </span>
    <span>${player.stats.partien}</span>
  </span>`;
}

// Gleichstand teilt sich den mittleren Platz, damit die Namensreihenfolge den
// bereinigten Losfaktor-Rang nicht beeinflusst, etwa vor dem ersten Spieltag.
function getSharedPointsRankMap(matches = PADEL_DATA.matches) {
  const ranked = getRankedPlayers(matches, 'points');
  const isTied = (left, right) =>
    left.stats.punkte === right.stats.punkte &&
    left.stats.spielDiff === right.stats.spielDiff &&
    left.stats.gewonneneSpiele === right.stats.gewonneneSpiele;
  const rankMap = new Map();
  for (let start = 0; start < ranked.length;) {
    let end = start;
    while (end + 1 < ranked.length && isTied(ranked[start], ranked[end + 1])) end += 1;
    const sharedRank = (start + end) / 2 + 1;
    ranked.slice(start, end + 1).forEach(player => rankMap.set(player.name, sharedRank));
    start = end + 1;
  }
  return rankMap;
}

function getDrawFactorAdjustedRank(player, rankMap, referenceRankMap) {
  const currentRank = rankMap.get(player.name);
  const factor = getPlayerDrawFactor(player, referenceRankMap);

  if (!Number.isFinite(currentRank)) return Infinity;
  if (!Number.isFinite(factor.diff)) return currentRank;

  return currentRank - factor.diff;
}

function renderRanking() {
  updateRankingSortHeaders();
  updateRankingViewToggle();
  const table = document.getElementById('ranking-table');
  const tableWrap = table.closest('.ranking-main-wrap');
  const body = document.getElementById('rl-body');
  const previousPositions = getRankingRowPositions(body, '.ranking-row');
  table.dataset.rankingSort = rankingSortMode;
  tableWrap.dataset.rankingView = rankingViewMode;
  table.classList.toggle('expanded', rankingViewMode === 'expanded');
  table.classList.toggle('compact', rankingViewMode === 'compact');

  const withStats = getRankedPlayers(PADEL_DATA.matches, rankingSortMode);
  const rankMap = getRankingPositionMap('points');
  const drawFactorRankMap = getDrawFactorReferenceRankMap();
  if (!drawFactorRankMap) requestDrawFactorReference();
  const maximumLeagueMatches = getMaximumLeagueMatches();
  const gamesNote = maximumLeagueMatches > 0 ? `Spiele: ${maximumLeagueMatches}` : '';
  const withGamesNote = (...parts) => parts.filter(Boolean).join('  |  ');
  const showMarcoAbsence = normalizeSeasonId(PADEL_DATA.id) === '2026-sommer';
  document.getElementById('rl-meta').textContent = withStats.length + ' Spieler';
  const sortNotes = {
    points: getCompetitionConfig().qualificationPlaces
      ? withGamesNote(`Top ${getCompetitionConfig().qualificationPlaces}: Qualifikationsplätze`, gamesNote, 'Sortierung: Punkte · Spiel-Differenz · gewonnene Spiele')
      : withGamesNote(gamesNote, 'Sortierung: Punkte · Spiel-Differenz · gewonnene Spiele'),
    games: withGamesNote(gamesNote, 'Sortierung: Partien · Punkte · Spiel-Differenz · gewonnene Spiele'),
    wins: withGamesNote(gamesNote, 'Sortierung: Siege · Punkte · Spiel-Differenz · gewonnene Spiele'),
    diff: withGamesNote(gamesNote, 'Sortierung: Spiel-Differenz · Punkte · gewonnene Spiele'),
    elo: withGamesNote(gamesNote, 'Sortierung: Elo · Punkte · Spiel-Differenz · gewonnene Spiele'),
    form: withGamesNote(gamesNote, 'Sortierung: Siege der letzten 3 · jüngste Ergebnisse · Punkte'),
    winrate: withGamesNote(gamesNote, 'Sortierung: Sieg-% · Punkte · Spiel-Differenz · gewonnene Spiele'),
    'draw-factor': withGamesNote(gamesNote, 'Sortierung: bereinigter Rang aus Punkte-Platz minus Losfaktor')
  };
  const rankingNote = document.getElementById('rl-sort-note');
  rankingNote.textContent = sortNotes[rankingSortMode] || sortNotes.points;
  if (showMarcoAbsence) {
    const absenceNote = document.createElement('span');
    absenceNote.className = 'ranking-absence-note';
    absenceNote.textContent = '* Marco M. fällt krankheitsbedingt beim Final Four aus. Der fünftplatzierte Ludwig W. rückt nach.';
    rankingNote.append(absenceNote);
  }
  body.innerHTML = withStats.map((p, i) => {
    const currentRank = i + 1;
    const pointsRank = rankMap.get(p.name);
    const extras = getPlayerRankingExtras(p, drawFactorRankMap);
    const isTopFourQualifier = getCompetitionConfig().qualificationPlaces > 0
      && pointsRank <= getCompetitionConfig().qualificationPlaces;
    const rankingPlayerLabel = isMobileViewport() && rankingViewMode === 'expanded'
      ? p.initials || p.name
      : p.name;
    const absenceMark = showMarcoAbsence && p.id === 'marco_m'
      ? '<span class="ranking-absence-mark"><span aria-hidden="true">*</span><span class="sr-only">Krankheitsbedingter Ausfall beim Final Four</span></span>'
      : '';
    return `<tr class="ranking-row r${Math.min(currentRank,4)} ${isTopFourQualifier ? 'top-four-highlight' : ''} ${isSelectedPlayer(p.name) ? 'viewer-highlight' : ''}" data-ranking-entry="${escapeHtml(p.id || p.name)}"${renderPlayerProfileRowAttributes(p)}>
      <td class="col-rank rank-position"><span class="rank-cell-inner"><span class="rank-main">${currentRank}</span>${rankingSortMode === 'points' ? renderRankingAvatar(p) : renderPointsRankReference(currentRank, pointsRank)}</span></td>
      <td class="col-name"><span class="player-cell-inner"><span class="ranking-player-name">${renderPlayerProfileLink(p, 'pname', rankingPlayerLabel)}</span>${absenceMark}${renderRankingCompanyBadge(p)}${renderLeagueRankingAchievementIcon(p)}</span></td>
      <td class="col-games">${renderRankingMatchCount(p)}</td>
      <td class="col-wins">${p.stats.siege}</td>
      <td class="col-points rank-score">${p.stats.punkte}</td>
      <td class="col-gv">${p.stats.partien > 0 ? p.stats.spieleGV : '—'}</td>
      <td class="col-diff">${renderDiffValue(p.stats.spielDiff, { played: p.stats.partien > 0 })}</td>
      <td class="col-elo">${getLatestPlayerElo(p)}</td>
      <td class="col-form">${extras.form}</td>
      <td class="col-winrate">${extras.winQuote === null ? '—' : `${extras.winQuote}%`}</td>
      <td class="col-draw-factor">${formatDrawFactor(extras.drawFactor)}</td>
    </tr>`;
  }).join('');
  animateRankingRows(body, '.ranking-row', previousPositions);
  renderFirmenRanking();
  renderFinalFourRanking();
  updatePlayerProfileRankingHighlights();
}

function getAllTimeLeagueMatches() {
  return (allTimeStatisticsData?.matches || []).filter(match =>
    match.sieger !== null &&
    match.saetze &&
    countsForRanking(match) &&
    getMatchStage(match) === 'league'
  );
}

function getAllTimeRankingPlayers(matches) {
  if (allTimeStatisticsData?.rankingPlayers?.length) {
    return allTimeStatisticsData.rankingPlayers;
  }

  const playerNames = new Set(matches.flatMap(match => [
    ...match.team1.spieler,
    ...match.team2.spieler
  ]));
  return (allTimeStatisticsData?.players || []).filter(player => playerNames.has(player.name));
}

const ALL_TIME_RANKING_SCOPES = ['league', 'official', 'training'];
const ALL_TIME_RANKING_SORT_NOTE = 'Sortierung: Punkte · Spiel-Differenz · gewonnene Spiele';

function getAllTimeOfficialMatches() {
  return (allTimeStatisticsData?.matches || []).filter(match =>
    match.sieger !== null &&
    match.saetze &&
    (countsForRanking(match) || match.countsForElo === true)
  );
}

function getRegularGameTotals(result) {
  return String(result || '').split(',').reduce((totals, part) => {
    const clean = part
      .split(/[–-]/)[0]
      .replace(/\s*\([^)]*\)/g, '')
      .trim();
    const score = clean.match(/^(\d+):(\d+)$/);
    if (!score) return totals;
    const games1 = Number(score[1]);
    const games2 = Number(score[2]);
    if (games1 > 7 || games2 > 7) return totals;
    return [totals[0] + games1, totals[1] + games2];
  }, [0, 0]);
}

// Final-Four-Sätze zählen wie im Profil als halbe Partie; ein gewonnener Satz bringt 1,5 Punkte.
function getAllTimeMatchContribution(match) {
  const isFinalFour = getMatchStage(match) === 'final-four';
  const [sets1, sets2] = match.saetze.split(':').map(Number);
  const [games1, games2] = getRegularGameTotals(match.ergebnis);
  const matchWeight = isFinalFour ? 0.5 : 1;
  const getPoints = (ownSets, otherSets, won) => {
    if (isFinalFour) return won ? 1.5 : 0;
    if (ownSets === 2 && otherSets === 0) return 3;
    if (ownSets === 2 && otherSets === 1) return 2;
    if (ownSets === 1 && otherSets === 2) return 1;
    return 0;
  };

  return {
    team1: { playerIds: match.team1.playerIds },
    team2: { playerIds: match.team2.playerIds },
    matchWeight,
    team1Wins: match.sieger === 1 ? matchWeight : 0,
    team2Wins: match.sieger === 2 ? matchWeight : 0,
    team1Points: getPoints(sets1, sets2, match.sieger === 1),
    team2Points: getPoints(sets2, sets1, match.sieger === 2),
    team1Games: games1,
    team2Games: games2
  };
}

function getAllTimeScopedStats(contributions) {
  const totalsByPlayer = new Map();
  contributions.forEach(entry => {
    [1, 2].forEach(team => {
      const otherTeam = team === 1 ? 2 : 1;
      (entry[`team${team}`]?.playerIds || []).forEach(playerId => {
        const totals = totalsByPlayer.get(playerId) || { partien: 0, siege: 0, punkte: 0, myGames: 0, oppGames: 0 };
        totals.partien += entry.matchWeight;
        totals.siege += entry[`team${team}Wins`];
        totals.punkte += entry[`team${team}Points`];
        totals.myGames += entry[`team${team}Games`];
        totals.oppGames += entry[`team${otherTeam}Games`];
        totalsByPlayer.set(playerId, totals);
      });
    });
  });

  return new Map([...totalsByPlayer].map(([playerId, totals]) => [playerId, {
    partien: totals.partien,
    siege: totals.siege,
    punkte: totals.punkte,
    spielDiff: totals.myGames - totals.oppGames,
    gewonneneSpiele: totals.myGames,
    spieleGV: totals.partien > 0 ? `${totals.myGames}:${totals.oppGames}` : '—'
  }]));
}

function getAllTimeScopedRankingPlayers(scope) {
  const includeTraining = scope === 'training';
  const contributions = getAllTimeOfficialMatches().map(getAllTimeMatchContribution);
  if (includeTraining) contributions.push(...(allTimeStatisticsData?.trainingRounds || []));
  const statsByPlayer = getAllTimeScopedStats(contributions);
  const rankingPlayerIds = new Set((allTimeStatisticsData?.rankingPlayers || []).map(player => player.id));
  const emptyStats = { partien: 0, siege: 0, punkte: 0, spielDiff: 0, gewonneneSpiele: 0, spieleGV: '—' };
  const playersById = new Map();
  [
    ...(allTimeStatisticsData?.rankingPlayers || []),
    ...(allTimeStatisticsData?.players || []),
    ...(includeTraining ? allTimeStatisticsData?.trainingPlayers || [] : [])
  ].forEach(player => {
    if (!playersById.has(player.id)) playersById.set(player.id, player);
  });

  return [...playersById.values()]
    .filter(player => rankingPlayerIds.has(player.id) || statsByPlayer.get(player.id)?.partien > 0)
    .map(player => ({ ...player, stats: statsByPlayer.get(player.id) || emptyStats }));
}

function formatAllTimeRankingValue(value) {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

function getAllTimeAveragePoints(stats) {
  return stats.partien > 0 ? stats.punkte / stats.partien : null;
}

function formatAllTimeAveragePoints(stats) {
  const average = getAllTimeAveragePoints(stats);
  return average === null
    ? '—'
    : average.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function compareAllTimeRankingByPoints(left, right) {
  return right.stats.punkte - left.stats.punkte ||
    right.stats.spielDiff - left.stats.spielDiff ||
    right.stats.gewonneneSpiele - left.stats.gewonneneSpiele;
}

function compareAllTimeRankingByAveragePoints(left, right) {
  return (getAllTimeAveragePoints(right.stats) ?? -Infinity) - (getAllTimeAveragePoints(left.stats) ?? -Infinity) ||
    compareAllTimeRankingByPoints(left, right);
}

function compareAllTimeRanking(left, right, sortMode = 'points') {
  let primaryComparison = 0;
  if (sortMode === 'games') {
    primaryComparison = right.stats.partien - left.stats.partien;
  } else if (sortMode === 'wins') {
    primaryComparison = right.stats.siege - left.stats.siege;
  } else if (sortMode === 'average') {
    primaryComparison = compareDescendingNullable(
      getAllTimeAveragePoints(left.stats),
      getAllTimeAveragePoints(right.stats)
    );
  } else if (sortMode === 'diff') {
    primaryComparison = compareDescendingNullable(
      left.stats.partien > 0 ? left.stats.spielDiff : null,
      right.stats.partien > 0 ? right.stats.spielDiff : null
    );
  }
  return primaryComparison || compareAllTimeRankingByPoints(left, right);
}

function renderAllTimePointsRankReference(currentRank, pointsRank) {
  if (allTimeRankingSortMode === 'points' || !Number.isFinite(pointsRank)) return '';

  const delta = pointsRank - currentRank;
  const deltaLabel = formatSignedInteger(delta);
  return `<span class="points-rank-ref" title="Punkte-Rang ${pointsRank}, Veränderung ${deltaLabel}">
    <span class="points-rank-num">${pointsRank}</span>
    <span class="points-rank-delta ${getDeltaClass(delta)}">${deltaLabel}</span>
  </span>`;
}

function updateAllTimeRankingSortHeaders() {
  updateSortHeaders('[data-all-time-ranking-sort]', 'allTimeRankingSort', allTimeRankingSortMode);
}

function renderAllTimeRanking() {
  const table = document.getElementById('all-time-ranking-table');
  const tableWrap = document.getElementById('all-time-ranking-wrap');
  const body = document.getElementById('all-time-ranking-body');
  const meta = document.getElementById('all-time-ranking-meta');
  if (!table || !tableWrap || !body || !meta || !allTimeStatisticsData) return;

  const previousPositions = getRankingRowPositions(body, '.ranking-row');
  updateAllTimeRankingViewToggle();
  updateAllTimeRankingSortHeaders();
  table.dataset.rankingSort = allTimeRankingSortMode;
  tableWrap.dataset.rankingView = allTimeRankingViewMode;
  table.classList.toggle('expanded', allTimeRankingViewMode === 'expanded');
  table.classList.toggle('compact', allTimeRankingViewMode === 'compact');

  const isLeagueScope = allTimeRankingScope === 'league';
  document.querySelectorAll('[data-all-time-ranking-scope]').forEach(button => {
    button.classList.toggle('active', button.dataset.allTimeRankingScope === allTimeRankingScope);
  });
  const note = document.getElementById('all-time-ranking-note');
  if (note) {
    const halfMatchNote = allTimeRankingScope === 'training'
      ? 'Final-Four- und Trainingssätze zählen als halbe Partie, ein gewonnener Satz bringt 1,5 Punkte'
      : 'Final-Four-Sätze zählen als halbe Partie, ein gewonnener Satz bringt 1,5 Punkte';
    const sortNotes = {
      points: ALL_TIME_RANKING_SORT_NOTE,
      games: 'Sortierung: Partien · Punkte · Spiel-Differenz · gewonnene Spiele',
      wins: 'Sortierung: Siege · Punkte · Spiel-Differenz · gewonnene Spiele',
      average: 'Sortierung: Ø-Punkte pro Partie · Punkte · Spiel-Differenz · gewonnene Spiele',
      diff: 'Sortierung: Spiel-Differenz · Punkte · gewonnene Spiele'
    };
    const sortNote = sortNotes[allTimeRankingSortMode] || ALL_TIME_RANKING_SORT_NOTE;
    note.textContent = isLeagueScope ? sortNote : `${halfMatchNote}  |  ${sortNote}`;
  }

  const matches = getAllTimeLeagueMatches();
  const players = isLeagueScope
    ? getAllTimeRankingPlayers(matches).map(player => ({ ...player, stats: getPlayerStats(player, matches) }))
    : getAllTimeScopedRankingPlayers(allTimeRankingScope);
  const pointsRankMap = new Map([...players]
    .sort(compareAllTimeRankingByPoints)
    .map((player, index) => [player.id || player.name, index + 1]));
  const rankedPlayers = [...players].sort((left, right) => compareAllTimeRanking(left, right, allTimeRankingSortMode));

  meta.textContent = `${rankedPlayers.length} Spieler`;
  body.innerHTML = rankedPlayers.map((player, index) => {
    const currentRank = index + 1;
    const rankingPlayerLabel = isMobileViewport() && allTimeRankingViewMode === 'expanded'
      ? player.initials || player.name
      : player.name;

    return `<tr class="ranking-row r${Math.min(currentRank, 4)} ${isSelectedPlayer(player.name) ? 'viewer-highlight' : ''}" data-ranking-entry="${escapeHtml(player.id || player.name)}"${renderPlayerProfileRowAttributes(player)}>
      <td class="col-rank rank-position"><span class="rank-cell-inner"><span class="rank-main">${currentRank}</span>${allTimeRankingSortMode === 'points' ? renderRankingAvatar(player) : renderAllTimePointsRankReference(currentRank, pointsRankMap.get(player.id || player.name))}</span></td>
      <td class="col-name"><span class="player-cell-inner">${renderPlayerProfileLink(player, 'pname', rankingPlayerLabel)}${renderRankingCompanyBadge(player)}</span></td>
      <td class="col-games">${isLeagueScope ? renderRankingMatchCount(player, matches) : formatAllTimeRankingValue(player.stats.partien)}</td>
      <td class="col-wins">${formatAllTimeRankingValue(player.stats.siege)}</td>
      <td class="col-points rank-score">${formatAllTimeRankingValue(player.stats.punkte)}</td>
      <td class="col-average-points">${formatAllTimeAveragePoints(player.stats)}</td>
      <td class="col-gv">${player.stats.partien > 0 ? player.stats.spieleGV : '—'}</td>
      <td class="col-diff">${renderDiffValue(player.stats.spielDiff, { played: player.stats.partien > 0 })}</td>
    </tr>`;
  }).join('');
  animateRankingRows(body, '.ranking-row', previousPositions);
  updatePlayerProfileRankingHighlights();
}

function compareDescendingNullable(leftValue, rightValue) {
  const leftValid = Number.isFinite(leftValue);
  const rightValid = Number.isFinite(rightValue);
  if (leftValid !== rightValid) return leftValid ? -1 : 1;
  if (!leftValid) return 0;
  return rightValue - leftValue;
}

function compareRankingByPoints(left, right) {
  return right.stats.punkte - left.stats.punkte ||
    right.stats.spielDiff - left.stats.spielDiff ||
    right.stats.gewonneneSpiele - left.stats.gewonneneSpiele;
}

function getRankedPlayers(matches = PADEL_DATA.matches, sortMode = 'points') {
  const withStats = PADEL_DATA.players.map(player => ({ ...player, stats: getPlayerStats(player, matches) }));
  const pointsComparison = (left, right) => compareRankingByPoints(left, right);
  let comparePrimary = pointsComparison;

  if (sortMode === 'games') {
    comparePrimary = (left, right) => right.stats.partien - left.stats.partien;
  } else if (sortMode === 'wins') {
    comparePrimary = (left, right) => right.stats.siege - left.stats.siege;
  } else if (sortMode === 'diff') {
    comparePrimary = (left, right) => compareDescendingNullable(
      left.stats.partien > 0 ? left.stats.spielDiff : null,
      right.stats.partien > 0 ? right.stats.spielDiff : null
    );
  } else if (sortMode === 'elo') {
    comparePrimary = (left, right) => compareDescendingNullable(
      getLatestPlayerEloValue(left),
      getLatestPlayerEloValue(right)
    );
  } else if (sortMode === 'form') {
    comparePrimary = (left, right) => comparePlayerRecentForm(left, right, matches);
  } else if (sortMode === 'winrate') {
    comparePrimary = (left, right) => compareDescendingNullable(
      getPlayerWinQuote(left, matches),
      getPlayerWinQuote(right, matches)
    );
  } else if (sortMode === 'draw-factor') {
    const rankMap = getSharedPointsRankMap(matches);
    const referenceRankMap = getDrawFactorReferenceRankMap();
    comparePrimary = (left, right) =>
      getDrawFactorAdjustedRank(left, rankMap, referenceRankMap) - getDrawFactorAdjustedRank(right, rankMap, referenceRankMap);
  }

  return withStats.sort((left, right) => comparePrimary(left, right) || pointsComparison(left, right));
}

function getPlayerIdByName(playerName) {
  const player = (PADEL_DATA?.allPlayers || PADEL_DATA?.players || [])
    .find(item => item.name === playerName);
  if (player?.id) return player.id;
  return (window.PADEL_PLAYERS || []).find(item => item.name === playerName)?.id || null;
}

function renderPlayerProfileLink(player, className = '', displayName = '') {
  const playerName = typeof player === 'string' ? player : player?.name;
  const playerId = typeof player === 'string'
    ? getPlayerIdByName(player)
    : player?.id || getPlayerIdByName(playerName);
  const visibleName = displayName || playerName;
  if (!playerId || !playerName) return `<span class="${escapeHtml(className)}">${escapeHtml(visibleName || '')}</span>`;

  return `<button
    type="button"
    class="player-profile-link ${escapeHtml(className)}"
    data-player-profile-id="${escapeHtml(playerId)}"
    aria-label="Profil von ${escapeHtml(playerName)} öffnen"
  >${escapeHtml(visibleName)}</button>`;
}

function renderTeamPlayers(players) {
  return players.map((player, index) => `
    ${index > 0 ? '<span class="mc-player-sep">&amp;</span>' : ''}
    ${renderPlayerProfileLink(player, `mc-player-name ${isSelectedPlayer(player) ? 'viewer-player' : ''}`)}
  `).join('');
}

function formatMatchTime(time) {
  if (!time) return '';
  const value = String(time).trim().replace(',', '.').replace(':', '.');
  const [hours, rawMinutes = '00'] = value.split('.');
  const minutes = rawMinutes.padEnd(2, '0').slice(0, 2);

  return `${hours.padStart(2, '0')}:${minutes}`;
}

function getMatchTimeMinutes(match) {
  const formattedTime = formatMatchTime(match.uhrzeit);
  if (!formattedTime) return 24 * 60;
  const [hours, minutes] = formattedTime.split(':').map(Number);

  return hours * 60 + minutes;
}

function compareMatchesByDateTime(a, b) {
  const dateA = toDateKey(getMatchSortDate(a)) || '9999-12-31';
  const dateB = toDateKey(getMatchSortDate(b)) || '9999-12-31';

  return dateA.localeCompare(dateB)
    || getMatchTimeMinutes(a) - getMatchTimeMinutes(b)
    || getMatchNumber(a) - getMatchNumber(b);
}

function compareMatchesByDateTimeDesc(a, b) {
  return compareMatchesByDateTime(b, a);
}

function compareMatchesByNumber(a, b) {
  return getMatchNumber(a) - getMatchNumber(b);
}

function hasScheduledDateTime(match) {
  return Boolean(match?.datum && match?.uhrzeit);
}

function getMatchSortDate(match) {
  if (!isCancelledMatch(match)) return match?.datum || null;
  return getMatchdayInfo(match.spieltag)?.startDate || null;
}

function hasMatchSortDate(match) {
  return isCancelledMatch(match)
    ? Boolean(getMatchSortDate(match))
    : hasScheduledDateTime(match);
}

function compareMatchesBySchedule(a, b) {
  const aIsScheduled = hasMatchSortDate(a);
  const bIsScheduled = hasMatchSortDate(b);
  if (aIsScheduled !== bIsScheduled) return aIsScheduled ? -1 : 1;
  if (!aIsScheduled) {
    const aMatchday = Number.isFinite(Number(a.spieltag)) ? Number(a.spieltag) : Number.MAX_SAFE_INTEGER;
    const bMatchday = Number.isFinite(Number(b.spieltag)) ? Number(b.spieltag) : Number.MAX_SAFE_INTEGER;
    return aMatchday - bMatchday || compareMatchesByNumber(a, b);
  }
  return compareMatchesByDateTime(a, b);
}

function formatMatchWeekday(date) {
  const parsedDate = parseDateValue(date);
  if (!parsedDate) return '';

  return ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][parsedDate.getDay()];
}

function formatMatchDate(match) {
  if (!hasScheduledDateTime(match)) return '';

  const d = parseDateValue(match.datum);
  const date = d
    ? d.toLocaleDateString('de-DE', {day:'2-digit', month:'2-digit'})
    : match.datum;
  const time = formatMatchTime(match.uhrzeit);
  const weekday = formatMatchWeekday(match.datum);
  const dateLabel = weekday ? `${weekday}, ${date}` : date;

  return time ? `${dateLabel} ${time}` : dateLabel;
}

function formatRelativeMatchDate(match) {
  if (!hasScheduledDateTime(match)) return '';

  const dateKey = toDateKey(match.datum);
  const todayKey = toDateKey(new Date());
  const date = parseDateValue(dateKey);
  const today = parseDateValue(todayKey);
  const time = formatMatchTime(match.uhrzeit);

  if (!date || !today) return formatMatchDate(match);

  const dayDiff = Math.round((date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  const relativeLabel = dayDiff === -1
    ? 'Gestern'
    : dayDiff === 0 ? 'Heute' : dayDiff === 1 ? 'Morgen' : null;

  if (!relativeLabel) return formatMatchDate(match);

  return time ? `${relativeLabel} ${time}` : relativeLabel;
}

function formatMatchMeta(match, options = {}) {
  const matchLabel = getMatchDisplayLabel(match);
  const date = options.relative ? formatRelativeMatchDate(match) : formatMatchDate(match);
  return date ? `${matchLabel} – ${date}` : matchLabel;
}

function renderHomeMatchCard(match, options = {}) {
  if (isCancelledMatch(match)) {
    return `<div class="mini-match-row is-unrated ${isViewerMatch(match) ? 'viewer-match' : ''}">
      <div class="mini-match-meta">${formatMatchMeta(match, { relative: options.relative !== false })}</div>
      <div class="mini-match-grid">
        <div class="mini-match-team mini-match-team-1">${renderTeamPlayers(match.team1.spieler)}</div>
        <div class="mini-match-status mini-match-status-unrated">
          <div class="mini-match-prob">o.W.</div>
          <div class="mini-match-label">ohne Wertung</div>
        </div>
        <div class="mini-match-team mini-match-team-2">${renderTeamPlayers(match.team2.spieler)}</div>
      </div>
    </div>`;
  }
  const isPlayed = match.sieger !== null;
  const probability = isPlayed ? getHistoricalMatchWinProbability(match) : getMatchWinProbability(match);
  const centerMain = isPlayed
    ? String(match.saetze || '—')
    : probability ? `${probability.team1}% : ${probability.team2}%` : '—';
  const centerLabel = isPlayed ? match.ergebnis : '';
  const team1Class = isPlayed
    ? match.sieger === 1 ? ' mini-match-winner' : ' mini-match-loser'
    : '';
  const team2Class = isPlayed
    ? match.sieger === 2 ? ' mini-match-winner' : ' mini-match-loser'
    : '';
  const statusClass = isPlayed ? ' mini-match-status-played' : '';
  const statistics = window.PadelMatchStatistics?.entry(match, PADEL_DATA);
  const centerContent = `<div class="mini-match-prob">${centerMain}</div>
        ${centerLabel ? `<div class="mini-match-label">${centerLabel}</div>` : ''}`;

  return `<div class="mini-match-row ${isViewerMatch(match) ? 'viewer-match' : ''}">
    <div class="mini-match-meta">${formatMatchMeta(match, { relative: options.relative !== false })}</div>
    <div class="mini-match-grid">
      <div class="mini-match-team mini-match-team-1${team1Class}">${renderTeamPlayers(match.team1.spieler)}</div>
      ${statistics
        ? `<button type="button" class="mini-match-status${statusClass} mini-match-status-action" ${statistics.attributes}>${centerContent}</button>`
        : `<div class="mini-match-status${statusClass}">${centerContent}</div>`}
      <div class="mini-match-team mini-match-team-2${team2Class}">${renderTeamPlayers(match.team2.spieler)}</div>
    </div>
  </div>`;
}

function getHomeFeedTimestamp(dateValue, timeValue) {
  const normalizedTime = String(timeValue || '').replace('.', ':');
  const timestamp = new Date(`${dateValue}T${normalizedTime || '00:00'}:00`).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function renderHomeTrainingCard(training, { recent = false } = {}) {
  const pseudoMatch = { datum: training.playedOn, uhrzeit: training.displayTime };
  const participantLinks = training.participants.map(participant => renderPlayerProfileLink({
    id: participant.isGuest ? null : participant.id,
    name: participant.displayName
  }, `mini-training-player ${isSelectedTrainingParticipant(participant) ? 'viewer-player' : ''}`));
  const roundLabel = `${training.roundCount} ${training.roundCount === 1 ? 'Paarung' : 'Paarungen'}`;
  const setLabel = `${training.completedSetCount} ${training.completedSetCount === 1 ? 'vollständiger Satz' : 'vollständige Sätze'}`;
  return `<div class="mini-match-row mini-training-row ${isViewerTraining(training) ? 'viewer-match' : ''}">
    <div class="mini-match-meta">Training – ${escapeHtml(formatRelativeMatchDate(pseudoMatch))}</div>
    <div class="mini-training-players">${participantLinks.join('')}</div>
    <div class="mini-training-summary">${recent ? `${escapeHtml(roundLabel)} · ${escapeHtml(setLabel)}` : '4 Teilnehmer'}</div>
  </div>`;
}

function getCurrentArticle() {
  const articles = PADEL_DATA.articles || [];
  const todayKey = toDateKey(new Date());
  const publishedArticles = articles.filter(article => Array.isArray(article.body) && article.body.length);
  const current = publishedArticles.find(article => {
    if (!article.startDate && !article.endDate) return false;
    const start = article.startDate || '0000-01-01';
    const end = article.endDate || '9999-12-31';
    return start <= todayKey && todayKey <= end;
  });

  if (current) return current;

  return publishedArticles.reduce((latest, article) => {
    const articleStart = article.startDate || article.endDate;
    if (articleStart && articleStart > todayKey) return latest;
    if (!latest) return article;

    const articleDate = article.endDate || article.startDate || '';
    const latestDate = latest.endDate || latest.startDate || '';
    return articleDate >= latestDate ? article : latest;
  }, null) || publishedArticles[0] || null;
}

function formatArticleMeta(meta) {
  return String(meta || '').replace(/\s*·\s*/g, ' | ');
}

function renderSplitMeta(label, detail, className) {
  return `<div class="${className}">
    <span>${escapeHtml(label)}</span>
    ${detail ? `<span>${escapeHtml(detail)}</span>` : ''}
  </div>`;
}

function renderGroupHeading(label, detail) {
  return `<h3><span>${escapeHtml(label)}</span>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</h3>`;
}

function renderArticleMeta(meta) {
  const [label, ...details] = formatArticleMeta(meta).split(/\s*\|\s*/);
  return renderSplitMeta(label, details.join(' | '), 'article-meta');
}

function renderArticleNewspaperHeader(article) {
  return `<header class="article-newspaper-header">
    <div class="article-newspaper-masthead" aria-label="PadelPost">
      <span>Padel</span><span>Post</span>
    </div>
    ${renderArticleMeta(article.meta || `Spieltag ${article.spieltag}`)}
  </header>`;
}

function renderArticleCard(article, { newspaper = true } = {}) {
  return `<article class="article-card${newspaper ? ' article-newspaper' : ''}">
    ${newspaper
      ? renderArticleNewspaperHeader(article)
      : article.meta ? renderArticleMeta(article.meta) : ''}
    <h2>${article.title}</h2>
    ${newspaper ? '<div class="article-newspaper-publisher">United we Padel</div>' : ''}
    ${article.body ? `<div class="article-body">${article.body.map(renderArticleBlock).join('')}</div>` : ''}
  </article>`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Verlinkt Spielernamen in der Form „Vorname I.“ mit dem Spielerprofil (nur Zwischenüberschriften und Spielblöcke).
function linkArticlePlayerNames(html) {
  const players = (PADEL_DATA?.allPlayers || PADEL_DATA?.players || window.PADEL_PLAYERS || [])
    .filter(player => player?.id && player?.name);
  if (!html || !players.length) return html || '';

  const playersByKey = new Map(players.map(player => [player.name.replace(/\.$/, ''), player]));
  const pattern = new RegExp(
    `(^|[^\\p{L}])(${[...playersByKey.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})\\.?(?![\\p{L}])`,
    'gu'
  );

  return String(html).split(/(<[^>]*>)/).map(part => {
    if (part.startsWith('<')) return part;
    return part.replace(pattern, (match, prefix, key) => {
      const player = playersByKey.get(key);
      const visibleName = match.slice(prefix.length);
      return `${prefix}${renderPlayerProfileLink(player, 'article-player-link', visibleName)}`;
    });
  }).join('');
}

function renderArticleBlock(block) {
  if (block.type === 'h') return `<h4>${linkArticlePlayerNames(block.text)}</h4>`;
  if (block.type === 'match') {
    let matchup = block.text;
    let result = block.result;
    let resultLabel = block.resultLabel || 'Ergebnis';
    if (!result) {
      [matchup, result] = block.text.split(/\s*\|\s*Ergebnis:\s*/);
      resultLabel = 'Ergebnis';
    }
    const match = block.matchId ? PADEL_DATA.matches.find(m => m.id === block.matchId) : null;
    const statisticsDetail = window.PadelMatchStatistics?.entry(match, PADEL_DATA);
    const detail = statisticsDetail || (match && getMatchStage(match) === 'final-four'
      ? {
          attributes: `data-live-open-match="${escapeHtml(match.id)}" aria-label="Spielverlauf öffnen"`,
          icon: ''
        }
      : null);
    return `<div class="article-match${detail ? ' has-partie-detail' : ''}">
      ${detail ? `<button type="button" class="article-match-action" ${detail.attributes}></button>` : ''}
      <span>${linkArticlePlayerNames(matchup)}</span>
      ${result ? `<span class="article-match-result">${resultLabel}: ${result}${detail?.icon || ''}</span>` : ''}
    </div>`;
  }
  if (block.type === 'quote') {
    return `<blockquote>
      <p>${block.text}</p>
      <cite>${block.author}</cite>
    </blockquote>`;
  }
  return `<p>${block.text}</p>`;
}

let homeAnnouncementExpiryTimer = null;

function getVisibleHomeAnnouncement(announcement, now = new Date()) {
  if (!announcement) return null;
  if (!announcement.expiresAt) return announcement;

  const expiresAt = Date.parse(announcement.expiresAt);
  if (!Number.isFinite(expiresAt)) return announcement;

  return now.getTime() < expiresAt ? announcement : null;
}

function renderHomeAnnouncement(now = new Date()) {
  const container = document.getElementById('home-announcement');
  const announcement = getVisibleHomeAnnouncement(PADEL_DATA.homeAnnouncement, now);

  container.hidden = !announcement;
  container.innerHTML = announcement
    ? `${announcement.label ? `<div class="eyebrow">${escapeHtml(announcement.label)}</div>` : ''}${renderArticleCard(announcement, { newspaper: false })}${announcement.link ? `<button class="text-link" data-nav-target="${escapeHtml(announcement.link.target)}">${escapeHtml(announcement.link.label)}</button>` : ''}`
    : '';

  if (homeAnnouncementExpiryTimer !== null) {
    window.clearTimeout(homeAnnouncementExpiryTimer);
    homeAnnouncementExpiryTimer = null;
  }

  const expiresAt = Date.parse(PADEL_DATA.homeAnnouncement?.expiresAt || '');
  const remainingMs = expiresAt - now.getTime();
  if (!Number.isFinite(expiresAt) || remainingMs <= 0) return;

  const maxBrowserTimeoutMs = 2_147_483_647;
  homeAnnouncementExpiryTimer = window.setTimeout(
    () => renderHomeAnnouncement(),
    Math.min(remainingMs, maxBrowserTimeoutMs)
  );
}

function getHomeSeasonPodiumPlacements() {
  if (!PADEL_DATA?.completedAt
    || !['direct-final-four', 'top8-semifinals'].includes(getCompetitionConfig().tournamentMode)) return [];

  const matches = getFinalFourMatches();
  if (!getFinalFourDetailEntryMatchId(matches)
    || matches.some(match => isCancelledMatch(match)
      || ![1, 2].includes(match.sieger)
      || !match.ergebnis)) return [];

  const { stats } = getFinalFourStats(matches);
  if (stats.length !== 4) return [];

  const playersByName = new Map(PADEL_DATA.players.map(player => [player.name, player]));
  const placements = stats.slice(0, 3).map((stat, index) => ({
    place: index + 1,
    player: playersByName.get(stat.name)
  }));
  return placements.every(placement => placement.player) ? placements : [];
}

function renderHomeSeasonPodium() {
  const container = document.getElementById('home-season-podium');
  if (!container) return;

  const placements = getHomeSeasonPodiumPlacements();
  const overviewMatchId = getFinalFourDetailEntryMatchId();
  container.hidden = placements.length !== 3;
  container.innerHTML = placements.length === 3 ? `
    <div class="home-season-podium-kicker">Saison ${escapeHtml(PADEL_DATA.label || selectedSeason.label || selectedSeason.id)} beendet</div>
    <h2 id="home-season-podium-title">Unser Champion</h2>
    ${renderFinalFourPodiumSteps(placements.map(placement => ({
      place: placement.place,
      playerId: placement.player.id,
      displayName: placement.player.name
    })), { overviewMatchId })}
  ` : '';
}

function renderTop8QualificationFlow() {
  if (getCompetitionConfig().tournamentMode !== 'top8-semifinals') return '';

  return `<figure
    class="qualification-flow"
    role="img"
    aria-label="Die besten acht Spieler der Ligaphase spielen zwei Halbfinals. Platz 1 und 2 spielen gegen Platz 7 und 8. Platz 3 und 4 spielen gegen Platz 5 und 6. Die vier Spieler der beiden Siegerteams erreichen das Final Four."
  >
    <div class="qualification-flow-stage qualification-flow-league" aria-hidden="true">
      <div class="qualification-flow-label">Ligaphase</div>
      <div class="qualification-flow-ranks">
        ${Array.from({ length: 8 }, (_, index) => `<span>${index + 1}</span>`).join('')}
      </div>
      <small>Top 8</small>
    </div>
    <span class="qualification-flow-arrow" aria-hidden="true"></span>
    <div class="qualification-flow-stage qualification-flow-semifinals" aria-hidden="true">
      <div class="qualification-flow-label">Halbfinale</div>
      <div class="qualification-flow-match">
        <span>1 + 2</span><b>vs.</b><span>7 + 8</span>
      </div>
      <div class="qualification-flow-match">
        <span>3 + 4</span><b>vs.</b><span>5 + 6</span>
      </div>
      <small>2 Siegerteams</small>
    </div>
    <span class="qualification-flow-arrow" aria-hidden="true"></span>
    <div class="qualification-flow-stage qualification-flow-final" aria-hidden="true">
      <div class="qualification-flow-label">Final Four</div>
      <div class="qualification-flow-final-card">
        <div class="qualification-flow-final-players">
          <span></span><span></span><span></span><span></span>
        </div>
        <strong>4 Spieler</strong>
      </div>
      <small>spielen in 3 Partien um den Titel</small>
    </div>
  </figure>`;
}

function renderPredictionAccountTypeIcon(entry) {
  if (typeof entry?.is_player !== 'boolean') return '';
  const label = entry.is_player ? 'Spieler' : 'Tipper';
  const icon = entry.is_player
    ? '<g transform="rotate(40 12 12)"><path d="M12 1.5c3.4 0 5.6 2.7 5.6 6.2 0 3.6-2.4 6.6-5.6 6.6s-5.6-3-5.6-6.6c0-3.5 2.2-6.2 5.6-6.2Z"/><path d="M9.6 13.6 11 16.6h2l1.4-3"/><rect x="10.8" y="16.6" width="2.4" height="5.6" rx="1.1"/><path d="M10 6h.01M14 6h.01M12 8h.01M10 10h.01M14 10h.01"/></g>'
    : '<path d="M2 9a3 3 0 0 1 0 6v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3a3 3 0 0 1 0-6V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="m9 12 2 2 4-4"/>';
  return `<span class="prediction-account-type-icon" role="img" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon}</svg></span>`;
}

function renderPredictionCompanyBadge(entry) {
  const company = String(entry?.company || '').trim();
  if (!company) return '';
  if (COMPANIES_WITH_LOGO.includes(company)) return renderCompanyIcon(company, ' prediction-company-badge');
  const shortLabel = company === 'Test' ? 'TEST' : company.slice(0, 3).toUpperCase();
  return `<span class="firma-badge firma-${escapeHtml(company)} prediction-company-badge" aria-label="Firma ${escapeHtml(company)}" title="${escapeHtml(company)}">${escapeHtml(shortLabel)}</span>`;
}

function renderTrophyIcon(label, additionalClass = '') {
  const extraClass = additionalClass ? ` ${escapeHtml(additionalClass)}` : '';
  return `<span class="prediction-achievement-icon prediction-achievement-icon--winner${extraClass}" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><svg viewBox="0 0 28 32" aria-hidden="true" focusable="false"><path d="M8 3h12v5c0 5-2.4 8.5-6 10-3.6-1.5-6-5-6-10V3Z"/><path d="M8 6H4v2c0 4 2 6 5.3 6.7M20 6h4v2c0 4-2 6-5.3 6.7"/><path d="M14 18v6M11 24h6v4M9 28h10"/></svg></span>`;
}

function renderPreviousPredictionWinnerIcon(entry) {
  if (entry?.previous_prediction_winner !== true) return '';
  const seasonLabel = String(entry.previous_prediction_season_label || '').trim();
  return renderTrophyIcon(`Tippsieger${seasonLabel ? ` ${seasonLabel}` : ''}`);
}

function renderLeagueRankingAchievementIcon(player) {
  const achievement = previousLeagueRankingAchievements.get(player?.id);
  if (!achievement) return '';
  if (achievement.kind === 'final_four') {
    const seasonLabel = String(achievement.seasonLabel || '').trim();
    const label = `Final Four${seasonLabel ? ` ${seasonLabel}` : ''}`;
    return `<span class="prediction-achievement-icon prediction-achievement-icon--final-four ranking-player-achievement" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
      <svg class="ranking-player-achievement-laurel" viewBox="0 0 1255.92 1166.47" aria-hidden="true" focusable="false">
        <g class="ranking-player-achievement-laurel-stems">
          <path d="M557.89 1161.81C222.45 1108.78 108.83 690.9 211.51 408.18c36.54-100.61 105.11-186.32 189.43-251.48"/>
          <path d="M698.03 1161.81c335.44-53.03 449.06-470.91 346.38-753.63-36.54-100.61-105.11-186.32-189.43-251.48"/>
        </g>
        <g class="ranking-player-achievement-laurel-leaves">
          <path d="M427.94 1121.56s80.68-130-36.83-314.82c-4.43 9.89-62.18 171.83 36.83 314.82ZM350.99 1068.8S203.11 1108.06 60.59 941.76c10.75-1.35 182.49-9.37 290.4 127.04ZM221.06 880.71S69.3 861.32 0 653.56c10.46 2.8 172.56 60.13 221.06 227.15ZM172.21 672.06S34.72 604.92 35.87 385.91c9.01 6.02 144.08 112.4 136.34 286.15ZM194.15 451.28S79.69 349.75 139.49 139.06c7.07 8.21 108.69 146.9 54.66 312.22ZM265.07 294.13S200.35 162.55 324.6 0c3.33 9.82 44.14 169.22-59.53 294.13ZM273.65 979.19s124.57-113.02 62.56-340.04c-7.78 9-118.53 154.78-62.56 340.04ZM183.33 725.92s130.61-74.07 135.53-294.87c-9.35 6.39-135.2 104.98-135.53 294.87ZM308.07 275.41c37.43-27.19 80.51-45.93 124.95-58.81-.09 9.22-1.36 18.42-3.77 27.31-2.98 11.02-7.68 21.51-12.86 31.69-41.4 81.32-125.52 158.37-217.36 176.43.3-10.34 7.29-24.21 10.17-34.36 16.65-58.66 49.18-106.17 98.87-142.27ZM410.22 132.82C471.23 83.5 549.44 55.89 627.89 55.97c1.88 24.66-30.62 47.43-47.64 60.31-38.98 29.48-79.99 49.56-127.66 62.42-29.34 7.92-62.33 14.28-92.79 14.23-.91 0-1.95-.07-2.51-.78-.8-1.03-.04-2.5.73-3.56 6.03-8.36 13.82-15.26 20.15-23.39 9.47-12.14 20.09-22.72 32.06-32.4Z"/>
          <path d="M827.98 1121.56s-80.68-130 36.83-314.82c4.43 9.89 62.18 171.83-36.83 314.82ZM904.93 1068.8s147.88 39.26 290.4-127.04c-10.75-1.35-182.49-9.37-290.4 127.04ZM1034.86 880.71s151.77-19.39 221.06-227.15c-10.46 2.8-172.56 60.13-221.06 227.15ZM1083.71 672.06s137.49-67.14 136.34-286.15c-9.01 6.02-144.08 112.4-136.34 286.15ZM1061.77 451.28s114.46-101.53 54.66-312.22c-7.07 8.21-108.69 146.9-54.66 312.22ZM990.85 294.13S1055.57 162.55 931.32 0c-3.33 9.82-44.14 169.22 59.53 294.13ZM982.27 979.19s-124.57-113.02-62.56-340.04c7.78 9 118.53 154.78 62.56 340.04ZM1072.59 725.92S941.98 651.85 937.06 431.05c9.35 6.39 135.2 104.98 135.53 294.87ZM947.85 275.41c-37.43-27.19-80.51-45.93-124.95-58.81.09 9.22 1.36 18.42 3.77 27.31 2.98 11.02 7.68 21.51 12.86 31.69 41.4 81.32 125.52 158.37 217.36 176.43-.3-10.34-7.29-24.21-10.17-34.36-16.65-58.66-49.18-106.17-98.87-142.27ZM845.7 132.82C784.69 83.5 706.49 55.89 628.04 55.98c-1.88 24.66 30.62 47.43 47.64 60.31 38.98 29.48 79.99 49.56 127.66 62.42 29.34 7.92 62.33 14.28 92.79 14.23.91 0 1.95-.07 2.51-.78.8-1.03.04-2.5-.73-3.56-6.03-8.36-13.82-15.26-20.15-23.39-9.47-12.14-20.09-22.72-32.06-32.4Z"/>
        </g>
      </svg>
    </span>`;
  }
  const seasonLabel = String(achievement.seasonLabel || '').trim();
  return renderTrophyIcon(`Champion${seasonLabel ? ` ${seasonLabel}` : ''}`, 'ranking-player-achievement');
}

function renderHomePredictionLeaderboard() {
  const target = document.getElementById('home-prediction-ranking');
  if (!target || !homePredictionLeaderboardReady) return;
  target.classList.remove('loading-skeleton', 'skeleton-ranking');
  target.removeAttribute('aria-hidden');
  if (homePredictionLeaderboardError) {
    target.innerHTML = '<div class="empty-state">Die Tipprangliste kann gerade nicht geladen werden.</div>';
    return;
  }
  if (!homePredictionLeaderboard.length) {
    target.innerHTML = `<div class="empty-state">${PADEL_DATA?.completedAt
      ? 'In dieser Saison wurden keine Tipps abgegeben.'
      : 'Noch keine Tippwertung vorhanden.'}</div>`;
    return;
  }
  const authenticatedUserId = window.PadelKonto?.getSession?.()?.user?.id || null;
  const leaderboardEntries = getHomePredictionRankingEntries(homePredictionLeaderboard, authenticatedUserId);
  target.innerHTML = leaderboardEntries.map(({ entry, rank, separated }) => `
    <div class="mini-rank-row r${rank}${entry.user_id === authenticatedUserId ? ' viewer-highlight' : ''}${separated ? ' home-ranking-selected-row' : ''}">
      <span class="rank-position">${rank}</span>
      <span class="mini-rank-name"><span class="prediction-rank-account"><span class="prediction-rank-account-name">${escapeHtml(entry.display_name)}</span>${renderPredictionAccountTypeIcon(entry)}${renderPredictionCompanyBadge(entry)}${renderPreviousPredictionWinnerIcon(entry)}</span></span>
      <span class="rank-score">${Number(entry.points) || 0} Pkt.</span>
    </div>
  `).join('');
}

function getHomePredictionRankingEntries(leaderboard, authenticatedUserId, limit = 4) {
  const topCount = Math.max(0, Number(limit) || 4);
  const entries = leaderboard.slice(0, topCount).map((entry, index) => ({
    entry,
    rank: index + 1,
    separated: false
  }));
  if (!authenticatedUserId) return entries;

  const ownIndex = leaderboard.findIndex(entry => entry.user_id === authenticatedUserId);
  if (ownIndex >= topCount) {
    entries.push({
      entry: leaderboard[ownIndex],
      rank: ownIndex + 1,
      separated: true
    });
  }
  return entries;
}

function getHomeRankingEntries(rankedPlayers, selectedPlayerId, limit = 4) {
  const topCount = Math.max(0, Number(limit) || 4);
  const entries = rankedPlayers.slice(0, topCount).map((player, index) => ({
    player,
    rank: index + 1,
    separated: false
  }));
  if (!selectedPlayerId) return entries;

  const selectedIndex = rankedPlayers.findIndex(player => player.id === selectedPlayerId);
  if (selectedIndex >= topCount) {
    entries.push({
      player: rankedPlayers[selectedIndex],
      rank: selectedIndex + 1,
      separated: true
    });
  }
  return entries;
}

async function refreshHomePredictionLeaderboard() {
  if (!selectedSeason?.id || isCupSeason()) return;
  const requestId = ++homePredictionLeaderboardRequest;
  const requestedSeasonId = selectedSeason.id;
  try {
    const leaderboard = await loadDatabasePredictionLeaderboard(selectedSeason);
    if (requestId !== homePredictionLeaderboardRequest || selectedSeason?.id !== requestedSeasonId) return;
    homePredictionLeaderboard = leaderboard;
    homePredictionLeaderboardError = '';
  } catch (error) {
    if (requestId !== homePredictionLeaderboardRequest || selectedSeason?.id !== requestedSeasonId) return;
    homePredictionLeaderboard = [];
    homePredictionLeaderboardError = error.message || 'Unbekannter Fehler';
    console.warn('Tipprangliste für die Startseite konnte nicht geladen werden:', error);
  } finally {
    if (requestId !== homePredictionLeaderboardRequest || selectedSeason?.id !== requestedSeasonId) return;
    homePredictionLeaderboardReady = true;
    renderHomePredictionLeaderboard();
  }
}

function renderHome() {
  ['home-short-info', 'home-ranking', 'home-next-matches', 'home-recent-matches'].forEach(id => {
    const target = document.getElementById(id);
    target?.classList.remove('loading-skeleton', 'skeleton-ranking', 'skeleton-match-list', 'skeleton-short-info');
    target?.removeAttribute('aria-hidden');
  });

  document.getElementById('home-short-info').innerHTML = (PADEL_DATA.shortInfo || [])
    .map(item => `<li>${item}</li>`)
    .join('');

  const qualificationFlow = document.getElementById('home-qualification-flow');
  if (qualificationFlow) {
    qualificationFlow.innerHTML = renderTop8QualificationFlow();
    qualificationFlow.hidden = !qualificationFlow.innerHTML;
  }

  renderHomeAnnouncement();
  renderHomeSeasonPodium();

  const finalFourCta = document.getElementById('home-final-four-cta');
  const finalFourLink = document.getElementById('home-final-four-link');
  const finalFourEntryMatchId = getFinalFourDetailEntryMatchId();
  if (finalFourCta && finalFourLink) {
    finalFourCta.hidden = !finalFourEntryMatchId;
    if (finalFourEntryMatchId) finalFourLink.dataset.liveOpenMatch = finalFourEntryMatchId;
    else delete finalFourLink.dataset.liveOpenMatch;
  }

  document.getElementById('home-articles').innerHTML = `
    <div class="home-article-preview" id="home-article-preview">
      ${getCurrentArticle() ? renderArticleCard(getCurrentArticle()) : '<div class="empty-state">Noch keine PadelPost-Ausgabe für diese Saison.</div>'}
    </div>
    <button class="text-link article-readmore" id="article-readmore" data-expand-home-article>Weiterlesen</button>
  `;

  const homeRankingEntries = getHomeRankingEntries(
    getRankedPlayers(),
    isParticipantView() ? selectedViewerId : null,
    getCompetitionConfig().homeRankingLimit
  );
  document.getElementById('home-ranking').innerHTML = homeRankingEntries
    .map(({ player: p, rank, separated }) => {
      const spielDiffStr = p.stats.partien > 0 ? formatStatDiff(p.stats.spielDiff) : '—';
      const spielDiffClass = getDeltaClass(p.stats.spielDiff);

      return `<div class="mini-rank-row r${rank}${isSelectedPlayer(p.name) ? ' viewer-highlight' : ''}${separated ? ' home-ranking-selected-row' : ''}"${renderPlayerProfileRowAttributes(p)}>
      <span class="rank-position">${rank}</span>
      <span class="mini-rank-name"><span class="ranking-player-name">${renderPlayerProfileLink(p)}${renderLeagueRankingAchievementIcon(p)}</span></span>
      <span class="mini-rank-values">
        <span class="mini-rank-games">${p.stats.partien}</span>
        <span class="rank-score">${p.stats.punkte}</span>
        <span class="mini-rank-diff ${p.stats.partien > 0 ? spielDiffClass : 'neu'}">${spielDiffStr}</span>
      </span>
    </div>`;
    })
    .join('');
  renderHomePredictionLeaderboard();

  const todayKey = toDateKey(new Date());
  const nextMatchEntries = PADEL_DATA.matches
    .filter(m => !isCancelledMatch(m) && m.sieger === null && m.uhrzeit && toDateKey(m.datum) >= todayKey)
    .map(match => ({ kind: 'match', match, timestamp: getHomeFeedTimestamp(toDateKey(match.datum), match.uhrzeit) }));
  const nextTrainingEntries = publicTrainingFeed.upcoming
    .map(training => ({ kind: 'training', training, timestamp: getHomeFeedTimestamp(training.playedOn, training.displayTime) }));
  const nextEntries = [...nextMatchEntries, ...nextTrainingEntries]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(0, 3);
  const allMatchesPlayed = PADEL_DATA.matches.every(isCompletedSeasonMatch);
  const emptyNextMatchesText = PADEL_DATA.matches.length === 0
    ? 'Der Spielplan folgt.'
    : allMatchesPlayed
    ? 'Alle Partien sind gespielt.'
    : 'Keine weiteren Partien terminiert.';

  document.getElementById('home-next-matches').innerHTML = nextEntries.length
    ? nextEntries.map(entry => entry.kind === 'training'
      ? renderHomeTrainingCard(entry.training)
      : renderHomeMatchCard(entry.match)).join('')
    : `<div class="empty-state">${emptyNextMatchesText}</div>`;

  const playedMatches = PADEL_DATA.matches.filter(match => match.sieger !== null);
  const recentMatchEntries = playedMatches
    .filter(match => match.sieger !== null && match.ergebnis)
    .map(match => ({ kind: 'match', match, timestamp: getHomeFeedTimestamp(toDateKey(match.datum), match.uhrzeit) }));
  const recentTrainingEntries = publicTrainingFeed.recent
    .map(training => ({ kind: 'training', training, timestamp: getHomeFeedTimestamp(training.playedOn, training.displayTime) }));
  const recentEntries = [...recentMatchEntries, ...recentTrainingEntries]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 3);
  const emptyRecentMatchesText = playedMatches.length === 0 && publicTrainingFeed.recent.length === 0
    ? 'Noch keine Partien gespielt.'
    : 'Noch keine Partien mit Ergebnis.';

  document.getElementById('home-recent-matches').innerHTML = recentEntries.length
    ? recentEntries.map(entry => entry.kind === 'training'
      ? renderHomeTrainingCard(entry.training, { recent: true })
      : renderHomeMatchCard(entry.match)).join('')
    : `<div class="empty-state">${emptyRecentMatchesText}</div>`;
}

function renderStatTeamPlayers(players) {
  return `<span class="stat-team-players">${renderTeamPlayers(players)}</span>`;
}

function isAllTimeStatistics() {
  return statisticsMode === 'all-time';
}

function getStatisticsData() {
  return isAllTimeStatistics() && allTimeStatisticsData ? allTimeStatisticsData : PADEL_DATA;
}

function getStatisticsMatches() {
  const matches = getStatisticsData()?.matches || [];
  return isAllTimeStatistics()
    ? matches.filter(match => match.sieger !== null && match.saetze)
    : matches.filter(countsForRanking);
}

function getStatisticsPlayers() {
  return getStatisticsData()?.players || [];
}

function getStatisticsPlayerFilter() {
  const key = isAllTimeStatistics() ? 'all-time' : 'season';
  if (!statisticsPlayerFilters.has(key)) {
    statisticsPlayerFilters.set(key, new Set(getStatisticsPlayers().map(player => player.id)));
  }
  return statisticsPlayerFilters.get(key);
}

function formatStatisticsMatchLabel(match) {
  const matchLabel = formatMatchNumberLabel(match);
  return isAllTimeStatistics() && match.seasonLabel
    ? `${match.seasonLabel} · ${matchLabel}`
    : matchLabel;
}

function renderStatisticsModeState({ loading = false } = {}) {
  document.querySelectorAll('[data-statistics-mode]').forEach(button => {
    const active = button.dataset.statisticsMode === statisticsMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.disabled = loading;
  });
  document.querySelectorAll('[data-season-only-statistic]').forEach(element => {
    element.hidden = isAllTimeStatistics();
  });
  document.querySelectorAll('[data-all-time-statistic]').forEach(element => {
    element.hidden = !isAllTimeStatistics();
  });

  const errorTarget = document.getElementById('statistics-load-error');
  if (errorTarget) {
    errorTarget.textContent = statisticsLoadError;
    errorTarget.hidden = !statisticsLoadError;
  }
}

async function setStatisticsMode(mode) {
  const nextMode = mode === 'all-time' ? 'all-time' : 'season';
  if (nextMode === statisticsMode && !(nextMode === 'all-time' && !allTimeStatisticsData)) return;
  if (nextMode !== statisticsMode && playerProfilePresentation === 'panel') {
    closePlayerProfile({ immediate: true, restoreFocus: false });
  }

  statisticsLoadError = '';
  if (nextMode === 'all-time') {
    renderStatisticsModeState({ loading: true });
    try {
      await loadAllTimeStatisticsData();
    } catch (error) {
      statisticsLoadError = 'Die All-Time-Statistik konnte nicht geladen werden. Bitte versuche es später erneut.';
      renderStatisticsModeState();
      console.error(error);
      return;
    }
  }

  statisticsMode = nextMode;
  chart?.destroy();
  placementChart?.destroy();
  chart = null;
  placementChart = null;
  renderStatistik();
  if (document.getElementById('verlauf')?.classList.contains('active')) initChart();
}

function getWinnerTeam(match) {
  if (match.sieger === 1) return match.team1.spieler;
  if (match.sieger === 2) return match.team2.spieler;
  return [];
}

function getWinnerProbability(match, data = getStatisticsData()) {
  const probability = getHistoricalMatchWinProbability(match, data);
  if (!probability || match.sieger === null) return null;

  return match.sieger === 1 ? probability.team1 : probability.team2;
}

function getMatchDisplayLabel(match) {
  if (match?.displayLabel) return match.displayLabel;
  const number = getMatchNumber(match);
  const prefix = String(match?.id || '').includes('-final-') ? 'Final' : 'Partie';
  return number ? `${prefix} ${number}` : 'Partie';
}

function formatMatchNumberLabel(match) {
  return getMatchDisplayLabel(match);
}

function formatWinnerResult(match) {
  return formatResultForPlayer(match.ergebnis, match.sieger === 1);
}

function getMatchGameStats(match) {
  const scores = [...String(match.ergebnis || '').matchAll(/(\d+)\s*:\s*(\d+)/g)];
  let team1Games = 0;
  let team2Games = 0;

  scores.forEach(score => {
    const team1Score = Number(score[1]);
    const team2Score = Number(score[2]);
    if (team1Score > 7 || team2Score > 7) return;

    team1Games += team1Score;
    team2Games += team2Score;
  });

  const winnerGames = match.sieger === 1 ? team1Games : team2Games;
  const loserGames = match.sieger === 1 ? team2Games : team1Games;

  return {
    team1Games,
    team2Games,
    winnerGames,
    loserGames,
    diff: winnerGames - loserGames
  };
}

function parseRegularSetScore(rawSet) {
  const normalized = String(rawSet || '')
    .replace(/\([^)]*\)/g, '')
    .trim();
  const match = normalized.match(/^(\d+)\s*:\s*(\d+)$/);

  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function getRegularSetScores(match) {
  const scoreCount = isSingleSetMatch(match) ? 1 : 2;
  return [...String(match?.ergebnis || '').matchAll(/(\d+)\s*:\s*(\d+)/g)]
    .map(score => parseRegularSetScore(`${score[1]}:${score[2]}`))
    .filter(Boolean)
    .slice(0, scoreCount);
}

function getPlayerSetDominance(player, matches = []) {
  let spielDiff = 0;
  let setCount = 0;

  matches
    .filter(match => match.sieger !== null && match.ergebnis)
    .filter(match => match.team1.spieler.includes(player.name) || match.team2.spieler.includes(player.name))
    .forEach(match => {
      const isTeam1 = match.team1.spieler.includes(player.name);
      getRegularSetScores(match).forEach(([team1Games, team2Games]) => {
        spielDiff += isTeam1 ? team1Games - team2Games : team2Games - team1Games;
        setCount += 1;
      });
    });

  return { spielDiff, setCount };
}

function getNormalizedWinnerSetAverages() {
  const setTotals = [
    { winnerGames: 0, loserGames: 0, count: 0 },
    { winnerGames: 0, loserGames: 0, count: 0 }
  ];
  const matchDiffs = [];
  const playedMatches = getStatisticsMatches()
    .filter(match => match.sieger !== null && match.ergebnis);

  playedMatches.forEach(match => {
    const sets = getRegularSetScores(match);

    sets.forEach(([team1Games, team2Games], index) => {
      if (team1Games === team2Games) return;

      setTotals[index].winnerGames += Math.max(team1Games, team2Games);
      setTotals[index].loserGames += Math.min(team1Games, team2Games);
      setTotals[index].count += 1;
    });

    const matchStats = getMatchGameStats(match);
    if (Number.isFinite(matchStats.diff)) matchDiffs.push(matchStats.diff);
  });

  const sets = setTotals.map(total => {
    if (!total.count || !total.winnerGames) return null;

    const winnerAverage = total.winnerGames / total.count;
    const loserAverage = total.loserGames / total.count;
    return {
      count: total.count,
      winnerAverage,
      loserAverage,
      normalizedWinner: 6,
      normalizedLoser: (loserAverage / winnerAverage) * 6
    };
  });

  return {
    playedMatches: playedMatches.length,
    averageMatchDiff: average(matchDiffs),
    sets
  };
}

function getPlayedMatchesWithProbability() {
  const data = getStatisticsData();
  return getStatisticsMatches()
    .filter(match => match.sieger !== null)
    .map(match => ({
      match,
      probability: getHistoricalMatchWinProbability(match, data)
    }))
    .filter(item => item.probability);
}

const FAVORITE_CHECK_MIN_PROBABILITY = 55;

function getFavoriteCheckStats(matches = getPlayedMatchesWithProbability()) {
  const favoriteMatches = matches
    .filter(({ probability }) => Math.max(probability.team1, probability.team2) >= FAVORITE_CHECK_MIN_PROBABILITY);
  const favoriteWins = favoriteMatches.filter(({ match, probability }) => {
    const favorite = probability.team1 > probability.team2 ? 1 : 2;
    return match.sieger === favorite;
  }).length;

  return {
    matches: favoriteMatches.length,
    wins: favoriteWins,
    rate: favoriteMatches.length ? Math.round((favoriteWins / favoriteMatches.length) * 100) : null
  };
}

function renderFavoriteCheck() {
  const stats = getFavoriteCheckStats();

  if (!stats.matches) {
    document.getElementById('favorite-check').innerHTML = '<div class="empty-state">Noch keine Favoriten-Daten.</div>';
    return;
  }

  document.getElementById('favorite-check').innerHTML = `
    <div class="stat-main">${stats.rate}%</div>
    <div class="stat-copy">Favoriten gewannen ${stats.wins} von ${stats.matches} Partien.</div>
  `;
}

function renderAverageSetScoreFact() {
  const target = document.getElementById('stats-average-set-score');
  if (!target) return;

  const averages = getNormalizedWinnerSetAverages();
  const setRows = [
    ...averages.sets
    .map((setAverage, index) => {
      if (!setAverage) return '';

      return `<div class="stat-split-row">
        <span class="stat-split-label">Satz ${index + 1}</span>
        <span class="stat-split-value">6 : ${formatDecimal(setAverage.normalizedLoser)}</span>
      </div>`;
    }),
    Number.isFinite(averages.averageMatchDiff)
      ? `<div class="stat-split-row">
          <span class="stat-split-label">Gesamt</span>
          <span class="stat-split-value">${formatSignedDecimal(averages.averageMatchDiff)}</span>
        </div>`
      : ''
  ]
    .filter(Boolean)
    .join('');

  target.innerHTML = setRows
    ? `<div class="stat-split-score">${setRows}</div>
       <div class="stat-copy">Die Sieger gewannen im Schnitt mit ${formatDecimal(averages.averageMatchDiff)} Spielen Abstand.</div>`
    : '<div class="empty-state">Noch keine gespielten Partien.</div>';
}

function getRankingDeviationGroups(fromMode, toMode, topDirection = 'negative') {
  const fromMap = getRankingPositionMap(fromMode);
  const toMap = getRankingPositionMap(toMode);
  const items = PADEL_DATA.players
    .map(player => {
      const fromRank = fromMap.get(player.name);
      const toRank = toMap.get(player.name);

      if (!Number.isFinite(fromRank) || !Number.isFinite(toRank)) return null;
      return {
        player,
        fromRank,
        toRank,
        delta: toMode === 'elo' ? toRank - fromRank : fromRank - toRank
      };
    })
    .filter(Boolean);

  const topIsPositive = topDirection === 'positive';

  return {
    up: items
      .filter(item => topIsPositive ? item.delta > 0 : item.delta < 0)
      .sort((a, b) =>
        (topIsPositive ? b.delta - a.delta : a.delta - b.delta) ||
        a.toRank - b.toRank ||
        a.fromRank - b.fromRank ||
        a.player.name.localeCompare(b.player.name, 'de')
      )
      .slice(0, 2),
    down: items
      .filter(item => topIsPositive ? item.delta < 0 : item.delta > 0)
      .sort((a, b) =>
        (topIsPositive ? a.delta - b.delta : b.delta - a.delta) ||
        a.toRank - b.toRank ||
        a.fromRank - b.fromRank ||
        a.player.name.localeCompare(b.player.name, 'de')
      )
      .slice(0, 2)
  };
}

function renderRankingDeviationFact(targetId, fromMode, toMode, topDirection = 'negative') {
  const target = document.getElementById(targetId);
  if (!target) return;

  const modeLabels = {
    points: 'Punkte',
    elo: 'Elo',
    'draw-factor': 'Losfaktor'
  };
  const labels = getRankingDeviationLabels(targetId);
  const { up, down } = getRankingDeviationGroups(fromMode, toMode, topDirection);
  const renderShiftItem = item => `<div class="stat-shift-item">
    <div class="stat-shift-head">
      ${renderPlayerProfileLink(item.player, `stat-shift-name ${isSelectedPlayer(item.player.name) ? 'viewer-player' : ''}`)}
      <span class="stat-shift-value ${getDeltaClass(item.delta)}">${formatSignedInteger(item.delta)}</span>
    </div>
    <div class="stat-meta-line">${toMode === 'elo'
      ? `${modeLabels[toMode]} #${item.toRank} -> ${modeLabels[fromMode]} #${item.fromRank}`
      : `${modeLabels[fromMode]} #${item.fromRank} -> ${modeLabels[toMode]} #${item.toRank}`}</div>
  </div>`;

  target.innerHTML = `
    <div class="stat-shift-groups">
      <div class="stat-shift-group">
        <h3>${escapeHtml(labels.top)}</h3>
        <div class="stat-shift-list">${up.length ? up.map(renderShiftItem).join('') : '<div class="empty-state">Keine Aufsteiger.</div>'}</div>
      </div>
      <div class="stat-shift-group">
        <h3>${escapeHtml(labels.bottom)}</h3>
        <div class="stat-shift-list">${down.length ? down.map(renderShiftItem).join('') : '<div class="empty-state">Keine Absteiger.</div>'}</div>
      </div>
    </div>
  `;
}

function getMatchLeaguePoints(match, teamIndex) {
  const [team1Sets, team2Sets] = String(match.saetze || '').split(':').map(Number);
  if (!Number.isFinite(team1Sets) || !Number.isFinite(team2Sets)) return 0;

  const ownSets = teamIndex === 1 ? team1Sets : team2Sets;
  const opponentSets = teamIndex === 1 ? team2Sets : team1Sets;

  if (ownSets === 2 && opponentSets === 0) return 3;
  if (ownSets === 2 && opponentSets === 1) return 2;
  if (ownSets === 1 && opponentSets === 2) return 1;
  return 0;
}

function getAverageLeaguePointModel() {
  const playedMatches = PADEL_DATA.matches
    .filter(countsForRanking)
    .filter(match => match.sieger !== null && match.saetze);
  const winnerPoints = [];
  const loserPoints = [];

  playedMatches.forEach(match => {
    winnerPoints.push(getMatchLeaguePoints(match, match.sieger));
    loserPoints.push(getMatchLeaguePoints(match, match.sieger === 1 ? 2 : 1));
  });

  return {
    winner: average(winnerPoints) ?? 2.5,
    loser: average(loserPoints) ?? 0.5
  };
}

function getFinalFourForecast() {
  const pointModel = getAverageLeaguePointModel();
  const playersByName = new Map(PADEL_DATA.players.map(player => {
    const stats = getPlayerStats(player);
    return [player.name, {
      player,
      currentPoints: stats.punkte,
      projectedPoints: stats.punkte,
      expectedRemaining: 0,
      stats
    }];
  }));

  const forecastMatches = PADEL_DATA.matches
    .filter(countsForRanking)
    .filter(match => match.sieger === null);

  forecastMatches.forEach(match => {
    const probability = getMatchWinProbability(match) || { team1: 50, team2: 50 };
    const team1Favored = probability.team1 >= probability.team2;
    const team1ExpectedPoints = team1Favored ? pointModel.winner : pointModel.loser;
    const team2ExpectedPoints = team1Favored ? pointModel.loser : pointModel.winner;

    match.team1.spieler.forEach(playerName => {
      const forecast = playersByName.get(playerName);
      if (!forecast) return;
      forecast.projectedPoints += team1ExpectedPoints;
      forecast.expectedRemaining += team1ExpectedPoints;
    });

    match.team2.spieler.forEach(playerName => {
      const forecast = playersByName.get(playerName);
      if (!forecast) return;
      forecast.projectedPoints += team2ExpectedPoints;
      forecast.expectedRemaining += team2ExpectedPoints;
    });
  });

  return [...playersByName.values()].sort((a, b) =>
    b.projectedPoints - a.projectedPoints ||
    b.currentPoints - a.currentPoints ||
    b.stats.spielDiff - a.stats.spielDiff ||
    b.stats.gewonneneSpiele - a.stats.gewonneneSpiele ||
    (getLatestPlayerEloValue(b.player) ?? 0) - (getLatestPlayerEloValue(a.player) ?? 0)
  );
}

function renderFinalFourForecast() {
  const target = document.getElementById('stats-final-four-forecast');
  if (!target) return;

  const qualificationPlaces = getCompetitionConfig().qualificationPlaces || 4;
  const forecast = getFinalFourForecast().slice(0, 4);
  const label = document.getElementById('stats-qualification-forecast-label');
  if (label) label.textContent = qualificationPlaces > 4 ? 'Top-4-Prognose' : 'Final-Four-Prognose';
  const openMatches = PADEL_DATA.matches
    .filter(countsForRanking)
    .filter(match => match.sieger === null).length;

  target.innerHTML = forecast.length
    ? `${forecast.map((item, index) => `
      <div class="mini-rank-row r${index + 1}">
        <span class="rank-position">${index + 1}</span>
        <div>
          ${renderPlayerProfileLink(item.player, `mini-rank-name ${isSelectedPlayer(item.player.name) ? 'viewer-player' : ''}`)}
          <div class="stat-meta-line">${formatDecimal(item.projectedPoints)} erwartete Punkte · ${item.currentPoints} aktuell</div>
        </div>
      </div>
    `).join('')}`
    : '<div class="empty-state">Noch keine Prognosedaten.</div>';
}

function formatAverageMatchTime(minutes) {
  if (!Number.isFinite(minutes)) return '—';

  const roundedMinutes = Math.round(minutes);
  const hours = Math.floor(roundedMinutes / 60);
  const mins = roundedMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function getPlayerAverageMatchTime(player, matches = getStatisticsMatches()) {
  const times = matches
    .filter(match => match.team1.spieler.includes(player.name) || match.team2.spieler.includes(player.name))
    .filter(match => match.sieger !== null && match.uhrzeit)
    .map(getMatchTimeMinutes)
    .filter(minutes => Number.isFinite(minutes) && minutes < 24 * 60);

  return {
    player,
    count: times.length,
    averageMinutes: average(times)
  };
}

function renderTimePerformance() {
  const target = document.getElementById('stats-time-performance');
  if (!target) return;

  const matches = getStatisticsMatches();
  const playerTimes = getStatisticsPlayers()
    .map(player => getPlayerAverageMatchTime(player, matches))
    .filter(item => Number.isFinite(item.averageMinutes))
    .sort((a, b) =>
      a.averageMinutes - b.averageMinutes ||
      b.count - a.count ||
      a.player.name.localeCompare(b.player.name, 'de')
    );

  if (!playerTimes.length) {
    target.innerHTML = '<div class="empty-state">Noch keine Partien mit Uhrzeit.</div>';
    return;
  }

  const earliest = playerTimes[0];
  const latest = playerTimes[playerTimes.length - 1];

  target.innerHTML = `
    <div class="stat-shift-groups">
      <div class="stat-shift-group">
        <h3>Früher Vogel</h3>
        <div class="stat-time-row">
          <div class="stat-time-text">
            ${renderPlayerProfileLink(earliest.player, `mini-rank-name ${isSelectedPlayer(earliest.player.name) ? 'viewer-player' : ''}`)}
            <div class="stat-meta-line">Ø-Spielbeginn aus ${earliest.count} Partien</div>
          </div>
          <span class="stat-split-value">${formatAverageMatchTime(earliest.averageMinutes)}</span>
        </div>
      </div>
      <div class="stat-shift-group">
        <h3>Langschläfer</h3>
        <div class="stat-time-row">
          <div class="stat-time-text">
            ${renderPlayerProfileLink(latest.player, `mini-rank-name ${isSelectedPlayer(latest.player.name) ? 'viewer-player' : ''}`)}
            <div class="stat-meta-line">Ø-Spielbeginn aus ${latest.count} Partien</div>
          </div>
          <span class="stat-split-value">${formatAverageMatchTime(latest.averageMinutes)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderSetDominance() {
  const target = document.getElementById('stats-set-dominance');
  if (!target) return;

  const matches = getStatisticsMatches();
  const dominantPlayers = getStatisticsPlayers()
    .map(player => {
      const stats = isAllTimeStatistics()
        ? getPlayerSetDominance(player, matches)
        : getPlayerStats(player, matches);
      return {
        player,
        stats,
        averageDiff: isAllTimeStatistics()
          ? stats.setCount > 0 ? stats.spielDiff / stats.setCount : null
          : stats.partien > 0 ? stats.spielDiff / stats.partien : null
      };
    })
    .filter(item => Number.isFinite(item.averageDiff))
    .sort((a, b) =>
      b.averageDiff - a.averageDiff ||
      b.stats.spielDiff - a.stats.spielDiff ||
      (b.stats.setCount || b.stats.partien) - (a.stats.setCount || a.stats.partien) ||
      a.player.name.localeCompare(b.player.name, 'de')
    )
    .slice(0, 3);

  target.innerHTML = dominantPlayers.length
    ? dominantPlayers.map((item, index) => `
      <div class="mini-rank-row r${index + 1}">
        <span class="rank-position">${index + 1}</span>
        <div>
          ${renderPlayerProfileLink(item.player, `mini-rank-name ${isSelectedPlayer(item.player.name) ? 'viewer-player' : ''}`)}
          <div class="stat-meta-line">${formatSignedDecimal(item.averageDiff)} Spiele pro ${isAllTimeStatistics() ? 'Satz' : 'Partie'} · ${formatStatDiff(item.stats.spielDiff)} gesamt</div>
        </div>
      </div>
    `).join('')
    : '<div class="empty-state">Noch keine gespielten Partien.</div>';
}

function renderDominantMatches() {
  const dominantMatches = getStatisticsMatches()
    .filter(match => match.sieger !== null)
    .map(match => ({ match, gameStats: getMatchGameStats(match) }))
    .filter(item => Number.isFinite(item.gameStats.diff) && item.gameStats.diff > 0)
    .sort((a, b) =>
      b.gameStats.diff - a.gameStats.diff ||
      a.gameStats.loserGames - b.gameStats.loserGames ||
      getMatchNumber(a.match) - getMatchNumber(b.match)
    )
    .slice(0, 3);

  document.getElementById('dominant-matches').innerHTML = dominantMatches.length
    ? dominantMatches.map((item, index) => `
      <div class="mini-rank-row r${index + 1}">
        <span class="rank-position">${index + 1}</span>
        <div>
          <div class="mini-rank-name">${renderStatTeamPlayers(getWinnerTeam(item.match))}</div>
          <div class="stat-meta-line">${formatStatisticsMatchLabel(item.match)} · ${formatWinnerResult(item.match)} · ${formatStatDiff(item.gameStats.diff)}</div>
        </div>
      </div>
    `).join('')
    : '<div class="empty-state">Noch keine gespielten Partien.</div>';
}

function renderBiggestUpsets() {
  const upsets = getPlayedMatchesWithProbability()
    .map(({ match }) => ({
      match,
      winnerProbability: getWinnerProbability(match)
    }))
    .filter(item => Number.isFinite(item.winnerProbability) && item.winnerProbability < 50)
    .sort((a, b) =>
      a.winnerProbability - b.winnerProbability ||
      getMatchNumber(a.match) - getMatchNumber(b.match)
    )
    .slice(0, 3);

  document.getElementById('biggest-upsets').innerHTML = upsets.length
    ? upsets.map((item, index) => `
      <div class="mini-rank-row r${index + 1}">
        <span class="rank-position">${index + 1}</span>
        <div>
          <div class="mini-rank-name">${renderStatTeamPlayers(getWinnerTeam(item.match))}</div>
          <div class="stat-meta-line">${formatStatisticsMatchLabel(item.match)} · nur ${item.winnerProbability}% Siegchance</div>
        </div>
      </div>
    `).join('')
    : '<div class="empty-state">Noch kein Außenseiter-Sieg.</div>';
}

function renderStatistik() {
  renderStatisticsModeState();
  renderFavoriteCheck();
  renderDominantMatches();
  renderBiggestUpsets();
  renderAverageSetScoreFact();
  if (!isAllTimeStatistics()) {
    renderRankingDeviationFact('stats-elo-points-deviation', 'points', 'elo', 'positive');
    renderRankingDeviationFact('stats-points-draw-factor-deviation', 'points', 'draw-factor', 'positive');
    renderFinalFourForecast();
  } else {
    renderAllTimeRanking();
  }
  renderTimePerformance();
  renderSetDominance();
}

function expandHomeArticle() {
  document.getElementById('home-article-preview').classList.add('expanded');
  document.getElementById('article-readmore').style.display = 'none';
}

function sectionId(title) {
  return title.toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function renderInfoSection(section, id) {
  const link = section.link
    ? `<a href="${section.link.href}" target="_blank" rel="noopener" class="text-link inline-link">${section.link.label}</a>`
    : '';
  const intro = section.intro ? `<p>${section.intro} ${link}</p>` : '';
  const paragraphs = (section.paragraphs || []).map(p => `<p>${p}</p>`).join('');
  const groups = (section.groups || []).map(group => `<div class="info-group">
    <h4>${group.title}</h4>
    <ul class="clean-list">${group.items.map(item => `<li>${item}</li>`).join('')}</ul>
  </div>`).join('');
  const items = section.items
    ? `<ul class="clean-list">${section.items.map(item => `<li>${item}</li>`).join('')}</ul>`
    : '';
  const table = section.table
    ? `<div class="info-table-wrap"><table class="info-table">${section.table.map((row, index) => `
      <tr>${row.map(cell => index === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`).join('')}</tr>
    `).join('')}</table></div>`
    : '';
  const paragraphsAfterTable = (section.paragraphsAfterTable || []).map(p => `<p>${p}</p>`).join('');
  const note = section.note ? `<p class="info-note">${section.note}</p>` : '';

  return `<article class="info-card info-anchor" id="${id}">
    <h2>${section.title}</h2>
    ${intro}
    ${paragraphs}
    ${groups}
    ${table}
    ${paragraphsAfterTable}
    ${items}
    ${note}
  </article>`;
}

function renderInfoArticle(article, index) {
  return `<article class="info-card info-article-card info-anchor" id="artikel-${article.spieltag}">
    <div class="info-article-preview" id="info-article-preview-${index}">
      ${renderArticleCard(article)}
    </div>
    <button class="text-link info-article-readmore" id="info-article-readmore-${index}" data-expand-info-article="${index}">Weiterlesen</button>
  </article>`;
}

function expandInfoArticle(index) {
  document.getElementById(`info-article-preview-${index}`).classList.add('expanded');
  document.getElementById(`info-article-readmore-${index}`).style.display = 'none';
}

function getInfoArticleMenuTitle(article) {
  if (article.spieltag === 'abschluss') return article.title;
  if (Number(article.spieltag) === 8) return `F4: ${article.title}`;
  if (Number.isInteger(Number(article.spieltag))) return `S${article.spieltag}: ${article.title}`;
  return article.title;
}

function renderInfos() {
  const articles = PADEL_DATA.articles || [];
  const sectionLinks = [
    { id: 'kurzinfo', title: 'Kurzinfo' },
    ...PADEL_INFO.sections.map(section => ({ id: sectionId(section.title), title: section.title }))
  ];
  const articleLinks = articles.map(article => ({
      id: `artikel-${article.spieltag}`,
      title: getInfoArticleMenuTitle(article)
    }));

  document.getElementById('info-menu').innerHTML = `<div class="info-menu-list">
    ${sectionLinks.map(link => `<a href="#${link.id}">${link.title}</a>`).join('')}
    <div class="info-menu-submenu">
      <a href="#artikel" class="info-menu-padelpost-link">PadelPost</a>
      <div class="info-menu-subitems" id="info-menu-padelpost">
        ${articleLinks.length
          ? articleLinks.map(link => `<a href="#${link.id}" class="is-sub">${link.title}</a>`).join('')
          : '<a href="#artikel" class="is-sub">Archiv</a>'}
      </div>
    </div>
  </div>`;

  const shortInfo = `<article class="info-card info-anchor" id="kurzinfo">
    <h2>Kurzinfo</h2>
    <ul class="clean-list">${(PADEL_DATA.shortInfo || []).map(item => `<li>${item}</li>`).join('')}</ul>
    ${renderTop8QualificationFlow()}
  </article>`;

  const articleSection = `<section class="info-article-section info-anchor" id="artikel">
    <div class="sh info-article-heading">
      <h2>PADELPOST</h2>
      <div class="sh-meta">Archiv</div>
    </div>
    <div class="info-articles-stack">
      ${articles.length ? articles.map(renderInfoArticle).join('') : '<article class="info-card"><div class="empty-state">Noch keine PadelPost-Ausgabe für diese Saison.</div></article>'}
    </div>
  </section>`;

  document.getElementById('info-sections').innerHTML = [
    shortInfo,
    ...PADEL_INFO.sections.map(section => renderInfoSection(section, sectionId(section.title))),
    articleSection
  ].join('');
}

// ── MATCHES ───────────────────────────────────────────────────────
function isAuthenticatedPlayerMatch(match) {
  const playerId = window.PadelKonto?.getProfile?.()?.player_id || null;
  const playerName = playerId && PADEL_DATA?.players.find(player => player.id === playerId)?.name;
  return Boolean(playerName && [...match.team1.spieler, ...match.team2.spieler].includes(playerName));
}

function renderMatchForecastLine(match) {
  const forecast = match?.forecast;
  const statistics = window.PadelMatchStatistics;
  const concealed = Boolean(statistics?.isForecastConcealed?.(forecast, {
    isOwnMatch: isAuthenticatedPlayerMatch(match),
    hasOwnPrediction: ownPredictionMatchIds.has(match.id)
  }));
  const totalVotes = concealed ? 1 : Math.max(0, Number(forecast?.totalVotes) || 0);
  const teamOnePercentage = concealed
    ? statistics.concealedForecastPercentage(match.id)
    : totalVotes
    ? Math.min(100, Math.max(0, Number(forecast?.team1Percentage) || 0))
    : 0;
  const teamTwoPercentage = totalVotes ? 100 - teamOnePercentage : 0;
  const hasBothTeamColors = teamOnePercentage > 0 && teamTwoPercentage > 0;
  const label = concealed
    ? 'Abstimmung: Verteilung erst nach eigenem Tipp sichtbar'
    : totalVotes
    ? `Abstimmung: Team 1 ${teamOnePercentage} Prozent, Team 2 ${teamTwoPercentage} Prozent`
    : 'Abstimmung: noch keine Stimme';
  return `<span class="mc-forecast-line${totalVotes ? ' has-votes' : ''}${hasBothTeamColors ? ' has-both-team-colors' : ''}" role="img" aria-label="${label}">
    <span class="mc-forecast-team-one" style="width:${teamOnePercentage / 2}%"></span>
    <span class="mc-forecast-team-two" style="width:${teamTwoPercentage / 2}%"></span>
  </span>`;
}

function renderMatchRow(m) {
  const activeLive = window.PadelLiveTicker?.activeMatch;
  const isLive = activeLive?.matchId === m.id;
  if (isCancelledMatch(m)) {
    return `<div class="mc played unrated ${isViewerMatch(m) ? 'viewer-match' : ''}" data-match-entry="${escapeHtml(m.id)}">
      <div class="mc-meta"><span class="mc-nr">${formatMatchMeta(m, { relative: true })}</span></div>
      <div class="mc-team mc-team-1">
        <div class="mc-players">${renderTeamPlayers(m.team1.spieler)}</div>
      </div>
      <div class="mc-score">
        <div class="mc-score-main">o.W.</div>
        <div class="mc-score-detail">ohne Wertung</div>
      </div>
      <div class="mc-team mc-team-2">
        <div class="mc-players">${renderTeamPlayers(m.team2.spieler)}</div>
      </div>
    </div>`;
  }
  const statistics = window.PadelMatchStatistics?.entry(m, PADEL_DATA);
  if (m.sieger === null) {
    const probability = getMatchWinProbability(m);
    const probabilityHtml = probability
      ? `<div class="mc-prob">${probability.team1}% : ${probability.team2}%</div>`
      : '';
    return `<div class="mc pending ${isViewerMatch(m) ? 'viewer-match' : ''}" data-match-entry="${escapeHtml(m.id)}">
      <div class="mc-meta"><span class="mc-nr">${formatMatchMeta(m, { relative: true })}</span></div>
      <div class="mc-team mc-team-1">
        <div class="mc-players">${renderTeamPlayers(m.team1.spieler)}</div>
      </div>
      ${isLive ? `<button type="button" class="mc-score" data-live-open-match="${escapeHtml(m.id)}" aria-label="Liveticker öffnen, Satzstand 0 zu 0, Spielstand ${Number(activeLive.teamOneGames) || 0} zu ${Number(activeLive.teamTwoGames) || 0}">
        <div class="mc-score-main">0:0</div>
        <div class="mc-score-detail mc-score-live">${Number(activeLive.teamOneGames) || 0}:${Number(activeLive.teamTwoGames) || 0} <span class="mc-score-live-dot" aria-hidden="true">●</span>LIVE</div>
      </button>` : `${statistics ? `<button type="button" class="mc-score" ${statistics.attributes}>` : '<div class="mc-score">'}
        ${probabilityHtml}
        ${statistics?.mode === 'preview' ? renderMatchForecastLine(m) : ''}
      ${statistics ? '</button>' : '</div>'}`}
      <div class="mc-team mc-team-2">
        <div class="mc-players">${renderTeamPlayers(m.team2.spieler)}</div>
      </div>
    </div>`;
  }

  const t1w = m.sieger === 1, t2w = m.sieger === 2;
  const hasLiveHistory = Boolean(window.PadelLiveTicker?.hasHistory(m.id));
  const liveHistoryIcon = statistics?.icon || (hasLiveHistory && getMatchStage(m) !== 'final-four' ? `<span class="mc-score-details-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M4 6h9M4 11h6M4 16h5"></path>
      <circle cx="15.5" cy="14.5" r="3.5"></circle>
      <path d="m18 17 3 3"></path>
    </svg>
  </span>` : '');
  const scoreMain = String(m.saetze || '—');
  const scoreDetail = m.ergebnis
    ? `<div class="mc-score-detail">${hasLiveHistory || statistics ? `<span class="mc-score-result-with-details">${m.ergebnis}${liveHistoryIcon}</span>` : m.ergebnis}</div>`
    : '';
  const viewerInT1 = isParticipantView() && m.team1.spieler.includes(getSelectedViewer().name);
  const viewerInT2 = isParticipantView() && m.team2.spieler.includes(getSelectedViewer().name);
  const viewerWon  = (viewerInT1 && m.sieger === 1) || (viewerInT2 && m.sieger === 2);
  const viewerLost = (viewerInT1 && m.sieger === 2) || (viewerInT2 && m.sieger === 1);
  const viewerResultClass = viewerWon ? 'viewer-win' : viewerLost ? 'viewer-loss' : '';
  const probability = getHistoricalMatchWinProbability(m);
  const leftProbability = probability ? `<span class="mc-result-prob">${probability.team1}%</span>` : '';
  const rightProbability = probability ? `<span class="mc-result-prob">${probability.team2}%</span>` : '';

  return `<div class="mc played ${isViewerMatch(m) ? `viewer-match ${viewerResultClass}` : ''}" data-match-entry="${escapeHtml(m.id)}">        <div class="mc-meta"><span class="mc-nr">${formatMatchMeta(m, { relative: true })}</span></div>
    <div class="mc-team mc-team-1 ${t1w?'win':''}">
      <div class="mc-players">${renderTeamPlayers(m.team1.spieler)}</div>
    </div>
    ${hasLiveHistory ? `<button type="button" class="mc-score" data-live-open-match="${escapeHtml(m.id)}" aria-label="Spielverlauf öffnen">` : statistics ? `<button type="button" class="mc-score" ${statistics.attributes}>` : '<div class="mc-score">'}
      <div class="mc-result-row">
        ${leftProbability}
        <div class="mc-score-main">${scoreMain}</div>
        ${rightProbability}
      </div>
      ${scoreDetail}
    ${hasLiveHistory || statistics ? '</button>' : '</div>'}
    <div class="mc-team mc-team-2 ${t2w?'win':''}">
      <div class="mc-players">${renderTeamPlayers(m.team2.spieler)}</div>
    </div>
  </div>`;
}

function renderMatchdayGroup(spieltag, matches) {
  if (!matches.length) return '';

  return `<div class="match-group">
    ${formatMatchdayLabel(spieltag)}
    <div class="match-list">${matches.map(renderMatchRow).join('')}</div>
  </div>`;
}

// Pausen erscheinen nur zwischen zwei sichtbaren Spieltagen der Spieltagsansicht.
function getMatchdayBreakBetween(previousMatchday, nextMatchday) {
  const previousEnd = getMatchdayInfo(previousMatchday)?.endDate;
  const nextStart = getMatchdayInfo(nextMatchday)?.startDate;
  if (!previousEnd || !nextStart) return null;
  return (PADEL_DATA.matchdayBreaks || []).find(matchdayBreak =>
    matchdayBreak.startDate > previousEnd && matchdayBreak.endDate < nextStart
  ) || null;
}

function renderMatchdayBreak(matchdayBreak) {
  if (!matchdayBreak) return '';

  return `<div class="match-group matchday-break">
    ${renderGroupHeading(matchdayBreak.title, formatMatchdayRange(matchdayBreak))}
  </div>`;
}

function renderTournamentGroup(matches, fallbackTitle, className) {
  if (!matches.length) return '';

  const title = getMatchdayInfo(matches[0].spieltag)?.title || fallbackTitle;
  const played = matches.filter(match => match.sieger !== null).length;
  const detailEntryMatchId = className === 'final-four-group'
    ? getFinalFourDetailEntryMatchId()
    : null;
  const detailLink = detailEntryMatchId
    ? `<button type="button" class="text-link inline-link final-four-detail-link" data-live-open-match="${escapeHtml(detailEntryMatchId)}" data-live-view="overview">Zur Übersicht</button>`
    : '';
  return `<div class="match-group ${className}">
    <div class="sh final-four-heading">
      <div class="sh-heading">
        <h2>${title.toUpperCase()}</h2>
        <div class="sh-meta">${played}/${matches.length}</div>
      </div>
      ${detailLink}
    </div>
    <div class="match-list">${matches.map(renderMatchRow).join('')}</div>
  </div>`;
}

function matchesCurrentMatchScope(match) {
  if (matchScope === 'open') return match.sieger === null && !isCancelledMatch(match);
  if (matchScope === 'mine') return isViewerMatch(match);
  return true;
}

function getSeasonStageOrder(phase = getSeasonDisplayPhase()) {
  if (phase === 'semifinal') return ['semifinal', 'league', 'finalFour'];
  if (['final-four', 'completed'].includes(phase)) return ['finalFour', 'semifinal', 'league'];
  return ['league', 'semifinal', 'finalFour'];
}

function joinSeasonPhaseSections(sections) {
  return getSeasonStageOrder()
    .map(stage => sections[stage])
    .filter(Boolean)
    .join('');
}

function renderPartienByMatchday(matches) {
  const regularMatches = matches.filter(match => getMatchStage(match) === 'league');
  const semifinalMatches = applyMatchSortDirection(matches
    .filter(match => getMatchStage(match) === 'semifinal')
    .sort(compareMatchesByNumber));
  const finalFourMatches = applyMatchSortDirection(matches
    .filter(match => getMatchStage(match) === 'final-four')
    .sort(compareMatchesByNumber));
  const matchdays = applyMatchSortDirection([...new Set(regularMatches.map(match => match.spieltag))].sort((a, b) => a - b));

  const regularHtml = matchdays.map((matchday, index) => {
    const matchesForDay = applyMatchSortDirection(regularMatches
      .filter(match => match.spieltag === matchday)
      .sort(compareMatchesByNumber));
    const matchdayBreak = index > 0
      ? getMatchdayBreakBetween(...applyMatchSortDirection([matchdays[index - 1], matchday]))
      : null;
    return renderMatchdayBreak(matchdayBreak) + renderMatchdayGroup(matchday, matchesForDay);
  }).join('');
  const semifinalHtml = renderTournamentGroup(semifinalMatches, 'Halbfinale', 'semifinal-group');
  const finalFourHtml = renderTournamentGroup(finalFourMatches, 'Final Four', 'final-four-group');
  return joinSeasonPhaseSections({
    league: regularHtml,
    semifinal: semifinalHtml,
    finalFour: finalFourHtml
  });
}

function formatMatchDateGroupLabel(date) {
  const parsedDate = parseDateValue(date);
  if (!parsedDate) return date;
  return parsedDate.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

function renderMatchDateGroup(date, matches) {
  if (!matches.length) return '';
  const countLabel = matches.length === 1 ? '1 Partie' : `${matches.length} Partien`;
  return `<div class="match-group">
    ${renderGroupHeading(formatMatchDateGroupLabel(date), countLabel)}
    <div class="match-list">${matches.map(renderMatchRow).join('')}</div>
  </div>`;
}

function renderOpenMatchGroup(matches) {
  if (!matches.length) return '';
  return `<div class="match-group">
    ${renderGroupHeading('Offen', 'Ohne Termin')}
    <div class="match-list">${matches.map(renderMatchRow).join('')}</div>
  </div>`;
}

// Partien ohne Termin haben kein Datum zum Umdrehen und bleiben in beiden Richtungen am Ende.
function sortMatchesBySchedule(matches) {
  const sorted = [...matches].sort(compareMatchesBySchedule);
  return [
    ...applyMatchSortDirection(sorted.filter(hasMatchSortDate)),
    ...applyMatchSortDirection(sorted.filter(match => !hasMatchSortDate(match)))
  ];
}

function renderPartienByDate(matches) {
  const regularMatches = matches.filter(match => getMatchStage(match) === 'league');
  const semifinalMatches = sortMatchesBySchedule(matches.filter(match => getMatchStage(match) === 'semifinal'));
  const finalFourMatches = sortMatchesBySchedule(matches.filter(match => getMatchStage(match) === 'final-four'));
  const sortedMatches = sortMatchesBySchedule(regularMatches);
  const scheduledMatches = sortedMatches.filter(hasMatchSortDate);
  const openMatches = sortedMatches.filter(match => !hasMatchSortDate(match));
  const dateGroups = [...new Set(scheduledMatches.map(match => toDateKey(getMatchSortDate(match))))];
  const scheduledHtml = dateGroups.map(date => renderMatchDateGroup(
    date,
    scheduledMatches.filter(match => toDateKey(getMatchSortDate(match)) === date)
  )).join('');
  const openHtml = renderOpenMatchGroup(openMatches);
  const semifinalHtml = renderTournamentGroup(semifinalMatches, 'Halbfinale', 'semifinal-group');
  const finalFourHtml = renderTournamentGroup(finalFourMatches, 'Final Four', 'final-four-group');
  return joinSeasonPhaseSections({
    league: scheduledHtml + openHtml,
    semifinal: semifinalHtml,
    finalFour: finalFourHtml
  });
}

function renderCupTrophy() {
  return `<div class="cup-trophy" aria-hidden="true">
    <svg viewBox="0 0 160 150" role="presentation" focusable="false">
      <path class="cup-trophy-glow" d="M42 18h76v26c0 28-15 49-38 55-23-6-38-27-38-55V18Z"/>
      <path class="cup-trophy-line" d="M46 20h68v23c0 28-14 46-34 52-20-6-34-24-34-52V20Z"/>
      <path class="cup-trophy-line" d="M46 31H25v12c0 22 11 34 29 37M114 31h21v12c0 22-11 34-29 37"/>
      <path class="cup-trophy-line" d="M80 95v25M59 137h42M65 120h30v17H65z"/>
      <path class="cup-trophy-accent" d="m80 35 5 11 12 2-9 8 3 12-11-6-11 6 3-12-9-8 12-2 5-11Z"/>
    </svg>
  </div>`;
}

function renderWanderpokalTrophy() {
  return `<div class="cup-trophy wanderpokal-trophy" aria-hidden="true">
    <svg viewBox="0 0 120 242" role="presentation" focusable="false">
      <path class="wanderpokal-outline" d="M25 8C12 16 7 28 14 40c11 13 28 22 46 28 18-6 35-15 46-28 7-12 2-24-11-32M25 8l17 43M95 8 78 51"/>
      <path class="wanderpokal-outline" d="M14 40l5 17Q39 73 60 82Q81 73 101 57l5-17"/>
      <path class="wanderpokal-outline" d="M22 68Q40 86 60 94Q80 86 98 68L95 80Q78 96 60 104Q42 96 25 80Z"/>
      <path class="wanderpokal-outline" d="M29 93Q44 108 60 116Q76 108 91 93L88 105Q74 119 60 126Q46 119 32 105Z"/>
      <path class="wanderpokal-outline" d="M36 118Q48 131 60 138Q72 131 84 118L70 169H50Z"/>
      <path class="wanderpokal-outline" d="M54 169h12v8H54zM50 177h20l-4 13H54l-4-13ZM54 190l-11 24h34l-11-24"/>
      <path class="wanderpokal-outline" d="M35 214h50l4 24H31l4-24Z"/>
    </svg>
  </div>`;
}

function renderFinalFourPodiumSteps(placements, { overviewMatchId = null } = {}) {
  const placementsByPlace = new Map((placements || []).map(placement => [Number(placement.place), placement]));
  const orderedPlacements = [1, 2, 3].map(place => placementsByPlace.get(place));
  if (orderedPlacements.some(placement => !placement?.displayName)) return '';
  const interactive = Boolean(overviewMatchId);

  return `<div class="home-season-podium-steps" role="${interactive ? 'group' : 'img'}" aria-label="${escapeHtml(orderedPlacements[0].displayName)} gewinnt vor ${escapeHtml(orderedPlacements[1].displayName)} und ${escapeHtml(orderedPlacements[2].displayName)}">
    ${[orderedPlacements[1], orderedPlacements[0], orderedPlacements[2]].map(placement => `
      <div class="home-season-podium-place home-season-podium-place--${placement.place}">
        ${placement.place === 1 ? renderWanderpokalTrophy() : ''}
        <div class="home-season-podium-player">${escapeHtml(placement.displayName)}</div>
        ${interactive
          ? `<button type="button" class="home-season-podium-step" data-live-open-match="${escapeHtml(overviewMatchId)}" data-live-view="overview" aria-label="Platz ${placement.place}: Final-Four-Übersicht öffnen"><span aria-hidden="true">${placement.place}</span></button>`
          : `<div class="home-season-podium-step" aria-hidden="true"><span>${placement.place}</span></div>`}
      </div>
    `).join('')}
  </div>`;
}

window.PadelLigaSeasonPodium = {
  getPresentation: () => ({
    seasonId: PADEL_DATA?.id || null,
    placements: getHomeSeasonPodiumPlacements().map(placement => ({
      place: placement.place,
      playerId: placement.player.id,
      displayName: placement.player.name
    }))
  }),
  renderSteps: renderFinalFourPodiumSteps
};

function renderCupMatchCard(match) {
  const statistics = window.PadelMatchStatistics?.entry(match, PADEL_DATA);
  const isPlayed = match.sieger !== null;
  const teamOneClass = isPlayed ? (match.sieger === 1 ? ' is-winner' : ' is-loser') : '';
  const teamTwoClass = isPlayed ? (match.sieger === 2 ? ' is-winner' : ' is-loser') : '';
  const status = isPlayed
    ? `<strong>${escapeHtml(match.saetze || '—')}</strong><span>${escapeHtml(match.ergebnis || '')}</span>`
    : `<strong>VS</strong><span>${escapeHtml(hasScheduledDateTime(match) ? formatMatchDate(match) : 'Noch offen')}</span>`;

  return `<article class="cup-match-card${isPlayed ? ' is-played' : ''}">
    <div class="cup-match-label">${escapeHtml(getMatchDisplayLabel(match))}</div>
    <div class="cup-match-team${teamOneClass}">${renderTeamPlayers(match.team1.spieler)}</div>
    ${statistics ? `<button type="button" class="cup-match-status" ${statistics.attributes}>${status}${statistics.icon}</button>` : `<div class="cup-match-status">${status}</div>`}
    <div class="cup-match-team${teamTwoClass}">${renderTeamPlayers(match.team2.spieler)}</div>
  </article>`;
}

function renderCupRound(matches, stage, title, className, decoration = '') {
  const stageMatches = matches
    .filter(match => getMatchStage(match) === stage)
    .sort(compareMatchesByNumber);

  return `<section class="cup-round ${className}" aria-labelledby="cup-${stage}-title">
    <div class="cup-round-title" id="cup-${stage}-title">${title}</div>
    <div class="cup-round-content">
      ${decoration}
      <div class="cup-round-matches">${stageMatches.map(renderCupMatchCard).join('')}</div>
    </div>
  </section>`;
}

function renderCupRedraw(label, className) {
  return `<div class="cup-redraw ${className}" aria-label="${escapeHtml(label)}">
    <span class="cup-redraw-line"></span>
    <span class="cup-redraw-label">${escapeHtml(label)}</span>
    <span class="cup-redraw-line"></span>
  </div>`;
}

function renderCupBracket(matches) {
  return `<div class="cup-bracket">
    ${renderCupRound(matches, 'final', 'Finale', 'cup-round-final', renderCupTrophy())}
    ${renderCupRedraw('4 Sieger · Teams und Gegner neu auslosen', 'cup-redraw-semifinal')}
    ${renderCupRound(matches, 'semifinal', 'Halbfinale', 'cup-round-semifinal')}
    ${renderCupRedraw('8 Sieger · Teams und Gegner neu auslosen', 'cup-redraw-quarterfinal')}
    ${renderCupRound(matches, 'quarterfinal', 'Viertelfinale', 'cup-round-quarterfinal')}
  </div>`;
}

function renderPartien({ animateSort = false } = {}) {
  updateMatchScopeToggle();
  updateMatchSortToggle();

  const partienSection = document.getElementById('partien');
  const finalFourSpielplan = document.getElementById('final-four-spielplan');
  const previousPositions = animateSort
    ? getRankingRowPositions(partienSection, '.mc', 'matchEntry')
    : null;
  finalFourSpielplan.replaceChildren();
  finalFourSpielplan.hidden = true;

  if (isCupSeason()) {
    const played = PADEL_DATA.matches.filter(match => match.sieger !== null).length;
    document.getElementById('sp-meta').textContent = `${played}/${PADEL_DATA.matches.length}`;
    document.getElementById('spielplan').innerHTML = renderCupBracket(PADEL_DATA.matches);
    return;
  }

  const regularMatches = PADEL_DATA.matches.filter(match => getMatchStage(match) === 'league');
  const played = regularMatches.filter(isCompletedSeasonMatch).length;
  document.getElementById('sp-meta').textContent = `${played}/${regularMatches.length}`;
  const visibleMatches = PADEL_DATA.matches.filter(matchesCurrentMatchScope);
  const spielplan = document.getElementById('spielplan');
  const spielplanHtml = matchSortMode === 'date'
    ? renderPartienByDate(visibleMatches)
    : renderPartienByMatchday(visibleMatches);

  const emptyMatchesText = PADEL_DATA.matches.length === 0
    ? 'Der Spielplan folgt.'
    : 'Keine Partien für diese Auswahl.';
  spielplan.innerHTML = spielplanHtml || `<div class="empty-state">${emptyMatchesText}</div>`;
  if (['final-four', 'completed'].includes(getSeasonDisplayPhase())) {
    const finalFourGroup = spielplan.querySelector('.final-four-group');
    if (finalFourGroup) {
      finalFourSpielplan.append(finalFourGroup);
      finalFourSpielplan.hidden = false;
    }
  }
  if (animateSort) animateRankingRows(partienSection, '.mc', previousPositions, 'matchEntry');
  window.PadelMatchStatistics?.reconcilePresentation?.();
}

// ── CALCULATOR ────────────────────────────────────────────────────
function getOpenMatches() {
  return PADEL_DATA.matches
    .filter(match => match.sieger === null)
    .filter(countsForRanking)
    .sort(compareMatchesByNumber);
}

function getAutoTipEntryForMatch(match) {
  const probability = getMatchWinProbability(match);
  if (!probability) return null;
  const playersByName = new Map(PADEL_DATA.players.map(p => [p.name, p]));
  const teamElos = names => names.map(name => {
    const player = playersByName.get(name);
    const elo = player ? getLatestPlayerEloValue(player) : null;
    return Number.isFinite(elo) ? elo : -Infinity;
  });
  return window.PadelEloForecast.getAutoTipForecast(
    probability.team1,
    teamElos(match.team1.spieler),
    teamElos(match.team2.spieler)
  )?.entry || null;
}

function applyCalculatorAutoTip() {
  getOpenMatches().forEach(match => {
    const entry = getAutoTipEntryForMatch(match);
    if (entry) calculatorResults.set(match.id, entry);
  });
  activeCalculatorMatchId = null;
  renderCalculator();
}

function updateCalculatorAutoTipUi() {
  const control = document.querySelector('[data-calculator-autotip]');
  if (control) {
    control.classList.toggle('is-on', calculatorAutoTip);
    control.setAttribute('aria-checked', calculatorAutoTip ? 'true' : 'false');
  }
  const bar = document.getElementById('calculator-autotip-bar');
  if (bar) bar.hidden = getOpenMatches().length === 0;
}

function setCalculatorAutoTip(on) {
  calculatorAutoTip = on;
  if (on) {
    applyCalculatorAutoTip();
  } else {
    // Manuelles Abschalten des Switch: alle Ergebnisse löschen, Default herstellen
    calculatorResults = new Map();
    activeCalculatorMatchId = null;
    renderCalculator();
  }
  updateCalculatorAutoTipUi();
}

function deactivateCalculatorAutoTip(matchId) {
  if (getMatchStage(PADEL_DATA.matches.find(match => match.id === matchId)) === 'final-four') return;
  if (!calculatorAutoTip) return;
  calculatorAutoTip = false;
  updateCalculatorAutoTipUi();
}

function getCalculatorEntry(matchId) {
  const match = PADEL_DATA.matches.find(item => item.id === matchId);
  const isFinalFour = getMatchStage(match) === 'final-four';
  const results = isFinalFour ? finalFourCalculatorResults : calculatorResults;
  if (!results.has(matchId)) {
    const officialScore = isFinalFour && match.sieger !== null
      ? String(match.ergebnis || '').match(/(\d+)\s*:\s*(\d+)/) : null;
    results.set(matchId, {
      set1: officialScore ? [officialScore[1], officialScore[2]] : ['', ''],
      set2: ['', ''],
      tb: ['', '']
    });
  }

  return results.get(matchId);
}

function getCalculatorPair(entry, part) {
  return Array.isArray(entry?.[part]) ? entry[part] : ['', ''];
}

function parseCalculatorScorePair(rawTeam1, rawTeam2) {
  return window.PadelScoreInput.parseScorePair(rawTeam1, rawTeam2);
}

function validateRegularSet(rawTeam1, rawTeam2) {
  const score = parseCalculatorScorePair(rawTeam1, rawTeam2);
  if (score.empty || score.invalid) return score;

  if (!window.PadelScoreInput.isValidRegularSet(score)) {
    return { invalid: true, message: '6:X, 7:5 oder 7:6 eintragen' };
  }

  return score;
}

function validateMatchTiebreak(rawTeam1, rawTeam2) {
  const score = parseCalculatorScorePair(rawTeam1, rawTeam2);
  if (score.empty || score.invalid) return score;

  if (!window.PadelScoreInput.isValidTiebreak(score, 10)) {
    return { invalid: true, message: 'Match-Tiebreak bis 10, danach genau 2 Pkt. Abstand' };
  }

  return score;
}

function formatCalculatorScore(score) {
  return `${score.team1}:${score.team2}`;
}

function getCalculatorStatusClass(status) {
  return {
    complete: 'calculator-status complete',
    invalid: 'calculator-status invalid',
    partial: 'calculator-status partial',
    empty: 'calculator-status'
  }[status] || 'calculator-status';
}

function parseCalculatorResult(match) {
  const entry = getCalculatorEntry(match.id);
  const firstSet = validateRegularSet(...getCalculatorPair(entry, 'set1'));
  if (isSingleSetMatch(match) || getMatchStage(match) === 'final-four') {
    if (firstSet.empty || firstSet.invalid) return {
      status: firstSet.empty ? 'empty' : 'invalid', message: firstSet.message || '',
      displaySaetze: '—', displayErgebnis: '', showTiebreak: false
    };
    const ergebnis = formatCalculatorScore(firstSet);
    const saetze = firstSet.winner === 1 ? '1:0' : '0:1';
    return {
      status: 'complete', message: '', displaySaetze: saetze, displayErgebnis: ergebnis,
      showTiebreak: false, match: { ...match, ergebnis, saetze, sieger: firstSet.winner }
    };
  }
  const secondSet = validateRegularSet(...getCalculatorPair(entry, 'set2'));
  const matchTiebreak = validateMatchTiebreak(...getCalculatorPair(entry, 'tb'));

  if (firstSet.invalid) return { status: 'invalid', message: `Satz 1: ${firstSet.message}`, displaySaetze: '—', displayErgebnis: '', showTiebreak: false };
  if (secondSet.invalid) return { status: 'invalid', message: `Satz 2: ${secondSet.message}`, displaySaetze: '—', displayErgebnis: '', showTiebreak: false };
  if (firstSet.empty && secondSet.empty) return { status: 'empty', message: '', displaySaetze: '—', displayErgebnis: '', showTiebreak: false };
  if (firstSet.empty && !secondSet.empty) return { status: 'invalid', message: 'Satz 1 fehlt', displaySaetze: '—', displayErgebnis: '', showTiebreak: false };

  const partialSetWins = [0, 0];
  partialSetWins[firstSet.winner - 1] += 1;
  if (secondSet.empty) {
    return {
      status: 'partial',
      message: 'Satz 2 fehlt',
      displaySaetze: `${partialSetWins[0]}:${partialSetWins[1]}`,
      displayErgebnis: formatCalculatorScore(firstSet),
      showTiebreak: false
    };
  }

  const setWins = [0, 0];
  setWins[firstSet.winner - 1] += 1;
  setWins[secondSet.winner - 1] += 1;
  const regularResult = `${formatCalculatorScore(firstSet)}, ${formatCalculatorScore(secondSet)}`;

  if (setWins[0] === 2 || setWins[1] === 2) {
    const winner = setWins[0] === 2 ? 1 : 2;
    const saetze = `${setWins[0]}:${setWins[1]}`;
    return {
      status: 'complete',
      message: '',
      displaySaetze: saetze,
      displayErgebnis: regularResult,
      showTiebreak: false,
      match: {
        ...match,
        ergebnis: regularResult,
        saetze,
        sieger: winner
      }
    };
  }

  if (matchTiebreak.invalid) {
    return {
      status: 'invalid',
      message: matchTiebreak.message,
      displaySaetze: '1:1',
      displayErgebnis: regularResult,
      showTiebreak: true
    };
  }
  if (matchTiebreak.empty) {
    return {
      status: 'partial',
      message: 'Match-Tiebreak fehlt',
      displaySaetze: '1:1',
      displayErgebnis: regularResult,
      showTiebreak: true
    };
  }

  setWins[matchTiebreak.winner - 1] += 1;
  const winner = matchTiebreak.winner;
  const saetze = `${setWins[0]}:${setWins[1]}`;
  const ergebnis = `${regularResult} – ${formatCalculatorScore(matchTiebreak)}`;

  return {
    status: 'complete',
    message: '',
    displaySaetze: saetze,
    displayErgebnis: ergebnis,
    showTiebreak: true,
    match: {
      ...match,
      ergebnis,
      saetze,
      sieger: winner
    }
  };
}

function getCalculatorSimulatedMatches() {
  const simulatedById = new Map(
    getOpenMatches()
      .map(match => [match.id, parseCalculatorResult(match)])
      .filter(([, result]) => result.match)
      .map(([matchId, result]) => [matchId, result.match])
  );

  return PADEL_DATA.matches.map(match => simulatedById.get(match.id) || match);
}

function updateCalculatorScore(input) {
  deactivateCalculatorAutoTip(input.dataset.calculatorMatchId);
  setActiveCalculatorMatch(input.dataset.calculatorMatchId, false);
  const entry = getCalculatorEntry(input.dataset.calculatorMatchId);
  const part = input.dataset.calculatorPart;
  const teamIndex = Number(input.dataset.calculatorTeam);
  const value = window.PadelScoreInput.sanitizeScoreValue(input.value);

  input.value = value;
  entry[part][teamIndex] = value;
  initializeCalculatorPairDefaults(input.dataset.calculatorMatchId, part, teamIndex);
  renderCalculatorMatchStatus(input.dataset.calculatorMatchId);
  renderCalculatorRanking();
}

function clearCalculatorScoreInput(input) {
  if (!input.value) return;

  deactivateCalculatorAutoTip(input.dataset.calculatorMatchId);
  const entry = getCalculatorEntry(input.dataset.calculatorMatchId);
  const part = input.dataset.calculatorPart;
  const teamIndex = Number(input.dataset.calculatorTeam);

  input.value = '';
  entry[part][teamIndex] = '';
  renderCalculatorMatchStatus(input.dataset.calculatorMatchId);
  renderCalculatorRanking();
}

function initializeCalculatorPairDefaults(matchId, part, changedTeamIndex) {
  const entry = getCalculatorEntry(matchId);
  const nextValues = window.PadelScoreInput.initializePairValues(entry[part], changedTeamIndex);
  entry[part] = nextValues;
  nextValues.forEach((value, teamIndex) => {
    const input = document.querySelector(
      `[data-calculator-score][data-calculator-match-id="${CSS.escape(matchId)}"][data-calculator-part="${CSS.escape(part)}"][data-calculator-team="${teamIndex}"]`
    );
    if (input) input.value = value;
  });
}

function stepCalculatorScore(button) {
  const matchId = button.dataset.calculatorMatchId;
  deactivateCalculatorAutoTip(matchId);
  setActiveCalculatorMatch(matchId, false);
  const part = button.dataset.calculatorPart;
  const teamIndex = Number(button.dataset.calculatorTeam);
  const delta = Number(button.dataset.calculatorStep);
  const entry = getCalculatorEntry(matchId);
  const value = window.PadelScoreInput.stepScoreValue(entry[part][teamIndex], delta);
  if (value === null) return;
  const input = document.querySelector(
    `[data-calculator-score][data-calculator-match-id="${CSS.escape(matchId)}"][data-calculator-part="${CSS.escape(part)}"][data-calculator-team="${teamIndex}"]`
  );

  entry[part][teamIndex] = value;
  if (input) input.value = value;
  initializeCalculatorPairDefaults(matchId, part, teamIndex);
  renderCalculatorMatchStatus(matchId);
  renderCalculatorRanking();
}

function syncCalculatorScoreInputs(matchId) {
  const entry = getCalculatorEntry(matchId);

  document.querySelectorAll(
    `[data-calculator-score][data-calculator-match-id="${CSS.escape(matchId)}"]`
  ).forEach(input => {
    const part = input.dataset.calculatorPart;
    const teamIndex = Number(input.dataset.calculatorTeam);
    input.value = entry?.[part]?.[teamIndex] ?? '';
  });
}

function applyCalculatorStraightSetsPreset(matchId, winnerTeamIndex) {
  if (!matchId || !Number.isInteger(winnerTeamIndex)) return;

  deactivateCalculatorAutoTip(matchId);
  const entry = getCalculatorEntry(matchId);
  const winnerScores = winnerTeamIndex === 0 ? ['6', '2'] : ['2', '6'];

  entry.set1 = [...winnerScores];
  const match = PADEL_DATA.matches.find(item => item.id === matchId);
  entry.set2 = isSingleSetMatch(match) || getMatchStage(match) === 'final-four' ? ['', ''] : [...winnerScores];
  entry.tb = ['', ''];

  setActiveCalculatorMatch(matchId, false);
  syncCalculatorScoreInputs(matchId);
  renderCalculatorMatchStatus(matchId);
  renderCalculatorRanking();
}

function resetCalculator() {
  calculatorResults = new Map();
  activeCalculatorMatchId = null;
  calculatorAutoTip = false;
  renderCalculator();
}

function setActiveCalculatorMatch(matchId, rerender = true) {
  if (!matchId || activeCalculatorMatchId === matchId) return;

  activeCalculatorMatchId = matchId;
  syncCalculatorActiveMatchCard();
  if (rerender) renderCalculatorRanking();
}

function setActiveCalculatorScorePair(scorePair) {
  window.PadelScoreInput.setActivePair(scorePair);
}

function syncCalculatorActiveMatchCard() {
  document.querySelectorAll('[data-calculator-match-card]').forEach(card => {
    card.classList.toggle(
      'calculator-match-active',
      card.dataset.calculatorMatchCard === activeCalculatorMatchId
    );
  });
}

function getActiveCalculatorPlayerIds() {
  const activeMatch = activeCalculatorMatchId
    ? PADEL_DATA.matches.find(match => match.id === activeCalculatorMatchId)
    : null;

  if (!activeMatch) return new Set();

  const activeNames = new Set([...activeMatch.team1.spieler, ...activeMatch.team2.spieler]);
  return new Set(PADEL_DATA.players
    .filter(player => activeNames.has(player.name))
    .map(player => player.id));
}

function renderCalculatorScoreInput(match, part, teamIndex, label, value) {
  return `<div class="score-counter-field" aria-label="${escapeHtml(formatMatchNumberLabel(match))} ${escapeHtml(label)}">
    <button
      type="button"
      class="score-counter-step"
      tabindex="-1"
      data-calculator-step="-1"
      data-calculator-match-id="${escapeHtml(match.id)}"
      data-calculator-part="${part}"
      data-calculator-team="${teamIndex}"
      aria-label="${escapeHtml(label)} verringern"
    >−</button>
    <input
      type="text"
      inputmode="numeric"
      pattern="[0-9]*"
      maxlength="2"
      autocomplete="off"
      value="${escapeHtml(value)}"
      data-calculator-score
      data-calculator-match-id="${escapeHtml(match.id)}"
      data-calculator-part="${part}"
      data-calculator-team="${teamIndex}"
      aria-label="${escapeHtml(formatMatchNumberLabel(match))} ${escapeHtml(label)}"
    >
    <button
      type="button"
      class="score-counter-step"
      tabindex="-1"
      data-calculator-step="1"
      data-calculator-match-id="${escapeHtml(match.id)}"
      data-calculator-part="${part}"
      data-calculator-team="${teamIndex}"
      aria-label="${escapeHtml(label)} erhöhen"
    >+</button>
  </div>`;
}

function renderCalculatorMatchStatusHtml(match) {
  const result = parseCalculatorResult(match);

  return `<div class="${getCalculatorStatusClass(result.status)}" id="calculator-status-${match.id}">${escapeHtml(result.message)}</div>`;
}

function isCalculatorEntryStarted(match) {
  const entry = getCalculatorEntry(match.id);
  return ['set1', 'set2', 'tb'].some(part => {
    const pair = getCalculatorPair(entry, part);
    return String(pair[0] || '').length > 0 || String(pair[1] || '').length > 0;
  });
}

function getCalculatorSetStanding(match) {
  const entry = getCalculatorEntry(match.id);
  const wins = [0, 0];

  const set1 = validateRegularSet(...getCalculatorPair(entry, 'set1'));
  if (!set1.empty && !set1.invalid) wins[set1.winner - 1] += 1;

  const set2 = validateRegularSet(...getCalculatorPair(entry, 'set2'));
  if (!set2.empty && !set2.invalid) wins[set2.winner - 1] += 1;

  // Match-Tiebreak zählt nur als 3. Satz, wenn es 1:1 steht
  if (wins[0] === 1 && wins[1] === 1) {
    const tb = validateMatchTiebreak(...getCalculatorPair(entry, 'tb'));
    if (!tb.empty && !tb.invalid) wins[tb.winner - 1] += 1;
  }

  return `${wins[0]}:${wins[1]}`;
}

function renderCalculatorProbabilityButton(match, teamIndex, probability) {
  if (!Number.isFinite(probability)) return '';
  const teamLabel = teamIndex === 0 ? 'Team 1' : 'Team 2';
  return `<button
    type="button"
    class="calculator-probability-button"
    data-calculator-preset-team="${teamIndex}"
    data-calculator-match-id="${escapeHtml(match.id)}"
    aria-label="${teamLabel} mit ${isSingleSetMatch(match) || getMatchStage(match) === 'final-four' ? '6 zu 2' : '6 zu 2, 6 zu 2'} als Sieger einsetzen"
  >${probability}%</button>`;
}

function renderCalculatorLiveInner(match) {
  const probability = getMatchWinProbability(match);

  // Sobald getippt wird: durchgehend laufender Satzstand (0:0 → 1:0/0:1 → …),
  // Wahrscheinlichkeit links/rechts daneben (wie die Partien-Cards).
  if (isCalculatorEntryStarted(match)) {
    const standing = getMatchStage(match) === 'final-four'
      ? getCalculatorPair(getCalculatorEntry(match.id), 'set1').map(value => value || '0').join(':')
      : getCalculatorSetStanding(match);
    const left = probability ? renderCalculatorProbabilityButton(match, 0, probability.team1) : '';
    const right = probability ? renderCalculatorProbabilityButton(match, 1, probability.team2) : '';
    return `<div class="calculator-probability">${left}<div class="mc-score-main">${escapeHtml(standing)}</div>${right}</div>`;
  }

  if (!probability) return '<div class="mc-score-main">—</div>';
  return `<div class="calculator-probability">
    ${renderCalculatorProbabilityButton(match, 0, probability.team1)}
    <span aria-hidden="true">:</span>
    ${renderCalculatorProbabilityButton(match, 1, probability.team2)}
  </div>`;
}

function renderCalculatorLiveResultHtml(match) {
  return `<div class="calculator-live-result" id="calculator-live-result-${match.id}">${renderCalculatorLiveInner(match)}</div>`;
}

function renderCalculatorMatchStatus(matchId) {
  const match = PADEL_DATA.matches.find(item => item.id === matchId);
  const statusElement = document.getElementById(`calculator-status-${matchId}`);
  const liveResultElement = document.getElementById(`calculator-live-result-${matchId}`);
  const tiebreakLine = document.getElementById(`calculator-tiebreak-${matchId}`);
  if (!match) return;

  const result = parseCalculatorResult(match);
  const matchCard = statusElement?.closest('.calculator-match-card') ||
    liveResultElement?.closest('.calculator-match-card') ||
    tiebreakLine?.closest('.calculator-match-card');

  if (matchCard) {
    matchCard.classList.toggle('calculator-match-complete', Boolean(result.match));
  }

  if (statusElement) {
    statusElement.className = getCalculatorStatusClass(result.status);
    statusElement.textContent = result.message;
  }

  if (liveResultElement) {
    liveResultElement.innerHTML = renderCalculatorLiveInner(match);
  }

  if (tiebreakLine) {
    tiebreakLine.hidden = !result.showTiebreak;
  }
}

function renderCalculatorMatchCard(match) {
  const entry = getCalculatorEntry(match.id);
  const set1 = getCalculatorPair(entry, 'set1');
  const set2 = getCalculatorPair(entry, 'set2');
  const tb = getCalculatorPair(entry, 'tb');
  const result = parseCalculatorResult(match);
  const singleSet = isSingleSetMatch(match) || getMatchStage(match) === 'final-four';

  return `<article class="calculator-match-card ${result.match ? 'calculator-match-complete' : ''} ${isViewerMatch(match) ? 'viewer-match' : ''} ${activeCalculatorMatchId === match.id ? 'calculator-match-active' : ''}" data-calculator-match-card="${escapeHtml(match.id)}">
    <div class="calculator-match-head">
      <div class="calculator-match-meta">${formatMatchNumberLabel(match)}</div>
      ${renderCalculatorMatchStatusHtml(match)}
    </div>
    <div class="calculator-match-teams">
      <div class="calculator-match-team">${renderTeamPlayers(match.team1.spieler)}</div>
      ${renderCalculatorLiveResultHtml(match)}
      <div class="calculator-match-team calculator-match-team-2">${renderTeamPlayers(match.team2.spieler)}</div>
    </div>
    <div class="calculator-score-line ${singleSet ? 'calculator-single-set' : ''}">
      <div class="score-counter-pair">
        ${renderCalculatorScoreInput(match, 'set1', 0, 'Team 1 Satz 1', set1[0])}
        <span class="score-counter-separator">:</span>
        ${renderCalculatorScoreInput(match, 'set1', 1, 'Team 2 Satz 1', set1[1])}
      </div>
      ${singleSet ? '' : `<span class="calculator-set-separator">|</span>
      <div class="score-counter-pair">
        ${renderCalculatorScoreInput(match, 'set2', 0, 'Team 1 Satz 2', set2[0])}
        <span class="score-counter-separator">:</span>
        ${renderCalculatorScoreInput(match, 'set2', 1, 'Team 2 Satz 2', set2[1])}
      </div>`}
    </div>
    ${singleSet ? '' : `<div class="calculator-tiebreak-line" id="calculator-tiebreak-${match.id}" ${result.showTiebreak ? '' : 'hidden'}>
      <div class="score-counter-pair">
        ${renderCalculatorScoreInput(match, 'tb', 0, 'Team 1 Match-Tiebreak', tb[0])}
        <span class="score-counter-separator">:</span>
        ${renderCalculatorScoreInput(match, 'tb', 1, 'Team 2 Match-Tiebreak', tb[1])}
      </div>
    </div>`}
  </article>`;
}

function renderCalculatorRanking() {
  renderFinalFourCalculatorRanking();
  const body = document.getElementById('calculator-ranking-body');
  if (!body) return;

  const previousRankingPositions = getRankingRowPositions(body, '.calculator-ranking-row');
  const miniRanking = document.getElementById('calculator-mini-ranking');
  const previousMiniPositions = getRankingRowPositions(miniRanking, '.calculator-mini-rank-row');
  const rankedPlayers = getRankedPlayers(getCalculatorSimulatedMatches());
  const activePlayerIds = getActiveCalculatorPlayerIds();
  const qualificationPlaces = getCompetitionConfig().qualificationPlaces;

  renderCalculatorMiniRanking(rankedPlayers, previousMiniPositions, activePlayerIds);
  body.innerHTML = rankedPlayers.map((player, index) => {
    const activeMatchClass = activePlayerIds.has(player.id) ? 'calculator-active-match-player' : '';
    const qualificationClass = index < qualificationPlaces ? 'top-four-highlight' : '';

    return `<tr class="calculator-ranking-row r${Math.min(index + 1, 4)} ${qualificationClass} ${activeMatchClass} ${isSelectedPlayer(player.name) ? 'viewer-highlight' : ''}" data-ranking-entry="${escapeHtml(player.id)}"${renderPlayerProfileRowAttributes(player)}>
      <td class="col-rank rank-position">${index + 1}</td>
      <td class="col-name">${renderPlayerProfileLink(player, 'pname')}</td>
      <td class="col-games">${player.stats.partien}</td>
      <td class="col-points rank-score">${player.stats.punkte}</td>
      <td class="col-diff">${renderDiffValue(player.stats.spielDiff, { played: player.stats.partien > 0 })}</td>
    </tr>`;
  }).join('');
  animateRankingRows(body, '.calculator-ranking-row', previousRankingPositions);
}

function renderCalculatorMiniRanking(rankedPlayers, previousPositions = null, activePlayerIds = new Set()) {
  const miniRanking = document.getElementById('calculator-mini-ranking');
  if (!miniRanking) return;
  const qualificationPlaces = getCompetitionConfig().qualificationPlaces;

  miniRanking.innerHTML = rankedPlayers.map((player, index) => {
    const activeMatchClass = activePlayerIds.has(player.id) ? 'calculator-active-match-player' : '';
    const qualificationClass = index < qualificationPlaces ? 'top-four-highlight' : '';
    return `
    <div class="calculator-mini-rank-row r${Math.min(index + 1, 4)} ${qualificationClass} ${activeMatchClass} ${isSelectedPlayer(player.name) ? 'viewer-highlight' : ''}" data-ranking-entry="${escapeHtml(player.id)}">
      <span class="rank-position calculator-rank-position">${index + 1}</span>
      <span class="calculator-mini-rank-initials">${escapeHtml(player.initials || player.name)}</span>
    </div>`;
  }).join('');
  animateRankingRows(miniRanking, '.calculator-mini-rank-row', previousPositions);
}

function renderCalculator() {
  const matchContainer = document.getElementById('calculator-matches');
  if (!matchContainer) return;

  const displayPhase = getSeasonDisplayPhase();
  const leagueCalculator = document.getElementById('league-calculator');
  if (leagueCalculator) leagueCalculator.hidden = displayPhase !== 'league';

  const openMatches = getOpenMatches();
  matchContainer.innerHTML = openMatches.length
    ? openMatches.map(renderCalculatorMatchCard).join('')
    : '<div class="empty-state">Keine offenen Partien.</div>';
  syncCalculatorActiveMatchCard();
  updateCalculatorAutoTipUi();
  renderFinalFourCalculator();
  renderCalculatorRanking();
}

// Final4 shares score controls and ranking rules with the existing calculators.
function getFinalFourCalculatorMatches() {
  return getFinalFourMatches().map(match => parseCalculatorResult(match).match || {
    ...match, sieger: null, ergebnis: null, saetze: null
  });
}

function getFinalFourCalculatorOutcomes(matches, targetId) {
  const target = matches.find(match => match.id === targetId);
  if (matches.length !== 3 || !target || matches.some(match => match.id !== targetId && match.sieger === null)) return [];
  const winningScores = [[6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [7, 5], [7, 6]];
  return [...winningScores, ...winningScores.map(([a, b]) => [b, a])].map(([a, b]) => {
    const score = `${a}:${b}`;
    const simulated = matches.map(match => match.id === targetId
      ? { ...match, ergebnis: score, sieger: a > b ? 1 : 2, saetze: a > b ? '1:0' : '0:1' }
      : match);
    return { score, winner: getFinalFourStats(simulated).stats[0] };
  });
}

function getFinalFourEliminatedPlayerNames(stats, outcomes) {
  if (!outcomes.length) return [];
  const possibleWinnerNames = new Set(outcomes.map(outcome => outcome.winner.name));
  return stats.map(player => player.name).filter(name => !possibleWinnerNames.has(name));
}

function renderFinalFourCalculatorRanking() {
  const body = document.getElementById('final-four-calculator-ranking-body');
  if (!body) return;
  const matches = getFinalFourCalculatorMatches();
  const { stats } = getFinalFourStats(matches);
  const mini = document.getElementById('final-four-calculator-mini-ranking');
  const previous = getRankingRowPositions(body, '.calculator-ranking-row');
  const previousMini = getRankingRowPositions(mini, '.calculator-mini-rank-row');
  const players = stats.map(stat => ({ ...PADEL_DATA.players.find(player => player.name === stat.name), ...stat }));
  body.innerHTML = players.map((player, index) => `<tr class="calculator-ranking-row r${index + 1} ${isSelectedPlayer(player.name) ? 'viewer-highlight' : ''}" data-ranking-entry="${escapeHtml(player.id || player.name)}"${renderPlayerProfileRowAttributes(player)}>
    <td class="col-rank rank-position">${index + 1}</td>
    <td class="col-name">${renderPlayerProfileLink(player, 'pname')}</td>
    <td class="col-wins rank-score">${player.siege}</td>
    <td class="col-gv">${player.spieleGV}</td>
    <td class="col-diff">${renderDiffValue(player.diff)}</td>
  </tr>`).join('');
  mini.innerHTML = players.map((player, index) => `<div class="calculator-mini-rank-row r${Math.min(index + 1, 4)} ${isSelectedPlayer(player.name) ? 'viewer-highlight' : ''}" data-ranking-entry="${escapeHtml(player.id || player.name)}" title="${escapeHtml(player.name)}">
    <span class="rank-position calculator-rank-position">${index + 1}</span>
    <span class="calculator-mini-rank-initials">${escapeHtml(player.initials || `P${player.seed}`)}</span>
  </div>`).join('');
  animateRankingRows(body, '.calculator-ranking-row', previous);
  animateRankingRows(mini, '.calculator-mini-rank-row', previousMini);
  const completed = matches.filter(match => match.sieger !== null).length;
  document.getElementById('final-four-calculator-winner').textContent = completed === 3
    ? `Gesamtsieger der Simulation: ${stats[0].name}`
    : `${completed} von 3 Sätzen gewertet`;

  const openMatches = matches.filter(match => match.sieger === null);
  const target = openMatches.length === 1 ? openMatches[0]
    : matches.find(match => match.id === activeCalculatorMatchId) || matches[matches.length - 1];
  const outcomes = getFinalFourCalculatorOutcomes(matches, target?.id);
  document.getElementById('final-four-outcomes-note').textContent = outcomes.length
    ? 'Alle möglichen Endstände bei unveränderten anderen Sätzen. Ergebnis anklicken zum Übernehmen.'
    : 'Trage zwei vollständige Sätze ein. Dann siehst du hier die möglichen Gesamtsieger für jeden Endstand des verbleibenden Satzes.';
  const grouped = new Map();
  outcomes.forEach(outcome => {
    if (!grouped.has(outcome.winner.name)) grouped.set(outcome.winner.name, []);
    grouped.get(outcome.winner.name).push(outcome.score);
  });
  const outcomeRows = [...grouped].map(([name, scores]) => `<div class="final-four-outcome-row">
    <div class="final-four-outcome-winner">${renderPlayerProfileLink(name, 'pname')}<span class="sh-meta"> gewinnt bei</span></div>
    <div class="final-four-outcome-scores">${scores.map(score => `<button type="button" class="secondary-button final-four-outcome-score" data-calculator-match-id="${escapeHtml(target.id)}" data-final-four-score="${score}" aria-label="${escapeHtml(formatMatchNumberLabel(target))}: ${score} einsetzen – ${escapeHtml(name)} gewinnt" aria-pressed="${target.ergebnis === score}">${score}</button>`).join('')}</div>
  </div>`).join('');
  const eliminatedPlayerNames = getFinalFourEliminatedPlayerNames(stats, outcomes);
  const eliminatedRow = eliminatedPlayerNames.length
    ? `<div class="final-four-eliminated-row">
        <span class="sh-meta">${eliminatedPlayerNames.length === 1 ? 'Kann' : 'Können'} nicht mehr gewinnen:</span>
        <span class="final-four-eliminated-players">${eliminatedPlayerNames.map(name => renderPlayerProfileLink(name, 'pname')).join('<span aria-hidden="true"> · </span>')}</span>
      </div>`
    : '';
  document.getElementById('final-four-calculator-outcomes').innerHTML = outcomeRows + eliminatedRow;
}

function renderFinalFourCalculator() {
  const section = document.getElementById('final-four-calculator');
  if (!section) return;
  const matches = getFinalFourMatches();
  section.hidden = matches.length !== 3;
  if (section.hidden) return;
  document.getElementById('final-four-calculator-matches').innerHTML = matches.map(renderCalculatorMatchCard).join('');
  renderFinalFourCalculatorRanking();
}

function getMatchdayInfo(spieltag) {
  return (PADEL_DATA.matchdays || []).find(matchday => matchday.spieltag === spieltag) || null;
}

function formatLongDayMonth(date) {
  const parsedDate = parseDateValue(date);
  if (!parsedDate) return '';

  return parsedDate.toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'long'
  }).replace(' ', '\u00a0');
}

function formatMatchdayRange(matchday) {
  if (!matchday?.startDate || !matchday?.endDate) return '';

  return `${formatLongDayMonth(matchday.startDate)} – ${formatLongDayMonth(matchday.endDate)}`;
}

function formatMatchdayLabel(spieltag) {
  const matchday = getMatchdayInfo(spieltag);
  const label = matchday?.title || `Spieltag ${spieltag}`;
  const details = [];
  const range = formatMatchdayRange(matchday);

  if (range) details.push(range);
  return renderGroupHeading(label, details.join(' | '));
}

// ── CHART ─────────────────────────────────────────────────────────
const PLAYER_COLOR_COUNT = 18;
const CHART_FADED_ALPHA = '59';
const CHART_DIM_ALPHA = 'D6';
const CHART_GRAY_MIX = 0.28;

let chart = null;
let placementChart = null;
let hoveredEloChartPlayerNames = new Set();
let hoveredPlacementChartPlayerName = null;

function getChartBaseColor(player, fallbackIndex = 0) {
  const centralIndex = (window.PADEL_PLAYERS || []).findIndex(item => item.id === player?.id);
  const colorIndex = centralIndex >= 0 ? centralIndex : fallbackIndex;
  return getThemeValue(`--player-${colorIndex % PLAYER_COLOR_COUNT + 1}`);
}

function hexToRgb(color) {
  const value = color.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

function blendHexColors(color, mixColor, mixAmount) {
  const base = hexToRgb(color);
  const mix = hexToRgb(mixColor);
  return rgbToHex({
    r: base.r * (1 - mixAmount) + mix.r * mixAmount,
    g: base.g * (1 - mixAmount) + mix.g * mixAmount,
    b: base.b * (1 - mixAmount) + mix.b * mixAmount
  });
}

// Bleibt dem Spieler zuzuordnen und passt durch die Transparenz auf --bg wie auf --surface.
function fadeChartColor(color) {
  return `${color.slice(0, 7)}${CHART_FADED_ALPHA}`;
}

function dimChartColor(color) {
  if (typeof color === 'string' && color.startsWith('#') && color.length === 7) {
    return `${blendHexColors(color, getThemeValue('--muted'), CHART_GRAY_MIX)}${CHART_DIM_ALPHA}`;
  }

  return color;
}

function isEloChartHighlighted(playerName) {
  return hoveredEloChartPlayerNames.has(playerName) || isSelectedPlayer(playerName);
}

function getEloChartColor(color, playerName) {
  return isParticipantView() && !isEloChartHighlighted(playerName)
    ? dimChartColor(color)
    : color;
}

function getEloChartLineWidth(playerName) {
  return isEloChartHighlighted(playerName) ? 3 : 1;
}

function getEloChartPointRadius(playerName) {
  return isParticipantView() && !isEloChartHighlighted(playerName) ? 3 : 4;
}

function getEloChartOrder(playerName) {
  return hoveredEloChartPlayerNames.has(playerName) ? -1 : 0;
}

function isPlacementChartHighlighted(playerName) {
  return playerName === hoveredPlacementChartPlayerName || isSelectedPlayer(playerName);
}

function getPlacementLabelWeight(playerName) {
  return isPlacementChartHighlighted(playerName) ? 700 : 300;
}

function getPlacementLabelColor(playerName, color) {
  return isParticipantView() && !isPlacementChartHighlighted(playerName)
    ? dimChartColor(color)
    : color;
}

function getPlacementChartColor(color, playerName) {
  return isParticipantView() && !isPlacementChartHighlighted(playerName)
    ? dimChartColor(color)
    : color;
}

function getPlacementChartLineWidth(playerName) {
  return isPlacementChartHighlighted(playerName) ? 3 : 1;
}

function getPlacementChartPointRadius(playerName, hasPlayed, hasBye) {
  if (hasPlayed) {
    return isPlacementChartHighlighted(playerName) ? 4 : 3;
  }

  return hasBye ? 3 : 0;
}

function getPlacementChartOrder(playerName) {
  return playerName === hoveredPlacementChartPlayerName ? -1 : 0;
}

function isEloChartDatasetHidden(player, activePlayers) {
  return !activePlayers.has(player.id) && !hoveredEloChartPlayerNames.has(player.name);
}

function updateEloChartFocus() {
  if (!chart) return;
  const activePlayers = getStatisticsPlayerFilter();
  chart.data.datasets.forEach((dataset, index) => {
    const player = chart.$players[index];
    dataset.hidden = isEloChartDatasetHidden(player, activePlayers);
    const color = getEloChartColor(getChartBaseColor(player, index), player.name);
    dataset.borderColor = color;
    dataset.pointBackgroundColor = color;
    dataset.pointBorderColor = color;
    dataset.pointHoverBackgroundColor = color;
    dataset.pointHoverBorderColor = color;
    dataset.borderWidth = getEloChartLineWidth(player.name);
    dataset.pointRadius = getEloChartPointRadius(player.name);
    dataset.order = getEloChartOrder(player.name);
  });
  chart.update();
}

function setHoveredEloChartPlayers(playerNames = []) {
  const nextNames = new Set(playerNames);
  if (nextNames.size === hoveredEloChartPlayerNames.size && [...nextNames].every(name => hoveredEloChartPlayerNames.has(name))) return;
  hoveredEloChartPlayerNames = nextNames;
  updateEloChartFocus();
}

function updatePlacementChartFocus() {
  if (!placementChart) return;
  placementChart.data.datasets.forEach((dataset, index) => {
    const player = PADEL_DATA.players[index];
    const baseColor = getChartBaseColor(player, index);
    const color = getPlacementChartColor(baseColor, player.name);
    const playedFlags = dataset.playedFlags;
    const byeFlags = dataset.byeFlags;
    dataset.baseColor = baseColor;
    dataset.borderColor = color;
    dataset.pointBackgroundColor = playedFlags.map(hasMatch => hasMatch ? color : 'transparent');
    dataset.pointBorderColor = playedFlags.map((hasMatch, pointIndex) => hasMatch || byeFlags[pointIndex] ? color : 'transparent');
    dataset.borderWidth = getPlacementChartLineWidth(player.name);
    dataset.pointRadius = playedFlags.map((hasMatch, pointIndex) =>
      getPlacementChartPointRadius(player.name, hasMatch, byeFlags[pointIndex])
    );
    dataset.segment.borderColor = ctx => getPlacementSegmentColor(ctx, playedFlags, color);
    dataset.order = getPlacementChartOrder(player.name);
  });
  placementChart.update();
}

function setHoveredPlacementChartPlayer(playerName) {
  if (hoveredPlacementChartPlayerName === playerName) return;
  hoveredPlacementChartPlayerName = playerName;
  updatePlacementChartFocus();
}

function updateChartViewerFocus() {
  if (chart) {
    hoveredEloChartPlayerNames = new Set();
    updateEloChartFocus();
    renderFilter();
  }

  hoveredPlacementChartPlayerName = null;
  updatePlacementChartFocus();
}

function parseDateValue(date) {
  if (!date) return null;
  if (date instanceof Date) return Number.isNaN(date.getTime()) ? null : date;

  const value = String(date).trim();
  const isoDate = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDate) {
    const d = new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const germanDate = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (germanDate) {
    const year = germanDate[3].length === 2 ? `20${germanDate[3]}` : germanDate[3];
    const d = new Date(Number(year), Number(germanDate[2]) - 1, Number(germanDate[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDateKey(date) {
  const d = parseDateValue(date);
  if (!d) return null;

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeGameLabel(label) {
  const value = String(label || '').trim();
  const gameNumber = value.match(/(?:spiel|partie)\s*(\d+)/i)?.[1];

  if (gameNumber) return `Partie ${gameNumber}`;
  return value || 'Start';
}

function getHistoryEventKey(historyEntry) {
  const date = toDateKey(historyEntry.date);
  if (historyEntry.matchId) return `match:${historyEntry.matchId}`;
  const label = normalizeGameLabel(historyEntry.label).toLowerCase().replace(/\s+/g, '-');

  return `${date}|${label}`;
}

function formatChartEventLabel(event) {
  if (event.gameLabel === 'Start' || event.gameLabel === 'Final') return [event.gameLabel];

  const parsedDate = parseDateValue(event.match?.datum || event.date);
  const dateLabel = parsedDate
    ? parsedDate.toLocaleDateString('de-DE', isAllTimeStatistics()
      ? { day: '2-digit', month: '2-digit', year: '2-digit' }
      : { day: '2-digit', month: '2-digit' })
    : '';

  return [dateLabel, event.gameLabel];
}

function getChartEvents(data = getStatisticsData()) {
  const events = new Map();

  data.players.forEach(player => {
    (player.history || []).forEach((historyEntry, index) => {
      const date = toDateKey(historyEntry.date);
      const elo = Number(historyEntry.elo);
      if (!date || !Number.isFinite(elo)) return;

      const gameLabel = normalizeGameLabel(historyEntry.label);
      const match = historyEntry.matchId
        ? data.matches.find(item => item.id === historyEntry.matchId) || null
        : null;
      const key = getHistoryEventKey(historyEntry);

      if (!events.has(key)) {
        events.set(key, {
          key,
          date,
          gameLabel,
          match,
          matchAt: historyEntry.matchAt || match?.matchAt || null,
          index,
          label: null
        });
      }
    });
  });

  const hasStoredSeasonEnd = data.players.some(player =>
    (player.history || []).some(entry => entry.eventType === 'season-end')
  );
  const finalDate = data.completedAt && !hasStoredSeasonEnd
    ? toDateKey(data.eloFinalDate)
    : null;
  if (finalDate && !hasStoredSeasonEnd) {
    events.set('final', {
      key: 'final',
      date: finalDate,
      gameLabel: 'Final',
      match: null,
      isFinal: true,
      index: Number.MAX_SAFE_INTEGER,
      label: null
    });
  }

  return [...events.values()]
    .sort((a, b) => {
      const timeCompare = String(a.matchAt || '').localeCompare(String(b.matchAt || ''));
      if (a.matchAt && b.matchAt && timeCompare) return timeCompare;

      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare) return dateCompare;

      const aIsStart = a.gameLabel === 'Start';
      const bIsStart = b.gameLabel === 'Start';
      if (aIsStart !== bIsStart) return aIsStart ? -1 : 1;

      const aIsFinal = a.gameLabel === 'Final';
      const bIsFinal = b.gameLabel === 'Final';
      if (aIsFinal !== bIsFinal) return aIsFinal ? 1 : -1;

      const minuteCompare = (a.match ? getMatchTimeMinutes(a.match) : 0) - (b.match ? getMatchTimeMinutes(b.match) : 0);
      if (minuteCompare) return minuteCompare;

      return getMatchNumber(a.match || a.gameLabel) - getMatchNumber(b.match || b.gameLabel);
    })
    .map((event, eventIndex) => ({ ...event, eventIndex, label: formatChartEventLabel(event) }));
}

function getPlayerMatchContext(playerName, match) {
  if (!match) return null;

  const isTeam1 = match.team1.spieler.includes(playerName);
  const team = isTeam1 ? match.team1.spieler : match.team2.spieler;
  const opponents = isTeam1 ? match.team2.spieler : match.team1.spieler;

  if (!team.includes(playerName)) return null;

  return {
    partner: team.find(name => name !== playerName) || '—',
    opponents: opponents.join(' & '),
    result: formatResultForPlayer(match.ergebnis, isTeam1)
  };
}

function getMatchById(matchId) {
  return PADEL_DATA.matches.find(match => match.id === matchId) || null;
}

function getPlayerByName(playerName) {
  return PADEL_DATA.players.find(player => player.name === playerName) || null;
}

function getPlayerHistoryEntryForMatch(player, match) {
  if (!player || !match) return null;

  return (player.history || []).find(historyEntry =>
    historyEntry.matchId === match.id &&
    Number.isFinite(Number(historyEntry.elo))
  ) || null;
}

function getPlayerPreviousHistoryEntry(player, historyEntry) {
  if (!player || !historyEntry) return null;
  const currentOrderKey = getHistoryOrderKey(historyEntry);

  return (player.history || [])
    .filter(entry =>
      entry !== historyEntry &&
      getHistoryOrderKey(entry) < currentOrderKey &&
      Number.isFinite(Number(entry.elo))
    )
    .sort((a, b) => getHistoryOrderKey(b).localeCompare(getHistoryOrderKey(a)))[0] || null;
}

function getPlayerMatchEloTooltipData(playerName, match) {
  const player = getPlayerByName(playerName);
  const historyEntry = getPlayerHistoryEntryForMatch(player, match);
  if (!historyEntry) return { elo: '', delta: '', deltaClass: 'neu' };

  const elo = Number(historyEntry.elo);
  const previousHistoryEntry = getPlayerPreviousHistoryEntry(player, historyEntry);
  const oldElo = historyEntry.oldElo !== null && historyEntry.oldElo !== undefined
    && Number.isFinite(Number(historyEntry.oldElo))
    ? Number(historyEntry.oldElo)
    : previousHistoryEntry ? Number(previousHistoryEntry.elo) : null;
  const delta = historyEntry.delta !== null && historyEntry.delta !== undefined
    && Number.isFinite(Number(historyEntry.delta))
    ? Number(historyEntry.delta)
    : oldElo === null ? null : elo - oldElo;

  return {
    elo,
    oldElo,
    delta: formatEloDelta(delta),
    deltaClass: getDeltaClass(delta),
    interveningEvents: historyEntry.interveningEvents || []
  };
}

function getRankingDeviationLabels(targetId) {
  return targetId === 'stats-elo-points-deviation'
    ? { top: 'Überperformt', bottom: 'Underperformt' }
    : { top: 'Lospech', bottom: 'Losglück' };
}

function formatResultForPlayer(result, isTeam1) {
  if (!result) return '—';
  if (isTeam1) return result;

  return result.replace(/(\d+)\s*:\s*(\d+)/g, '$2:$1');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getOrCreateChartTooltip(chartInstance, variantClass = '') {
  const parent = chartInstance.canvas.parentNode;
  const selector = `.chart-custom-tooltip${variantClass ? `.${variantClass}` : ''}`;
  let tooltip = parent.querySelector(selector);

  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = ['chart-custom-tooltip', variantClass].filter(Boolean).join(' ');
    parent.appendChild(tooltip);
  }

  return tooltip;
}

function getOrCreateFormTooltip(anchor) {
  const isEmbeddedDetail = document.documentElement.classList.contains('is-detail-embed');
  const modalHost = anchor?.closest(isEmbeddedDetail
    ? 'dialog[open]'
    : 'dialog[open]:not([data-presentation="panel"])');
  const host = modalHost || document.body;
  let tooltip = document.querySelector('.form-custom-tooltip');

  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'chart-custom-tooltip form-custom-tooltip';
  }
  if (tooltip.parentElement !== host) host.appendChild(tooltip);

  return tooltip;
}

function renderEloStyleTooltipItem({
  playerName,
  elo,
  oldElo = null,
  delta,
  deltaClass = 'neu',
  gameLabel = '',
  matchContext = null,
  interveningEvents = [],
  showElo = true
}) {
  return `<div class="elo-tooltip-item">
    <div class="elo-tooltip-name">${escapeHtml(playerName)}</div>
    ${interveningEvents.length ? `<div class="elo-tooltip-intervening">
      <span>Zwischenzeitlich</span>
      ${interveningEvents.map(event => `<div>${escapeHtml(event.seasonLabel || event.seasonId)} · ${escapeHtml(event.matchLabel || 'Partie')}: <strong class="${getDeltaClass(Number(event.delta))}">${escapeHtml(formatEloDelta(Number(event.delta)))} Elo</strong></div>`).join('')}
    </div>` : ''}
    ${showElo ? `<div class="elo-tooltip-main">${oldElo !== null && oldElo !== undefined && Number.isFinite(Number(oldElo)) ? `${escapeHtml(oldElo)} → ` : ''}${escapeHtml(elo)} Elo ${delta ? `<span class="elo-tooltip-delta ${deltaClass}">${escapeHtml(delta)}</span>` : ''}</div>` : ''}
    ${matchContext ? `
      <div>Ergebnis: ${escapeHtml(matchContext.result)}</div>
      <div>Mit: ${escapeHtml(matchContext.partner)}</div>
      <div>vs. ${escapeHtml(matchContext.opponents)}</div>
    ` : gameLabel ? `
      <div>${escapeHtml(gameLabel)}</div>
    ` : ''}
  </div>`;
}

function positionHelpTooltip(anchor) {
  const wrapper = anchor.closest('.th-help-wrap');
  if (!wrapper) return;

  const wrapperRect = wrapper.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const anchorViewportX = anchorRect.left + anchorRect.width / 2;
  const anchorOffsetX = anchorViewportX - wrapperRect.left;
  const anchorOffsetY = anchorRect.top - wrapperRect.top;
  const tooltip = wrapper.querySelector('.help-tooltip');
  const tooltipGap = 10;
  const tooltipWidth = tooltip?.offsetWidth || 260;
  const clippingContainer = anchor.closest('.ranking-wrap');
  const clippingRect = clippingContainer?.getBoundingClientRect();
  const boundaryLeft = Math.max(0, clippingRect?.left ?? 0);
  const boundaryRight = Math.min(window.innerWidth, clippingRect?.right ?? window.innerWidth);
  const availableLeft = anchorRect.left - boundaryLeft;
  const availableRight = boundaryRight - anchorRect.right;
  const requiredSpace = tooltipWidth + tooltipGap;
  const opensRight = availableRight >= requiredSpace
    || (availableLeft < requiredSpace && availableRight >= availableLeft);

  wrapper.style.setProperty('--help-tooltip-anchor-x', `${anchorOffsetX}px`);
  wrapper.style.setProperty('--help-tooltip-anchor-y', `${anchorOffsetY}px`);
  wrapper.classList.toggle('help-tooltip-opens-right', opensRight);
  wrapper.classList.toggle('help-tooltip-opens-left', !opensRight);

  if (wrapper.classList.contains('ranking-unrated-wrap')) {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const viewportPadding = 16;
    const tooltipWidth = Math.min(isMobile ? 190 : 260, window.innerWidth - viewportPadding * 2);
    const tooltipHeight = tooltip?.getBoundingClientRect().height || 48;
    const unclampedLeft = isMobile
      ? anchorViewportX - tooltipWidth / 2
      : opensRight ? anchorRect.right + 10 : anchorRect.left - tooltipWidth - 10;
    const tooltipLeft = Math.max(
      viewportPadding,
      Math.min(unclampedLeft, window.innerWidth - tooltipWidth - viewportPadding)
    );
    const tooltipTop = Math.max(
      viewportPadding,
      Math.min(anchorRect.bottom + 8, window.innerHeight - tooltipHeight - viewportPadding)
    );
    wrapper.style.setProperty('--ranking-tooltip-left', `${tooltipLeft}px`);
    wrapper.style.setProperty('--ranking-tooltip-top', `${tooltipTop}px`);
  }
}

function closePinnedHelpTooltips(exceptWrapper = null) {
  document.querySelectorAll('.th-help-wrap.is-open').forEach(wrapper => {
    if (wrapper === exceptWrapper) return;
    wrapper.classList.remove('is-open');
    wrapper.querySelector('[data-help-tooltip-anchor]')?.setAttribute('aria-expanded', 'false');
  });
}

function getChartTooltipHorizontalTransform(chartInstance, tooltip) {
  const canvasRect = chartInstance.canvas.getBoundingClientRect();
  const anchorViewportX = canvasRect.left + tooltip.caretX;

  return anchorViewportX <= window.innerWidth / 2
    ? 'translate(12px, -50%)'
    : 'translate(calc(-100% - 12px), -50%)';
}

function positionChartTooltip(chartInstance, tooltip, tooltipEl) {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  tooltipEl.style.opacity = 1;

  if (isMobile) {
    const parentHeight = chartInstance.canvas.parentNode.clientHeight;
    const tooltipHeight = tooltipEl.offsetHeight || 0;
    const top = Math.min(
      Math.max(tooltip.caretY + 16, 12),
      Math.max(parentHeight - tooltipHeight - 12, 12)
    );

    tooltipEl.style.left = '50%';
    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.transform = 'translateX(-50%)';
    return;
  }

  tooltipEl.style.left = `${tooltip.caretX}px`;
  tooltipEl.style.top = `${tooltip.caretY}px`;
  tooltipEl.style.transform = getChartTooltipHorizontalTransform(chartInstance, tooltip);
}

function positionFormTooltip(anchor, tooltipEl) {
  const rect = anchor.getBoundingClientRect();
  const gap = 10;
  const viewportPadding = 12;
  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  tooltipEl.style.opacity = 1;
  tooltipEl.style.transform = 'none';
  tooltipEl.style.left = `${viewportPadding}px`;
  tooltipEl.style.top = `${rect.bottom + gap}px`;

  const tooltipWidth = tooltipEl.offsetWidth || 240;
  const tooltipHeight = tooltipEl.offsetHeight || 80;

  if (isMobile) {
    const top = Math.min(rect.bottom + gap, window.innerHeight - tooltipHeight - viewportPadding);
    tooltipEl.style.left = `${viewportPadding}px`;
    tooltipEl.style.right = `${viewportPadding}px`;
    tooltipEl.style.top = `${Math.max(top, viewportPadding)}px`;
    return;
  }

  tooltipEl.style.right = 'auto';

  let left = rect.right + gap;
  if (left + tooltipWidth > window.innerWidth - viewportPadding) {
    left = rect.left - tooltipWidth - gap;
  }
  if (left < viewportPadding) left = viewportPadding;

  let top = rect.top + rect.height / 2 - tooltipHeight / 2;
  top = Math.max(viewportPadding, Math.min(top, window.innerHeight - tooltipHeight - viewportPadding));

  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function showFormTooltip(anchor) {
  const playerName = anchor.dataset.formPlayer;
  const tooltipEl = getOrCreateFormTooltip(anchor);
  const hasEmbeddedContext = anchor.hasAttribute('data-form-competition');

  if (hasEmbeddedContext) {
    const matchContext = {
      result: anchor.dataset.formResult || '—',
      partner: anchor.dataset.formPartner || '—',
      opponents: anchor.dataset.formOpponents || '—'
    };
    tooltipEl.innerHTML = `
      <div class="elo-tooltip-title">${escapeHtml([anchor.dataset.formDate, anchor.dataset.formCompetition].filter(Boolean).join(' · '))}</div>
      ${renderEloStyleTooltipItem({ playerName, matchContext, showElo: false })}
    `;
    positionFormTooltip(anchor, tooltipEl);
    return;
  }

  const match = getMatchById(anchor.dataset.formMatchId);
  const matchContext = getPlayerMatchContext(playerName, match);

  if (!match || !matchContext) {
    tooltipEl.style.opacity = 0;
    return;
  }

  const eloTooltipData = getPlayerMatchEloTooltipData(playerName, match);

  tooltipEl.innerHTML = `
    <div class="elo-tooltip-title">${escapeHtml(formatMatchMeta(match))}</div>
    ${renderEloStyleTooltipItem({
      playerName,
      ...eloTooltipData,
      matchContext,
      showElo: true
    })}
  `;
  positionFormTooltip(anchor, tooltipEl);
}

function hideFormTooltip() {
  const tooltipEl = document.querySelector('.form-custom-tooltip');
  if (tooltipEl) tooltipEl.style.opacity = 0;
}

function externalEloTooltip(context) {
  const { chart: chartInstance, tooltip } = context;
  const tooltipEl = getOrCreateChartTooltip(chartInstance, 'elo-chart-tooltip');

  if (tooltip.opacity === 0) {
    tooltipEl.style.opacity = 0;
    return;
  }

  const items = tooltip.dataPoints || [];
  const title = items.find(item => item.dataset.eventTitles?.[item.dataIndex])?.dataset.eventTitles?.[items[0]?.dataIndex] || '';

  tooltipEl.innerHTML = `
    ${title ? `<div class="elo-tooltip-title">${escapeHtml(title)}</div>` : ''}
    ${items.map(item => {
      const delta = item.dataset.deltaLabels?.[item.dataIndex] || '';
      const deltaClass = item.dataset.deltas?.[item.dataIndex] > 0
        ? 'pos'
        : item.dataset.deltas?.[item.dataIndex] < 0 ? 'neg' : 'neu';
      const gameLabel = item.dataset.gameLabels?.[item.dataIndex] || '';
      const matchContext = item.dataset.matchContexts?.[item.dataIndex];
      const oldElo = item.dataset.oldElos?.[item.dataIndex];
      const interveningEvents = item.dataset.interveningEvents?.[item.dataIndex] || [];

      return renderEloStyleTooltipItem({
        playerName: item.dataset.label,
        elo: item.parsed.y,
        oldElo,
        delta,
        deltaClass,
        gameLabel,
        matchContext,
        interveningEvents
      });
    }).join('')}
  `;

  positionChartTooltip(chartInstance, tooltip, tooltipEl);
}

function externalPlacementTooltip(context) {
  const { chart: chartInstance, tooltip } = context;
  const tooltipEl = getOrCreateChartTooltip(chartInstance, 'placement-chart-tooltip');

  if (tooltip.opacity === 0) {
    tooltipEl.style.opacity = 0;
    return;
  }

  const items = (tooltip.dataPoints || [])
    .filter(item => item.dataset.playedFlags?.[item.dataIndex]);

  if (!items.length) {
    tooltipEl.style.opacity = 0;
    return;
  }

  tooltipEl.innerHTML = items.map(item => {
    const stats = item.dataset.statsByPoint?.[item.dataIndex];
    const diff = stats ? formatStatDiff(stats.spielDiff) : '—';
    const diffClass = getDeltaClass(stats?.spielDiff);
    const points = stats && Number.isFinite(Number(stats.punkte)) ? String(stats.punkte) : '0';
    const wins = stats && Number.isFinite(Number(stats.siege)) ? String(stats.siege) : '0';

    return `<div class="elo-tooltip-item">
      <div class="elo-tooltip-name">${escapeHtml(item.dataset.label)}</div>
      <div>Platz: ${escapeHtml(item.parsed.y)}</div>
      <div>Pkt.: ${escapeHtml(points)} · Siege: ${escapeHtml(wins)} · Diff.: <span class="elo-tooltip-delta ${diffClass}">${escapeHtml(diff)}</span></div>
    </div>`;
  }).join('');

  positionChartTooltip(chartInstance, tooltip, tooltipEl);
}

function formatEloDelta(delta) {
  if (!Number.isFinite(delta) || delta === 0) return delta === 0 ? '±0' : '';
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function getPlayerSeries(player, events) {
  const completedEloMatchCount = (player.history || []).filter(historyEntry =>
    historyEntry.matchId && Number.isFinite(Number(historyEntry.elo))
  ).length;
  const historyByEvent = new Map(
    (player.history || [])
      .map(historyEntry => [getHistoryEventKey(historyEntry), historyEntry])
      .filter(([key, entry]) => key && Number.isFinite(Number(entry.elo)))
  );
  let previousElo = null;
  const series = {
    eloValues: [],
    deltas: [],
    deltaLabels: [],
    gameLabels: [],
    eventTitles: [],
    matchContexts: [],
    oldElos: [],
    interveningEvents: []
  };

  events.forEach(event => {
    if (event.isFinal) {
      const hasFinalValue = completedEloMatchCount >= 6 && Number.isFinite(previousElo);
      series.eloValues.push(hasFinalValue ? previousElo : null);
      series.deltas.push(null);
      series.deltaLabels.push('');
      series.gameLabels.push(hasFinalValue ? 'Final' : '');
      series.eventTitles.push(hasFinalValue ? 'Final' : '');
      series.matchContexts.push(null);
      series.oldElos.push(null);
      series.interveningEvents.push([]);
      return;
    }

    const historyEntry = historyByEvent.get(event.key);
    if (!historyEntry) {
      series.eloValues.push(null);
      series.deltas.push(null);
      series.deltaLabels.push('');
      series.gameLabels.push('');
      series.eventTitles.push('');
      series.matchContexts.push(null);
      series.oldElos.push(null);
      series.interveningEvents.push([]);
      return;
    }

    const elo = Number(historyEntry.elo);
    const isSeasonBoundary = ['season-start', 'season-end'].includes(historyEntry.eventType);
    const oldElo = !isSeasonBoundary
      && historyEntry.oldElo !== null && historyEntry.oldElo !== undefined
      && Number.isFinite(Number(historyEntry.oldElo))
      ? Number(historyEntry.oldElo)
      : isSeasonBoundary ? null : previousElo;
    const delta = !isSeasonBoundary
      && historyEntry.delta !== null && historyEntry.delta !== undefined
      && Number.isFinite(Number(historyEntry.delta))
      ? Number(historyEntry.delta)
      : isSeasonBoundary || oldElo === null ? null : elo - oldElo;
    previousElo = elo;

    series.eloValues.push(elo);
    series.deltas.push(delta);
    series.deltaLabels.push(formatEloDelta(delta));
    series.gameLabels.push(event.gameLabel);
    const eventTitle = event.gameLabel === 'Start' || event.gameLabel === 'Final'
      ? event.gameLabel
      : event.match ? formatMatchMeta(event.match) : formatMatchDate({ datum: event.date });
    series.eventTitles.push(isAllTimeStatistics() && event.match?.seasonLabel
      ? `${event.match.seasonLabel} · ${eventTitle}`
      : eventTitle);
    series.matchContexts.push(getPlayerMatchContext(player.name, event.match));
    series.oldElos.push(oldElo);
    series.interveningEvents.push(historyEntry.interveningEvents || []);
  });

  return series;
}

function getPlacementSeries() {
  const matchDays = [...new Set(PADEL_DATA.matches.filter(countsForRanking).map(m => m.spieltag))].sort((a, b) => a - b);
  const placementsByPlayer = new Map(PADEL_DATA.players.map(p => [p.name, []]));
  const playedByPlayer = new Map(PADEL_DATA.players.map(p => [p.name, []]));
  const byeByPlayer = new Map(PADEL_DATA.players.map(p => [p.name, []]));
  const statsByPlayer = new Map(PADEL_DATA.players.map(p => [p.name, []]));

  matchDays.forEach(spieltag => {
    const matchesUntilDay = PADEL_DATA.matches.filter(m => countsForRanking(m) && m.sieger !== null && m.spieltag <= spieltag);
    const scheduledMatchesAtDay = PADEL_DATA.matches.filter(m => countsForRanking(m) && m.spieltag === spieltag);
    const playedMatchesAtDay = scheduledMatchesAtDay.filter(m => m.sieger !== null);
    const ranked = getRankedPlayers(matchesUntilDay);
    ranked.forEach((player, index) => {
      const isInMatch = match => match.team1.spieler.includes(player.name) || match.team2.spieler.includes(player.name);
      placementsByPlayer.get(player.name).push(index + 1);
      statsByPlayer.get(player.name).push(player.stats);
      playedByPlayer.get(player.name).push(playedMatchesAtDay.some(isInMatch));
      byeByPlayer.get(player.name).push(!scheduledMatchesAtDay.some(isInMatch));
    });
  });

  return { matchDays, placementsByPlayer, playedByPlayer, byeByPlayer, statsByPlayer };
}

const placementLabelPlugin = {
  id: 'placementLabelPlugin',
  afterDatasetsDraw(chartInstance) {
    const { ctx, chartArea } = chartInstance;
    ctx.save();
    ctx.textBaseline = 'middle';

    chartInstance.$placementLabelBoxes = [];
    chartInstance.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chartInstance.getDatasetMeta(datasetIndex);
      if (!meta.data.length) return;

      const point = meta.data[meta.data.length - 1];
      const x = Math.min(point.x + 8, chartArea.right + 8);
      ctx.font = `${getPlacementLabelWeight(dataset.label)} 11px ${getThemeValue('--font-body')}`;
      ctx.fillStyle = getPlacementLabelColor(dataset.label, dataset.baseColor || dataset.borderColor);
      ctx.fillText(dataset.label, x, point.y);
      chartInstance.$placementLabelBoxes.push({
        playerName: dataset.label,
        left: x,
        right: x + ctx.measureText(dataset.label).width,
        top: point.y - 7,
        bottom: point.y + 7
      });
    });

    ctx.restore();
  },
  afterEvent(chartInstance, args) {
    const { event } = args;
    if (event.type === 'mouseout') {
      setHoveredPlacementChartPlayer(null);
      return;
    }
    if (event.type !== 'mousemove') return;

    const label = (chartInstance.$placementLabelBoxes || []).find(box =>
      event.x >= box.left && event.x <= box.right && event.y >= box.top && event.y <= box.bottom
    );
    setHoveredPlacementChartPlayer(label?.playerName || null);
  }
};

const eloFinalStraightSegmentPlugin = {
  id: 'eloFinalStraightSegmentPlugin',
  beforeDatasetsDraw(chartInstance) {
    chartInstance.data.datasets.forEach((dataset, datasetIndex) => {
      const finalIndex = dataset.finalPointIndex;
      if (!Number.isInteger(finalIndex) || finalIndex < 1 || dataset.data[finalIndex] === null) return;

      const points = chartInstance.getDatasetMeta(datasetIndex).data;
      const finalPoint = points[finalIndex];
      if (!finalPoint || finalPoint.skip) return;

      let previousIndex = finalIndex - 1;
      while (previousIndex >= 0 && (!points[previousIndex] || points[previousIndex].skip)) {
        previousIndex -= 1;
      }
      if (previousIndex < 0) return;

      const previousPoint = points[previousIndex];
      previousPoint.cp2x = previousPoint.x;
      previousPoint.cp2y = previousPoint.y;
      finalPoint.cp1x = finalPoint.x;
      finalPoint.cp1y = finalPoint.y;
    });
  }
};

function getStatisticsEloChartBounds(datasets = []) {
  const values = datasets
    .flatMap(dataset => dataset.data || [])
    .filter(value => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(Number);
  if (!values.length) return { min: 0, max: 100 };

  return {
    min: Math.max(0, Math.floor((Math.min(...values) - 50) / 50) * 50),
    max: Math.ceil((Math.max(...values) + 50) / 50) * 50
  };
}

function initChart() {
  if (!window.Chart) {
    void ensureChartLibrary().then(() => {
      if (document.getElementById('verlauf')?.classList.contains('active')) {
        if (statisticsLoadError.startsWith('Die Diagramme')) statisticsLoadError = '';
        renderStatisticsModeState();
        initChart();
      }
    }).catch(error => {
      statisticsLoadError = 'Die Diagramme konnten nicht geladen werden. Öffne die Statistik erneut, um es noch einmal zu versuchen.';
      renderStatisticsModeState();
      console.error(error);
    });
    return;
  }
  if (chart) {
    if (!isAllTimeStatistics()) initPlacementChart();
    return;
  }
  const data = getStatisticsData();
  const players = data.players;
  const activePlayers = getStatisticsPlayerFilter();
  const chartEvents = getChartEvents(data);
  const finalPointIndex = chartEvents.findIndex(event => event.isFinal);

  const datasets = players.map((p, i) => {
    const series = getPlayerSeries(p, chartEvents);
    const color = getEloChartColor(getChartBaseColor(p, i), p.name);
    return {
      label: p.name,
      playerId: p.id,
      data: series.eloValues,
      deltas: series.deltas,
      deltaLabels: series.deltaLabels,
      gameLabels: series.gameLabels,
      eventTitles: series.eventTitles,
      matchContexts: series.matchContexts,
      oldElos: series.oldElos,
      interveningEvents: series.interveningEvents,
      finalPointIndex,
      borderColor: color,
      backgroundColor: 'transparent',
      pointBackgroundColor: color,
      pointBorderColor: color,
      pointHoverBackgroundColor: color,
      pointHoverBorderColor: color,
      borderWidth: getEloChartLineWidth(p.name),
      pointRadius: getEloChartPointRadius(p.name),
      order: getEloChartOrder(p.name),
      pointHoverRadius: 5,
      tension: 0.3,
      spanGaps: true,
      hidden: !activePlayers.has(p.id)
    };
  });
  const eloBounds = getStatisticsEloChartBounds(datasets);

  const ctx = document.getElementById('eloChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartEvents.map(event => new Date(event.date).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        ...(isAllTimeStatistics() ? { year: '2-digit' } : {})
      })),
      datasets
    },
    plugins: [eloFinalStraightSegmentPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: externalEloTooltip
        }
      },
      scales: {
        x: { grid: { color: getThemeValue('--border') }, ticks: { color: getThemeValue('--muted'), font: { family: getThemeValue('--font-body'), size: 12 } } },
        y: {
          min: eloBounds.min, max: eloBounds.max,
          grid: { color: getThemeValue('--border') },
          ticks: { color: getThemeValue('--muted'), font: { family: getThemeValue('--font-body'), size: 12 } }
        }
      }
    }
  });
  chart.$players = players;
  if (!isAllTimeStatistics()) initPlacementChart();
  renderFilter();
}

function getPlacementSegmentColor(context, playedFlags, color) {
  const fromPlayed = playedFlags[context.p0DataIndex];
  const toPlayed = playedFlags[context.p1DataIndex];

  if (fromPlayed && toPlayed) return color;
  const fadedColor = fadeChartColor(color);
  if (!fromPlayed && !toPlayed) return fadedColor;

  const xScale = context.chart.scales.x;
  const x0 = xScale.getPixelForValue(context.p0DataIndex);
  const x1 = xScale.getPixelForValue(context.p1DataIndex);
  const gradient = context.chart.ctx.createLinearGradient(x0, 0, x1, 0);

  gradient.addColorStop(0, fromPlayed ? color : fadedColor);
  gradient.addColorStop(1, toPlayed ? color : fadedColor);

  return gradient;
}

function initPlacementChart() {
  if (placementChart) return;
  hoveredPlacementChartPlayerName = null;
  const { matchDays, placementsByPlayer, playedByPlayer, byeByPlayer, statsByPlayer } = getPlacementSeries();
  const maxPlace = PADEL_DATA.players.length;
  const datasets = PADEL_DATA.players.map((p, i) => {
    const playedFlags = playedByPlayer.get(p.name);
    const byeFlags = byeByPlayer.get(p.name);
    const baseColor = getChartBaseColor(p, i);
    const color = getPlacementChartColor(baseColor, p.name);
    return {
      label: p.name,
      data: placementsByPlayer.get(p.name),
      playedFlags,
      byeFlags,
      statsByPoint: statsByPlayer.get(p.name),
      baseColor,
      borderColor: color,
      backgroundColor: 'transparent',
      pointBackgroundColor: playedFlags.map(hasMatch => hasMatch ? color : 'transparent'),
      pointBorderColor: playedFlags.map((hasMatch, pointIndex) => hasMatch || byeFlags[pointIndex] ? color : 'transparent'),
      borderWidth: getPlacementChartLineWidth(p.name),
      pointStyle: 'circle',
      pointRadius: playedFlags.map((hasMatch, pointIndex) =>
        getPlacementChartPointRadius(p.name, hasMatch, byeFlags[pointIndex])
      ),
      pointBorderWidth: playedFlags.map((hasMatch, pointIndex) => hasMatch || byeFlags[pointIndex] ? 1 : 0),
      pointHitRadius: playedFlags.map(hasMatch => hasMatch ? 8 : 0),
      pointHoverRadius: playedFlags.map(hasMatch => hasMatch ? 5 : 0),
      tension: 0,
      order: getPlacementChartOrder(p.name),
      segment: {
        borderColor: ctx => getPlacementSegmentColor(ctx, playedFlags, color)
      }
    };
  });

  const ctx = document.getElementById('placementChart').getContext('2d');
  placementChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: matchDays.map(day => `ST ${day}`),
      datasets
    },
    plugins: [placementLabelPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 90 } },
      interaction: { mode: 'point', intersect: true },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          mode: 'point',
          intersect: true,
          filter: item => item.dataset.playedFlags?.[item.dataIndex],
          external: externalPlacementTooltip
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Spieltag', color: getThemeValue('--dim'), font: { family: getThemeValue('--font-body'), size: 14, weight: '600' } },
          grid: { color: getThemeValue('--border') },
          ticks: { color: getThemeValue('--muted'), font: { family: getThemeValue('--font-body'), size: 12 } }
        },
        y: {
          reverse: true,
          min: 0.5,
          max: maxPlace + 0.5,
          title: { display: true, text: 'Platz', color: getThemeValue('--dim'), font: { family: getThemeValue('--font-body'), size: 14, weight: '600' } },
          grid: { color: getThemeValue('--border') },
          ticks: {
            stepSize: 1,
            color: getThemeValue('--muted'),
            font: { family: getThemeValue('--font-body'), size: 12 },
            callback: value => Number.isInteger(value) ? value : ''
          }
        }
      }
    }
  });
}

const CHART_FILTER_COMPANIES = ['Envidual', 'Hanako', 'Headsquare'];

function getPlayerCompany(player) {
  return (window.PADEL_PLAYERS || []).find(item => item.id === player?.id)?.firma || player?.firma || null;
}

function getStatisticsCompanyPlayers(company) {
  return getStatisticsPlayers().filter(player => getPlayerCompany(player) === company);
}

function renderCompanyFilter() {
  const activePlayers = getStatisticsPlayerFilter();
  document.getElementById('filter-company-row').innerHTML = CHART_FILTER_COMPANIES.map(company => {
    const companyPlayers = getStatisticsCompanyPlayers(company);
    if (!companyPlayers.length) return '';
    const on = companyPlayers.every(player => activePlayers.has(player.id));
    return `<button
      class="fb-toggle fb-company fb-company-${company} ${on ? 'on' : ''}"
      data-company-toggle="${company}"
      aria-pressed="${on}"
    >${company}</button>`;
  }).join('');
}

function renderFilter() {
  renderCompanyFilter();
  const activePlayers = getStatisticsPlayerFilter();
  document.getElementById('filter-row').innerHTML = getStatisticsPlayers().map((p,i) => {
    const on = activePlayers.has(p.id);
    const color = getChartBaseColor(p, i);
    const selectedIcon = isSelectedPlayer(p.name)
      ? `<span class="fb-selected-icon" title="Ausgewählter Spieler" aria-label="Ausgewählter Spieler">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="8.5"></circle>
          <circle class="fb-selected-icon-dot" cx="12" cy="12" r="3"></circle>
        </svg>
      </span>`
      : '';
    return `<button
      class="fb ${on?'on':''}"
      style="${on ? `--player-color:${color};` : ''}"
      data-player-toggle-id="${p.id}"
      data-player-toggle-index="${i}"
      data-player-toggle-name="${escapeHtml(p.name)}"
    >${p.name}${selectedIcon}</button>`;
  }).join('');
}

function toggleP(id, i, btn) {
  if (!chart) return;
  const ds = chart.data.datasets[i];
  const activePlayers = getStatisticsPlayerFilter();
  const player = getStatisticsPlayers()[i];
  const color = getChartBaseColor(player, i);
  if (activePlayers.has(player.id)) { activePlayers.delete(player.id); btn.classList.remove('on'); btn.style = ''; }
  else { activePlayers.add(player.id); btn.classList.add('on'); btn.style = `--player-color:${color};`; }
  ds.hidden = isEloChartDatasetHidden(player, activePlayers);
  chart.update();
  renderCompanyFilter();
}

function toggleAll(on) {
  if (!chart) return;
  const activePlayers = getStatisticsPlayerFilter();
  getStatisticsPlayers().forEach((p, i) => {
    if (on) activePlayers.add(p.id); else activePlayers.delete(p.id);
    chart.data.datasets[i].hidden = isEloChartDatasetHidden(p, activePlayers);
  });
  chart.update();
  renderFilter();
}

function toggleCompany(company) {
  if (!chart) return;
  const activePlayers = getStatisticsPlayerFilter();
  const companyPlayers = getStatisticsCompanyPlayers(company);
  const on = !companyPlayers.every(player => activePlayers.has(player.id));
  getStatisticsPlayers().forEach((player, i) => {
    if (getPlayerCompany(player) !== company) return;
    if (on) activePlayers.add(player.id); else activePlayers.delete(player.id);
    chart.data.datasets[i].hidden = isEloChartDatasetHidden(player, activePlayers);
  });
  chart.update();
  renderFilter();
}

// ── INIT ──────────────────────────────────────────────────────────
function finishInitialLoading() {
  const main = document.querySelector('main');
  const status = document.getElementById('page-load-status');
  main?.setAttribute('aria-busy', 'false');
  if (status) status.textContent = 'Inhalte geladen.';
}

async function initApp() {
  try {
    normalizeLegacySeasonUrl();
    await loadActiveSeason();
    window.PadelSeasonRouting.normalizeCurrentMatchUrl(selectedSeason.id, PADEL_DATA.matches);
    window.PadelSeasonRouting.normalizeCurrentLiveUrl(selectedSeason.id, PADEL_DATA.matches);
    applySeasonMetadata();
    resetSeasonState();
    updateViewerPicker();
    appReady = true;
    invalidateSections();
    renderActiveSection();
  } catch (error) {
    document.querySelector('main').innerHTML = `<div class="empty-state">Die Saison-Daten konnten nicht geladen werden.</div>`;
    document.querySelector('main')?.setAttribute('aria-busy', 'false');
    console.error(error);
    return;
  }

  window.addEventListener('padel:training-data-changed', () => {
    void refreshPublicTrainingFeed();
  });

  finishInitialLoading();
  void refreshHomePredictionLeaderboard();
  if (isDetailEmbed) initDetailEmbed();

  const url = new URL(window.location.href);
  const requestedStatistics = window.PadelSeasonRouting.getRequestedMatchId(PADEL_DATA.matches);
  const requestedLive = requestedStatistics ? null : window.PadelSeasonRouting.getRequestedLiveRoute(PADEL_DATA.matches);
  const requestedLiveMatch = requestedLive?.matchId || null;
  const requestedPlayerProfile = url.searchParams.get('spielerprofil');
  let liveTickerInitialized = false;

  try {
    if (requestedStatistics) await window.PadelMatchStatistics?.open(requestedStatistics, { updateUrl: false, direct: true });
    if (requestedLiveMatch) {
      await window.PadelLiveTicker?.init();
      liveTickerInitialized = true;
      nav('partien', document.getElementById('partien-nav-button'));
      const liveUrl = new URL(url);
      const baseUrl = window.PadelSeasonRouting.getSeasonUrl(selectedSeason.id, 'league', {
        preserveSearch: true,
        preserveHash: true
      });
      baseUrl.searchParams.delete('live');
      baseUrl.searchParams.delete('liveView');
      window.history.replaceState({ liveBase: true }, '', `${baseUrl.pathname}${baseUrl.search}${baseUrl.hash}`);
      window.history.pushState({ liveMatchId: requestedLiveMatch }, '', `${liveUrl.pathname}${liveUrl.search}${liveUrl.hash}`);
      await openLiveTicker(requestedLiveMatch, {
        updateUrl: false,
        view: requestedLive.view
      });
    }
    if (requestedPlayerProfile && !requestedStatistics) {
      url.searchParams.delete('spielerprofil');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      await openPlayerProfile(requestedPlayerProfile, null, { forceModal: true });
    }
  } catch (error) {
    console.error('Die verlinkte Detailansicht konnte nicht initialisiert werden:', error);
  }
  if (isDetailEmbed) reportDetailEmbedState();

  try {
    if (!liveTickerInitialized) await window.PadelLiveTicker?.init();
    await window.PadelKonto?.init();
  } catch (error) {
    console.error('Das Konto konnte nicht initialisiert werden:', error);
  }

  await loadActiveSeasonForecasts();
  await window.PadelMatchStatistics?.refreshForecast?.();
}

// Eingebettet zeigt die Liga nur ihre Detailansichten wie Spielerprofil und Partie über der Tippseite an.
function postToDetailEmbedParent(message) {
  const targetOrigin = window.location.protocol === 'file:' ? '*' : window.location.origin;
  window.parent.postMessage(message, targetOrigin);
}

function reportDetailEmbedState() {
  const open = [...document.querySelectorAll('dialog')].some(dialog => dialog.open);
  postToDetailEmbedParent({ type: open ? 'padel:detail-opened' : 'padel:detail-closed' });
}

function initDetailEmbed() {
  window.addEventListener('message', event => {
    const validOrigin = window.location.protocol === 'file:'
      ? event.origin === 'null'
      : event.origin === window.location.origin;
    if (!validOrigin || event.source !== window.parent) return;
    if (event.data?.type === 'padel:detail-panel-availability') {
      window.PadelMatchStatistics?.setEmbeddedPanelAvailability?.(event.data.available);
      window.PadelLigaSetEmbeddedPlayerProfilePanelAvailability?.(event.data.available);
      return;
    }
    if (event.data?.type === 'padel:detail-sequence') {
      window.PadelMatchStatistics?.setSequence?.(event.data.sequence);
      return;
    }
    if (event.data?.type === 'padel:close-detail') {
      if (window.PadelMatchStatistics?.active) window.PadelMatchStatistics.restore();
      else if (document.getElementById('player-profile-dialog')?.open) closePlayerProfile({ immediate: true });
      reportDetailEmbedState();
      return;
    }
    if (event.data?.type !== 'padel:open-detail') return;
    const opening = event.data.playerId
      ? openPlayerProfile(event.data.playerId, null, {
          panelAvailable: event.data.panelAvailable,
          sharedDetail: Boolean(window.PadelMatchStatistics?.active && event.data.panelAvailable)
        })
      : window.PadelMatchStatistics?.open(event.data.matchId, {
          sequence: event.data.sequence,
          panelAvailable: event.data.panelAvailable
        });
    // Auch eine abgelehnte Detailansicht meldet ihren Zustand, damit die Tippseite nicht verdeckt bleibt.
    void Promise.resolve(opening).finally(reportDetailEmbedState);
  });
  window.addEventListener('padel:match-forecast-changed', () => postToDetailEmbedParent({ type: 'padel:match-forecast-changed' }));
  const observer = new MutationObserver(() => setTimeout(reportDetailEmbedState));
  document.querySelectorAll('dialog').forEach(dialog => {
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    dialog.addEventListener('close', reportDetailEmbedState);
  });
}

const mobileViewportQuery = window.matchMedia('(max-width: 768px)');
mobileViewportQuery.addEventListener?.('change', () => {
  if (!mobileViewportQuery.matches) {
    document.querySelectorAll('#spielplan, #final-four-spielplan')
      .forEach(matchPlan => matchPlan.classList.remove('played-details-visible'));
  }
  invalidateSections(['rangliste']);
  renderActiveSection();
});

document.querySelectorAll('#spielplan, #final-four-spielplan').forEach(matchPlan => {
  matchPlan.addEventListener('click', event => {
    if (!mobileViewportQuery.matches) return;
    if (!event.target.closest('.mc.played')) return;
    if (event.target.closest('button, a, input, select, textarea')) return;
    matchPlan.classList.toggle('played-details-visible');
  });
});

// Mobil per horizontalem Wischen zwischen den Hauptbereichen wechseln.
function getSwipeableSections() {
  const sections = [...document.querySelectorAll('nav.site-nav button[data-section]')]
    .filter(button => !button.hidden)
    .map(button => button.dataset.section);
  if (!document.body.classList.contains('is-cup-season')) sections.unshift('start');
  return sections;
}

window.PadelSwipeGesture?.attach(document.querySelector('main'), {
  enabled: () => mobileViewportQuery.matches,
  onSwipe: step => {
    const sections = getSwipeableSections();
    const currentIndex = sections.indexOf(document.querySelector('main > .section.active')?.id);
    const targetId = currentIndex === -1 ? null : sections[currentIndex + step];
    if (!targetId) return;
    nav(targetId);
    window.PadelSwipeGesture.animateIn(document.getElementById(targetId), step);
  }
});

const playerProfileDialog = document.getElementById('player-profile-dialog');
playerProfileDialog?.addEventListener('cancel', event => {
  event.preventDefault();
  closePlayerProfile();
});
playerProfileDialog?.addEventListener('click', event => {
  if (event.target === playerProfileDialog && playerProfilePresentation === 'modal') closePlayerProfile();
});
playerProfileDialog?.querySelector('.player-profile-shell')?.addEventListener('scroll', updatePlayerProfileHeroCondensed, { passive: true });

window.addEventListener('padel:branding-change', refreshThemeDependentCharts);

let playerProfileResizeFrame = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(playerProfileResizeFrame);
  playerProfileResizeFrame = requestAnimationFrame(reconcilePlayerProfilePresentation);
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || playerProfilePresentation !== 'panel' || !playerProfileDialog?.open) return;
  if (document.querySelector('dialog:modal')) return;
  event.preventDefault();
  closePlayerProfile();
});

const detailViewDialog = document.getElementById('detail-view-dialog');
detailViewDialog?.addEventListener('cancel', event => {
  event.preventDefault();
  closeLiveTicker();
});

applyAppHintVisibility();
initApp();
