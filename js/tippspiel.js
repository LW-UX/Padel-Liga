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
    profile: null,
    authMode: 'login',
    databaseMatches: new Map(),
    predictions: new Map(),
    leaderboard: [],
    resultTasks: [],
    trainingTasks: [],
    players: [],
    trainingRoundCount: 1,
    editingTrainingId: null,
    extendedPlayerFeatures: true,
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
    if (!databaseMatch.lock_at) return match.sieger === null;
    return match.sieger === null && new Date(databaseMatch.lock_at).getTime() > Date.now();
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
    const dateValue = databaseMatch?.scheduled_date || match.datum;
    const timeValue = databaseMatch?.display_time || match.uhrzeit;
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

  function renderTeam(team) {
    return team.spieler
      .map(player => `<span class="prediction-player">${escapeHtml(player)}</span>`)
      .join('<span class="mc-player-sep"> &amp; </span>');
  }

  function getProfileDisplayName() {
    return deriveDisplayNameFromEmail(state.session?.user?.email);
  }

  function deriveDisplayNameFromEmail(email) {
    const localPart = String(email || '').trim().split('@')[0] || '';
    const parts = localPart.split('.').map(part => part.trim()).filter(Boolean);
    const capitalize = value => value
      ? `${value.charAt(0).toLocaleUpperCase('de-DE')}${value.slice(1).toLocaleLowerCase('de-DE')}`
      : '';
    if (parts.length >= 2) {
      return `${capitalize(parts[0])} ${parts.at(-1).charAt(0).toLocaleUpperCase('de-DE')}`;
    }
    return capitalize(localPart) || 'Konto';
  }

  function isPlayerAccount() {
    return ['player', 'admin'].includes(state.profile?.app_role) && Boolean(state.profile?.player_id);
  }

  function isTrainingTaskVisible(task) {
    if (state.profile?.app_role === 'admin') return true;
    const playerId = state.profile?.player_id;
    return Boolean(playerId && Array.isArray(task?.player_ids) && task.player_ids.includes(playerId));
  }

  function isResultTaskOpen(task) {
    if (typeof task?.is_open === 'boolean') return task.is_open;
    if (task?.task_type === 'review' || task?.task_type === 'waiting') return true;
    if (task?.task_type === 'completed') return false;
    return getMatchTimestamp({
      datum: task?.scheduled_date,
      uhrzeit: task?.display_time
    }) <= Date.now();
  }

  function getPlayerResultTaskGroups(tasks = [], now = Date.now(), includeAll = false) {
    const compareBySchedule = (first, second) => getMatchTimestamp({
      datum: first.scheduled_date,
      uhrzeit: first.display_time
    }) - getMatchTimestamp({
      datum: second.scheduled_date,
      uhrzeit: second.display_time
    });
    const scopedTasks = includeAll
      ? tasks
      : tasks.filter(task => [1, 2].includes(Number(task?.my_team)));
    const resultEntries = scopedTasks.filter(task => task.task_type === 'enter');
    const scheduledEntries = resultEntries.filter(task => task.scheduled_date && task.display_time);

    return [
      {
        key: 'review',
        label: 'Zu bestätigen',
        tasks: scopedTasks
          .filter(task => task.task_type === 'review' || task.task_type === 'waiting')
          .sort(compareBySchedule)
      },
      {
        key: 'past',
        label: 'Ergebnis eintragen',
        tasks: scheduledEntries
          .filter(task => getMatchTimestamp({ datum: task.scheduled_date, uhrzeit: task.display_time }) <= now)
          .sort(compareBySchedule)
      },
      {
        key: 'future',
        label: 'Terminierte Spiele',
        tasks: scheduledEntries
          .filter(task => getMatchTimestamp({ datum: task.scheduled_date, uhrzeit: task.display_time }) > now)
          .sort(compareBySchedule)
      },
      {
        key: 'planned',
        label: 'Geplante Spiele',
        tasks: resultEntries
          .filter(task => !task.scheduled_date || !task.display_time)
          .sort((first, second) => Number(first.matchday) - Number(second.matchday)
            || String(first.match_id).localeCompare(String(second.match_id), 'de', { numeric: true }))
      }
    ];
  }

  function getActionableResultTasks() {
    const groups = getPlayerResultTaskGroups(
      state.resultTasks,
      Date.now(),
      state.profile?.app_role === 'admin'
    );
    return [
      ...groups.find(group => group.key === 'review').tasks.filter(task => task.task_type === 'review'),
      ...groups.find(group => group.key === 'past').tasks
    ];
  }

  function publishAuthenticatedPlayer() {
    const playerId = state.profile?.player_id || null;
    if (typeof window.PadelLigaSetAuthenticatedPlayer === 'function') {
      window.PadelLigaSetAuthenticatedPlayer(playerId);
      return;
    }
    window.dispatchEvent(new CustomEvent('padel:authenticated-player', {
      detail: { playerId }
    }));
  }

  function isMissingAppRoleColumn(error) {
    const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    return message.includes('app_role') && (
      message.includes('does not exist')
      || message.includes('not found')
      || error?.code === '42703'
      || error?.code === 'PGRST204'
    );
  }

  function renderAuthState() {
    const button = document.getElementById('auth-button');
    const guestView = document.getElementById('auth-guest-view');
    const accountView = document.getElementById('auth-account-view');
    if (!button || !guestView || !accountView) return;

    const isLoggedIn = Boolean(state.session?.user);
    const displayName = getProfileDisplayName();
    const taskCount = getActionableResultTasks().length
      + state.trainingTasks.filter(task => !task.created_by_me && isTrainingTaskVisible(task)).length;
    button.innerHTML = isLoggedIn
      ? `<svg class="auth-user-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0"/>
        </svg>${taskCount ? `<span class="auth-task-badge">${taskCount}</span>` : ''}`
      : 'Login';
    button.classList.toggle('is-authenticated', isLoggedIn);
    button.classList.toggle('secondary-button', isLoggedIn);
    button.setAttribute('aria-label', isLoggedIn ? `Spieleübersicht von ${displayName} öffnen` : 'Einloggen');
    button.title = isLoggedIn ? displayName : '';
    guestView.hidden = isLoggedIn;
    accountView.hidden = !isLoggedIn;

    if (isLoggedIn) {
      document.getElementById('account-display-name').textContent = displayName;
      document.getElementById('account-email').textContent = state.session.user.email || '';
      const playerArea = document.getElementById('account-player-area');
      if (playerArea) playerArea.hidden = !isPlayerAccount() || !state.extendedPlayerFeatures;
      const gamesEmpty = document.getElementById('account-games-empty');
      if (gamesEmpty) gamesEmpty.hidden = isPlayerAccount() && state.extendedPlayerFeatures;
    }
  }

  function renderAuthHint() {
    const target = document.getElementById('prediction-auth-hint');
    if (!target) return;
    target.innerHTML = state.session
      ? `<div class="prediction-session-note"><span>Du tippst als <strong>${escapeHtml(getProfileDisplayName() || state.session.user.email)}</strong>.</span><button class="text-link inline-link" type="button" data-auth-open>Konto öffnen</button></div>`
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
        <td class="l rn">${index + 1}</td>
        <td class="l"><span class="pname">${escapeHtml(entry.display_name)}</span></td>
        <td class="num-val">${Number(entry.predictions_count) || 0}</td>
        <td class="num-val">${Number(entry.exact_count) || 0}</td>
        <td class="punkte-val">${Number(entry.points) || 0}</td>
      </tr>
    `).join('');
    empty.textContent = state.ready && !state.leaderboard.length
      ? 'Die Tabelle füllt sich, sobald der erste Tipp gespeichert wurde.'
      : '';
  }

  function formatTaskDate(dateValue, timeValue) {
    if (!dateValue) return 'Termin noch offen';
    const date = new Date(`${dateValue}T12:00:00`);
    const label = Number.isNaN(date.getTime())
      ? dateValue
      : new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    const time = String(timeValue || '').slice(0, 5).replace(':', '.');
    return `${label}${time ? ` · ${time} Uhr` : ''}`;
  }

  function normalizeTimeInput(value) {
    return String(value || '').slice(0, 5).replace('.', ':');
  }

  function getTodayInputValue() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function getResultFormDate(task) {
    if (task.proposed_played_on) return task.proposed_played_on;
    return task.scheduled_date || getTodayInputValue();
  }

  function getResultFormTime(task) {
    const proposed = normalizeTimeInput(task.proposed_played_time);
    if (proposed) return proposed;
    const scheduled = normalizeTimeInput(task.display_time);
    if (scheduled) return scheduled;
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  function getTaskNumber(task) {
    return task.match_id.match(/\d+$/)?.[0] || task.match_id;
  }

  function getTaskLeagueLabel(task) {
    return task.league_label || task.league_id || 'Liga';
  }

  function parseScorePair(value) {
    const match = String(value || '').trim().match(/^(\d+)\s*:\s*(\d+)$/);
    return match ? [Number(match[1]), Number(match[2])] : [];
  }

  function parseResultScores(resultDetails) {
    const [regularPart = '', matchTiebreakPart = ''] = String(resultDetails || '').split(/\s*[–-]\s*/, 2);
    const sets = regularPart
      .split(/\s*,\s*/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => {
        const match = part.match(/^\s*(\d+)\s*:\s*(\d+)(?:\s*\(\s*(\d+)\s*:\s*(\d+)\s*\))?\s*$/);
        return match ? {
          score: [Number(match[1]), Number(match[2])],
          tiebreak: match[3] === undefined ? [] : [Number(match[3]), Number(match[4])]
        } : { score: [], tiebreak: [] };
      });
    return {
      sets,
      matchTiebreak: parseScorePair(matchTiebreakPart)
    };
  }

  function hasSplitFirstTwoSets(scores) {
    return scores.length >= 2
      && scores.slice(0, 2).every(score => score.every(Number.isInteger) && score[0] !== score[1])
      && (scores[0][0] > scores[0][1]) !== (scores[1][0] > scores[1][1]);
  }

  function renderScorePair(label, kind, setIndex, score = [], disabled = false, required = false) {
    return `<div class="calculator-score-pair result-score-pair">
      ${[1, 2].map((team, teamIndex) => `<div class="calculator-score-field result-score-counter">
        <button class="calculator-step" type="button" data-result-score-step="-1" aria-label="${label}, Team ${team}: eins abziehen"${disabled ? ' disabled' : ''}>−</button>
        <input
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="2"
          ${required ? 'required' : ''}
          name="${kind}_${setIndex}_${teamIndex}"
          data-result-score
          data-score-kind="${kind}"
          data-score-set="${setIndex}"
          data-score-team="${teamIndex}"
          value="${score[teamIndex] ?? ''}"
          aria-label="${label}, Team ${team}"
          ${disabled ? 'disabled' : ''}
        >
        <button class="calculator-step" type="button" data-result-score-step="1" aria-label="${label}, Team ${team}: eins addieren"${disabled ? ' disabled' : ''}>+</button>
      </div>`).join('<span class="result-score-colon">:</span>')}
    </div>`;
  }

  function renderScoreCounters(resultDetails = '', format = 'best-of-three') {
    const values = parseResultScores(resultDetails);
    const regularSetCount = format === 'single-set' ? 1 : 2;
    const regularScores = values.sets.map(set => set.score);
    const decisionEnabled = format !== 'single-set' && hasSplitFirstTwoSets(regularScores);
    return `<div class="result-score-entry">
      ${Array.from({ length: regularSetCount }, (_, setIndex) => {
        const set = values.sets[setIndex] || { score: [], tiebreak: [] };
        const label = format === 'single-set' ? 'Satz' : `Satz ${setIndex + 1}`;
        const needsTiebreak = Math.max(...set.score) === 7 && Math.min(...set.score) === 6;
        return `<div class="result-score-set" data-result-regular-set="${setIndex}">
          ${format === 'single-set' ? '<span class="result-score-label">Satz</span>' : ''}
          ${renderScorePair(label, 'set', setIndex, set.score, false, true)}
          <div class="result-score-tiebreak" data-result-set-tiebreak="${setIndex}" ${needsTiebreak ? '' : 'hidden'}>
            <span class="result-score-label">Satz-Tiebreak</span>
            ${renderScorePair(`${label}, Satz-Tiebreak`, 'set-tiebreak', setIndex, set.tiebreak, !needsTiebreak, needsTiebreak)}
          </div>
        </div>`;
      }).join('')}
      ${format === 'single-set' ? '' : `<div class="result-score-set" data-result-decision>
        ${renderScorePair('Match-Tiebreak', 'match-tiebreak', 0, values.matchTiebreak, !decisionEnabled, decisionEnabled)}
      </div>`}
    </div>`;
  }

  function renderTaskTeamLabel(label, authenticatedPlayerName) {
    const normalizedAuthenticatedName = String(authenticatedPlayerName || '').trim().toLocaleLowerCase('de-DE');
    return String(label || '')
      .split(' / ')
      .map(playerName => {
        const escapedName = escapeHtml(playerName);
        const isAuthenticatedPlayer = normalizedAuthenticatedName
          && playerName.trim().toLocaleLowerCase('de-DE') === normalizedAuthenticatedName;
        return isAuthenticatedPlayer
          ? `<span class="account-task-player-name is-authenticated">${escapedName}</span>`
          : escapedName;
      })
      .join('<span class="mc-player-sep">&amp;</span>');
  }

  function renderTaskMatchup(task) {
    const authenticatedPlayerName = state.profile?.player_id
      ? getPlayerName(state.profile.player_id)
      : '';
    return `<div class="account-task-matchup">
      <strong>${renderTaskTeamLabel(task.team_one_label, authenticatedPlayerName)}</strong>
      <span>vs.</span>
      <strong>${renderTaskTeamLabel(task.team_two_label, authenticatedPlayerName)}</strong>
    </div>`;
  }

  function renderResultForm(task, counter = false, collapsed = false) {
    const initialResult = counter ? task.proposed_result : '';
    const matchFormat = task.match_format || 'best-of-three';
    return `<form class="result-entry-form ${counter ? 'is-counterproposal' : ''}" data-result-submit="${escapeHtml(task.match_id)}" data-result-format="${escapeHtml(matchFormat)}" ${counter || collapsed ? 'hidden' : ''}>
      <div class="result-entry-timing">
        <label>
          <span>Datum</span>
          <input type="date" name="playedOn" required max="${getTodayInputValue()}" value="${escapeHtml(getResultFormDate(task))}">
        </label>
        <label>
          <span>Uhrzeit</span>
          <input type="time" name="playedTime" required value="${escapeHtml(getResultFormTime(task))}">
        </label>
      </div>
      ${renderScoreCounters(initialResult, matchFormat)}
      <div class="result-entry-actions">
        <div class="result-entry-summary" data-result-summary aria-live="polite">Satzergebnis wird automatisch berechnet.</div>
        <button class="primary-button" type="submit">${state.profile?.app_role === 'admin' ? 'Ergebnis eintragen' : counter ? 'Alternative senden' : 'Zur Bestätigung senden'}</button>
      </div>
    </form>`;
  }

  function renderScheduleForm(task) {
    return `<form class="match-schedule-form" data-match-schedule="${escapeHtml(task.match_id)}">
      <div class="result-entry-timing">
        <label>
          <span>Datum</span>
          <input type="date" name="scheduledDate" required>
        </label>
        <label>
          <span>Uhrzeit</span>
          <input type="time" name="scheduledTime" required>
        </label>
      </div>
      <div class="match-schedule-actions">
        <button class="secondary-button" type="submit">Terminieren</button>
      </div>
    </form>`;
  }

  function renderResultTaskStatus(task) {
    if (task.task_type === 'completed') return '<span class="account-task-status is-complete">Bestätigt</span>';
    if (task.task_type === 'waiting') return '<span class="account-task-status">Auf Bestätigung warten</span>';
    if (task.task_type === 'review') return '<span class="account-task-status is-open">Zu bestätigen</span>';
    return isResultTaskOpen(task)
      ? '<span class="account-task-status is-open">Offen</span>'
      : `<span class="account-task-status">${task.scheduled_date && task.display_time ? 'Terminiert' : 'Geplant'}</span>`;
  }

  function renderProposedResult(task, ownProposal = false) {
    return `<div class="result-proposal">
      <span>${ownProposal ? 'Dein Vorschlag' : 'Vorschlag des anderen Teams'}<br>${escapeHtml(formatTaskDate(task.proposed_played_on, task.proposed_played_time))}</span>
      <strong>${escapeHtml(task.proposed_sets)} · ${escapeHtml(task.proposed_result)}</strong>
    </div>`;
  }

  function renderResultTaskBody(task, groupKey) {
    if (task.task_type === 'completed') {
      return `<div class="result-proposal">
        <span>Bestätigtes Ergebnis</span>
        <strong>${escapeHtml(task.official_sets)} · ${escapeHtml(task.official_result)}</strong>
      </div>`;
    }
    if (task.task_type === 'waiting') {
      return `${renderProposedResult(task, true)}
        <div class="account-task-actions"><span class="account-waiting">Auf Bestätigung warten</span></div>`;
    }
    if (task.task_type === 'review') {
      return `${renderProposedResult(task)}
        <div class="account-task-actions result-review-actions">
          <button class="primary-button" type="button" data-result-confirm="${task.proposal_id}">Ergebnis bestätigen</button>
          <button class="secondary-button" type="button" data-counterproposal-toggle="${escapeHtml(task.match_id)}">Alternative eingeben</button>
        </div>
        ${renderResultForm(task, true)}`;
    }
    if (groupKey === 'planned') return renderScheduleForm(task);
    if (groupKey === 'future') {
      return `<div class="account-task-actions scheduled-result-actions">
          <button class="secondary-button" type="button" data-result-entry-toggle="${escapeHtml(task.match_id)}">Ergebnis eintragen</button>
        </div>
        ${renderResultForm(task, false, true)}`;
    }
    return renderResultForm(task);
  }

  function renderResultTaskCard(task, groupKey) {
    const isActionable = task.task_type === 'review' || groupKey === 'past';
    const isWaiting = task.task_type === 'waiting';
    const hasAuthenticatedPlayer = [1, 2].includes(Number(task.my_team));
    return `<div class="result-task-wrap">
      <article class="account-task-card result-task-card${hasAuthenticatedPlayer ? ' has-authenticated-player' : ''}${isActionable ? ' is-actionable' : ''}${isWaiting ? ' is-waiting' : ''}">
        <div class="account-task-meta">
          <span class="widget-label">${escapeHtml(getTaskLeagueLabel(task))} · Partie ${escapeHtml(getTaskNumber(task))}</span>
          ${renderResultTaskStatus(task)}
        </div>
        ${groupKey === 'future' ? `<div class="result-card-timing">${escapeHtml(formatTaskDate(
          task.task_type === 'completed' ? task.scheduled_date : task.proposed_played_on || task.scheduled_date,
          task.task_type === 'completed' ? task.display_time : task.proposed_played_time || task.display_time
        ))}</div>` : ''}
        ${renderTaskMatchup(task)}
        ${renderResultTaskBody(task, groupKey)}
      </article>
    </div>`;
  }

  function renderResultTaskGroups(target, groups, trainingTasks = []) {
    if (!target) return;
    const groupedItems = groups.map(group => {
      const items = group.tasks.map(task => ({ kind: 'league', task }));
      if (group.key === 'review') {
        trainingTasks.forEach((task, index) => items.push({ kind: 'training', task, index }));
        items.sort((first, second) => getMatchTimestamp({
          datum: first.kind === 'training' ? first.task.played_on : first.task.scheduled_date,
          uhrzeit: first.task.display_time
        }) - getMatchTimestamp({
          datum: second.kind === 'training' ? second.task.played_on : second.task.scheduled_date,
          uhrzeit: second.task.display_time
        }));
      }
      return { ...group, items };
    });
    target.innerHTML = groupedItems
      .map(group => `<section class="prediction-match-group" data-result-task-group="${group.key}">
          <div class="spieltag-label"><span>${escapeHtml(group.label)}</span></div>
          ${group.items.length
            ? `<div class="account-task-list">${group.items.map(item => item.kind === 'training'
                ? renderTrainingTaskCard(item.task, item.index)
                : renderResultTaskCard(item.task, group.key)).join('')}</div>`
            : '<div class="account-empty">Derzeit keine Partie.</div>'}
        </section>`)
      .join('');
  }

  function renderResultTasks() {
    const isAdmin = state.profile?.app_role === 'admin';
    const groups = getPlayerResultTaskGroups(state.resultTasks, Date.now(), isAdmin);
    const visibleTrainingTasks = state.trainingTasks.filter(isTrainingTaskVisible);
    renderResultTaskGroups(document.getElementById('result-task-list'), groups, visibleTrainingTasks);
  }

  function getPlayerName(playerId) {
    return state.players.find(player => player.id === playerId)?.display_name
      || (window.PADEL_PLAYERS || []).find(player => player.id === playerId)?.name
      || playerId;
  }

  function renderTrainingTaskTeam(playerIds = []) {
    return playerIds.map(playerId => {
      const isAuthenticated = playerId === state.profile?.player_id;
      return `<span class="account-task-player-name${isAuthenticated ? ' is-authenticated' : ''}">${escapeHtml(getPlayerName(playerId))}</span>`;
    }).join('<span class="mc-player-sep">&amp;</span>');
  }

  function getTrainingFormatConfig(format = 'one_set') {
    return {
      one_set: { regularSetCount: 1, sectionCount: 1, label: '1 Satz' },
      two_sets: { regularSetCount: 2, sectionCount: 2, label: '2 Sätze' },
      two_sets_match_tiebreak: { regularSetCount: 2, sectionCount: 3, label: '2 Sätze + Match-Tiebreak', hasMatchTiebreak: true },
      three_sets: { regularSetCount: 3, sectionCount: 3, label: '3 Sätze' }
    }[format] || { regularSetCount: 1, sectionCount: 1, label: '1 Satz' };
  }

  function getTrainingRoundFormat(round = {}) {
    if (getTrainingFormatConfig(round.result_format).label !== '1 Satz' || round.result_format === 'one_set') {
      return round.result_format;
    }
    if (Number(round.set_count) === 3) {
      return /\s[–-]\s/.test(String(round.result_details || '')) ? 'two_sets_match_tiebreak' : 'three_sets';
    }
    return Number(round.set_count) === 2 ? 'two_sets' : 'one_set';
  }

  function parseTrainingSetSegment(value) {
    const match = String(value || '').match(/^\s*(\d+)\s*:\s*(\d+)(?:\s*\(\s*(\d+)\s*:\s*(\d+)\s*\))?\s*$/);
    return match ? {
      score: [Number(match[1]), Number(match[2])],
      tiebreak: match[3] === undefined ? [] : [Number(match[3]), Number(match[4])]
    } : { score: [], tiebreak: [] };
  }

  function parseTrainingResultValues(resultDetails = '', format = 'one_set') {
    const config = getTrainingFormatConfig(format);
    const [regularPart = '', matchTiebreakPart = ''] = String(resultDetails || '').split(/\s*[–-]\s*/, 2);
    const parsedSets = regularPart.split(/\s*,\s*/).filter(Boolean).map(parseTrainingSetSegment);
    return {
      sets: Array.from({ length: config.regularSetCount }, (_, index) => parsedSets[index] || { score: [], tiebreak: [] }),
      matchTiebreak: parseScorePair(matchTiebreakPart)
    };
  }

  function renderTrainingResultDetails(round) {
    const [regularPart = '', matchTiebreakPart = ''] = String(round.result_details || '').split(/\s*[–-]\s*/, 2);
    const regularParts = regularPart.split(/\s*,\s*/).filter(Boolean);
    const renderedSets = regularParts.map(part => {
      const parsed = parseTrainingSetSegment(part);
      const classification = window.PadelScoreInput.classifyRegularSet(parsed.score[0], parsed.score[1]);
      const className = classification.state === 'complete' ? '' : ' class="training-result-partial"';
      return `<span${className}>${escapeHtml(part)}</span>`;
    });
    if (matchTiebreakPart) {
      const matchTiebreak = parseScorePair(matchTiebreakPart);
      const classification = window.PadelScoreInput.classifyTiebreak(matchTiebreak[0], matchTiebreak[1], 10);
      const className = classification.state === 'complete' ? '' : ' class="training-result-partial"';
      renderedSets.push(`<span class="training-result-divider">–</span><span${className}>${escapeHtml(matchTiebreakPart)}</span>`);
    }
    return renderedSets.join('<span class="training-result-divider">,</span>');
  }

  function renderTrainingTaskRound(task, round, roundIndex, roundCount) {
    const proposalLabel = task.created_by_me ? 'Dein Vorschlag' : 'Vorschlag des anderen Teams';
    const roundLabel = roundCount > 1 ? ` · Spiel ${roundIndex + 1}` : '';
    return `<div class="training-task-round">
      <div class="account-task-matchup">
        <strong>${renderTrainingTaskTeam(round.team_one_ids)}</strong>
        <span>vs.</span>
        <strong>${renderTrainingTaskTeam(round.team_two_ids)}</strong>
      </div>
      <div class="result-proposal">
        <span>${proposalLabel}${roundLabel}<br>${escapeHtml(formatTaskDate(task.played_on, task.display_time))}</span>
        <strong class="training-result-details" title="${round.is_complete === false ? 'Vollständige Sätze werden einzeln gewertet' : 'Vollständiges Ergebnis'}">${renderTrainingResultDetails(round)}</strong>
      </div>
    </div>`;
  }

  function readTrainingScorePair(round, kind, setIndex) {
    return [0, 1].map(teamIndex => {
      const input = round.querySelector(`[data-score-kind="${kind}"][data-score-set="${setIndex}"][data-score-team="${teamIndex}"]`);
      const raw = String(input?.value ?? '').trim();
      return raw === '' ? null : Number(raw);
    });
  }

  function readTrainingRoundValues() {
    return [...document.querySelectorAll('[data-training-round]')].map(round => {
      const resultFormat = round.querySelector('[name="resultFormat"]')?.value || 'one_set';
      const config = getTrainingFormatConfig(resultFormat);
      return {
        pairing: round.querySelector('[name="pairing"]')?.value || 'ab_cd',
        resultFormat,
        sets: Array.from({ length: config.regularSetCount }, (_, setIndex) => ({
          score: readTrainingScorePair(round, 'set', setIndex),
          tiebreak: readTrainingScorePair(round, 'set-tiebreak', setIndex)
        })),
        matchTiebreak: config.hasMatchTiebreak ? readTrainingScorePair(round, 'match-tiebreak', 0) : [null, null]
      };
    });
  }

  function renderTrainingPicker({ label, name, value, options, menuId }) {
    const selected = options.find(option => option.value === value) || options[0];
    return `<div class="training-picker" data-training-picker>
      <span class="training-picker-label">${escapeHtml(label)}</span>
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(selected?.value || '')}">
      <button class="secondary-button secondary-button--dropdown training-picker-toggle" type="button" data-training-picker-toggle aria-haspopup="listbox" aria-expanded="false" aria-controls="${escapeHtml(menuId)}">
        <span data-training-picker-label>${escapeHtml(selected?.label || 'Auswählen')}</span>
      </button>
      <div class="viewer-menu training-picker-menu" id="${escapeHtml(menuId)}" role="listbox" aria-label="${escapeHtml(label)} auswählen">
        ${options.map(option => `<button
          class="viewer-option training-picker-option${option.value === selected?.value ? ' active' : ''}"
          type="button"
          role="option"
          aria-selected="${option.value === selected?.value}"
          data-training-picker-value="${escapeHtml(option.value)}"
        ><span>${escapeHtml(option.label)}</span>${option.meta ? `<span>${escapeHtml(option.meta)}</span>` : ''}</button>`).join('')}
      </div>
    </div>`;
  }

  function renderTrainingScoreCounters(value, format) {
    const config = getTrainingFormatConfig(format);
    const sets = value?.sets || [];
    const regularScores = sets.map(set => set.score || []);
    const regularSetsComplete = regularScores.length === config.regularSetCount
      && regularScores.every(score => window.PadelScoreInput.classifyRegularSet(score[0], score[1]).state === 'complete');
    const decisionEnabled = Boolean(config.hasMatchTiebreak && regularSetsComplete && hasSplitFirstTwoSets(regularScores));
    return `<div class="result-score-entry training-score-entry">
      ${Array.from({ length: config.regularSetCount }, (_, setIndex) => {
        const set = sets[setIndex] || { score: [], tiebreak: [] };
        const needsTiebreak = Math.max(...(set.score || [])) === 7 && Math.min(...(set.score || [])) === 6;
        return `<div class="result-score-set" data-result-regular-set="${setIndex}">
          ${renderScorePair(`Satz ${setIndex + 1}`, 'set', setIndex, set.score, false, false)}
          <div class="result-score-tiebreak" data-result-set-tiebreak="${setIndex}" ${needsTiebreak ? '' : 'hidden'}>
            <span class="result-score-label">Satz-Tiebreak</span>
            ${renderScorePair(`Satz ${setIndex + 1}, Satz-Tiebreak`, 'set-tiebreak', setIndex, set.tiebreak, !needsTiebreak, false)}
          </div>
        </div>`;
      }).join('')}
      ${config.hasMatchTiebreak ? `<div class="result-score-set" data-result-decision>
        ${renderScorePair('Match-Tiebreak', 'match-tiebreak', 0, value?.matchTiebreak || [], !decisionEnabled, false)}
      </div>` : ''}
    </div>`;
  }

  function renderTrainingRounds(preserved = []) {
    const target = document.getElementById('training-rounds');
    if (!target) return;
    const pairingOptions = [
      { value: 'ab_cd', label: 'Spieler 1 + 2 vs. 3 + 4' },
      { value: 'ac_bd', label: 'Spieler 1 + 3 vs. 2 + 4' },
      { value: 'ad_bc', label: 'Spieler 1 + 4 vs. 2 + 3' }
    ];
    const formatOptions = [
      { value: 'one_set', label: '1 Satz' },
      { value: 'two_sets', label: '2 Sätze' },
      { value: 'two_sets_match_tiebreak', label: '2 Sätze + Match-Tiebreak' },
      { value: 'three_sets', label: '3 Sätze' }
    ];
    target.innerHTML = Array.from({ length: state.trainingRoundCount }, (_, index) => {
      const value = preserved[index] || { pairing: 'ab_cd', resultFormat: 'one_set', sets: [], matchTiebreak: [] };
      return `<div class="training-round-field" data-training-round="${index}">
        <div class="training-round-head">
          ${renderTrainingPicker({ label: 'Paarung', name: 'pairing', value: value.pairing, options: pairingOptions, menuId: `training-pairing-menu-${index}` })}
          ${renderTrainingPicker({ label: 'Ergebnisformat', name: 'resultFormat', value: value.resultFormat, options: formatOptions, menuId: `training-format-menu-${index}` })}
          <button class="training-round-remove" type="button" data-training-round-remove="${index}" aria-label="${index === 0 ? 'Trainingseingabe schließen' : `Spielergebnis ${index + 1} entfernen`}">×</button>
        </div>
        ${renderTrainingScoreCounters(value, value.resultFormat)}
        <div class="result-entry-summary training-round-summary" data-training-round-summary aria-live="polite">Satzergebnis wird automatisch berechnet.</div>
      </div>`;
    }).join('');
    target.querySelectorAll('[data-training-round]').forEach(updateTrainingRoundSummary);
  }

  function renderTrainingForm(playerIds = null, roundValues = []) {
    const target = document.getElementById('training-player-fields');
    if (!target || !state.players.length) return;
    target.innerHTML = Array.from({ length: 4 }, (_, index) => {
      const selectedId = playerIds?.[index] || (index === 0 ? state.profile?.player_id || '' : '');
      return renderTrainingPicker({
        label: `Spieler ${index + 1}`,
        name: 'playerId',
        value: selectedId,
        options: [{ value: '', label: 'Auswählen' }, ...state.players.map(player => ({ value: player.id, label: player.display_name, meta: player.initials || '' }))],
        menuId: `training-player-menu-${index}`
      });
    }).join('');
    renderTrainingRounds(roundValues);
  }

  function closeTrainingPickerMenus(exceptPicker = null) {
    document.querySelectorAll('[data-training-picker].open').forEach(picker => {
      if (picker === exceptPicker) return;
      picker.classList.remove('open');
      picker.querySelector('[data-training-picker-toggle]')?.setAttribute('aria-expanded', 'false');
    });
  }

  function setTrainingPickerValue(picker, value) {
    if (!picker) return;
    const input = picker.querySelector('input[type="hidden"]');
    const label = picker.querySelector('[data-training-picker-label]');
    const selectedOption = [...picker.querySelectorAll('[data-training-picker-value]')]
      .find(option => option.dataset.trainingPickerValue === value);
    if (input) input.value = selectedOption ? value : '';
    if (label) label.textContent = selectedOption?.querySelector('span')?.textContent || 'Auswählen';
    picker.querySelectorAll('[data-training-picker-value]').forEach(option => {
      const isSelected = option === selectedOption;
      option.classList.toggle('active', isSelected);
      option.setAttribute('aria-selected', String(isSelected));
    });
  }

  function toggleTrainingPickerMenu(toggle) {
    const picker = toggle.closest('[data-training-picker]');
    if (!picker) return;
    const shouldOpen = !picker.classList.contains('open');
    closeTrainingPickerMenus(picker);
    picker.classList.toggle('open', shouldOpen);
    toggle.setAttribute('aria-expanded', String(shouldOpen));
  }

  function selectTrainingPickerOption(option) {
    const picker = option.closest('[data-training-picker]');
    const inputName = picker?.querySelector('input[type="hidden"]')?.name;
    setTrainingPickerValue(picker, option.dataset.trainingPickerValue);
    if (inputName === 'resultFormat') {
      const preserved = readTrainingRoundValues();
      renderTrainingRounds(preserved);
    }
    closeTrainingPickerMenus();
    setTrainingMessage('');
  }

  function renderTrainingTaskCard(task, index) {
    const rounds = Array.isArray(task.rounds) ? task.rounds : [];
    const hasAuthenticatedPlayer = Boolean(state.profile?.player_id && task.player_ids.includes(state.profile.player_id));
    return `<article class="account-task-card training-task-card${hasAuthenticatedPlayer ? ' has-authenticated-player' : ''}${task.created_by_me ? ' is-waiting' : ' is-actionable'}">
      <div class="account-task-meta">
        <span class="widget-label">Training · Partie ${escapeHtml(task.training_number || index + 1)}</span>
        <span class="account-task-status${task.created_by_me ? '' : ' is-open'}">${task.created_by_me ? 'Auf Bestätigung warten' : 'Zu bestätigen'}</span>
      </div>
      <div class="training-task-rounds">${rounds.map((round, roundIndex) => renderTrainingTaskRound(task, round, roundIndex, rounds.length)).join('')}</div>
      <div class="account-task-actions${task.created_by_me ? '' : ' result-review-actions'}">
        ${task.created_by_me
          ? '<span class="account-waiting">Auf Bestätigung warten</span>'
          : `<button class="primary-button" type="button" data-training-confirm="${task.session_id}">Training bestätigen</button><button class="secondary-button" type="button" data-training-edit="${task.session_id}">Alternative eingeben</button>`}
      </div>
    </article>`;
  }

  function render() {
    renderAuthState();
    renderAuthHint();
    renderMatches();
    renderLeaderboard();
    renderResultTasks();
  }

  async function loadProfile() {
    state.profile = null;
    if (!state.session?.user) {
      publishAuthenticatedPlayer();
      return;
    }

    const profileResponse = await state.client
      .from('profiles')
      .select('id, display_name, player_id, app_role, players(display_name)')
      .eq('id', state.session.user.id)
      .single();

    if (!profileResponse.error) {
      state.extendedPlayerFeatures = true;
      state.profile = profileResponse.data;
      publishAuthenticatedPlayer();
      return;
    }

    if (!isMissingAppRoleColumn(profileResponse.error)) throw profileResponse.error;

    // Keep login and tipping usable while the player-role migration is still pending.
    const legacyResponse = await state.client
      .from('profiles')
      .select('id, display_name, player_id, players(display_name)')
      .eq('id', state.session.user.id)
      .single();
    if (legacyResponse.error) throw legacyResponse.error;

    state.extendedPlayerFeatures = false;
    state.profile = {
      ...legacyResponse.data,
      app_role: legacyResponse.data.player_id ? 'player' : 'tipper'
    };
    publishAuthenticatedPlayer();
  }

  async function loadPlayerTools() {
    state.resultTasks = [];
    state.trainingTasks = [];
    state.players = [];
    if (!isPlayerAccount() || !state.extendedPlayerFeatures) return;

    const [playersResponse, resultResponse, trainingTaskResponse] = await Promise.all([
      state.client.from('players').select('id, display_name, initials, company').order('display_name'),
      state.client.rpc('get_my_result_tasks', { p_season_id: null }),
      state.client.rpc('get_my_training_tasks')
    ]);
    const error = playersResponse.error || resultResponse.error || trainingTaskResponse.error;
    if (error) throw error;
    state.players = playersResponse.data || [];
    state.resultTasks = resultResponse.data || [];
    state.trainingTasks = trainingTaskResponse.data || [];
    renderTrainingForm();
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
        .select('id, format, competition_stage, betting_open, actual_sets, result_details, lock_at, scheduled_date, display_time')
        .eq('season_id', seasonId),
      state.client.rpc('get_prediction_leaderboard', { p_season_id: seasonId })
    ]);
    if (matchesError) throw matchesError;
    if (leaderboardError) throw leaderboardError;
    state.databaseMatches = new Map((matches || []).map(match => [match.id, match]));
    state.leaderboard = leaderboard || [];
  }

  async function refresh() {
    if (!state.client) return;
    try {
      await Promise.all([loadPublicData(), loadPredictions(), loadProfile()]);
      await loadPlayerTools();
      state.ready = true;
      state.error = null;
    } catch (error) {
      state.error = error.message || 'Unbekannter Fehler';
      console.error('Tippspiel konnte nicht geladen werden:', error);
    }
    render();
  }

  function setAuthMessage(message, type = '') {
    const target = document.getElementById('auth-message');
    target.textContent = message || '';
    target.className = `auth-message ${type}`.trim();
  }

  function setAuthMode(mode) {
    state.authMode = mode === 'signup' ? 'signup' : 'login';
    document.querySelectorAll('[data-auth-mode]').forEach(button => {
      button.classList.toggle('active', button.dataset.authMode === state.authMode);
    });
    const passwordInput = document.querySelector('#auth-form [name="password"]');
    passwordInput.autocomplete = state.authMode === 'signup' ? 'new-password' : 'current-password';
    document.getElementById('auth-dialog-title').textContent = state.authMode === 'signup' ? 'Konto erstellen' : 'Einloggen';
    document.getElementById('auth-submit').textContent = state.authMode === 'signup' ? 'Konto erstellen' : 'Einloggen';
    setAuthMessage('');
  }

  function openAuthDialog() {
    const dialog = document.getElementById('auth-dialog');
    renderAuthState();
    setAuthMessage('');
    if (!dialog.open) dialog.showModal();
  }

  function closeAuthDialog() {
    document.getElementById('auth-dialog')?.close();
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!state.client) return;
    const authForm = event.currentTarget;
    const formData = new FormData(authForm);
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');
    const submit = document.getElementById('auth-submit');
    submit.disabled = true;
    setAuthMessage(state.authMode === 'signup' ? 'Konto wird erstellt …' : 'Login läuft …');

    try {
      if (state.authMode === 'signup') {
        const isWebPage = ['http:', 'https:'].includes(window.location.protocol);
        const emailRedirectTo = isWebPage
          ? new URL(window.location.pathname, window.location.origin).href
          : undefined;
        const { data, error } = await state.client.auth.signUp({
          email,
          password,
          options: {
            ...(emailRedirectTo ? { emailRedirectTo } : {})
          }
        });
        if (error) throw error;
        if (!data.session) {
          setAuthMessage('Fast geschafft: Bitte bestätige die E-Mail von Supabase und logge dich danach ein.', 'success');
          return;
        }
      } else {
        const { error } = await state.client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      authForm.reset();
      closeAuthDialog();
    } catch (error) {
      setAuthMessage(getFriendlyAuthError(error), 'error');
    } finally {
      submit.disabled = false;
    }
  }

  function getFriendlyAuthError(error) {
    const message = String(error?.message || 'Anmeldung fehlgeschlagen.');
    if (/invalid login credentials/i.test(message)) return 'E-Mail oder Passwort stimmen nicht.';
    if (/refresh token|jwt.*expired|invalid.*token/i.test(message)) return 'Deine Sitzung ist abgelaufen. Bitte ausloggen und erneut einloggen.';
    if (/already registered/i.test(message)) return 'Für diese E-Mail gibt es bereits ein Konto.';
    if (/password/i.test(message) && /characters/i.test(message)) return 'Das Passwort muss mindestens 8 Zeichen lang sein.';
    return message;
  }

  function readResultScorePair(form, kind, setIndex) {
    return [0, 1].map(teamIndex => {
      const input = form.querySelector(`[data-score-kind="${kind}"][data-score-set="${setIndex}"][data-score-team="${teamIndex}"]`);
      const raw = String(input?.value ?? '').trim();
      return raw === '' ? null : Number(raw);
    });
  }

  function isValidTiebreakScore(score, target) {
    return window.PadelScoreInput.isValidTiebreak(
      window.PadelScoreInput.parseScorePair(score[0], score[1]),
      target
    );
  }

  function validateResultSet(score, label) {
    if (score.every(value => value === null)) throw new Error(`${label} fehlt.`);
    if (!score.every(value => Number.isInteger(value) && value >= 0)) throw new Error(`${label}: Score unvollständig.`);
    if (score[0] === score[1]) throw new Error(`${label} benötigt einen eindeutigen Sieger.`);
    if (!window.PadelScoreInput.isValidRegularSet(window.PadelScoreInput.parseScorePair(score[0], score[1]))) {
      throw new Error(`${label}: Nur 6:X, 7:5 oder 7:6 sind gültig.`);
    }
    return score[0] > score[1] ? 1 : 2;
  }

  function validateSetTiebreak(form, score, setIndex, setWinner, label) {
    const needsTiebreak = Math.max(...score) === 7 && Math.min(...score) === 6;
    if (!needsTiebreak) return null;
    const tiebreak = readResultScorePair(form, 'set-tiebreak', setIndex);
    if (tiebreak.some(value => value === null)) throw new Error(`${label}: Satz-Tiebreak fehlt.`);
    if (!isValidTiebreakScore(tiebreak, 7)) {
      throw new Error(`${label}: Der Satz-Tiebreak benötigt einen regelkonformen Endstand.`);
    }
    const tiebreakWinner = tiebreak[0] > tiebreak[1] ? 1 : 2;
    if (tiebreakWinner !== setWinner) throw new Error(`${label}: Satz- und Tiebreak-Sieger stimmen nicht überein.`);
    return tiebreak;
  }

  function formatResultSet(score, tiebreak = null) {
    return `${score[0]}:${score[1]}${tiebreak ? ` (${tiebreak[0]}:${tiebreak[1]})` : ''}`;
  }

  function readResultScore(form) {
    const format = form.dataset?.resultFormat || 'best-of-three';
    const regularSetCount = format === 'single-set' ? 1 : 2;
    const scores = Array.from({ length: regularSetCount }, (_, setIndex) => readResultScorePair(form, 'set', setIndex));
    const setWinners = scores.map((score, setIndex) => validateResultSet(
      score,
      format === 'single-set' ? 'Der Satz' : `Satz ${setIndex + 1}`
    ));
    const setTiebreaks = scores.map((score, setIndex) => validateSetTiebreak(
      form,
      score,
      setIndex,
      setWinners[setIndex],
      format === 'single-set' ? 'Der Satz' : `Satz ${setIndex + 1}`
    ));
    const regularResult = scores.map((score, index) => formatResultSet(score, setTiebreaks[index])).join(', ');

    if (format === 'single-set') {
      return {
        actualSets: setWinners[0] === 1 ? '1:0' : '0:1',
        winner: setWinners[0],
        resultDetails: regularResult
      };
    }

    const firstTwoWins = setWinners.reduce((wins, winner) => {
      wins[winner - 1] += 1;
      return wins;
    }, [0, 0]);
    const matchTiebreak = readResultScorePair(form, 'match-tiebreak', 0);
    const decidingStarted = matchTiebreak.some(value => value !== null);
    if (firstTwoWins[0] === firstTwoWins[1] && !decidingStarted) {
      throw new Error('Bei 1:1 bitte auch den Match-Tiebreak eingeben.');
    }
    if (firstTwoWins[0] !== firstTwoWins[1] && decidingStarted) {
      throw new Error('Bei einem Ergebnis von 2:0 ist kein Match-Tiebreak mehr nötig.');
    }
    if (decidingStarted && !isValidTiebreakScore(matchTiebreak, 10)) {
      throw new Error('Der Match-Tiebreak benötigt einen regelkonformen Endstand.');
    }

    const setWins = [...firstTwoWins];
    if (decidingStarted) setWins[matchTiebreak[0] > matchTiebreak[1] ? 0 : 1] += 1;
    const actualSets = `${setWins[0]}:${setWins[1]}`;
    return {
      actualSets,
      winner: setWins[0] === 2 ? 1 : 2,
      resultDetails: decidingStarted ? `${regularResult} – ${matchTiebreak[0]}:${matchTiebreak[1]}` : regularResult
    };
  }

  function updateResultSummary(form) {
    if (!form) return;
    const format = form.dataset?.resultFormat || 'best-of-three';
    const regularSetCount = format === 'single-set' ? 1 : 2;
    const regularScores = Array.from({ length: regularSetCount }, (_, setIndex) => readResultScorePair(form, 'set', setIndex));
    regularScores.forEach((score, setIndex) => {
      const needsTiebreak = score.every(Number.isInteger) && Math.max(...score) === 7 && Math.min(...score) === 6;
      const tiebreak = form.querySelector(`[data-result-set-tiebreak="${setIndex}"]`);
      if (tiebreak) tiebreak.hidden = !needsTiebreak;
      tiebreak?.querySelectorAll('input, button').forEach(control => {
        if (!needsTiebreak && control.matches('input')) control.value = '';
        if (control.matches('input')) control.required = needsTiebreak;
        control.disabled = !needsTiebreak;
      });
    });
    const validRegularScores = regularScores.every(score => window.PadelScoreInput.isValidRegularSet(
      window.PadelScoreInput.parseScorePair(score[0], score[1])
    ));
    const decisionEnabled = format !== 'single-set' && validRegularScores && hasSplitFirstTwoSets(regularScores);
    form.querySelector('[data-result-decision]')?.querySelectorAll('input, button').forEach(control => {
      if (!decisionEnabled && control.matches('input')) control.value = '';
      if (control.matches('input')) control.required = decisionEnabled;
      control.disabled = !decisionEnabled;
    });

    const target = form.querySelector('[data-result-summary]');
    if (!target) return;
    target.classList.remove('is-valid', 'is-invalid', 'is-partial');
    try {
      const result = readResultScore(form);
      target.textContent = `${result.resultDetails} · automatisch ${result.actualSets}`;
      target.classList.add('is-valid');
    } catch (error) {
      const hasStarted = [...form.querySelectorAll('[data-result-score]:not(:disabled)')]
        .some(input => String(input.value).trim() !== '');
      if (!hasStarted) {
        target.textContent = 'Satzergebnis wird automatisch berechnet.';
        return;
      }
      target.textContent = error.message || 'Bitte das Ergebnis prüfen.';
      target.classList.add(/fehlt/i.test(target.textContent) ? 'is-partial' : 'is-invalid');
    }
  }

  function initializeResultScorePair(input) {
    if (!input || String(input.value).trim() === '') return;
    const pair = input.closest('.result-score-pair');
    const inputs = [...(pair?.querySelectorAll('[data-result-score]') || [])];
    const changedTeamIndex = inputs.indexOf(input);
    const nextValues = window.PadelScoreInput.initializePairValues(inputs.map(field => field.value), changedTeamIndex);
    inputs.forEach((field, teamIndex) => { field.value = nextValues[teamIndex]; });
  }

  async function handleScheduleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    setAuthMessage('Partie wird terminiert …');
    try {
      const { error } = await state.client.rpc('schedule_match', {
        p_match_id: form.dataset.matchSchedule,
        p_scheduled_date: String(data.get('scheduledDate') || ''),
        p_scheduled_time: String(data.get('scheduledTime') || '')
      });
      if (error) throw error;
      setAuthMessage('Partie wurde terminiert.', 'success');
      await refresh();
    } catch (error) {
      setAuthMessage(error.message || 'Die Partie konnte nicht terminiert werden.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function handleResultSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const playedOn = String(data.get('playedOn') || '');
    const playedTime = String(data.get('playedTime') || '');
    const button = form.querySelector('[type="submit"]');
    try {
      const { resultDetails, actualSets, winner } = readResultScore(form);
      button.disabled = true;
      setAuthMessage('Ergebnis wird gespeichert …');
      const { error } = await state.client.rpc('submit_match_result', {
        p_match_id: form.dataset.resultSubmit,
        p_result_details: resultDetails,
        p_actual_sets: actualSets,
        p_winner: winner,
        p_played_on: playedOn,
        p_played_time: playedTime
      });
      if (error) throw error;
      setAuthMessage(state.profile?.app_role === 'admin' ? 'Ergebnis wurde direkt eingetragen.' : 'Ergebnis wurde an das andere Team gesendet.', 'success');
      await refresh();
    } catch (error) {
      setAuthMessage(error.message || 'Das Ergebnis konnte nicht gespeichert werden.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function confirmResult(proposalId, button) {
    if (button) button.disabled = true;
    setAuthMessage('Ergebnis wird bestätigt …');
    try {
      const { error } = await state.client.rpc('confirm_match_result', { p_proposal_id: Number(proposalId) });
      if (error) throw error;
      setAuthMessage('Ergebnis bestätigt. Tabelle und Elo wurden aktualisiert.', 'success');
      await refresh();
    } catch (error) {
      setAuthMessage(error.message || 'Das Ergebnis konnte nicht bestätigt werden.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function getTrainingPairing(playerIds, pairing) {
    if (pairing === 'ac_bd') return [[playerIds[0], playerIds[2]], [playerIds[1], playerIds[3]]];
    if (pairing === 'ad_bc') return [[playerIds[0], playerIds[3]], [playerIds[1], playerIds[2]]];
    return [[playerIds[0], playerIds[1]], [playerIds[2], playerIds[3]]];
  }

  function getTrainingResultData(round) {
    const resultFormat = round.querySelector('[name="resultFormat"]').value;
    const rawResult = round.querySelector('[name="roundResult"]').value.trim();
    const scores = [...rawResult.matchAll(/(\d+)\s*:\s*(\d+)/g)]
      .map(match => [Number(match[1]), Number(match[2])]);
    const expectedCounts = { one_set: 1, two_sets: 2, two_sets_match_tiebreak: 3, three_sets: 3 };
    const setCount = expectedCounts[resultFormat];

    if (!setCount || scores.length !== setCount || scores.some(score => score[0] === score[1])) {
      throw new Error('Das Ergebnis passt nicht zum gewählten Ergebnisformat.');
    }
    if ((resultFormat === 'two_sets_match_tiebreak' || resultFormat === 'three_sets') && !hasSplitFirstTwoSets(scores)) {
      throw new Error('Ein dritter Ergebnisabschnitt ist nur nach einem Satzstand von 1:1 möglich.');
    }
    if (resultFormat === 'two_sets_match_tiebreak') {
      const winnerScore = Math.max(...scores[2]);
      const loserScore = Math.min(...scores[2]);
      if (winnerScore < 10 || winnerScore - loserScore < 2) {
        throw new Error('Der Match-Tiebreak geht bis mindestens 10 und benötigt zwei Punkte Abstand.');
      }
    }
    if (resultFormat === 'three_sets' && Math.max(...scores[2]) > 7) {
      throw new Error('Beim Format „3 Sätze“ darf der dritte Ergebnisabschnitt kein Match-Tiebreak sein.');
    }

    return {
      resultDetails: scores
        .map(([first, second], index) => `${resultFormat === 'two_sets_match_tiebreak' && index === 2 ? '– ' : ''}${first}:${second}`)
        .join(', ')
        .replace(', –', ' –'),
      setCount
    };
  }

  function setTrainingMessage(message, type = '') {
    const target = document.querySelector('[data-training-message]');
    if (!target) return;
    target.textContent = message || '';
    target.className = `training-form-message ${type}`.trim();
  }

  function handleTrainingInvalid(event) {
    const form = event.currentTarget;
    if (form.querySelector(':invalid') !== event.target) return;
    const label = event.target.closest('label')?.querySelector('span')?.textContent?.trim() || 'Pflichtfeld';
    setTrainingMessage(`Bitte „${label}“ ausfüllen.`, 'error');
  }

  async function handleTrainingSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setTrainingMessage('');
    const data = new FormData(form);
    const playerIds = data.getAll('playerId').map(String);
    if (new Set(playerIds).size !== 4 || playerIds.some(id => !id)) {
      setTrainingMessage('Bitte vier verschiedene Spieler auswählen.', 'error');
      return;
    }
    let rounds;
    try {
      rounds = [...form.querySelectorAll('[data-training-round]')].map(round => {
        const [teamOne, teamTwo] = getTrainingPairing(playerIds, round.querySelector('[name="pairing"]').value);
        const result = getTrainingResultData(round);
        return {
          team_one_ids: teamOne,
          team_two_ids: teamTwo,
          result_details: result.resultDetails,
          set_count: result.setCount,
          is_complete: round.querySelector('[name="roundStatus"]').value === 'complete'
        };
      });
    } catch (error) {
      setTrainingMessage(error.message, 'error');
      return;
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    setTrainingMessage('Training wird gespeichert …');
    const rpcName = state.editingTrainingId ? 'replace_pending_training_session' : 'create_training_session';
    const payload = {
      p_played_on: String(data.get('playedOn')),
      p_display_time: String(data.get('displayTime')),
      p_player_ids: playerIds,
      p_rounds: rounds
    };
    if (state.editingTrainingId) payload.p_session_id = Number(state.editingTrainingId);
    try {
      const { error } = await state.client.rpc(rpcName, payload);
      if (error) throw error;
    } catch (error) {
      setTrainingMessage(getFriendlyAuthError(error), 'error');
      button.disabled = false;
      return;
    }
    button.disabled = false;
    form.reset();
    form.hidden = true;
    state.trainingRoundCount = 1;
    state.editingTrainingId = null;
    setAuthMessage('Training wurde zur Bestätigung gesendet.', 'success');
    await refresh();
  }

  function editTraining(sessionId) {
    const task = state.trainingTasks.find(item => Number(item.session_id) === Number(sessionId));
    if (!task) return;
    const form = document.getElementById('training-form');
    state.editingTrainingId = Number(sessionId);
    state.trainingRoundCount = Math.max(1, task.rounds?.length || 1);
    renderTrainingForm();
    form.hidden = false;
    form.querySelector('[name="playedOn"]').value = task.played_on;
    form.querySelector('[name="displayTime"]').value = String(task.display_time).slice(0, 5);
    [...form.querySelectorAll('[data-training-player-picker]')].forEach((picker, index) => {
      setTrainingPlayerPickerValue(picker, task.player_ids[index] || '');
    });
    [...form.querySelectorAll('[data-training-round]')].forEach((roundElement, index) => {
      const round = task.rounds[index];
      if (!round) return;
      const [a, b, c, d] = task.player_ids;
      const teamOne = new Set(round.team_one_ids);
      const pairing = teamOne.has(a) && teamOne.has(c) ? 'ac_bd' : teamOne.has(a) && teamOne.has(d) ? 'ad_bc' : 'ab_cd';
      roundElement.querySelector('[name="pairing"]').value = pairing;
      roundElement.querySelector('[name="roundResult"]').value = round.result_details;
      roundElement.querySelector('[name="resultFormat"]').value = Number(round.set_count) === 3
        ? (String(round.result_details).includes('–') ? 'two_sets_match_tiebreak' : 'three_sets')
        : Number(round.set_count) === 2 ? 'two_sets' : 'one_set';
      roundElement.querySelector('[name="roundStatus"]').value = round.is_complete === false ? 'incomplete' : 'complete';
    });
  }

  async function confirmTraining(sessionId) {
    setAuthMessage('Training wird bestätigt …');
    const { error } = await state.client.rpc('confirm_training_session', { p_session_id: Number(sessionId) });
    if (error) return setAuthMessage(error.message, 'error');
    setAuthMessage('Training bestätigt.', 'success');
    await refresh();
  }

  async function deleteTraining(sessionId) {
    const { error } = await state.client.rpc('delete_my_pending_training', { p_session_id: Number(sessionId) });
    if (error) return setAuthMessage(error.message, 'error');
    setAuthMessage('Training gelöscht.', 'success');
    await refresh();
  }

  async function savePrediction(matchId, prediction) {
    if (!state.session?.user) {
      openAuthDialog();
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
      setAuthMessage(error.message, 'error');
      openAuthDialog();
    } else {
      await loadPublicData();
    }
    render();
  }

  function bindEvents() {
    document.addEventListener('click', async event => {
      if (!event.target.closest('[data-training-player-picker]')) closeTrainingPlayerMenus();
      const open = event.target.closest('[data-auth-open]');
      if (open) {
        openAuthDialog();
        return;
      }
      if (event.target.closest('[data-auth-close]')) {
        closeAuthDialog();
        return;
      }
      const mode = event.target.closest('[data-auth-mode]');
      if (mode) {
        setAuthMode(mode.dataset.authMode);
        return;
      }
      if (event.target.closest('[data-auth-logout]')) {
        await state.client.auth.signOut();
        closeAuthDialog();
        return;
      }
      const confirmResultButton = event.target.closest('[data-result-confirm]');
      if (confirmResultButton) {
        await confirmResult(confirmResultButton.dataset.resultConfirm, confirmResultButton);
        return;
      }
      const counterproposalToggle = event.target.closest('[data-counterproposal-toggle]');
      if (counterproposalToggle) {
        const card = counterproposalToggle.closest('.result-task-card');
        const form = card?.querySelector('.result-entry-form.is-counterproposal');
        if (form) {
          form.hidden = !form.hidden;
          counterproposalToggle.textContent = form.hidden ? 'Alternative eingeben' : 'Alternative schließen';
          if (!form.hidden) updateResultSummary(form);
        }
        return;
      }
      const resultEntryToggle = event.target.closest('[data-result-entry-toggle]');
      if (resultEntryToggle) {
        const card = resultEntryToggle.closest('.result-task-card');
        const form = card?.querySelector('.result-entry-form:not(.is-counterproposal)');
        if (form) {
          form.hidden = !form.hidden;
          resultEntryToggle.textContent = form.hidden ? 'Ergebnis eintragen' : 'Eingabe schließen';
          if (!form.hidden) updateResultSummary(form);
        }
        return;
      }
      const scoreStep = event.target.closest('[data-result-score-step]');
      if (scoreStep) {
        const input = scoreStep.parentElement?.querySelector('[data-result-score]');
        if (!input) return;
        const step = Number(scoreStep.dataset.resultScoreStep);
        const value = window.PadelScoreInput.stepScoreValue(input.value, step);
        if (value === null) return;
        input.value = value;
        if (step > 0) initializeResultScorePair(input);
        window.PadelScoreInput.setActivePair(input.closest('.result-score-pair'));
        updateResultSummary(input.closest('[data-result-submit]'));
        return;
      }
      const trainingToggle = event.target.closest('[data-training-toggle]');
      if (trainingToggle) {
        const form = document.getElementById('training-form');
        form.hidden = !form.hidden;
        if (!form.hidden) {
          state.editingTrainingId = null;
          state.trainingRoundCount = 1;
          renderTrainingForm();
        }
        return;
      }
      const trainingPlayerToggle = event.target.closest('[data-training-player-toggle]');
      if (trainingPlayerToggle) {
        toggleTrainingPlayerMenu(trainingPlayerToggle);
        return;
      }
      const trainingPlayerOption = event.target.closest('[data-training-player-id]');
      if (trainingPlayerOption) {
        selectTrainingPlayer(trainingPlayerOption);
        return;
      }
      if (event.target.closest('[data-training-round-add]')) {
        const preserved = readTrainingRoundValues();
        state.trainingRoundCount += 1;
        renderTrainingRounds(preserved);
        return;
      }
      const removeRound = event.target.closest('[data-training-round-remove]');
      if (removeRound) {
        const preserved = readTrainingRoundValues();
        preserved.splice(Number(removeRound.dataset.trainingRoundRemove), 1);
        state.trainingRoundCount = Math.max(1, state.trainingRoundCount - 1);
        renderTrainingRounds(preserved);
        return;
      }
      const confirmTrainingButton = event.target.closest('[data-training-confirm]');
      if (confirmTrainingButton) {
        await confirmTraining(confirmTrainingButton.dataset.trainingConfirm);
        return;
      }
      const editTrainingButton = event.target.closest('[data-training-edit]');
      if (editTrainingButton) {
        editTraining(editTrainingButton.dataset.trainingEdit);
        return;
      }
      const deleteTrainingButton = event.target.closest('[data-training-delete]');
      if (deleteTrainingButton) {
        await deleteTraining(deleteTrainingButton.dataset.trainingDelete);
        return;
      }
      const prediction = event.target.closest('[data-prediction-match]');
      if (prediction) {
        savePrediction(prediction.dataset.predictionMatch, prediction.dataset.predictionValue);
      }
    });

    document.getElementById('auth-form')?.addEventListener('submit', handleAuthSubmit);
    const trainingForm = document.getElementById('training-form');
    trainingForm?.addEventListener('submit', handleTrainingSubmit);
    trainingForm?.addEventListener('invalid', handleTrainingInvalid, true);
    document.addEventListener('submit', event => {
      if (event.target.matches('[data-match-schedule]')) handleScheduleSubmit(event);
      else if (event.target.matches('[data-result-submit]')) handleResultSubmit(event);
    });
    document.addEventListener('input', event => {
      if (event.target.matches('[data-result-score]')) {
        event.target.value = window.PadelScoreInput.sanitizeScoreValue(event.target.value);
        initializeResultScorePair(event.target);
        window.PadelScoreInput.setActivePair(event.target.closest('.result-score-pair'));
        updateResultSummary(event.target.closest('[data-result-submit]'));
      }
    });
    document.addEventListener('pointerdown', event => {
      const scoreControl = event.target.closest('[data-result-score], [data-result-score-step]');
      if (!scoreControl) return;
      window.PadelScoreInput.setActivePair(scoreControl.closest('.result-score-pair'));
      const input = event.target.closest('[data-result-score]');
      if (input && input.value) {
        input.value = '';
        updateResultSummary(input.closest('[data-result-submit]'));
      }
    });
    document.addEventListener('focusin', event => {
      const scoreControl = event.target.closest('[data-result-score], [data-result-score-step]');
      if (scoreControl) window.PadelScoreInput.setActivePair(scoreControl.closest('.result-score-pair'));
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeTrainingPlayerMenus();
    });
    document.getElementById('auth-dialog')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) closeAuthDialog();
    });
  }

  async function init(season) {
    state.season = season;
    render();
    const config = window.PADEL_SUPABASE_CONFIG;
    if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) {
      state.error = 'Supabase ist nicht vollständig konfiguriert.';
      render();
      return;
    }

    state.client = window.PADEL_SUPABASE_CLIENT || window.supabase.createClient(config.url, config.publishableKey);
    window.PADEL_SUPABASE_CLIENT = state.client;
    if (!state.bound) {
      bindEvents();
      state.bound = true;
    }
    setAuthMode('login');
    const { data: { session }, error } = await state.client.auth.getSession();
    if (error) {
      state.error = error.message;
      render();
      return;
    }
    state.session = session;
    state.client.auth.onAuthStateChange((_event, nextSession) => {
      state.session = nextSession;
      window.setTimeout(refresh, 0);
    });
    await refresh();
  }

  window.PadelTippspiel = { init, refresh, render };
})();
