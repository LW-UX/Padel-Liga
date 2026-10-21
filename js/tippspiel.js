(function () {
  const BEST_OF_THREE_PREDICTIONS = ['2:0', '2:1', '1:2', '0:2'];
  const SINGLE_SET_PREDICTIONS = [
    '6:0', '6:1', '6:2', '6:3', '6:4', '7:5', '7:6',
    '0:6', '1:6', '2:6', '3:6', '4:6', '5:7', '6:7'
  ];
  const LEGACY_DATABASE_SEASON_IDS = Object.freeze({
    '2026-sommer': '2026',
    '2026-winter': 'winter-2026',
    '2027-cup': 'cup-2027',
    '2026-test': 'test-2026'
  });
  const state = {
    client: null,
    season: null,
    session: null,
    profile: null,
    databaseMatches: new Map(),
    playerElos: new Map(),
    predictions: new Map(),
    matchFloorPredictions: new Map(),
    leaderboard: [],
    leaderboardReady: false,
    leaderboardError: null,
    seasonCompleted: null,
    saving: new Set(),
    ready: false,
    error: null,
    bound: false,
    sortMode: 'status'
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getPredictionLocalMatches() {
    if (!state.season) return [];
    return state.season.matches.filter(match =>
      match.team1.playerIds.length > 0 &&
      match.team2.playerIds.length > 0 &&
      state.databaseMatches.has(match.id)
    );
  }

  function getActualSets(match) {
    return state.databaseMatches.get(match.id)?.actual_sets || match.saetze || null;
  }

  function isCancelledMatch(match) {
    return Boolean(state.databaseMatches.get(match.id)?.cancelled_at || match.cancelledAt);
  }

  function getMatchFormat(match) {
    return state.databaseMatches.get(match.id)?.format || match.format || 'best-of-three';
  }

  function getPredictionOptions(match) {
    return getMatchFormat(match) === 'single-set'
      ? SINGLE_SET_PREDICTIONS
      : BEST_OF_THREE_PREDICTIONS;
  }

  function getActualPredictionValue(match) {
    if (getMatchFormat(match) !== 'single-set') return getActualSets(match);
    const resultDetails = state.databaseMatches.get(match.id)?.result_details || match.ergebnis;
    return String(resultDetails || '').match(/(\d+)\s*:\s*(\d+)/)?.slice(1, 3).join(':') || null;
  }

  function isPredictionOpen(match) {
    const databaseMatch = state.databaseMatches.get(match.id);
    if (
      isOwnMatch(match) ||
      state.season?.competition?.predictionsEnabled === false ||
      !databaseMatch ||
      databaseMatch.betting_open !== true ||
      getActualSets(match) ||
      isCancelledMatch(match)
    ) return false;
    if (!databaseMatch.match_at) return match.sieger === null && !isOutsidePreviewWindow(match);
    return match.sieger === null && new Date(databaseMatch.match_at).getTime() > Date.now();
  }

  // Neue Tipps folgen dem Fenster der vollständigen Partievorschau.
  function getPreviewWindowMatch(match) {
    const databaseMatch = state.databaseMatches.get(match.id);
    return { ...match, matchAt: databaseMatch?.match_at || null, cancelledAt: databaseMatch?.cancelled_at || match.cancelledAt };
  }

  function isOutsidePreviewWindow(match) {
    return window.PadelPreviewWindow?.availability(getPreviewWindowMatch(match), state.season) === 'basic';
  }

  function isPredictionUpcoming(match) {
    const databaseMatch = state.databaseMatches.get(match.id);
    return Boolean(
      !isOwnMatch(match) &&
      state.season?.competition?.predictionsEnabled !== false &&
      databaseMatch?.betting_open === true &&
      !databaseMatch.match_at &&
      match.sieger === null &&
      !getActualSets(match) &&
      !isCancelledMatch(match) &&
      isOutsidePreviewWindow(match)
    );
  }

  function formatPredictionOpensOn(match) {
    const opensOn = window.PadelPreviewWindow?.opensOn(getPreviewWindowMatch(match), state.season);
    if (!opensOn) return 'Tippbar näher am Spieltag';
    const label = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .format(new Date(`${opensOn}T12:00:00Z`));
    return `Tippbar ab ${label}`;
  }

  function isOwnMatch(match) {
    const authenticatedPlayerId = state.profile?.player_id;
    return Boolean(authenticatedPlayerId && [
      ...(match?.team1?.playerIds || []),
      ...(match?.team2?.playerIds || [])
    ].includes(authenticatedPlayerId));
  }

  function getPredictionWinner(value, format) {
    if (format !== 'single-set') return value?.startsWith('2') ? 1 : 2;
    const [teamOne, teamTwo] = String(value || '').split(':').map(Number);
    if (!Number.isFinite(teamOne) || !Number.isFinite(teamTwo) || teamOne === teamTwo) return null;
    return teamOne > teamTwo ? 1 : 2;
  }

  function getPredictionPoints(prediction, actualValue, format = 'best-of-three') {
    if (!prediction || !actualValue) return null;
    if (prediction === actualValue) return 4;
    const predictedTeam = getPredictionWinner(prediction, format);
    const actualTeam = getPredictionWinner(actualValue, format);
    return predictedTeam === actualTeam ? 2 : 0;
  }

  function formatMatchDate(match) {
    const databaseMatch = state.databaseMatches.get(match.id);
    const matchTime = getBerlinMatchAtParts(databaseMatch?.match_at);
    if (!matchTime.date) return '';
    const date = new Date(`${matchTime.date}T12:00:00`);
    const weekdayLabel = Number.isNaN(date.getTime())
      ? ''
      : ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][date.getDay()];
    const dateLabel = Number.isNaN(date.getTime())
      ? matchTime.date
      : new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(date);
    return `${weekdayLabel ? `${weekdayLabel}, ` : ''}${dateLabel}`;
  }

  function formatMatchdayLabel(spieltag) {
    const matchday = (state.season?.matchdays || []).find(day => day.spieltag === spieltag);
    const label = matchday?.title || `Spieltag ${spieltag}`;
    const formatDay = value => {
      const date = new Date(`${value}T12:00:00`);
      return Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
    };
    const range = matchday?.startDate && matchday?.endDate
      ? `${formatDay(matchday.startDate)} – ${formatDay(matchday.endDate)}`
      : '';
    return `<div class="spieltag-label"><span>${escapeHtml(label)}</span>${range ? `<span>${escapeHtml(range)}</span>` : ''}</div>`;
  }

  function renderMatchGroup(labelHtml, matches, renderMatch) {
    if (!matches.length) return '';
    return `<section class="prediction-match-group">${labelHtml}<div class="match-list">${matches.map(renderMatch).join('')}</div></section>`;
  }

  function renderMatchesByMatchday(matches, renderMatch) {
    const matchdays = [...new Set(matches.map(match => match.spieltag))]
      .sort((first, second) => Number(first ?? Infinity) - Number(second ?? Infinity));
    return matchdays.map(spieltag => renderMatchGroup(
      formatMatchdayLabel(spieltag),
      matches.filter(match => match.spieltag === spieltag).sort(compareMatchesByNumber),
      renderMatch
    )).join('');
  }

  function renderSortToggle() {
    document.querySelectorAll('[data-prediction-sort]').forEach(button => {
      const isActive = button.dataset.predictionSort === state.sortMode;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  function applyPlayerElos(participants = []) {
    state.playerElos = new Map(participants.map(participant => [
      participant.playerId,
      Number(participant.currentElo ?? participant.startElo)
    ]).filter(([, elo]) => Number.isFinite(elo)));
  }

  function getWeightedTeamElo(playerIds) {
    const elos = playerIds.map(playerId => state.playerElos.get(playerId));
    if (elos.length !== 2 || elos.some(elo => !Number.isFinite(elo))) return null;
    const [weakerElo, strongerElo] = [...elos].sort((left, right) => left - right);
    return weakerElo * 0.7 + strongerElo * 0.3;
  }

  function getMatchWinProbability(match) {
    const teamOneElo = getWeightedTeamElo(match.team1.playerIds);
    const teamTwoElo = getWeightedTeamElo(match.team2.playerIds);
    if (!Number.isFinite(teamOneElo) || !Number.isFinite(teamTwoElo)) return null;
    const teamOne = Math.round(100 / (1 + Math.pow(10, (teamTwoElo - teamOneElo) / 500)));
    return { team1: teamOne, team2: 100 - teamOne };
  }

  function getMatchDetailHref(match) {
    const seasonId = state.season?.id || state.season?.databaseId || '';
    return `../?saison=${encodeURIComponent(seasonId)}&partie=${encodeURIComponent(match.id)}`;
  }

  function renderMatchCenter(match, actualValue, isCancelled) {
    if (isCancelled) return '<span class="prediction-match-center prediction-match-center--result">o.W.</span>';
    const probability = actualValue ? null : getMatchWinProbability(match);
    const label = actualValue || (probability ? `${probability.team1} % : ${probability.team2} %` : '—');
    if (!actualValue && isOutsidePreviewWindow(match)) {
      return `<span class="prediction-match-center">${escapeHtml(label)}</span>`;
    }
    const ariaLabel = actualValue
      ? `Partieanalyse öffnen, Ergebnis ${actualValue.replace(':', ' zu ')}`
      : probability
        ? `Partievorschau öffnen, Gewinnwahrscheinlichkeit ${probability.team1} zu ${probability.team2} Prozent`
        : 'Partievorschau öffnen';
    const resultClass = actualValue ? ' prediction-match-center--result' : '';
    return `<a class="prediction-match-center prediction-match-center-link${resultClass}" href="${getMatchDetailHref(match)}" aria-label="${escapeHtml(ariaLabel)}">${escapeHtml(label)}</a>`;
  }

  function getStatusChip({ isCancelled, isOwn, isOpen, isUpcoming, isSaving, actualValue, selected, points }) {
    if (isCancelled) return { label: 'Ohne Wertung', classes: 'is-locked' };
    if (isOwn) return { label: 'Eigene Partie', classes: 'is-locked is-own-match' };
    if (isUpcoming) return { label: 'Noch nicht offen', classes: 'is-upcoming' };
    if (isOpen) return {
      label: isSaving ? 'Speichert …' : 'Offen',
      classes: `is-open${isSaving ? ' is-saving' : ''}`
    };
    if (actualValue && selected) {
      if (points === 4) return { label: 'Exakt · +4', classes: 'is-locked points-4' };
      if (points === 2) return { label: 'Sieger · +2', classes: 'is-locked points-2' };
      return { label: 'Falsch · 0', classes: 'is-locked points-0' };
    }
    if (actualValue || !selected) return { label: 'Kein Tipp', classes: 'is-locked' };
    return { label: 'Gesperrt', classes: 'is-locked' };
  }

  function compareMatchesByNumber(first, second) {
    const firstNumber = Number(first.id.match(/\d+$/)?.[0]);
    const secondNumber = Number(second.id.match(/\d+$/)?.[0]);
    if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber) && firstNumber !== secondNumber) {
      return firstNumber - secondNumber;
    }
    return String(first.id).localeCompare(String(second.id), 'de', { numeric: true });
  }

  function getBerlinMatchAtParts(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return { date: null, time: null };
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }

  function renderTeam(team) {
    return team.spieler
      .map((player, index) => {
        const playerId = team.playerIds?.[index];
        const isAuthenticatedPlayer = playerId === state.profile?.player_id;
        const className = `prediction-player${isAuthenticatedPlayer ? ' is-authenticated-player' : ''}`;
        if (!playerId) return `<span class="${className}">${escapeHtml(player)}</span>`;
        return `<a class="${className} player-profile-link" href="../?spielerprofil=${encodeURIComponent(playerId)}" aria-label="Profil von ${escapeHtml(player)} öffnen">${escapeHtml(player)}</a>`;
      })
      .join('<span class="mc-player-sep"> &amp; </span>');
  }

  function renderAuthHint() {
    const target = document.getElementById('prediction-auth-hint');
    if (!target) return;
    target.innerHTML = state.session
      ? `<div class="prediction-session-note"><span>Du tippst als <strong>${escapeHtml(window.PadelKonto?.getDisplayName?.() || state.session.user.email)}</strong>.</span><button class="text-link inline-link" type="button" data-auth-open>Konto öffnen</button></div>`
      : '<div class="prediction-login-hint"><div><strong>Einloggen und mittippen</strong><span>Deine Tipps werden in deinem Konto gespeichert.</span></div><button class="primary-button" type="button" data-auth-open>Login / Konto erstellen</button></div>';
  }

  function renderMatches() {
    const target = document.getElementById('prediction-matches');
    const meta = document.getElementById('prediction-meta');
    if (!target) return;

    if (state.error) {
      target.innerHTML = `<div class="prediction-error">Das Tippspiel kann gerade nicht geladen werden.<small>${escapeHtml(state.error)}</small></div>`;
      if (meta) meta.textContent = 'Verbindung nicht verfügbar';
      return;
    }

    if (!state.ready) {
      target.innerHTML = '<div class="empty-state">Offene Spiele werden geladen …</div>';
      return;
    }

    const matches = getPredictionLocalMatches();
    const openMatches = matches
      .filter(isPredictionOpen)
      .sort(compareMatchesByNumber);
    const upcomingMatches = matches
      .filter(isPredictionUpcoming)
      .sort(compareMatchesByNumber);
    const lockedMatches = matches
      .filter(match => !isPredictionOpen(match) && !isPredictionUpcoming(match))
      .sort((first, second) => compareMatchesByNumber(second, first));
    if (meta) meta.textContent = `${openMatches.length}/${matches.length} offen`;
    if (!matches.length) {
      target.innerHTML = '<div class="widget empty-state">Für diese Saison sind noch keine Spiele im Tippspiel hinterlegt.</div>';
      return;
    }

    const renderMatch = match => {
      const selected = state.predictions.get(match.id);
      const isSaving = state.saving.has(match.id);
      const isOwn = isOwnMatch(match);
      const isOpen = isPredictionOpen(match);
      const isUpcoming = isPredictionUpcoming(match);
      const matchFormat = getMatchFormat(match);
      const actualPredictionValue = getActualPredictionValue(match);
      const points = getPredictionPoints(selected, actualPredictionValue, matchFormat);
      const isCancelled = isCancelledMatch(match);
      const floorPredictions = isOwn ? state.matchFloorPredictions.get(match.id) : null;
      const scheduledDateLabel = formatMatchDate(match);
      const statusChip = getStatusChip({
        isCancelled,
        isOwn,
        isOpen,
        isUpcoming,
        isSaving,
        actualValue: actualPredictionValue,
        selected,
        points
      });
      return `
        <article class="prediction-match-card ${matchFormat === 'single-set' ? 'is-single-set' : ''} ${selected ? 'has-prediction' : ''} ${isOpen ? '' : 'is-locked'} ${points !== null ? `points-${points}` : ''}">
          <div class="prediction-match-meta">
            <span class="mc-nr prediction-match-number">Partie ${escapeHtml(match.id.match(/\d+$/)?.[0] || match.id)}${scheduledDateLabel ? ` – ${escapeHtml(scheduledDateLabel)}` : ''}</span>
          </div>
          <div class="prediction-teams">
            <div class="prediction-team prediction-team-1">${renderTeam(match.team1)}</div>
            ${renderMatchCenter(match, actualPredictionValue, isCancelled)}
            <div class="prediction-team prediction-team-2">${renderTeam(match.team2)}</div>
          </div>
          ${isUpcoming ? `<div class="prediction-options prediction-options--upcoming">${escapeHtml(formatPredictionOpensOn(match))}</div>` : `<div class="prediction-options" role="group" aria-label="Satzergebnis für Partie ${escapeHtml(match.id)} tippen">
            ${getPredictionOptions(match).map(prediction => `
              <button
                type="button"
                class="prediction-option ${selected === prediction ? 'active' : ''} ${floorPredictions?.has(prediction) ? 'is-own-floor' : ''} ${actualPredictionValue === prediction ? 'is-result' : ''}"
                data-prediction-match="${escapeHtml(match.id)}"
                data-prediction-value="${prediction}"
                aria-pressed="${selected === prediction}"
                ${floorPredictions?.has(prediction) ? 'title="Schlechtester Fremdtipp – deine automatische Wertung"' : ''}
                ${isSaving || !isOpen ? 'disabled' : ''}
              >${prediction}</button>
            `).join('')}
          </div>`}
          <span class="prediction-status ${statusChip.classes}">${statusChip.label}</span>
        </article>
      `;
    };

    target.innerHTML = state.sortMode === 'matchday'
      ? renderMatchesByMatchday(matches, renderMatch)
      : `
        ${renderMatchGroup('<div class="spieltag-label"><span>Offene Spiele</span></div>', openMatches, renderMatch)}
        ${renderMatchGroup('<div class="spieltag-label"><span>Demnächst tippbar</span></div>', upcomingMatches, renderMatch)}
        ${renderMatchGroup('<div class="spieltag-label"><span>Gespielt &amp; gesperrt</span></div>', lockedMatches, renderMatch)}
      `;
  }

  function renderLeaderboard() {
    const body = document.getElementById('prediction-ranking-body');
    const empty = document.getElementById('prediction-ranking-empty');
    if (!body || !empty) return;

    body.innerHTML = state.leaderboard.map((entry, index) => `
      <tr class="ranking-row r${Math.min(index + 1, 4)} ${state.session?.user?.id === entry.user_id ? 'authenticated-player-highlight' : ''}">
        <td class="col-rank rank-position">${index + 1}</td>
        <td class="col-name"><span class="pname">${escapeHtml(entry.display_name)}</span></td>
        <td class="col-games">${Number(entry.predictions_count) || 0}</td>
        <td class="col-wins">${Number(entry.exact_count) || 0}</td>
        <td class="col-points rank-score">${Number(entry.points) || 0}</td>
      </tr>
    `).join('');
    empty.textContent = state.leaderboardError || (!state.leaderboardReady && state.error)
      ? 'Die Rangliste kann gerade nicht geladen werden.'
      : state.leaderboard.length
        ? ''
        // Ohne bekannten Saisonstatus bleibt offen, ob noch Tipps folgen können.
        : !state.leaderboardReady || state.seasonCompleted === null
          ? 'Rangliste wird geladen …'
          : state.seasonCompleted
            ? 'In dieser Saison wurden keine Tipps abgegeben.'
            : 'Die Rangliste füllt sich, sobald der erste Tipp gespeichert wurde.';
  }

  async function loadPredictions({ accountReady } = {}) {
    if (accountReady) {
      await accountReady;
      state.session = window.PadelKonto?.getSession?.() || null;
      state.profile = window.PadelKonto?.getProfile?.() || null;
    }
    state.predictions.clear();
    if (!state.session?.user) return;
    const userId = state.session.user.id;
    const { data, error } = await state.client
      .from('predictions')
      .select('match_id, prediction');
    if (window.PadelKonto?.getSession?.()?.user?.id !== userId) return;
    if (error) throw error;
    (data || []).forEach(row => state.predictions.set(row.match_id, row.prediction));
  }

  async function loadLeaderboard(seasonId, legacySeasonId) {
    try {
      const { data, error } = await state.client.rpc('get_prediction_leaderboard', { p_season_id: seasonId });
      if (error) throw error;
      let leaderboard = data || [];
      if (!leaderboard.length && legacySeasonId) {
        const fallback = await state.client.rpc('get_prediction_leaderboard', { p_season_id: legacySeasonId });
        if (fallback.error) throw fallback.error;
        leaderboard = fallback.data || [];
      }
      state.leaderboard = leaderboard;
      state.leaderboardReady = true;
      state.leaderboardError = null;
    } catch (error) {
      state.leaderboardError = error.message || 'Unbekannter Fehler';
      throw error;
    } finally {
      // Die zuerst sichtbare Rangliste wartet weder auf Partien noch auf Kontodaten.
      renderLeaderboard();
    }
  }

  // Werte des schlechtesten Fremdtipps zeigen Beteiligten ihre automatische Gutschrift.
  async function loadMatchFloorPredictions(seasonIds) {
    const floors = new Map();
    for (const seasonId of seasonIds) {
      const { data, error } = await state.client.rpc('get_prediction_match_floors', { p_season_id: seasonId });
      if (error) {
        console.warn('Schlechteste Fremdtipps nicht verfügbar:', error.message);
        break;
      }
      (data || []).forEach(row => {
        if (!floors.has(row.match_id)) floors.set(row.match_id, new Set());
        floors.get(row.match_id).add(row.prediction);
      });
    }
    state.matchFloorPredictions = floors;
  }

  async function loadPublicData() {
    const seasonId = state.season?.databaseId || state.season?.id;
    const legacySeasonId = LEGACY_DATABASE_SEASON_IDS[seasonId];
    const seasonIds = legacySeasonId ? [seasonId, legacySeasonId] : [seasonId];
    const participantsPromise = (async () => {
      try {
        for (const candidateId of seasonIds) {
          const { data, error } = await state.client.rpc('get_public_season', { p_season_id: candidateId });
          if (!error && Array.isArray(data?.participants)) {
            state.seasonCompleted = Boolean(data.completedAt);
            return data.participants;
          }
        }
        return state.season?.participants || [];
      } finally {
        if (state.seasonCompleted === null) state.seasonCompleted = Boolean(state.season?.completedAt);
        renderLeaderboard();
      }
    })();
    const [{ data: matches, error: matchesError }, participants] = await Promise.all([
      state.client
        .from('matches')
        .select('id, season_id, format, competition_stage, betting_open, actual_sets, result_details, match_at, cancelled_at')
        .in('season_id', seasonIds),
      participantsPromise,
      loadLeaderboard(seasonId, legacySeasonId),
      loadMatchFloorPredictions(seasonIds)
    ]);
    if (matchesError) throw matchesError;
    state.databaseMatches = new Map((matches || []).map(match => [match.id, match]));
    applyPlayerElos(participants);
  }

  async function savePrediction(matchId, prediction) {
    if (!state.session?.user) {
      window.PadelKonto?.openDialog?.();
      return;
    }
    const localMatch = state.season?.matches.find(match => match.id === matchId);
    if (!localMatch || isOwnMatch(localMatch) || !getPredictionOptions(localMatch).includes(prediction) || !isPredictionOpen(localMatch)) return;

    const previous = state.predictions.get(matchId);
    state.predictions.set(matchId, prediction);
    state.saving.add(matchId);
    renderMatches();
    const { error } = await state.client.from('predictions').upsert({
      user_id: state.session.user.id,
      match_id: matchId,
      prediction
    }, { onConflict: 'user_id,match_id' });
    state.saving.delete(matchId);
    if (error) {
      if (previous) state.predictions.set(matchId, previous);
      else state.predictions.delete(matchId);
      window.PadelKonto?.setMessage?.(error.message, 'error');
      window.PadelKonto?.openDialog?.();
    } else {
      await loadPublicData();
    }
    render();
  }

  function render() {
    renderAuthHint();
    renderMatches();
    renderLeaderboard();
  }

  async function refresh({ accountReady } = {}) {
    state.client = window.PadelKonto?.getClient?.() || state.client;
    state.session = window.PadelKonto?.getSession?.() || null;
    state.profile = window.PadelKonto?.getProfile?.() || null;
    if (!state.client || !state.season) return;
    try {
      await Promise.all([loadPublicData(), loadPredictions({ accountReady })]);
      state.ready = true;
      state.error = null;
    } catch (error) {
      state.error = error.message || 'Unbekannter Fehler';
      console.error('Tippspiel konnte nicht geladen werden:', error);
    }
    render();
  }

  function bindEvents() {
    document.addEventListener('click', event => {
      const sortButton = event.target.closest('[data-prediction-sort]');
      if (!sortButton || sortButton.dataset.predictionSort === state.sortMode) return;
      state.sortMode = sortButton.dataset.predictionSort;
      renderSortToggle();
      renderMatches();
    });
    document.addEventListener('click', event => {
      const prediction = event.target.closest('[data-prediction-match]');
      if (!prediction) return;
      savePrediction(prediction.dataset.predictionMatch, prediction.dataset.predictionValue);
    });
    window.addEventListener('padel:auth-state-changed', event => {
      state.session = event.detail?.session || null;
      state.profile = event.detail?.profile || null;
      refresh();
    });
    window.addEventListener('padel:official-result-changed', () => refresh());
  }

  async function init(season, { accountReady } = {}) {
    state.season = season;
    applyPlayerElos(season?.participants || []);
    render();
    if (!window.PadelKonto?.init) {
      state.error = 'Das Kontomodul ist nicht verfügbar.';
      render();
      return;
    }
    accountReady = accountReady || window.PadelKonto.init();
    state.client = window.PadelKonto.getClient();
    state.session = window.PadelKonto.getSession();
    state.profile = window.PadelKonto.getProfile?.() || null;
    if (!state.client) {
      state.error = 'Supabase ist nicht vollständig konfiguriert.';
      render();
      return;
    }
    const initialRefresh = refresh({ accountReady });
    // Das erste Kontoereignis ist bereits durch den initialen Abruf abgedeckt.
    await accountReady;
    if (!state.bound) {
      bindEvents();
      state.bound = true;
    }
    await initialRefresh;
  }

  function setSeasonData(season) {
    state.season = season;
    applyPlayerElos(season?.participants || []);
    render();
  }

  window.PadelTippspiel = { init, refresh, render, setSeasonData };
})();
