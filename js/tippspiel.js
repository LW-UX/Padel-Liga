(function () {
  const BEST_OF_THREE_PREDICTIONS = ['2:0', '2:1', '1:2', '0:2'];
  const SINGLE_SET_PREDICTIONS = [
    '6:0', '6:1', '6:2', '6:3', '6:4', '7:5', '7:6',
    '0:6', '1:6', '2:6', '3:6', '4:6', '5:7', '6:7'
  ];
  const state = {
    client: null,
    season: null,
    session: null,
    databaseMatches: new Map(),
    predictions: new Map(),
    leaderboard: [],
    saving: new Set(),
    ready: false,
    error: null,
    bound: false
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
    if (!state.season || state.season.competition?.predictionsEnabled === false) return [];
    return state.season.matches.filter(match =>
      match.team1.playerIds.length > 0 &&
      match.team2.playerIds.length > 0 &&
      state.databaseMatches.has(match.id)
    );
  }

  function getActualSets(match) {
    return state.databaseMatches.get(match.id)?.actual_sets || match.saetze || null;
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
    if (!databaseMatch || databaseMatch.betting_open !== true || getActualSets(match)) return false;
    if (!databaseMatch.match_at) return match.sieger === null;
    return match.sieger === null && new Date(databaseMatch.match_at).getTime() > Date.now();
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
    const dateValue = matchTime.date || match.datum;
    const timeValue = matchTime.time || match.uhrzeit;
    if (!dateValue) return `Spieltag ${match.spieltag}`;
    const date = new Date(`${dateValue}T12:00:00`);
    const dateLabel = Number.isNaN(date.getTime())
      ? dateValue
      : new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    return `${dateLabel}${timeValue ? ` · ${String(timeValue).slice(0, 5).replace(':', '.')} Uhr` : ''}`;
  }

  function getMatchTimestamp(match) {
    const rawTime = String(match.uhrzeit || '23:59').replace('.', ':');
    const time = /^\d{1,2}:\d{2}$/.test(rawTime) ? `${rawTime}:00` : rawTime;
    const timestamp = new Date(`${match.datum || '9999-12-31'}T${time}`).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
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
      .map(player => `<span class="prediction-player">${escapeHtml(player)}</span>`)
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
      .sort((first, second) => getMatchTimestamp(first) - getMatchTimestamp(second));
    const lockedMatches = matches
      .filter(match => !isPredictionOpen(match))
      .sort((first, second) => getMatchTimestamp(second) - getMatchTimestamp(first));
    if (meta) meta.textContent = `${openMatches.length} offen · ${lockedMatches.length} gesperrt`;
    if (!matches.length) {
      target.innerHTML = '<div class="widget empty-state">Für diese Saison sind noch keine Spiele im Tippspiel hinterlegt.</div>';
      return;
    }

    const renderMatch = match => {
      const selected = state.predictions.get(match.id);
      const isSaving = state.saving.has(match.id);
      const isOpen = isPredictionOpen(match);
      const actualSets = getActualSets(match);
      const matchFormat = getMatchFormat(match);
      const actualPredictionValue = getActualPredictionValue(match);
      const resultDetails = state.databaseMatches.get(match.id)?.result_details || match.ergebnis;
      const points = getPredictionPoints(selected, actualPredictionValue, matchFormat);
      const statusLabel = isOpen ? 'Offen' : actualSets ? 'Gespielt' : 'Gesperrt';
      const saveState = isOpen
        ? isSaving
          ? 'Wird gespeichert …'
          : selected
            ? `Gespeichert: ${selected}`
            : 'Noch kein Tipp'
        : actualSets
          ? selected
            ? `Dein Tipp: ${selected} · Ergebnis: ${actualPredictionValue} · ${points} ${points === 1 ? 'Punkt' : 'Punkte'}`
            : `Kein Tipp abgegeben · Ergebnis: ${actualPredictionValue}`
          : selected
            ? `Dein Tipp: ${selected} · Ergebnis ausstehend`
            : 'Kein Tipp abgegeben · Ergebnis ausstehend';
      return `
        <article class="prediction-match-card ${selected ? 'has-prediction' : ''} ${isOpen ? '' : 'is-locked'}">
          <div class="prediction-match-meta">
            <span class="prediction-match-number">Partie ${escapeHtml(match.id.match(/\d+$/)?.[0] || match.id)} <span class="prediction-status ${isOpen ? 'is-open' : 'is-locked'}">${statusLabel}</span></span>
            <span>Spieltag ${escapeHtml(match.spieltag)} · ${escapeHtml(formatMatchDate(match))}</span>
          </div>
          <div class="prediction-teams">
            <div class="prediction-team prediction-team-1">${renderTeam(match.team1)}</div>
            <div class="prediction-versus">VS</div>
            <div class="prediction-team prediction-team-2">${renderTeam(match.team2)}</div>
          </div>
          <div class="prediction-options" role="group" aria-label="Satzergebnis für Partie ${escapeHtml(match.id)} tippen">
            ${getPredictionOptions(match).map(prediction => `
              <button
                type="button"
                class="prediction-option ${selected === prediction ? 'active' : ''} ${actualPredictionValue === prediction ? 'is-result' : ''}"
                data-prediction-match="${escapeHtml(match.id)}"
                data-prediction-value="${prediction}"
                aria-pressed="${selected === prediction}"
                ${isSaving || !isOpen ? 'disabled' : ''}
              >${prediction}</button>
            `).join('')}
          </div>
          ${actualSets ? `<div class="prediction-result-details">Endstand ${escapeHtml(actualPredictionValue)}${matchFormat === 'single-set' ? '' : resultDetails ? ` · ${escapeHtml(resultDetails)}` : ''}</div>` : ''}
          <div class="prediction-save-state ${selected ? 'saved' : ''} ${points !== null ? `points-${points}` : ''}">${saveState}</div>
        </article>
      `;
    };

    target.innerHTML = `
      ${openMatches.length ? `<div class="prediction-match-group"><div class="widget-label">Offene Spiele</div>${openMatches.map(renderMatch).join('')}</div>` : ''}
      ${lockedMatches.length ? `<div class="prediction-match-group"><div class="widget-label">Gespielt &amp; gesperrt</div>${lockedMatches.map(renderMatch).join('')}</div>` : ''}
    `;
  }

  function renderLeaderboard() {
    const body = document.getElementById('prediction-ranking-body');
    const empty = document.getElementById('prediction-ranking-empty');
    if (!body || !empty) return;

    body.innerHTML = state.leaderboard.map((entry, index) => `
      <tr class="r${Math.min(index + 1, 4)} ${state.session?.user?.id === entry.user_id ? 'viewer-highlight' : ''}">
        <td class="l rn rank-position">${index + 1}</td>
        <td class="l"><span class="pname">${escapeHtml(entry.display_name)}</span></td>
        <td class="num-val">${Number(entry.predictions_count) || 0}</td>
        <td class="num-val">${Number(entry.exact_count) || 0}</td>
        <td class="rank-score">${Number(entry.points) || 0}</td>
      </tr>
    `).join('');
    empty.textContent = state.ready && !state.leaderboard.length
      ? 'Die Tabelle füllt sich, sobald der erste Tipp gespeichert wurde.'
      : '';
  }

  async function loadPredictions() {
    state.predictions.clear();
    if (!state.session?.user) return;
    const { data, error } = await state.client
      .from('predictions')
      .select('match_id, prediction');
    if (error) throw error;
    (data || []).forEach(row => state.predictions.set(row.match_id, row.prediction));
  }

  async function loadPublicData() {
    const seasonId = state.season?.id;
    const [{ data: matches, error: matchesError }, { data: leaderboard, error: leaderboardError }] = await Promise.all([
      state.client
        .from('matches')
        .select('id, format, competition_stage, betting_open, actual_sets, result_details, match_at')
        .eq('season_id', seasonId),
      state.client.rpc('get_prediction_leaderboard', { p_season_id: seasonId })
    ]);
    if (matchesError) throw matchesError;
    if (leaderboardError) throw leaderboardError;
    state.databaseMatches = new Map((matches || []).map(match => [match.id, match]));
    state.leaderboard = leaderboard || [];
  }

  async function savePrediction(matchId, prediction) {
    if (!state.session?.user) {
      window.PadelKonto?.openDialog?.();
      return;
    }
    const localMatch = state.season?.matches.find(match => match.id === matchId);
    if (!localMatch || !getPredictionOptions(localMatch).includes(prediction) || !state.databaseMatches.get(matchId)?.betting_open) return;

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

  async function refresh() {
    state.client = window.PadelKonto?.getClient?.() || state.client;
    state.session = window.PadelKonto?.getSession?.() || null;
    if (!state.client || !state.season) return;
    try {
      await Promise.all([loadPublicData(), loadPredictions()]);
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
      const prediction = event.target.closest('[data-prediction-match]');
      if (!prediction) return;
      savePrediction(prediction.dataset.predictionMatch, prediction.dataset.predictionValue);
    });
    window.addEventListener('padel:auth-state-changed', event => {
      state.session = event.detail?.session || null;
      refresh();
    });
    window.addEventListener('padel:official-result-changed', () => refresh());
  }

  async function init(season) {
    state.season = season;
    render();
    if (!window.PadelKonto?.init) {
      state.error = 'Das Kontomodul ist nicht verfügbar.';
      render();
      return;
    }
    await window.PadelKonto.init();
    state.client = window.PadelKonto.getClient();
    state.session = window.PadelKonto.getSession();
    if (!state.client) {
      state.error = 'Supabase ist nicht vollständig konfiguriert.';
      render();
      return;
    }
    if (!state.bound) {
      bindEvents();
      state.bound = true;
    }
    await refresh();
  }

  function setSeasonData(season) {
    state.season = season;
    render();
  }

  window.PadelTippspiel = { init, refresh, render, setSeasonData };
})();
