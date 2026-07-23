// ── VIEWER ────────────────────────────────────────────────────────
const VIEWER_STORAGE_KEY_PREFIX = 'padel-liga-viewer';
let PADEL_DATA = null;
let selectedSeason = null;
let selectedViewerId = 'sb';
let matchScope = 'all';
let rankingSortMode = 'points';
let rankingViewMode = 'compact';
let calculatorResults = new Map();
let activeCalculatorMatchId = null;
let calculatorAutoTip = false;

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

function getSeasonOptions() {
  return Array.isArray(window.PADEL_SEASONS) ? window.PADEL_SEASONS : [];
}

function getRequestedSeasonId() {
  return new URLSearchParams(window.location.search).get('saison');
}

function getDefaultSeasonOption() {
  const seasons = getSeasonOptions();
  const requestedSeasonId = getRequestedSeasonId();
  const requestedSeason = seasons.find(season => season.id === requestedSeasonId);

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

function getSupabaseClient() {
  if (window.PADEL_SUPABASE_CLIENT) return window.PADEL_SUPABASE_CLIENT;
  const config = window.PADEL_SUPABASE_CONFIG;
  if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) return null;
  window.PADEL_SUPABASE_CLIENT = window.supabase.createClient(config.url, config.publishableKey);
  return window.PADEL_SUPABASE_CLIENT;
}

async function mergeDatabaseResults(rawSeason) {
  if (!rawSeason.databaseResults) return rawSeason;
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase ist für die Test-Saison nicht konfiguriert.');
  const matchIds = rawSeason.matches.map(match => match.id);
  const [{ data: databaseMatches, error: matchError }, { data: eloChanges, error: eloError }] = await Promise.all([
    client
      .from('matches')
      .select('id, scheduled_date, display_time, result_details, actual_sets, winner')
      .in('id', matchIds),
    client
      .from('match_elo_changes')
      .select('match_id, player_id, old_elo, new_elo, delta')
      .in('match_id', matchIds)
  ]);
  if (matchError) throw matchError;
  if (eloError) throw eloError;

  const matchesById = new Map((databaseMatches || []).map(match => [match.id, match]));
  const eloByMatch = new Map();
  (eloChanges || []).forEach(change => {
    if (!eloByMatch.has(change.match_id)) eloByMatch.set(change.match_id, []);
    eloByMatch.get(change.match_id).push({
      playerId: change.player_id,
      oldElo: change.old_elo,
      newElo: change.new_elo,
      delta: change.delta
    });
  });

  return {
    ...rawSeason,
    matches: rawSeason.matches.map(match => {
      const stored = matchesById.get(match.id);
      if (!stored) throw new Error(`Die Datenbank-Partie ${match.id} fehlt.`);
      return {
        ...match,
        date: stored.scheduled_date || match.date,
        time: stored.display_time ? String(stored.display_time).slice(0, 5).replace(':', '.') : match.time,
        result: stored.result_details,
        sets: stored.actual_sets,
        winner: stored.winner,
        eloChanges: eloByMatch.get(match.id) || []
      };
    })
  };
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
      : { qualifierRanks: names.map(name => qualifierRanks.get(name)).filter(Boolean) };
  };

  return {
    ...rawSeason,
    participants: rawSeason.players.map(player => ({
      playerId: player.id,
      startElo: Number(player.history?.[0]?.elo)
    })),
    matches: rawSeason.matches.map(match => ({
      id: `season-${rawSeason.id}-partie-${String(match.id).match(/\d+$/)?.[0] || match.id}`,
      type: 'season',
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
      displayLabel: match.displayLabel,
      team1: normalizeTeam(match.team1),
      team2: normalizeTeam(match.team2)
    }))
  };
}

function countsForRanking(match) {
  return match?.countsForRanking !== false;
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

  playerIds.forEach(playerId => {
    if (!playersById.has(playerId)) {
      throw new Error(`Unbekannte Spieler-ID ${playerId}.`);
    }
  });

  return {
    ...team,
    playerIds,
    qualifierRanks,
    // Anzeigenamen werden ausschließlich aus den zentralen Stammdaten abgeleitet.
    spieler: playerIds.length
      ? playerIds.map(playerId => playersById.get(playerId).name)
      : qualifierRanks.map(getQualifierLabel)
  };
}

function hydrateMatch(match, playersById) {
  return {
    ...match,
    // Die Oberfläche nutzt vorerst diese bisherigen Feldnamen. Die gepflegten
    // Rohdaten verwenden für Saison- und Trainingsspiele dasselbe Schema.
    spieltag: match.matchday ?? null,
    datum: match.date ?? null,
    uhrzeit: match.time ?? null,
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
  const regularGames = score.regularSets.reduce(
    (totals, set) => [totals[0] + set[0], totals[1] + set[1]],
    [0, 0]
  );
  const regularDifference = Math.abs(regularGames[0] - regularGames[1]);
  const tiebreakDifference = score.matchTiebreak
    ? (Math.abs(score.matchTiebreak[0] - score.matchTiebreak[1]) / 10) * 3
    : 0;

  return Math.pow(Math.log10(regularDifference + tiebreakDifference + 1), 3) + 2;
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
    if (!player.name || !player.initials || !player.firma) {
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
      startElo: Number(participant.startElo)
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
      throw new Error(`Trainingsspiel ${match.id} darf weder Tabelle noch Elo verändern.`);
    }
  });

  const completeSeason = {
    ...rawSeason,
    leagues: leagueConfig.leagues,
    activeLeagueId: leagueConfig.defaultLeagueId,
    players: allPlayers,
    matches: allMatches,
    trainingMatches
  };
  calculateSeasonEloHistory(completeSeason);

  return {
    ...completeSeason,
    allPlayers,
    allMatches,
    players: allPlayers.filter(player => player.leagueId === leagueConfig.defaultLeagueId),
    matches: allMatches.filter(match => match.leagueId === leagueConfig.defaultLeagueId)
  };
}

async function loadActiveSeason() {
  selectedSeason = getDefaultSeasonOption();
  if (!selectedSeason) throw new Error('Keine Saison in data/seasons.js gefunden.');

  window.PADEL_SEASON = null;
  await loadScript(selectedSeason.file);
  const rawSeason = await mergeDatabaseResults(normalizeLegacySeason(window.PADEL_SEASON));

  if (!rawSeason?.participants || !rawSeason?.matches) {
    throw new Error(`Saison ${selectedSeason.id} ist unvollständig.`);
  }

  PADEL_DATA = hydrateSeasonData(rawSeason);
}

function applySeasonMetadata() {
  const label = PADEL_DATA.label || selectedSeason.label || selectedSeason.id;
  const title = PADEL_DATA.title || `Padel-Liga ${label}`;
  const organizations = PADEL_DATA.organizations || [];
  const organizationLabel = organizations.join('  ×  ');
  const heroOrganizations = document.getElementById('hero-orgs');

  document.title = title;
  document.querySelectorAll('[data-season-label]').forEach(element => {
    element.textContent = label;
  });
  if (heroOrganizations) heroOrganizations.textContent = organizationLabel;
  document.body.classList.toggle('is-test-season', Boolean(PADEL_DATA.resultsEntryEnabled));
  const seasonSelect = document.getElementById('season-select');
  if (seasonSelect) {
    seasonSelect.innerHTML = getSeasonOptions().map(season => `
      <option value="${season.id}" ${season.id === selectedSeason.id ? 'selected' : ''}>${season.label}</option>
    `).join('');
    seasonSelect.addEventListener('change', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('saison', seasonSelect.value);
      window.location.assign(url);
    });
  }
  const predictionLink = document.getElementById('tippspiel-link');
  if (predictionLink) predictionLink.href = `tipp/?saison=${encodeURIComponent(selectedSeason.id)}`;
}

function resetSeasonState() {
  selectedViewerId = getStoredViewerId();
  if (!getViewerOptions().some(option => option.id === selectedViewerId)) {
    selectedViewerId = 'sb';
  }
  matchScope = 'all';
  rankingSortMode = 'points';
  rankingViewMode = 'compact';
  calculatorResults = new Map();
  activeCalculatorMatchId = null;
  calculatorAutoTip = false;
  activeP = new Set(PADEL_DATA.players.map(player => player.id));
  chart?.destroy();
  placementChart?.destroy();
  chart = null;
  placementChart = null;
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function getViewerOptions() {
  return [
    { id: 'sb', name: 'Spieler auswählen', short: '-/-', mobileLabel: 'Auswählen' },
    ...PADEL_DATA.players.map(player => ({
      id: player.id,
      name: player.name,
      short: player.initials
    }))
  ];
}

function getSelectedViewer() {
  return getViewerOptions().find(option => option.id === selectedViewerId) || getViewerOptions()[0];
}

function isParticipantView() {
  return selectedViewerId !== 'sb';
}

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

function toggleViewerMenu() {
  const picker = document.getElementById('viewer-picker');
  const isOpen = picker.classList.toggle('open');
  document.querySelector('.viewer-toggle').setAttribute('aria-expanded', String(isOpen));
}

function closeViewerMenu() {
  const picker = document.getElementById('viewer-picker');
  if (!picker) return;
  picker.classList.remove('open');
  picker.querySelector('.viewer-toggle')?.setAttribute('aria-expanded', 'false');
}

function selectViewer(id) {
  selectedViewerId = id;
  storeViewerId(selectedViewerId);
  if (!isParticipantView() && matchScope === 'mine') matchScope = 'all';
  updateViewerPicker();
  updateChartViewerFocus();
  renderHome();
  renderRanking();
  renderPartien();
  renderCalculator();
  renderStatistik();
  closeViewerMenu();
}

function updateViewerPicker() {
  const selected = getSelectedViewer();
  document.getElementById('viewer-label-full').textContent = selected.name;
  document.getElementById('viewer-label-short').textContent = selected.mobileLabel || selected.short;
  document.getElementById('viewer-menu').innerHTML = getViewerOptions().map(option => `
    <button
      type="button"
      class="viewer-option ${option.id === selectedViewerId ? 'active' : ''}"
      role="option"
      aria-selected="${option.id === selectedViewerId}"
      data-viewer-id="${option.id}"
    >
      <span>${option.name}</span>
      <span>${option.short}</span>
    </button>
  `).join('');
}

function setAuthenticatedPlayer(playerId = null) {
  const isSeasonParticipant = Boolean(playerId && PADEL_DATA?.players.some(player => player.id === playerId));
  if (isSeasonParticipant) selectViewer(playerId);
}

window.PadelLigaSetAuthenticatedPlayer = setAuthenticatedPlayer;
window.addEventListener('padel:authenticated-player', event => {
  setAuthenticatedPlayer(event.detail?.playerId || null);
});

document.addEventListener('click', event => {
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

  const rankingSortControl = event.target.closest('[data-ranking-sort]');
  if (rankingSortControl) {
    setRankingSort(rankingSortControl.dataset.rankingSort);
    return;
  }

  const rankingViewControl = event.target.closest('[data-ranking-view]');
  if (rankingViewControl) {
    setRankingView(rankingViewControl.dataset.rankingView);
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

  const chartToggleAllControl = event.target.closest('[data-chart-toggle-all]');
  if (chartToggleAllControl) {
    toggleAll(chartToggleAllControl.dataset.chartToggleAll === 'true');
    return;
  }

  const calculatorResetControl = event.target.closest('[data-calculator-reset]');
  if (calculatorResetControl) {
    resetCalculator();
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
});

document.addEventListener('input', event => {
  const calculatorScoreInput = event.target.closest('[data-calculator-score]');
  if (!calculatorScoreInput) return;

  updateCalculatorScore(calculatorScoreInput);
});

document.addEventListener('pointerdown', event => {
  const calculatorScoreControl = event.target.closest('[data-calculator-score], [data-calculator-step]');
  setActiveCalculatorScorePair(calculatorScoreControl?.closest('.calculator-score-pair') || null);

  const calculatorScoreInput = event.target.closest('[data-calculator-score]');
  if (!calculatorScoreInput) return;

  clearCalculatorScoreInput(calculatorScoreInput);
  setActiveCalculatorMatch(calculatorScoreInput.dataset.calculatorMatchId);
});

document.addEventListener('mouseover', event => {
  const formChip = event.target.closest('[data-form-match-id]');
  if (formChip) showFormTooltip(formChip);
});

document.addEventListener('mouseout', event => {
  const formChip = event.target.closest('[data-form-match-id]');
  if (formChip && !formChip.contains(event.relatedTarget)) hideFormTooltip();
});

document.addEventListener('focusin', event => {
  const calculatorScoreControl = event.target.closest('[data-calculator-score], [data-calculator-step]');
  setActiveCalculatorScorePair(calculatorScoreControl?.closest('.calculator-score-pair') || null);

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
  if (event.key === 'Enter' || event.key === ' ') {
    const calculatorPresetControl = event.target.closest('[data-calculator-preset-team]');
    if (calculatorPresetControl) {
      event.preventDefault();
      applyCalculatorStraightSetsPreset(
        calculatorPresetControl.dataset.calculatorMatchId,
        Number(calculatorPresetControl.dataset.calculatorPresetTeam)
      );
      return;
    }
  }

  if (event.key === 'Escape') {
    closeViewerMenu();
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

function setRankingSort(mode) {
  rankingSortMode = ['elo', 'placement'].includes(mode) ? mode : 'points';
  renderRanking();
}

function updateRankingSortToggle() {
  const toggle = document.getElementById('ranking-sort-toggle');
  if (!toggle) return;

  const buttons = toggle.querySelectorAll('button');
  buttons[0]?.classList.toggle('active', rankingSortMode === 'points');
  buttons[1]?.classList.toggle('active', rankingSortMode === 'elo');
  buttons[2]?.classList.toggle('active', rankingSortMode === 'placement');
}

function setRankingView(mode) {
  rankingViewMode = mode === 'expanded' ? 'expanded' : 'compact';
  renderRanking();
}

function updateRankingViewToggle() {
  const toggle = document.getElementById('ranking-view-toggle');
  if (!toggle) return;
  const effectiveRankingViewMode = isMobileViewport() ? 'expanded' : rankingViewMode;

  const buttons = toggle.querySelectorAll('button');
  buttons[0].classList.toggle('active', effectiveRankingViewMode === 'compact');
  buttons[1].classList.toggle('active', effectiveRankingViewMode === 'expanded');
}

// ── NAV ───────────────────────────────────────────────────────────
function nav(id, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const activeButton = el || document.querySelector(`nav button[data-section="${id}"]`);
  if (activeButton) activeButton.classList.add('active');
  scrollToTopInstantly();
  if (id === 'verlauf') initChart();
  if (id === 'tippspiel') window.PadelTippspiel?.refresh();
}

function scrollToTopInstantly() {
  const root = document.documentElement;
  const navigation = document.querySelector('.site-nav');
  const header = document.querySelector('.site-header');
  const targetTop = header ? header.offsetHeight : 0;
  const navigationTop = navigation ? navigation.getBoundingClientRect().top : 0;

  if (!navigation || navigationTop > 1) return;

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
  const latestHistory = (player.history || [])
    .map((h, index) => ({ ...h, index, dateValue: new Date(h.date).getTime() }))
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

function getHistoryOrderKey(historyEntry) {
  const historyMatch = historyEntry.matchId
    ? PADEL_DATA.matches.find(match => match.id === historyEntry.matchId)
    : null;
  if (historyMatch) return getMatchOrderKey(historyMatch);

  const dateKey = toDateKey(historyEntry.date) || '0000-00-00';
  return `${dateKey}|0000|0000`;
}

function getPlayerEloBeforeMatch(player, match) {
  const matchOrderKey = getMatchOrderKey(match);
  const latestHistoryBeforeMatch = (player.history || [])
    .map((historyEntry, index) => ({
      ...historyEntry,
      index,
      orderKey: getHistoryOrderKey(historyEntry)
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

function getMatchWinProbabilityFromElos(match, getEloValue) {
  const playersByName = new Map(PADEL_DATA.players.map(p => [p.name, p]));
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

function getHistoricalMatchWinProbability(match) {
  return getMatchWinProbabilityFromElos(match, getPlayerEloBeforeMatch);
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
    const diffStr   = f.partien > 0 ? (f.spielDiff >= 0 ? `+${f.spielDiff}` : `${f.spielDiff}`) : '—';
    const diffClass = getStatDiffClass(f.spielDiff);
    return `<tr class="r${i+1} ${isSelectedViewerFirma(f.firma) ? 'viewer-highlight' : ''}">
      <td class="rn l">${i+1}</td>
      <td class="l"><span class="pname">${f.firma}</span><span class="firma-badge firma-${f.firma}">${f.firma}</span></td>
      <td class="num-val">${f.teilnehmer}</td>
      <td class="num-val">${f.partien}</td>
      <td class="num-val">${f.siege}</td>
      <td class="num-val">${f.punkte}</td>
      <td class="num-val"><span class="${f.partien > 0 ? diffClass : 'neu'}">${diffStr}</span></td>
      <td class="punkte-val">${f.pktPerTN.toFixed(2)}</td>
    </tr>`;
  }).join('');
}

function getFinalFourMatches() {
  return PADEL_DATA.matches
    .filter(match => !countsForRanking(match))
    .sort(compareMatchesByNumber);
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

function getFinalFourHeadToHeadWins(playerName, opponentName, matches) {
  return matches.filter(match => {
    if (match.sieger === null) return false;

    const playerTeam = getPlayerMatchTeamIndex({ name: playerName }, match);
    const opponentTeam = getPlayerMatchTeamIndex({ name: opponentName }, match);
    return playerTeam && opponentTeam && playerTeam !== opponentTeam && match.sieger === playerTeam;
  }).length;
}

function compareFinalFourHeadToHead(a, b, matches) {
  const aWins = getFinalFourHeadToHeadWins(a.name, b.name, matches);
  const bWins = getFinalFourHeadToHeadWins(b.name, a.name, matches);

  return aWins === bWins ? 0 : bWins - aWins;
}

function getFinalFourStats() {
  const matches = getFinalFourMatches();
  const names = getFinalFourPlayerNames(matches);

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
        seed: index + 1,
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
      compareFinalFourHeadToHead(a, b, matches) ||
      a.seed - b.seed
    )
  };
}

function renderFinalFourRanking() {
  const body = document.getElementById('ff-body');
  const meta = document.getElementById('ff-meta');
  if (!body || !meta) return;

  const { matches, stats } = getFinalFourStats();
  meta.textContent = `${stats.length} Spieler`;

  body.innerHTML = stats.map((player, index) => {
    const diffClass = getStatDiffClass(player.diff);
    const diffLabel = player.diff > 0 ? `+${player.diff}` : String(player.diff);

    return `<tr class="r${index + 1}">
      <td class="rn l">${index + 1}</td>
      <td class="l"><span class="pname">${player.name}</span></td>
      <td class="num-val">${player.partien}</td>
      <td class="punkte-val">${player.siege}</td>
      <td class="num-val">${player.spieleGV}</td>
      <td class="num-val"><span class="${diffClass}">${diffLabel}</span></td>
    </tr>`;
  }).join('');
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

function getDeltaClass(value) {
  return value > 0 ? 'pos' : value < 0 ? 'neg' : 'neu';
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

function getPlayerMatches(player) {
  return PADEL_DATA.matches.filter(match =>
    match.team1.spieler.includes(player.name) || match.team2.spieler.includes(player.name)
  );
}

function getPlayerMatchTeamIndex(player, match) {
  if (match.team1.spieler.includes(player.name)) return 1;
  if (match.team2.spieler.includes(player.name)) return 2;
  return null;
}

function getPlayerMatchProbability(player, match) {
  const probability = match.sieger === null
    ? getMatchWinProbability(match)
    : getHistoricalMatchWinProbability(match);
  const teamIndex = getPlayerMatchTeamIndex(player, match);

  if (!probability || !teamIndex) return null;
  return teamIndex === 1 ? probability.team1 : probability.team2;
}

function getPlayerWinQuote(player) {
  const probabilities = getPlayerMatches(player)
    .filter(countsForRanking)
    .map(match => getPlayerMatchProbability(player, match))
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

function getPlayerPlacementFactor(player, rankMap) {
  const partnerPlaces = [];
  const opponentPlaces = [];

  getPlayerMatches(player).filter(countsForRanking).forEach(match => {
    const teamIndex = getPlayerMatchTeamIndex(player, match);
    if (!teamIndex) return;

    const team = teamIndex === 1 ? match.team1.spieler : match.team2.spieler;
    const opponents = teamIndex === 1 ? match.team2.spieler : match.team1.spieler;
    const partnerAverage = average(team
      .filter(name => name !== player.name)
      .map(name => rankMap.get(name)));
    const opponentAverage = average(opponents.map(name => rankMap.get(name)));

    if (partnerAverage !== null) partnerPlaces.push(partnerAverage);
    if (opponentAverage !== null) opponentPlaces.push(opponentAverage);
  });

  const partnerAverage = average(partnerPlaces);
  const opponentAverage = average(opponentPlaces);
  const diff = partnerAverage !== null && opponentAverage !== null
    ? partnerAverage - opponentAverage
    : null;

  return { partnerAverage, opponentAverage, diff };
}

function formatPlacementFactor(factor) {
  if (!factor || !Number.isFinite(factor.diff)) return '—';

  const diffClass = getDeltaClass(factor.diff);
  return `<span class="pf-muted">${formatDecimal(factor.partnerAverage)}</span><span class="pf-muted"> / </span><span class="pf-muted">${formatDecimal(factor.opponentAverage)}</span><span class="pf-muted"> / </span><span class="${diffClass}">${formatSignedDecimal(factor.diff)}</span>`;
}

function getPlayerForm(player) {
  return getPlayerMatches(player)
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

      return `<span
        class="form-chip form-recency-${index} ${won ? 'form-win' : 'form-loss'} ${tieBreak ? 'form-tiebreak' : ''}"
        tabindex="0"
        aria-label="${escapeHtml(title)}"
        data-form-player="${escapeHtml(player.name)}"
        data-form-match-id="${escapeHtml(match.id)}"
      >${won ? 'S' : 'N'}</span>`;
    })
    .join('') || '<span class="neu">—</span>';
}

function getPlayerRankingExtras(player, rankMap) {
  return {
    winQuote: getPlayerWinQuote(player),
    placementFactor: getPlayerPlacementFactor(player, rankMap),
    form: getPlayerForm(player)
  };
}

function getPlacementAdjustedRank(player, rankMap) {
  const currentRank = rankMap.get(player.name);
  const factor = getPlayerPlacementFactor(player, rankMap);

  if (!Number.isFinite(currentRank)) return Infinity;
  if (!Number.isFinite(factor.diff)) return currentRank;

  return currentRank - factor.diff;
}

function renderRanking() {
  updateRankingSortToggle();
  updateRankingViewToggle();
  const table = document.getElementById('ranking-table');
  table.dataset.rankingSort = rankingSortMode;
  const effectiveRankingViewMode = isMobileViewport() ? 'expanded' : rankingViewMode;
  table.classList.toggle('expanded', effectiveRankingViewMode === 'expanded');
  table.classList.toggle('compact', effectiveRankingViewMode === 'compact');

  const withStats = getRankedPlayers(PADEL_DATA.matches, rankingSortMode);
  const rankMap = getRankingPositionMap('points');
  const firmaShort = { Envidual: 'Env', Headsquare: 'Hsq', Hanako: 'Han' };
  document.getElementById('rl-meta').textContent = withStats.length + ' Spieler';
  const sortNotes = {
    points: 'Top 4: Final-Four-Qualifikation  |  Sortierung: Punkte · Spiel-Differenz · gewonnene Spiele',
    elo: 'Sortierung: Elo · Punkte · Spiel-Differenz · gewonnene Spiele',
    placement: 'Sortierung: bereinigter Rang aus Punkte-Platz minus Platzierungsfaktor'
  };
  document.getElementById('rl-sort-note').textContent = sortNotes[rankingSortMode] || sortNotes.points;
  document.getElementById('rl-body').innerHTML = withStats.map((p, i) => {
    const currentRank = i + 1;
    const pointsRank = rankMap.get(p.name);
    const extras = getPlayerRankingExtras(p, rankMap);
    const spielDiffStr = p.stats.partien > 0 ? (p.stats.spielDiff >= 0 ? `+${p.stats.spielDiff}` : `${p.stats.spielDiff}`) : '—';
    const spielDiffClass = getStatDiffClass(p.stats.spielDiff);
    const isTopFourQualifier = pointsRank <= 4;
    return `<tr class="r${Math.min(currentRank,4)} ${isTopFourQualifier ? 'top-four-highlight' : ''} ${isSelectedPlayer(p.name) ? 'viewer-highlight' : ''}">
      <td class="rn l sticky-rank"><span class="rank-cell-inner"><span class="rank-main">${currentRank}</span>${renderPointsRankReference(currentRank, pointsRank)}</span></td>
      <td class="l sticky-name"><span class="player-cell-inner"><span class="pname">${p.name}</span><span class="firma-badge firma-${p.firma}"><span class="firma-full">${p.firma}</span><span class="firma-short">${firmaShort[p.firma] || p.firma}</span></span></span></td>
      <td class="num-val">${p.stats.partien}</td>
      <td class="num-val">${p.stats.siege}</td>
      <td class="punkte-val">${p.stats.punkte}</td>
      <td class="num-val extended-col">${p.stats.partien > 0 ? p.stats.spieleGV : '—'}</td>
      <td class="num-val"><span class="${p.stats.partien > 0 ? spielDiffClass : 'neu'}">${spielDiffStr}</span></td>
      <td class="elo-val">${getLatestPlayerElo(p)}</td>
      <td class="extended-col form-val">${extras.form}</td>
      <td class="num-val extended-col">${extras.winQuote === null ? '—' : `${extras.winQuote}%`}</td>
      <td class="num-val extended-col placement-factor-val">${formatPlacementFactor(extras.placementFactor)}</td>
    </tr>`;
  }).join('');
  renderFirmenRanking();
  renderFinalFourRanking();
}

function getRankedPlayers(matches = PADEL_DATA.matches, sortMode = 'points') {
  const withStats = PADEL_DATA.players.map(p => ({ ...p, stats: getPlayerStats(p, matches) }));
  if (sortMode === 'elo') {
    withStats.sort((a, b) =>
      (getLatestPlayerEloValue(b) ?? -Infinity) - (getLatestPlayerEloValue(a) ?? -Infinity) ||
      b.stats.punkte - a.stats.punkte ||
      b.stats.spielDiff - a.stats.spielDiff ||
      b.stats.gewonneneSpiele - a.stats.gewonneneSpiele
    );
  } else if (sortMode === 'placement') {
    const rankMap = getRankingPositionMap('points');
    withStats.sort((a, b) =>
      getPlacementAdjustedRank(a, rankMap) - getPlacementAdjustedRank(b, rankMap) ||
      b.stats.punkte - a.stats.punkte ||
      b.stats.spielDiff - a.stats.spielDiff ||
      b.stats.gewonneneSpiele - a.stats.gewonneneSpiele
    );
  } else {
    withStats.sort((a,b) =>
      b.stats.punkte     - a.stats.punkte     ||
      b.stats.spielDiff  - a.stats.spielDiff  ||
      b.stats.gewonneneSpiele - a.stats.gewonneneSpiele
    );
  }
  return withStats;
}

function renderTeamPlayers(players) {
  return players.map((player, index) => `
    ${index > 0 ? '<span class="mc-player-sep">&amp;</span>' : ''}
    <span class="mc-player-name ${isSelectedPlayer(player) ? 'viewer-player' : ''}">${player}</span>
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
  const dateA = toDateKey(a.datum) || '9999-12-31';
  const dateB = toDateKey(b.datum) || '9999-12-31';

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
  return date ? `${matchLabel} | ${date}` : matchLabel;
}

function getPendingMatchLabel(match) {
  return match.uhrzeit ? 'Terminiert' : 'Ausstehend';
}

function renderHomeMatchCard(match, options = {}) {
  const isPlayed = match.sieger !== null;
  const probability = isPlayed ? getHistoricalMatchWinProbability(match) : getMatchWinProbability(match);
  const centerMain = isPlayed
    ? String(match.saetze || '—')
    : probability ? `${probability.team1}% : ${probability.team2}%` : '—';
  const centerLabel = isPlayed ? match.ergebnis : getPendingMatchLabel(match);
  const team1Class = isPlayed
    ? match.sieger === 1 ? ' mini-match-winner' : ' mini-match-loser'
    : '';
  const team2Class = isPlayed
    ? match.sieger === 2 ? ' mini-match-winner' : ' mini-match-loser'
    : '';
  const statusClass = isPlayed ? ' mini-match-status-played' : '';

  return `<div class="mini-match-row ${isViewerMatch(match) ? 'viewer-match' : ''}">
    <div class="mini-match-meta">${formatMatchMeta(match, { relative: options.relative !== false })}</div>
    <div class="mini-match-grid">
      <div class="mini-match-team mini-match-team-1${team1Class}">${renderTeamPlayers(match.team1.spieler)}</div>
      <div class="mini-match-status${statusClass}">
        <div class="mini-match-prob">${centerMain}</div>
        <div class="mini-match-label">${centerLabel}</div>
      </div>
      <div class="mini-match-team mini-match-team-2${team2Class}">${renderTeamPlayers(match.team2.spieler)}</div>
    </div>
  </div>`;
}

function getCurrentArticle() {
  const articles = PADEL_DATA.articles || [];
  const todayKey = toDateKey(new Date());
  const current = articles.find(article => {
    if (!article.startDate && !article.endDate) return false;
    const start = article.startDate || '0000-01-01';
    const end = article.endDate || '9999-12-31';
    return start <= todayKey && todayKey <= end;
  });

  return current || articles[0];
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

function renderArticleMeta(meta) {
  const [label, ...details] = formatArticleMeta(meta).split(/\s*\|\s*/);
  return renderSplitMeta(label, details.join(' | '), 'article-meta');
}

function renderArticleCard(article) {
  return `<article class="article-card">
    ${renderArticleMeta(article.meta || `Spieltag ${article.spieltag}`)}
    <h3>${article.title}</h3>
    ${article.body ? `<div class="article-body">${article.body.map(renderArticleBlock).join('')}</div>` : ''}
  </article>`;
}

function renderArticleBlock(block) {
  if (block.type === 'h') return `<h4>${block.text}</h4>`;
  if (block.type === 'match') {
    let matchup = block.text;
    let result = block.result;
    let resultLabel = block.resultLabel || 'Ergebnis';
    if (!result) {
      [matchup, result] = block.text.split(/\s*\|\s*Ergebnis:\s*/);
      resultLabel = 'Ergebnis';
    }
    return `<div class="article-match">
      <span>${matchup}</span>
      ${result ? `<span class="article-match-result">${resultLabel}: ${result}</span>` : ''}
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

function renderHome() {
  document.getElementById('home-short-info').innerHTML = (PADEL_DATA.shortInfo || [])
    .map(item => `<li>${item}</li>`)
    .join('');

  document.getElementById('home-articles').innerHTML = `
    <div class="home-article-preview" id="home-article-preview">
      ${getCurrentArticle() ? renderArticleCard(getCurrentArticle()) : '<div class="empty-state">Noch keine Artikel für diese Saison.</div>'}
    </div>
    <button class="text-link article-readmore" id="article-readmore" data-expand-home-article>Weiterlesen</button>
  `;

  document.getElementById('home-ranking').innerHTML = getRankedPlayers().slice(0, 4)
    .map((p, i) => {
      const spielDiffStr = p.stats.partien > 0 ? formatStatDiff(p.stats.spielDiff) : '—';
      const spielDiffClass = getStatDiffClass(p.stats.spielDiff);

      return `<div class="mini-rank-row r${i + 1} ${isSelectedPlayer(p.name) ? 'viewer-highlight' : ''}">
      <span class="mini-rank-pos">${i + 1}</span>
      <span class="mini-rank-name">${p.name}</span>
      <span class="mini-rank-values">
        <span class="mini-rank-games">${p.stats.partien}</span>
        <span class="mini-rank-points">${p.stats.punkte}</span>
        <span class="mini-rank-diff ${p.stats.partien > 0 ? spielDiffClass : 'neu'}">${spielDiffStr}</span>
      </span>
    </div>`;
    })
    .join('');

  const todayKey = toDateKey(new Date());
  const nextMatches = PADEL_DATA.matches
    .filter(m => m.sieger === null && m.uhrzeit && toDateKey(m.datum) >= todayKey)
    .sort(compareMatchesByDateTime)
    .slice(0, 3);
  const allMatchesPlayed = PADEL_DATA.matches.every(match => match.sieger !== null);
  const emptyNextMatchesText = allMatchesPlayed
    ? 'Alle Partien sind gespielt.'
    : 'Keine weiteren Partien terminiert.';

  document.getElementById('home-next-matches').innerHTML = nextMatches.length
    ? nextMatches.map(match => renderHomeMatchCard(match)).join('')
    : `<div class="empty-state">${emptyNextMatchesText}</div>`;

  const playedMatches = PADEL_DATA.matches.filter(match => match.sieger !== null);
  const recentMatches = playedMatches
    .filter(match => match.sieger !== null && match.ergebnis)
    .sort(compareMatchesByDateTimeDesc)
    .slice(0, 3);
  const emptyRecentMatchesText = playedMatches.length === 0
    ? 'Noch keine Partien gespielt.'
    : 'Noch keine Partien mit Ergebnis.';

  document.getElementById('home-recent-matches').innerHTML = recentMatches.length
    ? recentMatches.map(match => renderHomeMatchCard(match)).join('')
    : `<div class="empty-state">${emptyRecentMatchesText}</div>`;
}

function renderStatTeamPlayers(players) {
  return `<span class="stat-team-players">${renderTeamPlayers(players)}</span>`;
}

function getWinnerTeam(match) {
  if (match.sieger === 1) return match.team1.spieler;
  if (match.sieger === 2) return match.team2.spieler;
  return [];
}

function getWinnerProbability(match) {
  const probability = getHistoricalMatchWinProbability(match);
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

function getNormalizedWinnerSetAverages() {
  const setTotals = [
    { winnerGames: 0, loserGames: 0, count: 0 },
    { winnerGames: 0, loserGames: 0, count: 0 }
  ];
  const matchDiffs = [];
  const playedMatches = PADEL_DATA.matches
    .filter(countsForRanking)
    .filter(match => match.sieger !== null && match.ergebnis);

  playedMatches.forEach(match => {
    const regularResult = String(match.ergebnis).split('–')[0];
    const sets = regularResult
      .split(',')
      .map(parseRegularSetScore)
      .filter(Boolean)
      .slice(0, 2);

    sets.forEach(([team1Games, team2Games], index) => {
      const winnerGames = match.sieger === 1 ? team1Games : team2Games;
      const loserGames = match.sieger === 1 ? team2Games : team1Games;

      setTotals[index].winnerGames += winnerGames;
      setTotals[index].loserGames += loserGames;
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
  return PADEL_DATA.matches
    .filter(countsForRanking)
    .filter(match => match.sieger !== null)
    .map(match => ({
      match,
      probability: getHistoricalMatchWinProbability(match)
    }))
    .filter(item => item.probability);
}

function renderFavoriteCheck() {
  const matches = getPlayedMatchesWithProbability()
    .filter(({ probability }) => probability.team1 !== probability.team2);

  if (!matches.length) {
    document.getElementById('favorite-check').innerHTML = '<div class="empty-state">Noch keine Favoriten-Daten.</div>';
    return;
  }

  const favoriteWins = matches.filter(({ match, probability }) => {
    const favorite = probability.team1 > probability.team2 ? 1 : 2;
    return match.sieger === favorite;
  }).length;
  const favoriteRate = Math.round((favoriteWins / matches.length) * 100);

  document.getElementById('favorite-check').innerHTML = `
    <div class="stat-main">${favoriteRate}%</div>
    <div class="stat-copy">Favoriten gewannen ${favoriteWins} von ${matches.length} Partien.</div>
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
    placement: 'Platzierungsfaktor'
  };
  const labels = getRankingDeviationLabels(targetId);
  const { up, down } = getRankingDeviationGroups(fromMode, toMode, topDirection);
  const renderShiftItem = item => `<div class="stat-shift-item">
    <div class="stat-shift-head">
      <span class="stat-shift-name ${isSelectedPlayer(item.player.name) ? 'viewer-player' : ''}">${item.player.name}</span>
      <span class="stat-shift-value ${getDeltaClass(item.delta)}">${formatSignedInteger(item.delta)}</span>
    </div>
    <div class="stat-meta-line">${toMode === 'elo'
      ? `${modeLabels[toMode]} #${item.toRank} -> ${modeLabels[fromMode]} #${item.fromRank}`
      : `${modeLabels[fromMode]} #${item.fromRank} -> ${modeLabels[toMode]} #${item.toRank}`}</div>
  </div>`;

  target.innerHTML = `
    <div class="stat-shift-groups">
      <div class="stat-shift-group">
        <div class="stat-shift-label">${escapeHtml(labels.top)}</div>
        <div class="stat-shift-list">${up.length ? up.map(renderShiftItem).join('') : '<div class="empty-state">Keine Aufsteiger.</div>'}</div>
      </div>
      <div class="stat-shift-group">
        <div class="stat-shift-label">${escapeHtml(labels.bottom)}</div>
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

  const forecast = getFinalFourForecast().slice(0, 4);
  const openMatches = PADEL_DATA.matches
    .filter(countsForRanking)
    .filter(match => match.sieger === null).length;

  target.innerHTML = forecast.length
    ? `${forecast.map((item, index) => `
      <div class="mini-rank-row r${index + 1}">
        <span class="mini-rank-pos">${index + 1}</span>
        <div>
          <div class="mini-rank-name ${isSelectedPlayer(item.player.name) ? 'viewer-player' : ''}">${escapeHtml(item.player.name)}</div>
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

function getPlayerAverageMatchTime(player) {
  const times = getPlayerMatches(player)
    .filter(countsForRanking)
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

  const playerTimes = PADEL_DATA.players
    .map(getPlayerAverageMatchTime)
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
        <div class="stat-shift-label">Früher Vogel</div>
        <div class="stat-time-row">
          <div class="stat-time-text">
            <div class="mini-rank-name ${isSelectedPlayer(earliest.player.name) ? 'viewer-player' : ''}">${escapeHtml(earliest.player.name)}</div>
            <div class="stat-meta-line">Ø aus ${earliest.count} Partien</div>
          </div>
          <span class="stat-split-value">${formatAverageMatchTime(earliest.averageMinutes)}</span>
        </div>
      </div>
      <div class="stat-shift-group">
        <div class="stat-shift-label">Langschläfer</div>
        <div class="stat-time-row">
          <div class="stat-time-text">
            <div class="mini-rank-name ${isSelectedPlayer(latest.player.name) ? 'viewer-player' : ''}">${escapeHtml(latest.player.name)}</div>
            <div class="stat-meta-line">Ø aus ${latest.count} Partien</div>
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

  const dominantPlayers = PADEL_DATA.players
    .map(player => {
      const stats = getPlayerStats(player);
      return {
        player,
        stats,
        averageDiff: stats.partien > 0 ? stats.spielDiff / stats.partien : null
      };
    })
    .filter(item => Number.isFinite(item.averageDiff))
    .sort((a, b) =>
      b.averageDiff - a.averageDiff ||
      b.stats.spielDiff - a.stats.spielDiff ||
      b.stats.partien - a.stats.partien ||
      a.player.name.localeCompare(b.player.name, 'de')
    )
    .slice(0, 3);

  target.innerHTML = dominantPlayers.length
    ? dominantPlayers.map((item, index) => `
      <div class="mini-rank-row r${index + 1}">
        <span class="mini-rank-pos">${index + 1}</span>
        <div>
          <div class="mini-rank-name ${isSelectedPlayer(item.player.name) ? 'viewer-player' : ''}">${escapeHtml(item.player.name)}</div>
          <div class="stat-meta-line">${formatSignedDecimal(item.averageDiff)} Spiele pro Partie · ${formatStatDiff(item.stats.spielDiff)} gesamt</div>
        </div>
      </div>
    `).join('')
    : '<div class="empty-state">Noch keine gespielten Partien.</div>';
}

function renderDominantMatches() {
  const dominantMatches = PADEL_DATA.matches
    .filter(countsForRanking)
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
        <span class="mini-rank-pos">${index + 1}</span>
        <div>
          <div class="mini-rank-name">${renderStatTeamPlayers(getWinnerTeam(item.match))}</div>
          <div class="stat-meta-line">${formatMatchNumberLabel(item.match)} · ${formatWinnerResult(item.match)} · +${item.gameStats.diff}</div>
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
        <span class="mini-rank-pos">${index + 1}</span>
        <div>
          <div class="mini-rank-name">${renderStatTeamPlayers(getWinnerTeam(item.match))}</div>
          <div class="stat-meta-line">${formatMatchNumberLabel(item.match)} · nur ${item.winnerProbability}% Siegchance</div>
        </div>
      </div>
    `).join('')
    : '<div class="empty-state">Noch kein Außenseiter-Sieg.</div>';
}

function renderStatistik() {
  renderFavoriteCheck();
  renderDominantMatches();
  renderBiggestUpsets();
  renderAverageSetScoreFact();
  renderRankingDeviationFact('stats-elo-points-deviation', 'points', 'elo', 'positive');
  renderRankingDeviationFact('stats-points-placement-deviation', 'points', 'placement', 'positive');
  renderFinalFourForecast();
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
    <h3>${group.title}</h3>
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
  const note = section.note ? `<p class="info-note">${section.note}</p>` : '';

  return `<article class="info-card info-anchor" id="${id}">
    <h2>${section.title}</h2>
    ${intro}
    ${paragraphs}
    ${groups}
    ${table}
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
    ...PADEL_INFO.sections.map(section => ({ id: sectionId(section.title), title: section.title })),
    { id: 'artikel', title: 'Artikel' },
    ...articles.map(article => ({
      id: `artikel-${article.spieltag}`,
      title: getInfoArticleMenuTitle(article),
      sub: true
    }))
  ];

  document.getElementById('info-menu').innerHTML = sectionLinks
    .map(link => `<a href="#${link.id}" class="${link.sub ? 'is-sub' : ''}">${link.title}</a>`)
    .join('');

  const shortInfo = `<article class="info-card info-anchor" id="kurzinfo">
    <h2>Kurzinfo</h2>
    <ul class="clean-list">${(PADEL_DATA.shortInfo || []).map(item => `<li>${item}</li>`).join('')}</ul>
  </article>`;

  const articleSection = `<section class="info-article-section info-anchor" id="artikel">
    <div class="sh info-article-heading">
      <div class="sh-title">ARTIKEL</div>
      <div class="sh-meta">Archiv</div>
    </div>
    <div class="info-articles-stack">
      ${articles.length ? articles.map(renderInfoArticle).join('') : '<article class="info-card"><div class="empty-state">Noch keine Artikel für diese Saison.</div></article>'}
    </div>
  </section>`;

  document.getElementById('info-sections').innerHTML = [
    shortInfo,
    ...PADEL_INFO.sections.map(section => renderInfoSection(section, sectionId(section.title))),
    articleSection
  ].join('');
}

// ── MATCHES ───────────────────────────────────────────────────────
function renderMatchRow(m) {
  if (m.sieger === null) {
    const probability = getMatchWinProbability(m);
    const probabilityHtml = probability
      ? `<div class="mc-prob">${probability.team1}% : ${probability.team2}%</div>`
      : '';
    return `<div class="mc pending ${isViewerMatch(m) ? 'viewer-match' : ''}">
      <div class="mc-meta"><span class="mc-nr">${formatMatchMeta(m, { relative: true })}</span></div>
      <div class="mc-team mc-team-1">
        <div class="mc-players">${renderTeamPlayers(m.team1.spieler)}</div>
      </div>
      <div class="mc-score">
        ${probabilityHtml}
        <div class="mc-pending-label">${getPendingMatchLabel(m)}</div>
      </div>
      <div class="mc-team mc-team-2">
        <div class="mc-players">${renderTeamPlayers(m.team2.spieler)}</div>
      </div>
    </div>`;
  }

  const t1w = m.sieger === 1, t2w = m.sieger === 2;
  const [s1, s2] = String(m.saetze || '').split(':');
  const scoreMain = isSingleSetMatch(m) ? (m.ergebnis || '—') : `${s1}:${s2}`;
  const scoreDetail = isSingleSetMatch(m) ? '' : `<div class="mc-score-detail">${m.ergebnis}</div>`;
  const viewerInT1 = isParticipantView() && m.team1.spieler.includes(getSelectedViewer().name);
  const viewerInT2 = isParticipantView() && m.team2.spieler.includes(getSelectedViewer().name);
  const viewerWon  = (viewerInT1 && m.sieger === 1) || (viewerInT2 && m.sieger === 2);
  const viewerLost = (viewerInT1 && m.sieger === 2) || (viewerInT2 && m.sieger === 1);
  const viewerResultClass = viewerWon ? 'viewer-win' : viewerLost ? 'viewer-loss' : '';
  const probability = countsForRanking(m) ? getHistoricalMatchWinProbability(m) : null;
  const leftProbability = probability ? `<span class="mc-result-prob">${probability.team1}%</span>` : '';
  const rightProbability = probability ? `<span class="mc-result-prob">${probability.team2}%</span>` : '';
  const playerNames = new Map((window.PADEL_PLAYERS || []).map(player => [player.id, player.name]));
  const eloHtml = Array.isArray(m.eloChanges) && m.eloChanges.length
    ? `<div class="mc-elo-changes">${m.eloChanges
        .sort((first, second) => first.playerId.localeCompare(second.playerId))
        .map(change => `<span><strong>${escapeHtml(playerNames.get(change.playerId) || change.playerId)}</strong> ${change.oldElo} → ${change.newElo} <em>${change.delta >= 0 ? '+' : ''}${change.delta}</em></span>`)
        .join('')}</div>`
    : '';

  return `<div class="mc played ${isViewerMatch(m) ? `viewer-match ${viewerResultClass}` : ''}">        <div class="mc-meta"><span class="mc-nr">${formatMatchMeta(m, { relative: true })}</span></div>
    <div class="mc-team mc-team-1 ${t1w?'win':''}">
      <div class="mc-players">${renderTeamPlayers(m.team1.spieler)}</div>
    </div>
    <div class="mc-score">
      <div class="mc-result-row">
        ${leftProbability}
        <div class="mc-score-main">${scoreMain}</div>
        ${rightProbability}
      </div>
      ${scoreDetail}
    </div>
    <div class="mc-team mc-team-2 ${t2w?'win':''}">
      <div class="mc-players">${renderTeamPlayers(m.team2.spieler)}</div>
    </div>
    ${eloHtml}
  </div>`;
}

function renderMatchdayGroup(spieltag, matches) {
  if (!matches.length) return '';

  return `<div class="spieltag-group">
    ${formatMatchdayLabel(spieltag)}
    <div class="match-list">${matches.map(renderMatchRow).join('')}</div>
  </div>`;
}

function renderFinalFourGroup(matches) {
  if (!matches.length) return '';

  const title = getMatchdayInfo(matches[0].spieltag)?.title || 'Final Four';
  const played = matches.filter(match => match.sieger !== null).length;
  return `<div class="spieltag-group final-four-group">
    <div class="sh final-four-heading">
      <div class="sh-heading">
        <div class="sh-title">${title.toUpperCase()}</div>
        <div class="sh-meta">${played}/${matches.length}</div>
      </div>
    </div>
    <div class="match-list">${matches.map(renderMatchRow).join('')}</div>
  </div>`;
}

function renderPartien() {
  updateMatchScopeToggle();
  const regularMatches = PADEL_DATA.matches.filter(countsForRanking);
  const finalFourMatches = PADEL_DATA.matches
    .filter(m => !countsForRanking(m))
    .sort(compareMatchesByNumber);
  const spieltage = [...new Set(regularMatches.map(m => m.spieltag))].sort((a,b)=>a-b);
  const played = regularMatches.filter(m => m.sieger !== null).length;
  document.getElementById('sp-meta').textContent = `${played}/${regularMatches.length}`;

  const regularHtml = spieltage.map(st => {
    const matches = regularMatches
      .filter(m => m.spieltag === st)
      .filter(m => matchScope !== 'open' || m.sieger === null)
      .filter(m => matchScope !== 'mine' || isViewerMatch(m))
      .sort(compareMatchesByNumber);
    return renderMatchdayGroup(st, matches);
  }).join('');
  const finalFourHtml = renderFinalFourGroup(finalFourMatches);
  const spielplanHtml = [regularHtml, finalFourHtml].filter(Boolean).join('');

  document.getElementById('spielplan').innerHTML = spielplanHtml || '<div class="empty-state">Keine Partien für diese Auswahl.</div>';
}

// ── CALCULATOR ────────────────────────────────────────────────────
function getOpenMatches() {
  return PADEL_DATA.matches
    .filter(match => match.sieger === null)
    .filter(countsForRanking)
    .sort(compareMatchesByNumber);
}

function getBetterSingleEloTeam(match) {
  const playersByName = new Map(PADEL_DATA.players.map(p => [p.name, p]));
  const maxTeamElo = names => Math.max(...names.map(name => {
    const player = playersByName.get(name);
    const elo = player ? getLatestPlayerEloValue(player) : null;
    return Number.isFinite(elo) ? elo : -Infinity;
  }));
  return maxTeamElo(match.team2.spieler) > maxTeamElo(match.team1.spieler) ? 2 : 1;
}

function getAutoTipEntryForMatch(match) {
  const probability = getMatchWinProbability(match);
  if (!probability) return null;

  let winner;
  let favorite;
  if (probability.team1 > probability.team2) {
    winner = 1; favorite = probability.team1;
  } else if (probability.team2 > probability.team1) {
    winner = 2; favorite = probability.team2;
  } else {
    winner = getBetterSingleEloTeam(match); favorite = 50;
  }

  // Scoreline aus Sicht des Gewinners: [Gewinner, Verlierer]
  let winSet1, winSet2, winTb;
  if (favorite >= 80) {
    winSet1 = [6, 0]; winSet2 = [6, 0]; winTb = null;          // maximal dominant
  } else if (favorite >= 70) {
    winSet1 = [6, 1]; winSet2 = [6, 1]; winTb = null;          // sehr einseitig
  } else if (favorite >= 63) {
    winSet1 = [6, 2]; winSet2 = [6, 2]; winTb = null;          // sehr deutlich
  } else if (favorite >= 58) {
    winSet1 = [6, 3]; winSet2 = [6, 3]; winTb = null;          // solide Favoritenrolle
  } else if (favorite >= 54) {
    winSet1 = [6, 4]; winSet2 = [6, 4]; winTb = null;          // knapp in zwei Sätzen
  } else {
    winSet1 = [6, 4]; winSet2 = [4, 6]; winTb = [10, 8];       // knapp im Match-Tiebreak
  }

  const toTeams = pair => winner === 1
    ? [String(pair[0]), String(pair[1])]
    : [String(pair[1]), String(pair[0])];

  return {
    set1: toTeams(winSet1),
    set2: toTeams(winSet2),
    tb: winTb ? toTeams(winTb) : ['', '']
  };
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

function deactivateCalculatorAutoTip() {
  if (!calculatorAutoTip) return;
  calculatorAutoTip = false;
  updateCalculatorAutoTipUi();
}

function getCalculatorEntry(matchId) {
  if (!calculatorResults.has(matchId)) {
    calculatorResults.set(matchId, {
      set1: ['', ''],
      set2: ['', ''],
      tb: ['', '']
    });
  }

  return calculatorResults.get(matchId);
}

function getCalculatorPair(entry, part) {
  return Array.isArray(entry?.[part]) ? entry[part] : ['', ''];
}

function parseCalculatorScorePair(rawTeam1, rawTeam2) {
  const rawValues = [rawTeam1, rawTeam2].map(value => String(value ?? '').trim());
  if (!rawValues[0] && !rawValues[1]) return { empty: true };
  if (!rawValues[0] || !rawValues[1]) return { invalid: true, message: 'Score unvollständig' };

  const values = rawValues.map(Number);
  if (values.some(value => !Number.isInteger(value) || value < 0)) {
    return { invalid: true, message: 'Nur ganze Zahlen ab 0' };
  }

  if (values[0] === values[1]) return { invalid: true, message: 'Gewinner notwendig' };

  return { team1: values[0], team2: values[1], winner: values[0] > values[1] ? 1 : 2 };
}

function validateRegularSet(rawTeam1, rawTeam2) {
  const score = parseCalculatorScorePair(rawTeam1, rawTeam2);
  if (score.empty || score.invalid) return score;

  const winnerScore = Math.max(score.team1, score.team2);
  const loserScore = Math.min(score.team1, score.team2);
  const isValid = (winnerScore === 6 && loserScore <= 4) ||
    (winnerScore === 7 && (loserScore === 5 || loserScore === 6));

  if (!isValid) {
    return { invalid: true, message: '6:X, 7:5 oder 7:6 eintragen' };
  }

  return score;
}

function validateMatchTiebreak(rawTeam1, rawTeam2) {
  const score = parseCalculatorScorePair(rawTeam1, rawTeam2);
  if (score.empty || score.invalid) return score;

  const winnerScore = Math.max(score.team1, score.team2);
  const loserScore = Math.min(score.team1, score.team2);

  if (winnerScore < 10 || winnerScore - loserScore < 2) {
    return { invalid: true, message: 'Match-Tiebreak bis mind. 10 mit 2 Pkt. Abstand' };
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
  deactivateCalculatorAutoTip();
  setActiveCalculatorMatch(input.dataset.calculatorMatchId, false);
  const entry = getCalculatorEntry(input.dataset.calculatorMatchId);
  const part = input.dataset.calculatorPart;
  const teamIndex = Number(input.dataset.calculatorTeam);
  const value = input.value.replace(/[^\d]/g, '').slice(0, 2);

  input.value = value;
  entry[part][teamIndex] = value;
  initializeCalculatorPairDefaults(input.dataset.calculatorMatchId, part, teamIndex);
  renderCalculatorMatchStatus(input.dataset.calculatorMatchId);
  renderCalculatorRanking();
}

function clearCalculatorScoreInput(input) {
  if (!input.value) return;

  deactivateCalculatorAutoTip();
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
  if (!entry[part][changedTeamIndex]) return;

  const otherTeamIndex = changedTeamIndex === 0 ? 1 : 0;
  if (entry[part][otherTeamIndex] !== '') return;

  entry[part][otherTeamIndex] = '0';
  const otherInput = document.querySelector(
    `[data-calculator-score][data-calculator-match-id="${CSS.escape(matchId)}"][data-calculator-part="${CSS.escape(part)}"][data-calculator-team="${otherTeamIndex}"]`
  );
  if (otherInput) otherInput.value = '0';
}

function stepCalculatorScore(button) {
  deactivateCalculatorAutoTip();
  const matchId = button.dataset.calculatorMatchId;
  setActiveCalculatorMatch(matchId, false);
  const part = button.dataset.calculatorPart;
  const teamIndex = Number(button.dataset.calculatorTeam);
  const delta = Number(button.dataset.calculatorStep);
  const entry = getCalculatorEntry(matchId);
  const current = Number(entry[part][teamIndex]);
  const nextValue = Math.max(0, (Number.isFinite(current) ? current : 0) + delta);
  const value = String(nextValue).slice(0, 2);
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

  deactivateCalculatorAutoTip();
  const entry = getCalculatorEntry(matchId);
  const winnerScores = winnerTeamIndex === 0 ? ['6', '2'] : ['2', '6'];

  entry.set1 = [...winnerScores];
  entry.set2 = [...winnerScores];
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
  document.querySelectorAll('.calculator-score-pair-active').forEach(element => {
    element.classList.remove('calculator-score-pair-active');
  });

  if (scorePair) scorePair.classList.add('calculator-score-pair-active');
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
  return `<div class="calculator-score-field" aria-label="${escapeHtml(formatMatchNumberLabel(match))} ${escapeHtml(label)}">
    <button
      type="button"
      class="calculator-step"
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
      value="${escapeHtml(value)}"
      data-calculator-score
      data-calculator-match-id="${escapeHtml(match.id)}"
      data-calculator-part="${part}"
      data-calculator-team="${teamIndex}"
      aria-label="${escapeHtml(formatMatchNumberLabel(match))} ${escapeHtml(label)}"
    >
    <button
      type="button"
      class="calculator-step"
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

function renderCalculatorLiveInner(match) {
  const probability = getMatchWinProbability(match);

  // Sobald getippt wird: durchgehend laufender Satzstand (0:0 → 1:0/0:1 → …),
  // Wahrscheinlichkeit links/rechts daneben (wie die Partien-Cards).
  if (isCalculatorEntryStarted(match)) {
    const standing = getCalculatorSetStanding(match);
    const left = probability ? `<span class="mc-result-prob">${probability.team1}%</span>` : '';
    const right = probability ? `<span class="mc-result-prob">${probability.team2}%</span>` : '';
    return `<div class="mc-result-row">${left}<div class="mc-score-main">${escapeHtml(standing)}</div>${right}</div>`;
  }

  // Ohne Tipp: kombinierte Wahrscheinlichkeit als Hauptzeile.
  const probLabel = probability ? `${probability.team1}% : ${probability.team2}%` : '—';
  return `<div class="mc-score-main ${probability ? 'calculator-probability' : ''}">${escapeHtml(probLabel)}</div>`;
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

  return `<article class="calculator-match-card ${result.match ? 'calculator-match-complete' : ''} ${isViewerMatch(match) ? 'viewer-match' : ''} ${activeCalculatorMatchId === match.id ? 'calculator-match-active' : ''}" data-calculator-match-card="${escapeHtml(match.id)}">
    <div class="calculator-match-head">
      <div class="calculator-match-meta">${formatMatchNumberLabel(match)}</div>
      ${renderCalculatorMatchStatusHtml(match)}
    </div>
    <div class="calculator-match-teams">
      <div class="calculator-match-team" role="button" tabindex="0" data-calculator-preset-team="0" data-calculator-match-id="${escapeHtml(match.id)}">${renderTeamPlayers(match.team1.spieler)}</div>
      ${renderCalculatorLiveResultHtml(match)}
      <div class="calculator-match-team calculator-match-team-2" role="button" tabindex="0" data-calculator-preset-team="1" data-calculator-match-id="${escapeHtml(match.id)}">${renderTeamPlayers(match.team2.spieler)}</div>
    </div>
    <div class="calculator-score-line">
      <div class="calculator-score-pair">
        ${renderCalculatorScoreInput(match, 'set1', 0, 'Team 1 Satz 1', set1[0])}
        <span>:</span>
        ${renderCalculatorScoreInput(match, 'set1', 1, 'Team 2 Satz 1', set1[1])}
      </div>
      <span class="calculator-set-separator">|</span>
      <div class="calculator-score-pair">
        ${renderCalculatorScoreInput(match, 'set2', 0, 'Team 1 Satz 2', set2[0])}
        <span>:</span>
        ${renderCalculatorScoreInput(match, 'set2', 1, 'Team 2 Satz 2', set2[1])}
      </div>
    </div>
    <div class="calculator-tiebreak-line" id="calculator-tiebreak-${match.id}" ${result.showTiebreak ? '' : 'hidden'}>
      <span class="calculator-score-pair">
        ${renderCalculatorScoreInput(match, 'tb', 0, 'Team 1 Match-Tiebreak', tb[0])}
        <span>:</span>
        ${renderCalculatorScoreInput(match, 'tb', 1, 'Team 2 Match-Tiebreak', tb[1])}
      </span>
    </div>
  </article>`;
}

function renderCalculatorRanking() {
  const body = document.getElementById('calculator-ranking-body');
  if (!body) return;

  const previousRankingPositions = getCalculatorRowPositions(body, '.calculator-ranking-row');
  const miniRanking = document.getElementById('calculator-mini-ranking');
  const previousMiniPositions = getCalculatorRowPositions(miniRanking, '.calculator-mini-rank-row');
  const rankedPlayers = getRankedPlayers(getCalculatorSimulatedMatches());
  const activePlayerIds = getActiveCalculatorPlayerIds();

  renderCalculatorMiniRanking(rankedPlayers, previousMiniPositions, activePlayerIds);
  body.innerHTML = rankedPlayers.map((player, index) => {
    const diffStr = player.stats.partien > 0 ? formatStatDiff(player.stats.spielDiff) : '—';
    const diffClass = getStatDiffClass(player.stats.spielDiff);
    const activeMatchClass = activePlayerIds.has(player.id) ? 'calculator-active-match-player' : '';

    return `<tr class="calculator-ranking-row r${Math.min(index + 1, 4)} ${index < 4 ? 'top-four-highlight' : ''} ${activeMatchClass} ${isSelectedPlayer(player.name) ? 'viewer-highlight' : ''}" data-calculator-player="${escapeHtml(player.id)}">
      <td class="rn l">${index + 1}</td>
      <td class="l"><span class="pname">${player.name}</span></td>
      <td class="num-val">${player.stats.partien}</td>
      <td class="punkte-val">${player.stats.punkte}</td>
      <td class="num-val"><span class="${player.stats.partien > 0 ? diffClass : 'neu'}">${diffStr}</span></td>
    </tr>`;
  }).join('');
  animateCalculatorRows(body, '.calculator-ranking-row', previousRankingPositions);
}

function renderCalculatorMiniRanking(rankedPlayers, previousPositions = null, activePlayerIds = new Set()) {
  const miniRanking = document.getElementById('calculator-mini-ranking');
  if (!miniRanking) return;

  miniRanking.innerHTML = rankedPlayers.map((player, index) => {
    const activeMatchClass = activePlayerIds.has(player.id) ? 'calculator-active-match-player' : '';
    return `
    <div class="calculator-mini-rank-row ${index < 4 ? 'top-four-highlight' : ''} ${activeMatchClass} ${isSelectedPlayer(player.name) ? 'viewer-highlight' : ''}" data-calculator-player="${escapeHtml(player.id)}">
      <span class="calculator-mini-rank-pos">${index + 1}</span>
      <span class="calculator-mini-rank-initials">${escapeHtml(player.initials || player.name)}</span>
    </div>`;
  }).join('');
  animateCalculatorRows(miniRanking, '.calculator-mini-rank-row', previousPositions);
}

function getCalculatorRowPositions(container, rowSelector) {
  if (!container) return null;

  return new Map([...container.querySelectorAll(rowSelector)]
    .map(row => [row.dataset.calculatorPlayer, row.getBoundingClientRect().top])
    .filter(([playerId, top]) => playerId && Number.isFinite(top)));
}

function animateCalculatorRows(container, rowSelector, previousPositions) {
  if (!container || !previousPositions?.size) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  container.querySelectorAll(rowSelector).forEach(row => {
    const previousTop = previousPositions.get(row.dataset.calculatorPlayer);
    if (!Number.isFinite(previousTop)) return;

    const currentTop = row.getBoundingClientRect().top;
    const deltaY = previousTop - currentTop;
    if (Math.abs(deltaY) < 1) return;

    row.style.transition = 'none';
    row.style.transform = `translateY(${deltaY}px)`;
    row.getBoundingClientRect();

    requestAnimationFrame(() => {
      row.style.transition = 'transform 520ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      row.style.transform = 'translateY(0)';

      window.setTimeout(() => {
        row.style.transition = '';
        row.style.transform = '';
      }, 540);
    });
  });
}

function renderCalculator() {
  const matchContainer = document.getElementById('calculator-matches');
  if (!matchContainer) return;

  const openMatches = getOpenMatches();
  matchContainer.innerHTML = openMatches.length
    ? openMatches.map(renderCalculatorMatchCard).join('')
    : '<div class="empty-state">Keine offenen Partien.</div>';
  syncCalculatorActiveMatchCard();
  updateCalculatorAutoTipUi();
  renderCalculatorRanking();
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
  });
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
  return renderSplitMeta(label, details.join(' | '), 'spieltag-label');
}

// ── CHART ─────────────────────────────────────────────────────────
const COLORS = [
  '#6EF79C',
  '#C96EF7',
  '#F7F76E',
  '#6EC9F7',
  '#F76E9C',
  '#6EF76E',
  '#9C6EF7',
  '#F7C96E',
  '#6EF7F7',
  '#F76EC9',
  '#9CF76E',
  '#6E6EF7',
  '#F79C6E',
  '#6EF7C9',
  '#F76EF7',
  '#C9F76E',
  '#6E9CF7',
  '#F76E6E'
];
const GRAY = '#444444';
const CHART_DIM_ALPHA = 'D6';
const CHART_GRAY_MIX = 0.28;

let chart = null;
let placementChart = null;
let activeP = new Set();

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

function dimChartColor(color) {
  if (typeof color === 'string' && color.startsWith('#') && color.length === 7) {
    return `${blendHexColors(color, GRAY, CHART_GRAY_MIX)}${CHART_DIM_ALPHA}`;
  }

  return color;
}

function getEloChartColor(color, playerName) {
  return isParticipantView() && getSelectedViewer().name !== playerName
    ? dimChartColor(color)
    : color;
}

function getEloChartLineWidth(playerName) {
  return isParticipantView() && getSelectedViewer().name === playerName ? 3 : 1;
}

function getPlacementLabelWeight(playerName) {
  return isParticipantView() && getSelectedViewer().name === playerName ? 700 : 300;
}

function getPlacementLabelColor(playerName, color) {
  return isParticipantView() && getSelectedViewer().name !== playerName
    ? dimChartColor(color)
    : color;
}

function getPlacementChartColor(color, playerName) {
  return isParticipantView() && getSelectedViewer().name !== playerName
    ? dimChartColor(color)
    : color;
}

function getPlacementChartLineWidth(playerName) {
  return isParticipantView() && getSelectedViewer().name === playerName ? 3 : 1;
}

function updateChartViewerFocus() {
  if (chart) {
    chart.data.datasets.forEach((dataset, index) => {
      const player = PADEL_DATA.players[index];
      const color = getEloChartColor(COLORS[index], player.name);
      dataset.borderColor = color;
      dataset.pointBackgroundColor = color;
      dataset.pointBorderColor = color;
      dataset.pointHoverBackgroundColor = color;
      dataset.pointHoverBorderColor = color;
      dataset.borderWidth = getEloChartLineWidth(player.name);
    });
    chart.update();
  }

  if (placementChart) {
    placementChart.data.datasets.forEach((dataset, index) => {
      const player = PADEL_DATA.players[index];
      const color = getPlacementChartColor(COLORS[index], player.name);
      const playedFlags = dataset.playedFlags;
      dataset.borderColor = color;
      dataset.pointBackgroundColor = playedFlags.map(hasMatch => hasMatch ? color : GRAY);
      dataset.pointBorderColor = playedFlags.map(hasMatch => hasMatch ? color : GRAY);
      dataset.borderWidth = getPlacementChartLineWidth(player.name);
      dataset.segment.borderColor = ctx => getPlacementSegmentColor(ctx, playedFlags, color);
    });
    placementChart.update();
  }
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
  if (event.gameLabel === 'Start') return ['Start'];

  const dateLabel = event.match
    ? formatMatchDate(event.match)
    : new Date(event.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

  return [dateLabel, event.gameLabel];
}

function getChartEvents() {
  const events = new Map();

  PADEL_DATA.players.forEach(player => {
    (player.history || []).forEach((historyEntry, index) => {
      const date = toDateKey(historyEntry.date);
      const elo = Number(historyEntry.elo);
      if (!date || !Number.isFinite(elo)) return;

      const gameLabel = normalizeGameLabel(historyEntry.label);
      const match = historyEntry.matchId ? getMatchById(historyEntry.matchId) : null;
      const key = getHistoryEventKey(historyEntry);

      if (!events.has(key)) {
        events.set(key, {
          key,
          date,
          gameLabel,
          match,
          index,
          label: null
        });
      }
    });
  });

  return [...events.values()]
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare) return dateCompare;

      const aIsStart = a.gameLabel === 'Start';
      const bIsStart = b.gameLabel === 'Start';
      if (aIsStart !== bIsStart) return aIsStart ? -1 : 1;

      const timeCompare = (a.match ? getMatchTimeMinutes(a.match) : 0) - (b.match ? getMatchTimeMinutes(b.match) : 0);
      if (timeCompare) return timeCompare;

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

  const previousHistoryEntry = getPlayerPreviousHistoryEntry(player, historyEntry);
  const elo = Number(historyEntry.elo);
  const previousElo = previousHistoryEntry ? Number(previousHistoryEntry.elo) : null;
  const delta = previousElo === null ? null : elo - previousElo;

  return {
    elo,
    delta: formatEloDelta(delta),
    deltaClass: getDeltaClass(delta)
  };
}

function formatStatDiff(diff) {
  if (!Number.isFinite(diff)) return '—';
  return diff >= 0 ? `+${diff}` : `${diff}`;
}

function getStatDiffClass(diff) {
  return getDeltaClass(diff);
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

function getOrCreateChartTooltip(chartInstance, className = 'chart-custom-tooltip') {
  const parent = chartInstance.canvas.parentNode;
  let tooltip = parent.querySelector(`.${className}`);

  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = className;
    parent.appendChild(tooltip);
  }

  return tooltip;
}

function getOrCreateFormTooltip() {
  let tooltip = document.querySelector('.form-custom-tooltip');

  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'chart-custom-tooltip form-custom-tooltip';
    document.body.appendChild(tooltip);
  }

  return tooltip;
}

function renderEloStyleTooltipItem({
  playerName,
  elo,
  delta,
  deltaClass = 'neu',
  gameLabel = '',
  matchContext = null,
  showElo = true
}) {
  return `<div class="elo-tooltip-item">
    <div class="elo-tooltip-name">${escapeHtml(playerName)}</div>
    ${showElo ? `<div class="elo-tooltip-main">Elo: ${escapeHtml(elo)} ${delta ? `<span class="elo-tooltip-delta ${deltaClass}">${escapeHtml(delta)}</span>` : ''}</div>` : ''}
    ${matchContext ? `
      <div>Ergebnis: ${escapeHtml(matchContext.result)}</div>
      <div>Mit: ${escapeHtml(matchContext.partner)}</div>
      <div>vs. ${escapeHtml(matchContext.opponents)}</div>
    ` : gameLabel ? `
      <div>${escapeHtml(gameLabel)}</div>
    ` : ''}
  </div>`;
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
  tooltipEl.style.transform = 'translate(12px, -50%)';
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
  const match = getMatchById(anchor.dataset.formMatchId);
  const playerName = anchor.dataset.formPlayer;
  const matchContext = getPlayerMatchContext(playerName, match);
  const tooltipEl = getOrCreateFormTooltip();

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
  const tooltipEl = getOrCreateChartTooltip(chartInstance);

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

      return renderEloStyleTooltipItem({
        playerName: item.dataset.label,
        elo: item.parsed.y,
        delta,
        deltaClass,
        gameLabel,
        matchContext
      });
    }).join('')}
  `;

  positionChartTooltip(chartInstance, tooltip, tooltipEl);
}

function externalPlacementTooltip(context) {
  const { chart: chartInstance, tooltip } = context;
  const tooltipEl = getOrCreateChartTooltip(chartInstance);

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
    const diffClass = getStatDiffClass(stats?.spielDiff);
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
    matchContexts: []
  };

  events.forEach(event => {
    const historyEntry = historyByEvent.get(event.key);
    if (!historyEntry) {
      series.eloValues.push(null);
      series.deltas.push(null);
      series.deltaLabels.push('');
      series.gameLabels.push('');
      series.eventTitles.push('');
      series.matchContexts.push(null);
      return;
    }

    const elo = Number(historyEntry.elo);
    const delta = previousElo === null ? null : elo - previousElo;
    previousElo = elo;

    series.eloValues.push(elo);
    series.deltas.push(delta);
    series.deltaLabels.push(formatEloDelta(delta));
    series.gameLabels.push(event.gameLabel);
    series.eventTitles.push(event.gameLabel === 'Start'
      ? 'Start'
      : event.match ? formatMatchMeta(event.match) : formatMatchDate({ datum: event.date }));
    series.matchContexts.push(getPlayerMatchContext(player.name, event.match));
  });

  return series;
}

function getPlacementSeries() {
  const matchDays = [...new Set(PADEL_DATA.matches.filter(countsForRanking).map(m => m.spieltag))].sort((a, b) => a - b);
  const placementsByPlayer = new Map(PADEL_DATA.players.map(p => [p.name, []]));
  const playedByPlayer = new Map(PADEL_DATA.players.map(p => [p.name, []]));
  const statsByPlayer = new Map(PADEL_DATA.players.map(p => [p.name, []]));

  matchDays.forEach(spieltag => {
    const matchesUntilDay = PADEL_DATA.matches.filter(m => countsForRanking(m) && m.sieger !== null && m.spieltag <= spieltag);
    const matchesAtDay = PADEL_DATA.matches.filter(m => countsForRanking(m) && m.sieger !== null && m.spieltag === spieltag);
    const ranked = getRankedPlayers(matchesUntilDay);
    ranked.forEach((player, index) => {
      placementsByPlayer.get(player.name).push(index + 1);
      statsByPlayer.get(player.name).push(player.stats);
      playedByPlayer.get(player.name).push(matchesAtDay.some(m =>
        m.team1.spieler.includes(player.name) || m.team2.spieler.includes(player.name)
      ));
    });
  });

  return { matchDays, placementsByPlayer, playedByPlayer, statsByPlayer };
}

const placementLabelPlugin = {
  id: 'placementLabelPlugin',
  afterDatasetsDraw(chartInstance) {
    const { ctx, chartArea } = chartInstance;
    ctx.save();
    ctx.textBaseline = 'middle';

    chartInstance.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chartInstance.getDatasetMeta(datasetIndex);
      if (!meta.data.length) return;

      const point = meta.data[meta.data.length - 1];
      ctx.font = `${getPlacementLabelWeight(dataset.label)} 11px DM Sans`;
      ctx.fillStyle = getPlacementLabelColor(dataset.label, dataset.baseColor || dataset.borderColor);
      ctx.fillText(dataset.label, Math.min(point.x + 8, chartArea.right + 8), point.y);
    });

    ctx.restore();
  }
};

function initChart() {
  if (chart) {
    initPlacementChart();
    return;
  }
  const chartEvents = getChartEvents();

  const datasets = PADEL_DATA.players.map((p, i) => {
    const series = getPlayerSeries(p, chartEvents);
    const color = getEloChartColor(COLORS[i], p.name);
    return {
      label: p.name,
      data: series.eloValues,
      deltas: series.deltas,
      deltaLabels: series.deltaLabels,
      gameLabels: series.gameLabels,
      eventTitles: series.eventTitles,
      matchContexts: series.matchContexts,
      borderColor: color,
      backgroundColor: 'transparent',
      pointBackgroundColor: color,
      pointBorderColor: color,
      pointHoverBackgroundColor: color,
      pointHoverBorderColor: color,
      borderWidth: getEloChartLineWidth(p.name),
      pointRadius: 4,
      pointHoverRadius: 5,
      tension: 0.3,
      spanGaps: true
    };
  });

  const ctx = document.getElementById('eloChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartEvents.map(event => new Date(event.date).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})),
      datasets
    },
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
        x: { grid: { color: '#222' }, ticks: { color: '#5a5a72', font: { family: 'DM Sans', size: 12 } } },
        y: {
          min: 600, max: 1250,
          grid: { color: '#222' },
          ticks: { color: '#5a5a72', font: { family: 'DM Sans', size: 12 } }
        }
      }
    }
  });
  initPlacementChart();
  renderFilter();
}

function getPlacementSegmentColor(context, playedFlags, color) {
  const fromPlayed = playedFlags[context.p0DataIndex];
  const toPlayed = playedFlags[context.p1DataIndex];

  if (fromPlayed && toPlayed) return color;
  if (!fromPlayed && !toPlayed) return GRAY;

  const xScale = context.chart.scales.x;
  const x0 = xScale.getPixelForValue(context.p0DataIndex);
  const x1 = xScale.getPixelForValue(context.p1DataIndex);
  const gradient = context.chart.ctx.createLinearGradient(x0, 0, x1, 0);

  gradient.addColorStop(0, fromPlayed ? color : GRAY);
  gradient.addColorStop(1, toPlayed ? color : GRAY);

  return gradient;
}

function initPlacementChart() {
  if (placementChart) return;
  const { matchDays, placementsByPlayer, playedByPlayer, statsByPlayer } = getPlacementSeries();
  const maxPlace = PADEL_DATA.players.length;
  const datasets = PADEL_DATA.players.map((p, i) => {
    const playedFlags = playedByPlayer.get(p.name);
    const color = getPlacementChartColor(COLORS[i], p.name);
    return {
      label: p.name,
      data: placementsByPlayer.get(p.name),
      playedFlags,
      statsByPoint: statsByPlayer.get(p.name),
      baseColor: COLORS[i],
      borderColor: color,
      backgroundColor: 'transparent',
      pointBackgroundColor: playedFlags.map(hasMatch => hasMatch ? color : GRAY),
      pointBorderColor: playedFlags.map(hasMatch => hasMatch ? color : GRAY),
      borderWidth: getPlacementChartLineWidth(p.name),
      pointRadius: playedFlags.map(hasMatch => hasMatch ? 3 : 0),
      pointHitRadius: playedFlags.map(hasMatch => hasMatch ? 8 : 0),
      pointHoverRadius: playedFlags.map(hasMatch => hasMatch ? 4 : 0),
      tension: 0,
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
          title: { display: true, text: 'Spieltag', color: '#a2a2b7', font: { family: 'DM Sans', size: 14, weight: '600' } },
          grid: { color: '#222' },
          ticks: { color: '#5a5a72', font: { family: 'DM Sans', size: 12 } }
        },
        y: {
          reverse: true,
          min: 0.5,
          max: maxPlace + 0.5,
          title: { display: true, text: 'Platz', color: '#a2a2b7', font: { family: 'DM Sans', size: 14, weight: '600' } },
          grid: { color: '#222' },
          ticks: {
            stepSize: 1,
            color: '#5a5a72',
            font: { family: 'DM Sans', size: 12 },
            callback: value => Number.isInteger(value) ? value : ''
          }
        }
      }
    }
  });
}

function renderFilter() {
  document.getElementById('filter-row').innerHTML = PADEL_DATA.players.map((p,i) => {
    const on = activeP.has(p.id);
    return `<button
      class="fb ${on?'on':''}"
      style="${on ? `--player-color:${COLORS[i]};` : ''}"
      data-player-toggle-id="${p.id}"
      data-player-toggle-index="${i}"
    >${p.name}</button>`;
  }).join('');
}

function toggleP(id, i, btn) {
  const ds = chart.data.datasets[i];
  ds.hidden = !ds.hidden;
  if (ds.hidden) { activeP.delete(id); btn.classList.remove('on'); btn.style = ''; }
  else { activeP.add(id); btn.classList.add('on'); btn.style = `--player-color:${COLORS[i]};`; }
  chart.update();
}

function toggleAll(on) {
  PADEL_DATA.players.forEach((p, i) => {
    chart.data.datasets[i].hidden = !on;
    if (on) activeP.add(p.id); else activeP.delete(p.id);
  });
  chart.update();
  renderFilter();
}

// ── INIT ──────────────────────────────────────────────────────────
async function initApp() {
  try {
    await loadActiveSeason();
    applySeasonMetadata();
    resetSeasonState();
    updateViewerPicker();
    renderHome();
    renderRanking();
    renderPartien();
    renderCalculator();
    renderStatistik();
    renderInfos();
    await window.PadelTippspiel?.init(PADEL_DATA);
  } catch (error) {
    document.querySelector('main').innerHTML = `<div class="empty-state">Die Saison-Daten konnten nicht geladen werden.</div>`;
    console.error(error);
  }
}

const mobileViewportQuery = window.matchMedia('(max-width: 768px)');
mobileViewportQuery.addEventListener?.('change', () => {
  if (PADEL_DATA) renderRanking();
});

initApp();
