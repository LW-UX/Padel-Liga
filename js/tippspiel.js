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
  const COMPANY_SHORT_LABELS = Object.freeze({
    Envidual: 'ENV',
    Headsquare: 'HSQ',
    Hanako: 'HAN',
    Test: 'TEST'
  });
  const state = {
    client: null,
    season: null,
    session: null,
    profile: null,
    databaseMatches: new Map(),
    playerElos: new Map(),
    seasonParticipants: [],
    predictions: new Map(),
    bonusQuestions: [],
    bonusAnswers: new Map(),
    matchFloorPredictions: new Map(),
    leaderboard: [],
    leaderboardReady: false,
    leaderboardError: null,
    seasonCompleted: null,
    saving: new Set(),
    bonusSaving: new Set(),
    ready: false,
    error: null,
    bound: false,
    sortMode: 'status',
    sortDescending: false,
    leaderboardSortMode: 'points',
    articleExpanded: false,
    tableView: 'matches',
    tableEntries: new Map(),
    tableRequested: false,
    tableReady: false,
    tableError: null
  };

  const BONUS_QUESTION_PRESENTATION = Object.freeze({
    champion: {
      order: 1,
      title: 'Liga-Champion',
      question: 'Wer wird der nächste PadelLiga-Champion?'
    },
    final_four_players: {
      order: 2,
      title: 'Final Four',
      question: 'Welche vier Spieler erreichen das Final Four?'
    },
    league_winner: {
      order: 3,
      title: 'Liga-Erster',
      question: 'Wer belegt nach der Ligaphase Platz 1?'
    },
    league_game_difference: {
      order: 4,
      title: 'Spiel-Differenz',
      question: 'Wer hat nach der Ligaphase die beste Spiel-Differenz?'
    },
    league_elo_gain: {
      order: 5,
      title: 'Elo-Zuwachs',
      question: 'Wer hat nach der Ligaphase den größten Elo-Zuwachs?'
    },
    company_winner: {
      order: 6,
      title: 'Firma',
      question: 'Welche Firma gewinnt nach Ø-Punkten je Teilnehmer?'
    }
  });

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  const RACKET_ICON_SVG = '<g transform="rotate(40 12 12)"><path d="M12 1.5c3.4 0 5.6 2.7 5.6 6.2 0 3.6-2.4 6.6-5.6 6.6s-5.6-3-5.6-6.6c0-3.5 2.2-6.2 5.6-6.2Z"/><path d="M9.6 13.6 11 16.6h2l1.4-3"/><rect x="10.8" y="16.6" width="2.4" height="5.6" rx="1.1"/><path d="M10 6h.01M14 6h.01M12 8h.01M10 10h.01M14 10h.01"/></g>';

  function renderPredictionAccountTypeIcon(entry) {
    if (typeof entry?.is_player !== 'boolean') return '';
    const label = entry.is_player ? 'Spieler' : 'Tipper';
    const icon = entry.is_player
      ? RACKET_ICON_SVG
      : '<path d="M2 9a3 3 0 0 1 0 6v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3a3 3 0 0 1 0-6V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="m9 12 2 2 4-4"/>';
    return `<span class="prediction-account-type-icon" role="img" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon}</svg></span>`;
  }

  function renderPredictionCompanyBadge(entry) {
    const company = String(entry?.company || '').trim();
    if (!company) return '';
    if (COMPANY_SHORT_LABELS[company]) {
      return `<span class="firma-badge firma-icon firma-${escapeHtml(company)} prediction-company-badge" role="img" aria-label="Firma ${escapeHtml(company)}" title="${escapeHtml(company)}"></span>`;
    }
    const shortLabel = company.slice(0, 3).toUpperCase();
    return `<span class="firma-badge firma-${escapeHtml(company)} prediction-company-badge" aria-label="Firma ${escapeHtml(company)}" title="${escapeHtml(company)}">${escapeHtml(shortLabel)}</span>`;
  }

  function renderPreviousPredictionWinnerIcon(entry) {
    if (entry?.previous_prediction_winner !== true) return '';
    const seasonLabel = String(entry.previous_prediction_season_label || '').trim();
    const label = `Tippsieger${seasonLabel ? ` ${seasonLabel}` : ''}`;
    return `<span class="prediction-achievement-icon prediction-achievement-icon--winner" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><svg viewBox="0 0 28 32" aria-hidden="true" focusable="false"><path d="M8 3h12v5c0 5-2.4 8.5-6 10-3.6-1.5-6-5-6-10V3Z"/><path d="M8 6H4v2c0 4 2 6 5.3 6.7M20 6h4v2c0 4-2 6-5.3 6.7"/><path d="M14 18v6M11 24h6v4M9 28h10"/></svg></span>`;
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

  function formatMatchdayLabel(spieltag, count) {
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
    return `<h3><span>${escapeHtml(label)} (${count})</span>${range ? `<span>${escapeHtml(range)}</span>` : ''}</h3>`;
  }

  function renderMatchGroup(labelHtml, matches, renderMatch) {
    if (!matches.length) return '';
    return `<section class="match-group">${labelHtml}<div class="match-list">${matches.map(renderMatch).join('')}</div></section>`;
  }

  function applyPredictionSortDirection(items) {
    return state.sortDescending ? [...items].reverse() : items;
  }

  function renderMatchesByMatchday(matches, renderMatch) {
    const matchdays = applyPredictionSortDirection([...new Set(matches.map(match => match.spieltag))]
      .sort((first, second) => Number(first ?? Infinity) - Number(second ?? Infinity)));
    return matchdays.map(spieltag => {
      const matchdayMatches = applyPredictionSortDirection(matches
        .filter(match => match.spieltag === spieltag)
        .sort(compareMatchesByNumber));
      return renderMatchGroup(
        formatMatchdayLabel(spieltag, matchdayMatches.length),
        matchdayMatches,
        renderMatch
      );
    }).join('');
  }

  function isBonusQuestionOpen(question) {
    const lockAt = question?.lock_at ? new Date(question.lock_at).getTime() : NaN;
    return question?.is_open === true && Number.isFinite(lockAt) && lockAt > Date.now();
  }

  function getBonusAnswers(questionId) {
    return [...(state.bonusAnswers.get(questionId) || [])];
  }

  function isBonusQuestionComplete(question) {
    return getBonusAnswers(question.question_id).length >= Number(question.max_selections || 1);
  }

  function getBonusOptionLabel(value) {
    return (window.PADEL_PLAYERS || []).find(player => player.id === value)?.name || value;
  }

  function getBonusOptionMeta(value) {
    return (window.PADEL_PLAYERS || []).find(player => player.id === value)?.initials || '';
  }

  function getBonusQuestionOptions(question) {
    if (question.question_type === 'company_winner') {
      return (state.season?.organizations || []).map(company => ({ value: company, label: company }));
    }
    const participants = state.seasonParticipants.length
      ? state.seasonParticipants
      : Array.isArray(state.season?.participants) ? state.season.participants : [];
    return participants.map(participant => ({
      value: participant.playerId,
      label: getBonusOptionLabel(participant.playerId),
      meta: getBonusOptionMeta(participant.playerId)
    })).sort((first, second) => first.label.localeCompare(second.label, 'de'));
  }

  function getBonusQuestionPresentation(question) {
    return BONUS_QUESTION_PRESENTATION[question.question_type] || {
      order: Number(question.sort_order) || Number.MAX_SAFE_INTEGER,
      title: question.label,
      question: question.explanation || ''
    };
  }

  function compareBonusQuestions(first, second) {
    return getBonusQuestionPresentation(first).order - getBonusQuestionPresentation(second).order;
  }

  function renderBonusPicker({
    question,
    options,
    selected,
    slot,
    disabled,
    label,
    placeholder,
    searchable
  }) {
    const menuId = `prediction-bonus-picker-${question.question_id}-${slot}`;
    const selectedOption = options.find(option => option.value === selected);
    const displayLabel = selectedOption?.label || placeholder;
    return `
      <div
        class="viewer-picker prediction-bonus-picker${searchable ? '' : ' prediction-bonus-picker--no-search'}"
        data-bonus-picker
        data-bonus-question="${escapeHtml(question.question_id)}"
        data-bonus-slot="${slot}"
      >
        <div class="viewer-split-button">
          <div class="viewer-combobox">
            <button
              class="secondary-button secondary-button--dropdown"
              type="button"
              data-bonus-picker-toggle
              aria-label="${escapeHtml(label)}${Number(question.max_selections) > 1 ? `, Auswahl ${slot + 1}` : ''}: ${escapeHtml(displayLabel)}"
              aria-haspopup="listbox"
              aria-expanded="false"
              aria-controls="${escapeHtml(menuId)}"
              ${disabled ? 'disabled' : ''}
            ><span data-bonus-picker-label>${escapeHtml(displayLabel)}</span></button>
            ${searchable ? `<input
              class="viewer-search-input"
              type="search"
              data-bonus-picker-search
              role="combobox"
              aria-label="${escapeHtml(label)} suchen"
              aria-controls="${escapeHtml(menuId)}"
              aria-expanded="false"
              autocomplete="off"
              spellcheck="false"
              placeholder="Spieler suchen …"
              disabled
            >` : ''}
          </div>
        </div>
        <div class="viewer-menu prediction-bonus-picker-menu" id="${escapeHtml(menuId)}" role="listbox" aria-label="${escapeHtml(label)} auswählen">
          <button
            class="viewer-option${selected ? '' : ' active'}"
            type="button"
            role="option"
            aria-selected="${!selected}"
            data-bonus-picker-value=""
            ${searchable ? `data-bonus-picker-search-text="${escapeHtml(placeholder)}"` : ''}
          ><span>${escapeHtml(placeholder)}</span></button>
          ${options.map(option => {
            const usedElsewhere = option.value !== selected && getBonusAnswers(question.question_id).includes(option.value);
            return `<button
              class="viewer-option${option.value === selected ? ' active' : ''}"
              type="button"
              role="option"
              aria-selected="${option.value === selected}"
              data-bonus-picker-value="${escapeHtml(option.value)}"
              ${searchable ? `data-bonus-picker-search-text="${escapeHtml(option.label)} ${escapeHtml(option.meta || '')}"` : ''}
              ${usedElsewhere ? 'disabled' : ''}
            ><span>${escapeHtml(option.label)}</span>${option.meta ? `<span>${escapeHtml(option.meta)}</span>` : ''}</button>`;
          }).join('')}
          ${searchable ? '<div class="picker-search-empty" data-bonus-picker-search-empty hidden>Kein Spieler gefunden.</div>' : ''}
        </div>
      </div>
    `;
  }

  function getBonusStatusChip(question) {
    const answers = getBonusAnswers(question.question_id);
    if (state.bonusSaving.has(question.question_id)) {
      return { label: 'Speichert …', classes: 'is-open is-saving' };
    }
    if (question.resolved) {
      if (!answers.length) return { label: 'Kein Tipp', classes: 'is-locked' };
      const points = Number(question.points) || 0;
      return {
        label: `${points > 0 ? '+' : ''}${points} Punkte`,
        classes: `is-locked ${points > 0 ? 'points-4' : 'points-0'}`
      };
    }
    if (isBonusQuestionOpen(question)) {
      return answers.length
        ? { label: 'Gespeichert', classes: 'is-open' }
        : { label: 'Offen', classes: 'is-open' };
    }
    return { label: 'Gesperrt', classes: 'is-locked' };
  }

  function renderBonusQuestion(question) {
    const answers = getBonusAnswers(question.question_id);
    const options = getBonusQuestionOptions(question);
    const isOpen = isBonusQuestionOpen(question);
    const disabled = !isOpen || state.bonusSaving.has(question.question_id);
    const selectionCount = Number(question.max_selections) || 1;
    const presentation = getBonusQuestionPresentation(question);
    const selectedValues = question.resolved
      ? []
      : [...answers, ...Array(Math.max(0, selectionCount - answers.length)).fill('')]
        .slice(0, selectionCount);
    const status = getBonusStatusChip(question);
    const correctAnswers = Array.isArray(question.correct_answers) ? question.correct_answers : [];
    const ownAnswer = question.resolved && answers.length
      ? `<div class="prediction-bonus-answer">Dein Tipp: ${answers.map(getBonusOptionLabel).map(escapeHtml).join(', ')}</div>`
      : '';
    const result = question.resolved && correctAnswers.length
      ? `<div class="prediction-bonus-result">Richtig: ${correctAnswers.map(getBonusOptionLabel).map(escapeHtml).join(', ')}</div>`
      : '';
    const selects = selectedValues.map((selected, slot) => {
      const isCompanyPicker = question.question_type === 'company_winner';
      return renderBonusPicker({
        question,
        options,
        selected,
        slot,
        disabled,
        label: presentation.question || presentation.title,
        placeholder: isCompanyPicker ? 'Firma auswählen' : 'Spieler auswählen',
        searchable: !isCompanyPicker
      });
    }).join('');
    const selectionControls = selects
      ? `<div class="prediction-bonus-selects">${selects}</div>`
      : '';

    return `
      <article class="prediction-match-card prediction-bonus-card ${answers.length ? 'has-prediction' : ''} ${isOpen ? '' : 'is-locked'} ${question.resolved ? `points-${Number(question.points) || 0}` : ''}">
        <div class="prediction-bonus-copy">
          <strong>${escapeHtml(presentation.title)}</strong>
          ${presentation.question ? `<span>${escapeHtml(presentation.question)}</span>` : ''}
        </div>
        <div class="prediction-bonus-options">
          ${selectionControls}
          ${ownAnswer}
          ${result}
        </div>
        <span class="prediction-status ${status.classes}">${escapeHtml(status.label)}</span>
      </article>
    `;
  }

  function renderPredictionHtmlGroup(label, cards) {
    if (!cards.length) return '';
    return `<section class="match-group">${label}<div class="match-list">${cards.join('')}</div></section>`;
  }

  function renderSortToggle() {
    const toggle = document.getElementById('prediction-sort-toggle');
    if (toggle) toggle.dataset.sortDirection = state.sortDescending ? 'descending' : 'ascending';
    document.querySelectorAll('[data-prediction-sort]').forEach(button => {
      const isActive = button.dataset.predictionSort === state.sortMode;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
      if (isActive) button.setAttribute('aria-label', `${button.textContent.trim()}, ${state.sortDescending ? 'absteigend' : 'aufsteigend'}`);
      else button.removeAttribute('aria-label');
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
    return window.PadelSeasonRouting.getMatchUrl(seasonId, match).href;
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
    return `<a class="prediction-match-center prediction-match-center-link${resultClass}" href="${getMatchDetailHref(match)}" data-match-statistics="${escapeHtml(match.id)}" aria-label="${escapeHtml(ariaLabel)}">${escapeHtml(label)}</a>`;
  }

  function getStatusChip({ isCancelled, isOwn, isOpen, isUpcoming, isSaving, actualValue, selected, points }) {
    if (isCancelled) return { label: 'Ohne Wertung', classes: 'is-locked' };
    if (isOwn) return { label: 'Eigene Partie', classes: 'is-locked is-own-match' };
    if (isUpcoming) return { label: 'Noch nicht offen', classes: 'is-upcoming' };
    if (isOpen) return {
      label: isSaving ? 'Speichert …' : selected ? 'Gespeichert' : 'Offen',
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
        return `<a class="${className} player-profile-link" href="../?spielerprofil=${encodeURIComponent(playerId)}" data-player-profile-id="${escapeHtml(playerId)}" aria-label="Profil von ${escapeHtml(player)} öffnen">${escapeHtml(player)}</a>`;
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

  function getOwnLeaderboardPosition() {
    const userId = state.session?.user?.id;
    if (!userId) return { entry: null, index: -1 };
    const index = state.leaderboard.findIndex(entry => entry.user_id === userId);
    return { entry: index >= 0 ? state.leaderboard[index] : null, index };
  }

  function formatCount(value) {
    return new Intl.NumberFormat('de-DE').format(Number(value) || 0);
  }

  function formatDeadline(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    const day = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin', weekday: 'long', day: 'numeric', month: 'long'
    }).format(date);
    const time = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit'
    }).format(date);
    return `${day} · ${time} Uhr`;
  }

  function getTodayKey() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date()).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function getCurrentOverviewArticle() {
    const articles = Array.isArray(state.season?.articles) ? state.season.articles : [];
    const todayKey = getTodayKey();
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

  function renderArticleMeta(meta) {
    const [label, ...details] = formatArticleMeta(meta).split(/\s*\|\s*/);
    return `<div class="article-meta">
      <span>${escapeHtml(label)}</span>
      ${details.length ? `<span>${escapeHtml(details.join(' | '))}</span>` : ''}
    </div>`;
  }

  function renderArticleNewspaperHeader(article) {
    return `<header class="article-newspaper-header">
      <div class="article-newspaper-masthead" aria-label="PadelPost"><span>Padel</span><span>Post</span></div>
      ${renderArticleMeta(article.meta || `Spieltag ${article.spieltag}`)}
    </header>`;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function renderArticlePlayerLink(player, visibleName) {
    if (!player?.id || !player?.name) return escapeHtml(visibleName || '');
    return `<button type="button" class="player-profile-link article-player-link" data-player-profile-id="${escapeHtml(player.id)}" aria-label="Profil von ${escapeHtml(player.name)} öffnen">${escapeHtml(visibleName)}</button>`;
  }

  function linkArticlePlayerNames(html) {
    const players = (window.PADEL_PLAYERS || []).filter(player => player?.id && player?.name);
    if (!html || !players.length) return html || '';
    const playersByKey = new Map(players.map(player => [player.name.replace(/\.$/, ''), player]));
    const pattern = new RegExp(
      `(^|[^\\p{L}])(${[...playersByKey.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})\\.?(?![\\p{L}])`,
      'gu'
    );
    return String(html).split(/(<[^>]*>)/).map(part => {
      if (part.startsWith('<')) return part;
      return part.replace(pattern, (match, prefix, key) => {
        const visibleName = match.slice(prefix.length);
        return `${prefix}${renderArticlePlayerLink(playersByKey.get(key), visibleName)}`;
      });
    }).join('');
  }

  function renderOverviewArticleBlock(block) {
    if (block.type === 'h') return `<h4>${linkArticlePlayerNames(block.text)}</h4>`;
    if (block.type === 'match') {
      let matchup = block.text;
      let result = block.result;
      let resultLabel = block.resultLabel || 'Ergebnis';
      if (!result) {
        [matchup, result] = String(block.text || '').split(/\s*\|\s*Ergebnis:\s*/);
        resultLabel = 'Ergebnis';
      }
      const match = block.matchId ? state.season?.matches?.find(item => item.id === block.matchId) : null;
      return `<div class="article-match${match ? ' has-partie-detail' : ''}">
        ${match ? `<button type="button" class="article-match-action" data-match-statistics="${escapeHtml(match.id)}" aria-label="Partiedetails öffnen"></button>` : ''}
        <span>${linkArticlePlayerNames(matchup)}</span>
        ${result ? `<span class="article-match-result">${escapeHtml(resultLabel)}: ${escapeHtml(result)}</span>` : ''}
      </div>`;
    }
    if (block.type === 'quote') {
      return `<blockquote><p>${block.text}</p><cite>${block.author}</cite></blockquote>`;
    }
    return `<p>${block.text}</p>`;
  }

  function renderOverviewArticleCard(article) {
    return `<article class="article-card article-newspaper">
      ${renderArticleNewspaperHeader(article)}
      <h2>${article.title}</h2>
      <div class="article-newspaper-publisher">United we Padel</div>
      <div class="article-body">${article.body.map(renderOverviewArticleBlock).join('')}</div>
    </article>`;
  }

  function renderOverviewArticle() {
    const article = getCurrentOverviewArticle();
    if (!article) return '';
    return `<article class="widget widget-articles prediction-overview-block prediction-overview-article">
      <div class="home-article-preview${state.articleExpanded ? ' expanded' : ''}" id="prediction-home-article-preview">
        ${renderOverviewArticleCard(article)}
      </div>
      <button class="text-link article-readmore" type="button" data-expand-prediction-article${state.articleExpanded ? ' hidden' : ''}>Weiterlesen</button>
    </article>`;
  }

  function getOpenPredictionSummary() {
    const openMatches = getPredictionLocalMatches().filter(isPredictionOpen);
    const openBonusQuestions = state.bonusQuestions.filter(isBonusQuestionOpen);
    const remainingMatches = state.session?.user
      ? openMatches.filter(match => !state.predictions.has(match.id))
      : openMatches;
    const remainingBonusQuestions = state.session?.user
      ? openBonusQuestions.filter(question => !isBonusQuestionComplete(question))
      : openBonusQuestions;
    const nextDeadline = [
      ...remainingMatches.map(match => state.databaseMatches.get(match.id)?.match_at),
      ...remainingBonusQuestions.map(question => question.lock_at)
    ]
      .filter(Boolean)
      .map(value => new Date(value))
      .filter(date => !Number.isNaN(date.getTime()) && date.getTime() > Date.now())
      .sort((first, second) => first - second)[0] || null;
    return { openMatches, openBonusQuestions, remainingMatches, remainingBonusQuestions, nextDeadline };
  }

  function getMatchdayTitle(match) {
    const configured = (state.season?.matchdays || []).find(day => day.spieltag === match.spieltag);
    return configured?.title || (match.spieltag != null ? `Spieltag ${match.spieltag}` : 'Letzte Wertung');
  }

  function getPersonalContributions() {
    if (!state.session?.user) return [];
    return getPredictionLocalMatches().flatMap(match => {
      if (isCancelledMatch(match)) return [];
      const actualValue = getActualPredictionValue(match);
      if (!actualValue) return [];
      const format = getMatchFormat(match);
      const selected = state.predictions.get(match.id);
      let points = getPredictionPoints(selected, actualValue, format);
      let automatic = false;
      if (points === null && isOwnMatch(match)) {
        const floorValues = [...(state.matchFloorPredictions.get(match.id) || [])];
        const floorPoints = floorValues
          .map(value => getPredictionPoints(value, actualValue, format))
          .filter(value => value !== null);
        if (floorPoints.length) {
          points = Math.min(...floorPoints);
          automatic = true;
        }
      }
      if (points === null) return [];
      const databaseMatch = state.databaseMatches.get(match.id);
      const matchNumber = Number(match.id.match(/\d+$/)?.[0]) || 0;
      return [{
        match,
        points,
        automatic,
        sortTime: databaseMatch?.match_at ? new Date(databaseMatch.match_at).getTime() : 0,
        matchNumber
      }];
    });
  }

  function getLatestPersonalRound() {
    const contributions = getPersonalContributions();
    if (!contributions.length) return null;
    contributions.sort((first, second) => {
      const firstDay = Number(first.match.spieltag);
      const secondDay = Number(second.match.spieltag);
      if (Number.isFinite(firstDay) && Number.isFinite(secondDay) && firstDay !== secondDay) return firstDay - secondDay;
      if (first.sortTime !== second.sortTime) return first.sortTime - second.sortTime;
      return first.matchNumber - second.matchNumber;
    });
    const latest = contributions.at(-1);
    const group = latest.match.spieltag == null
      ? [latest]
      : contributions.filter(item => item.match.spieltag === latest.match.spieltag);
    return {
      label: getMatchdayTitle(latest.match),
      points: group.reduce((total, item) => total + item.points, 0),
      exact: group.filter(item => !item.automatic && item.points === 4).length,
      tendency: group.filter(item => !item.automatic && item.points === 2).length,
      wrong: group.filter(item => !item.automatic && item.points === 0).length,
      automatic: group.filter(item => item.automatic).length
    };
  }

  function renderOverviewRankRows() {
    if (!state.leaderboard.length) {
      return '<div class="prediction-overview-empty">Noch keine Tippwertung vorhanden.</div>';
    }
    const { index: ownIndex } = getOwnLeaderboardPosition();
    const indexes = [0, 1, 2].filter(index => state.leaderboard[index]);
    if (ownIndex >= 3) indexes.push(ownIndex);
    return indexes.map((index, position) => {
      const entry = state.leaderboard[index];
      const isOwn = index === ownIndex;
      const separated = position === 3 ? ' prediction-overview-rank-separated' : '';
      return `
        <div class="mini-rank-row r${index + 1}${isOwn ? ' viewer-highlight' : ''}${separated}">
          <span class="rank-position">${index + 1}</span>
          <span class="mini-rank-name"><span class="prediction-rank-account"><span class="prediction-rank-account-name">${escapeHtml(entry.display_name)}</span>${renderPredictionAccountTypeIcon(entry)}${renderPredictionCompanyBadge(entry)}${renderPreviousPredictionWinnerIcon(entry)}</span></span>
          <span class="rank-score">${formatCount(entry.points)} Pkt.</span>
        </div>
      `;
    }).join('');
  }

  function renderPersonalStand(entry, index) {
    const displayName = window.PadelKonto?.getDisplayName?.() || state.session?.user?.email || 'Dein Konto';
    const passivePoints = getPersonalContributions()
      .filter(item => item.automatic)
      .reduce((total, item) => total + item.points, 0);
    let context = 'Mit deiner ersten Wertung erscheinst du in der Tipprangliste.';
    if (entry && index === 0) {
      const lead = Number(entry.points) - Number(state.leaderboard[1]?.points || 0);
      context = state.leaderboard.length > 1
        ? lead > 0 ? `${formatCount(lead)} ${lead === 1 ? 'Punkt' : 'Punkte'} Vorsprung auf Platz 2.` : 'Die Spitze ist punktgleich.'
        : 'Du führst die Tipprangliste an.';
    } else if (entry && index > 0) {
      const gap = Math.max(0, Number(state.leaderboard[index - 1]?.points || 0) - Number(entry.points || 0));
      context = gap > 0
        ? `${formatCount(gap)} ${gap === 1 ? 'Punkt' : 'Punkte'} bis zum nächsten Platz.`
        : `Punktgleich mit Platz ${index}.`;
    }
    return `
      <article class="widget prediction-overview-block prediction-overview-stand prediction-overview-personal-stand">
        <div class="prediction-overview-stand-copy">
          <h3>Dein Stand</h3>
          <div class="prediction-overview-account">${escapeHtml(displayName)}</div>
          <p>${escapeHtml(context)}</p>
        </div>
        <div class="prediction-overview-scoreline">
          <div><div class="stat-main">${entry ? index + 1 : '–'}</div><div class="stat-copy">Platz</div></div>
          <div><div class="stat-main">${formatCount(entry?.points)}</div><div class="stat-copy">Punkte</div></div>
          <div>
            <div class="stat-main prediction-passive-points-value">
              <span>${formatCount(passivePoints)}</span>
              <span class="th-help-wrap prediction-passive-points-help">
                <span class="help-icon" tabindex="0" role="button" aria-label="Passive Punkte erklären" aria-describedby="prediction-passive-points-help" data-help-tooltip-anchor>?</span>
                <span class="help-tooltip" id="prediction-passive-points-help" role="tooltip">Deine eigenen Partien kannst du nicht tippen. Sobald sie gewertet werden, erhältst du automatisch so viele Punkte wie der schlechteste tatsächlich abgegebene Tipp der anderen. Hat niemand getippt, gibt es keine automatische Gutschrift.</span>
              </span>
            </div>
            <div class="stat-copy">Passive Punkte</div>
          </div>
        </div>
      </article>
    `;
  }

  function formatOpenPredictionTitle(count) {
    return count === 1
      ? '1 Tipp offen'
      : `${count} Tipps offen`;
  }

  function renderPredictionAction() {
    const {
      openMatches, openBonusQuestions, remainingMatches, remainingBonusQuestions, nextDeadline
    } = getOpenPredictionSummary();
    const openCount = openMatches.length + openBonusQuestions.length;
    const remainingCount = remainingMatches.length + remainingBonusQuestions.length;
    const noDeadlineCopy = 'Du kannst deine Prognosen bis zum Spielbeginn ändern - genug Zeit für Elo-Studium, Bauchgefühl und die Frage: klares 2:0 oder doch 2:1?';
    if (!state.session?.user) {
      return `
        <article class="widget prediction-overview-block prediction-overview-action">
          <h2>${openCount ? formatOpenPredictionTitle(openCount) : 'Gerade nichts offen'}</h2>
          <p>${nextDeadline ? `Nächster Tippschluss: ${escapeHtml(formatDeadline(nextDeadline))}.` : openCount ? noDeadlineCopy : 'Neue Tippmöglichkeiten erscheinen automatisch näher am Spieltag.'}</p>
          <button class="primary-button" type="button" data-auth-open>Login / Konto erstellen</button>
        </article>
      `;
    }
    if (remainingCount) {
      return `
        <article class="widget prediction-overview-block prediction-overview-action has-open-tips">
          <h2>${formatOpenPredictionTitle(remainingCount)}</h2>
          <p>${nextDeadline ? `Nächster Tippschluss: ${escapeHtml(formatDeadline(nextDeadline))}.` : noDeadlineCopy}</p>
          <button class="primary-button" type="button" data-tip-nav="tippen">Jetzt tippen</button>
        </article>
      `;
    }
    const allDone = openCount > 0;
    return `
      <article class="widget prediction-overview-block prediction-overview-action${allDone ? ' is-complete' : ''}">
        <h2>${allDone ? 'Alles getippt ✓' : 'Gerade nichts zu tun'}</h2>
        <p>${allDone ? `Deine ${openCount === 1 ? 'offene Prognose ist' : `${openCount} offenen Prognosen sind`} gespeichert.` : state.seasonCompleted ? 'Die Tippabgabe dieser Saison ist abgeschlossen.' : 'Neue Tippmöglichkeiten erscheinen automatisch näher am Spieltag.'}</p>
        <button class="secondary-button" type="button" data-tip-nav="tippen">Tippabgabe ansehen</button>
      </article>
    `;
  }

  function renderLatestEvaluation() {
    const latest = getLatestPersonalRound();
    if (!latest) {
      return `
        <article class="widget prediction-overview-block prediction-overview-latest">
          <div class="eyebrow">Letzte Auswertung</div>
          <h2>Noch keine Wertung</h2>
          <p>Sobald ein bestätigtes Ergebnis für dich gewertet wurde, erscheint hier die Zusammenfassung.</p>
        </article>
      `;
    }
    const details = [
      { value: `${latest.points > 0 ? '+' : ''}${formatCount(latest.points)}`, label: latest.points === 1 ? 'Punkt' : 'Punkte' }
    ];
    if (latest.exact) details.push({ value: `${latest.exact}×`, label: 'exakt' });
    if (latest.tendency) details.push({ value: `${latest.tendency}×`, label: 'Sieger richtig' });
    if (latest.wrong) details.push({ value: `${latest.wrong}×`, label: 'ohne Punkte' });
    if (latest.automatic) details.push({ value: `${latest.automatic}×`, label: 'automatisch gewertet' });
    return `
      <article class="widget prediction-overview-block prediction-overview-latest">
        <h3>Letzte Auswertung · ${escapeHtml(latest.label)}</h3>
        <div class="prediction-overview-stats prediction-overview-latest-stats">
          ${details.map(detail => `<div><strong>${escapeHtml(detail.value)}</strong><span class="stat-copy">${escapeHtml(detail.label)}</span></div>`).join('')}
        </div>
      </article>
    `;
  }

  function renderSeasonBalance(entry) {
    const predictions = Number(entry?.predictions_count) || 0;
    const scored = Number(entry?.scored_count) || 0;
    const exact = Number(entry?.exact_count) || 0;
    const correctWinners = exact + (Number(entry?.tendency_count) || 0);
    const matchPoints = (Number(entry?.points) || 0) - (Number(entry?.bonus_points) || 0);
    const average = scored ? (matchPoints / scored).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '–';
    const scoredPredictions = getPersonalContributions().filter(item => !item.automatic).length;
    const exactRate = scoredPredictions ? `${Math.round((exact / scoredPredictions) * 100)} %` : '–';
    return `
      <article class="widget prediction-overview-block prediction-overview-balance">
        <h3>Deine Saisonbilanz</h3>
        <div class="prediction-overview-stats">
          <div><strong>${formatCount(predictions)}</strong><span class="stat-copy">Tipps</span></div>
          <div><strong>${formatCount(scored)}</strong><span class="stat-copy">Wertungen</span></div>
          <div><strong>${average}</strong><span class="stat-copy">Ø Punkte</span></div>
          <div><strong>${formatCount(correctWinners)}</strong><span class="stat-copy">Sieger richtig</span></div>
          <div><strong>${formatCount(exact)}</strong><span class="stat-copy">Exakt</span></div>
          <div><strong>${exactRate}</strong><span class="stat-copy">Exaktquote</span></div>
        </div>
      </article>
    `;
  }

  function renderGuestStand() {
    return `
      <article class="widget prediction-overview-block prediction-overview-stand prediction-overview-guest">
        <div class="eyebrow">Dein PadelTipp</div>
        <h2>Tippen, mitfiebern, Punkte sammeln.</h2>
        <p>Mit einem gemeinsamen Padel-Konto speicherst du deine Prognosen und siehst hier deinen persönlichen Saisonstand.</p>
      </article>
    `;
  }

  function renderGuestCommunity() {
    const participants = state.leaderboard.length;
    const predictions = state.leaderboard.reduce((total, entry) => total + (Number(entry.predictions_count) || 0), 0);
    return `
      <article class="widget prediction-overview-block prediction-overview-community">
        <h3>Diese Saison</h3>
        <div class="prediction-overview-scoreline">
          <div><div class="stat-main">${formatCount(participants)}</div><div class="stat-copy">Teilnehmende</div></div>
          <div><div class="stat-main">${formatCount(predictions)}</div><div class="stat-copy">Tipps</div></div>
        </div>
      </article>
    `;
  }

  function renderOverview() {
    const target = document.getElementById('prediction-overview');
    if (!target) return;
    if (state.error) {
      target.innerHTML = `<div class="prediction-error">Die Tippzentrale kann gerade nicht geladen werden.<small>${escapeHtml(state.error)}</small></div>`;
      return;
    }
    if (!state.ready) {
      target.innerHTML = '<div class="prediction-overview-loading">Deine Tippzentrale wird geladen …</div>';
      return;
    }
    const { entry, index } = getOwnLeaderboardPosition();
    // Desktop verteilt die Blöcke auf zwei Spalten; mobil ordnet CSS sie in einer Lesereihenfolge an.
    const stand = state.session?.user ? renderPersonalStand(entry, index) : renderGuestStand();
    const action = renderPredictionAction();
    const leaders = `
      <article class="widget prediction-overview-block prediction-overview-leaders">
        <h3>Spitzenfeld</h3>
        <div class="prediction-overview-ranks">${renderOverviewRankRows()}</div>
        <div class="home-widget-links">
          <button class="text-link inline-link" type="button" data-tip-nav="tippuebersicht">Zur Tipprangliste</button>
        </div>
      </article>
    `;
    const latest = state.session?.user ? renderLatestEvaluation() : renderGuestCommunity();
    const balance = state.session?.user ? renderSeasonBalance(entry) : '';
    const article = renderOverviewArticle();
    const leftColumn = state.session?.user ? `${action}${stand}${article}` : `${stand}${action}${article}`;
    const rightColumn = state.session?.user ? `${latest}${balance}${leaders}` : `${latest}${leaders}`;
    target.innerHTML = `
      <div class="prediction-overview-grid${state.session?.user ? '' : ' is-guest'}">
        <div class="prediction-overview-column prediction-overview-column--left">${leftColumn}</div>
        <div class="prediction-overview-column prediction-overview-column--right">${rightColumn}</div>
      </div>
    `;
  }

  function renderMatches() {
    const target = document.getElementById('prediction-matches');
    if (!target) return;

    if (state.error) {
      target.innerHTML = `<div class="prediction-error">Das Tippspiel kann gerade nicht geladen werden.<small>${escapeHtml(state.error)}</small></div>`;
      return;
    }

    if (!state.ready) {
      target.innerHTML = '<div class="empty-state">Offene Tipps werden geladen …</div>';
      return;
    }

    const matches = getPredictionLocalMatches();
    const bonusQuestions = [...state.bonusQuestions].sort(compareBonusQuestions);
    const openMatches = matches
      .filter(isPredictionOpen)
      .sort(compareMatchesByNumber);
    const upcomingMatches = matches
      .filter(isPredictionUpcoming)
      .sort(compareMatchesByNumber);
    const lockedMatches = matches
      .filter(match => !isPredictionOpen(match) && !isPredictionUpcoming(match))
      .sort((first, second) => compareMatchesByNumber(second, first));
    const openBonusQuestions = bonusQuestions.filter(isBonusQuestionOpen);
    const incompleteBonusQuestions = openBonusQuestions.filter(question => !isBonusQuestionComplete(question));
    const completeBonusQuestions = openBonusQuestions.filter(isBonusQuestionComplete);
    const lockedBonusQuestions = bonusQuestions.filter(question => !isBonusQuestionOpen(question));
    if (!matches.length && !bonusQuestions.length) {
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

    if (state.sortMode === 'matchday') {
      const matchdayGroups = renderMatchesByMatchday(matches, renderMatch);
      const bonusGroup = renderPredictionHtmlGroup(
        `<h3><span>Bonustipps (${bonusQuestions.length})</span></h3>`,
        bonusQuestions.map(renderBonusQuestion)
      );
      target.innerHTML = `${matchdayGroups}${bonusGroup}`;
      return;
    }

    const openCards = [
      ...incompleteBonusQuestions.map(renderBonusQuestion),
      ...openMatches.map(renderMatch),
      ...completeBonusQuestions.map(renderBonusQuestion)
    ];
    const upcomingCards = upcomingMatches.map(renderMatch);
    const lockedCards = [
      ...lockedMatches.map(renderMatch),
      ...lockedBonusQuestions.map(renderBonusQuestion)
    ];
    target.innerHTML = applyPredictionSortDirection([
      renderPredictionHtmlGroup(`<h3><span>Offene Tipps (${openCards.length})</span></h3>`, applyPredictionSortDirection(openCards)),
      renderPredictionHtmlGroup(`<h3><span>Demnächst tippbar (${upcomingCards.length})</span></h3>`, applyPredictionSortDirection(upcomingCards)),
      renderPredictionHtmlGroup(`<h3><span>Gesperrte Tipps (${lockedCards.length})</span></h3>`, applyPredictionSortDirection(lockedCards))
    ]).join('');
  }

  function getPredictionLeaderboardSortValue(entry, sortMode) {
    let value;
    if (sortMode === 'predictions') value = entry.predictions_count;
    else if (sortMode === 'exact') value = entry.exact_count;
    else if (sortMode === 'passive') value = entry.points == null ? null : getLeaderboardPassivePoints(entry);
    else if (sortMode === 'bonus') value = entry.bonus_points;
    else value = entry.points;

    if (value === null || value === undefined || value === '') return null;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  function getSortedPredictionLeaderboard() {
    return state.leaderboard
      .map((entry, canonicalIndex) => ({ entry, canonicalRank: canonicalIndex + 1 }))
      .sort((left, right) => {
        const leftValue = getPredictionLeaderboardSortValue(left.entry, state.leaderboardSortMode);
        const rightValue = getPredictionLeaderboardSortValue(right.entry, state.leaderboardSortMode);
        const leftMissing = leftValue === null;
        const rightMissing = rightValue === null;
        if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
        return (rightValue ?? 0) - (leftValue ?? 0) || left.canonicalRank - right.canonicalRank;
      });
  }

  function formatPredictionRankDelta(value) {
    if (value === 0) return '±0';
    return value > 0 ? `+${value}` : String(value);
  }

  function renderPredictionRankReference(currentRank, canonicalRank) {
    if (state.leaderboardSortMode === 'points') return '';
    const delta = canonicalRank - currentRank;
    const deltaClass = delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'neu';
    const deltaLabel = formatPredictionRankDelta(delta);
    return `<span class="points-rank-ref" title="Gesamt-Rang ${canonicalRank}, Veränderung ${deltaLabel}">
      <span class="points-rank-num">${canonicalRank}</span>
      <span class="points-rank-delta ${deltaClass}">${deltaLabel}</span>
    </span>`;
  }

  function renderLeaderboard() {
    const body = document.getElementById('prediction-ranking-body');
    const empty = document.getElementById('prediction-ranking-empty');
    if (!body || !empty) return;

    const previousPositions = window.PadelTable.getRankingRowPositions(body, '.ranking-row');
    const sortedEntries = getSortedPredictionLeaderboard();
    const table = document.getElementById('prediction-ranking-table');
    if (table) table.dataset.rankingSort = state.leaderboardSortMode;
    window.PadelTable.updateSortHeaders('[data-prediction-ranking-sort]', 'predictionRankingSort', state.leaderboardSortMode);
    body.innerHTML = sortedEntries.map(({ entry, canonicalRank }, index) => `
      <tr class="ranking-row r${Math.min(index + 1, 4)} ${state.session?.user?.id === entry.user_id ? 'authenticated-player-highlight' : ''}" data-ranking-entry="${escapeHtml(entry.user_id)}">
        <td class="col-rank rank-position"><span class="rank-cell-inner"><span class="rank-main">${index + 1}</span>${renderPredictionRankReference(index + 1, canonicalRank)}</span></td>
        <td class="col-name"><span class="prediction-rank-account"><span class="pname">${escapeHtml(entry.display_name)}</span>${renderPredictionAccountTypeIcon(entry)}${renderPredictionCompanyBadge(entry)}${renderPreviousPredictionWinnerIcon(entry)}</span></td>
        <td class="col-games">${Number(entry.predictions_count) || 0}</td>
        <td class="col-wins">${Number(entry.exact_count) || 0}</td>
        <td class="col-passive" title="Automatisch gutgeschriebene Punkte aus eigenen Partien">${getLeaderboardPassivePoints(entry)}</td>
        <td class="col-bonus">${Number(entry.bonus_points) || 0}</td>
        <td class="col-points rank-score">${Number(entry.points) || 0}</td>
      </tr>
    `).join('');
    window.PadelTable.animateRankingRows(body, '.ranking-row', previousPositions);
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

  function getLeaderboardPassivePoints(entry) {
    const totalPoints = Number(entry?.points) || 0;
    const bonusPoints = Number(entry?.bonus_points) || 0;
    const activeTipPoints = ((Number(entry?.exact_count) || 0) * 4)
      + ((Number(entry?.tendency_count) || 0) * 2);
    return Math.max(0, totalPoints - bonusPoints - activeTipPoints);
  }

  function isPredictionTableVisible() {
    return Boolean(document.getElementById('tipptabelle')?.classList.contains('active'));
  }

  function getPredictionTableMatches() {
    return [...(state.season?.matches || [])].sort((first, second) =>
      Number(first.spieltag ?? Infinity) - Number(second.spieltag ?? Infinity)
      || compareMatchesByNumber(first, second));
  }

  function getPredictionTableEntry(userId, type, itemId) {
    return state.tableEntries.get(userId)?.get(`${type}:${itemId}`) || null;
  }

  function getPlayerShortLabel(playerId) {
    return (window.PADEL_PLAYERS || []).find(player => player.id === playerId)?.initials || playerId;
  }

  function getPredictionTableTeamLabel(team) {
    const playerIds = team?.playerIds || [];
    return playerIds.length ? playerIds.map(getPlayerShortLabel).join('/') : 'offen';
  }

  // Der Fokus liegt auf dem zuletzt gespielten bestätigten Ergebnis.
  function getLastConfirmedMatchId(matches) {
    const confirmed = matches.filter(match => getActualSets(match) && !isCancelledMatch(match));
    const getTime = match => new Date(state.databaseMatches.get(match.id)?.match_at || 0).getTime() || 0;
    return confirmed.sort((first, second) => getTime(second) - getTime(first) || compareMatchesByNumber(second, first))[0]?.id || null;
  }

  function renderPredictionTableCellContent(value, points, extraSuffix = '', isPassive = false) {
    const tone = isPassive ? 'is-passive' : points >= 4 ? 'points-4' : 'points-2';
    const pointsHtml = Number.isFinite(points) && points > 0 ? `<span class="prediction-table-points ${tone}">${points}</span>` : '';
    return `<span class="prediction-table-value">${escapeHtml(value)}${extraSuffix}${pointsHtml}</span>`;
  }

  function renderPredictionTableHiddenCell(isOwnRow) {
    return isOwnRow
      ? '<td class="prediction-table-cell is-hidden" title="Getippt – sichtbar ab Tippschluss" aria-label="Getippt">✓</td>'
      : '<td class="prediction-table-cell is-hidden"></td>';
  }

  function renderPredictionTableMatchCell(entry, match, isOwnRow = false) {
    const isCancelled = isCancelledMatch(match);
    // Die eigene, nicht tippbare Partie erhält bis zur automatischen Gutschrift einen Strich.
    if (isOwnRow && !entry?.is_passive && isOwnMatch(match)) {
      return '<td class="prediction-table-cell is-own-match" title="Eigene Partie – kein Tipp möglich" aria-label="Eigene Partie">–</td>';
    }
    if (!entry) return '<td class="prediction-table-cell is-empty" aria-label="Kein Tipp"></td>';
    if (entry.is_passive) {
      const points = Number(entry.points) || 0;
      const icon = `<span class="prediction-table-racket" role="img" aria-label="Eigene Partie"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${RACKET_ICON_SVG}</svg></span>`;
      return `<td class="prediction-table-cell is-passive" title="Eigene Partie: automatisch ${points} Punkte">${renderPredictionTableCellContent('', points, icon, true)}</td>`;
    }
    if (entry.prediction === null || entry.prediction === undefined) return renderPredictionTableHiddenCell(isOwnRow);
    if (isCancelled) {
      return `<td class="prediction-table-cell is-cancelled" title="Nicht gewertet">${renderPredictionTableCellContent(entry.prediction, null)}</td>`;
    }
    const points = entry.points === null || entry.points === undefined ? null : Number(entry.points);
    const classes = ['prediction-table-cell', 'is-visible'];
    if (points === 0) classes.push('is-zero');
    if (points === 4) classes.push('is-exact');
    return `<td class="${classes.join(' ')}">${renderPredictionTableCellContent(entry.prediction, points)}</td>`;
  }

  // Mobil zeigt die Tabelle Kürzel: das Spielerkürzel, sonst die Anfangsbuchstaben von Vor- und Nachname.
  function getPredictionAccountShortLabel(entry) {
    const normalize = value => String(value || '').replace(/[.\s]+/g, ' ').trim().toLocaleLowerCase('de');
    const displayName = normalize(entry?.display_name);
    const player = entry?.is_player && displayName
      ? (window.PADEL_PLAYERS || []).find(candidate => normalize(candidate.name) === displayName)
      : null;
    if (player?.initials) return player.initials;
    const words = String(entry?.display_name || '').split(/[\s._-]+/).filter(Boolean);
    if (words.length >= 2) return `${words[0][0]}${words[words.length - 1][0]}`.toLocaleUpperCase('de');
    return (words[0] || '?').slice(0, 2).toLocaleUpperCase('de');
  }

  function renderPredictionTableAccountCell(entry, index) {
    return `<th scope="row" class="prediction-table-account r${Math.min(index + 1, 4)}"><span class="prediction-table-account-inner"><span class="prediction-table-rank rank-position">${index + 1}</span><span class="prediction-rank-account"><span class="pname">${escapeHtml(entry.display_name)}</span><span class="pname-short" title="${escapeHtml(entry.display_name)}">${escapeHtml(getPredictionAccountShortLabel(entry))}</span>${renderPredictionAccountTypeIcon(entry)}${renderPredictionCompanyBadge(entry)}${renderPreviousPredictionWinnerIcon(entry)}</span></span></th>`;
  }

  function renderPredictionTableTotals(entry) {
    return `<td class="prediction-table-bonus-total">${Number(entry.bonus_points) || 0}</td><td class="prediction-table-total">${Number(entry.points) || 0}</td>`;
  }

  // Gespielte, begonnene und aktuell tippbare Partien gelten als aktiv; eigene Partien zählen wie für alle anderen.
  function isPredictionTableMatchActive(match) {
    const databaseMatch = state.databaseMatches.get(match.id);
    if (getActualSets(match) || isCancelledMatch(match)) return true;
    if (databaseMatch?.match_at && new Date(databaseMatch.match_at).getTime() <= Date.now()) return true;
    if (!databaseMatch || databaseMatch.betting_open !== true || state.season?.competition?.predictionsEnabled === false) return false;
    return databaseMatch.match_at ? true : match.sieger === null && !isOutsidePreviewWindow(match);
  }

  function renderPredictionTableMatchHeader(match, isFocus) {
    const actualValue = getActualPredictionValue(match);
    const isCancelled = isCancelledMatch(match);
    const result = isCancelled ? 'o.W.' : actualValue || formatMatchDate(match);
    const number = match.id.match(/\d+$/)?.[0] || '';
    const hasTeams = match.team1.playerIds.length > 0 && match.team2.playerIds.length > 0;
    const title = hasTeams
      ? `Partie ${number}: ${match.team1.spieler.join(' & ')} vs. ${match.team2.spieler.join(' & ')}`
      : `Partie ${number}: Teilnehmer stehen noch nicht fest`;
    const content = `<span class="prediction-table-team">${escapeHtml(getPredictionTableTeamLabel(match.team1))}</span><span class="prediction-table-team">${escapeHtml(getPredictionTableTeamLabel(match.team2))}</span><span class="prediction-table-result${actualValue && !isCancelled ? ' has-result' : ''}">${escapeHtml(result)}</span>`;
    // Noch nicht geöffnete Partien haben keine Vorschau und bleiben deshalb unverlinkt.
    const isActive = isPredictionTableMatchActive(match);
    const inner = hasTeams && isActive
      ? `<a class="prediction-table-match-link" href="${getMatchDetailHref(match)}" data-match-statistics="${escapeHtml(match.id)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${content}</a>`
      : `<span class="prediction-table-match-link" title="${escapeHtml(title)}">${content}</span>`;
    const stateClass = isActive ? '' : ' is-not-open';
    return `<th scope="col" class="prediction-table-match${stateClass}${isFocus ? ' is-focus' : ''}"${isFocus ? ' data-prediction-table-focus' : ''}>${inner}</th>`;
  }

  function renderPredictionMatchTable(entries) {
    const matches = getPredictionTableMatches();
    // Eine Gruppensumme ist aktiv, sobald eine ihrer Partien aktiv ist, etwa durch eine Vorterminierung.
    const groups = [...new Set(matches.map(match => match.spieltag))].map(spieltag => {
      const groupMatches = matches.filter(match => match.spieltag === spieltag);
      return {
        spieltag,
        matches: groupMatches,
        totalClass: groupMatches.some(isPredictionTableMatchActive) ? 'prediction-table-group-total' : 'prediction-table-group-total is-not-open'
      };
    });
    const focusMatchId = getLastConfirmedMatchId(matches);
    const getGroupLabel = spieltag => (state.season?.matchdays || []).find(day => day.spieltag === spieltag)?.title
      || (spieltag === null || spieltag === undefined ? 'Weitere' : `Spieltag ${spieltag}`);
    const head = `<thead>
      <tr class="prediction-table-groups">
        <th scope="col" rowspan="2" class="prediction-table-account">Name</th>
        ${groups.map(group => `<th scope="colgroup" colspan="${group.matches.length + 1}" class="prediction-table-group">${escapeHtml(getGroupLabel(group.spieltag))}</th>`).join('')}
        <th scope="col" rowspan="2" class="prediction-table-bonus-total">Bonus</th>
        <th scope="col" rowspan="2" class="prediction-table-total" aria-label="Gesamt"><span class="prediction-table-label-full">Gesamt</span><span class="prediction-table-label-short" aria-hidden="true">Ω</span></th>
      </tr>
      <tr class="prediction-table-matches">
        ${groups.map(group => `${group.matches.map(match => renderPredictionTableMatchHeader(match, match.id === focusMatchId)).join('')}<th scope="col" class="${group.totalClass}" title="Punkte ${escapeHtml(getGroupLabel(group.spieltag))}">Σ</th>`).join('')}
      </tr>
    </thead>`;
    const body = entries.map((entry, index) => {
      const isOwnRow = state.session?.user?.id === entry.user_id;
      const cells = groups.map(group => {
        let groupPoints = 0;
        const matchCells = group.matches.map(match => {
          const tableEntry = getPredictionTableEntry(entry.user_id, 'match', match.id);
          if (Number.isFinite(Number(tableEntry?.points))) groupPoints += Number(tableEntry.points);
          return renderPredictionTableMatchCell(tableEntry, match, isOwnRow);
        }).join('');
        return `${matchCells}<td class="${group.totalClass}">${groupPoints}</td>`;
      }).join('');
      return `<tr class="${isOwnRow ? 'authenticated-player-highlight' : ''}">${renderPredictionTableAccountCell(entry, index)}${cells}${renderPredictionTableTotals(entry)}</tr>`;
    }).join('');
    return `${head}<tbody>${body}</tbody>`;
  }

  function getBonusAnswerShortLabel(question, answer) {
    if (question.question_type === 'company_winner') return COMPANY_SHORT_LABELS[answer] || String(answer).slice(0, 3).toUpperCase();
    return getPlayerShortLabel(answer);
  }

  function renderPredictionTableBonusCell(entry, question, isOwnRow = false) {
    if (!entry) return '<td class="prediction-table-cell is-empty" aria-label="Kein Tipp"></td>';
    if (!Array.isArray(entry.answers)) return renderPredictionTableHiddenCell(isOwnRow);
    const points = entry.points === null || entry.points === undefined ? null : Number(entry.points);
    const fullLabel = entry.answers.map(answer => question.question_type === 'company_winner' ? answer : getBonusOptionLabel(answer)).join(', ');
    let value = entry.answers.map(answer => getBonusAnswerShortLabel(question, answer)).join('/');
    if (question.question_type === 'final_four_players') {
      const correct = new Set(question.correct_answers || []);
      value = question.resolved
        ? `${entry.answers.filter(answer => correct.has(answer)).length}/${entry.answers.length}`
        : `${entry.answers.length} Sp.`;
    }
    const classes = ['prediction-table-cell', 'is-visible'];
    if (points === 0) classes.push('is-zero');
    return `<td class="${classes.join(' ')}" title="${escapeHtml(fullLabel)}">${renderPredictionTableCellContent(value, points)}</td>`;
  }

  // Der Bonuskopf folgt dem Partienkopf: Gruppentitel, weißer Fragentitel und Status in der Datumszeile.
  function renderPredictionBonusTable(entries) {
    const questions = [...state.bonusQuestions].sort(compareBonusQuestions);
    const head = `<thead>
      <tr class="prediction-table-groups">
        <th scope="col" rowspan="2" class="prediction-table-account">Name</th>
        <th scope="colgroup" colspan="${questions.length}" class="prediction-table-group">Bonus</th>
        <th scope="col" rowspan="2" class="prediction-table-bonus-total">Bonus</th>
        <th scope="col" rowspan="2" class="prediction-table-total" aria-label="Gesamt"><span class="prediction-table-label-full">Gesamt</span><span class="prediction-table-label-short" aria-hidden="true">Ω</span></th>
      </tr>
      <tr class="prediction-table-matches">
        ${questions.map(question => {
          const presentation = getBonusQuestionPresentation(question);
          const status = question.resolved
            ? (question.correct_answers || []).map(answer => getBonusAnswerShortLabel(question, answer)).join('/')
            : isBonusQuestionOpen(question) ? 'offen' : 'gesperrt';
          return `<th scope="col" class="prediction-table-question" title="${escapeHtml(presentation.question)}"><span class="prediction-table-match-link"><span class="prediction-table-question-title">${escapeHtml(presentation.title)}</span><span class="prediction-table-result">${escapeHtml(status)}</span></span></th>`;
        }).join('')}
      </tr>
    </thead>`;
    const body = entries.map((entry, index) => `<tr class="${state.session?.user?.id === entry.user_id ? 'authenticated-player-highlight' : ''}">${renderPredictionTableAccountCell(entry, index)}${questions.map(question => renderPredictionTableBonusCell(getPredictionTableEntry(entry.user_id, 'bonus', question.question_id), question, state.session?.user?.id === entry.user_id)).join('')}${renderPredictionTableTotals(entry)}</tr>`).join('');
    return `${head}<tbody>${body}</tbody>`;
  }

  // Die Spalte des letzten bestätigten Ergebnisses steht rechts vor den festen Summenspalten.
  function focusPredictionTable() {
    const wrap = document.getElementById('prediction-table-wrap');
    if (!wrap || !isPredictionTableVisible()) return;
    const focus = wrap.querySelector('[data-prediction-table-focus]');
    if (!focus) {
      wrap.scrollLeft = 0;
      return;
    }
    const stickyRight = [...wrap.querySelectorAll('thead .prediction-table-total')]
      .reduce((width, cell) => Math.max(width, cell.getBoundingClientRect().width), 0);
    const delta = focus.getBoundingClientRect().right - (wrap.getBoundingClientRect().right - stickyRight);
    wrap.scrollLeft = Math.max(0, wrap.scrollLeft + delta);
  }

  function renderPredictionTableViewToggle() {
    document.querySelectorAll('[data-prediction-table-view]').forEach(button => {
      const active = button.dataset.predictionTableView === state.tableView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  // Ordnet einer Körperspalte den untersten Kopf zu; Gruppenköpfe überspannen mehrere Spalten.
  function getPredictionTableHeaderCell(table, columnIndex) {
    const occupied = [];
    let headerCell = null;
    [...(table.tHead?.rows || [])].forEach((row, rowIndex) => {
      let column = 0;
      [...row.cells].forEach(cell => {
        while (occupied[rowIndex]?.[column]) column += 1;
        for (let rowOffset = 0; rowOffset < cell.rowSpan; rowOffset += 1) {
          for (let columnOffset = 0; columnOffset < cell.colSpan; columnOffset += 1) {
            (occupied[rowIndex + rowOffset] ||= [])[column + columnOffset] = true;
          }
        }
        if (cell.colSpan === 1 && column === columnIndex) headerCell = cell;
        column += cell.colSpan;
      });
    });
    return headerCell;
  }

  function highlightPredictionTableColumn(cell) {
    const table = document.getElementById('prediction-table');
    if (!table) return;
    table.querySelectorAll('.is-column-hover').forEach(node => node.classList.remove('is-column-hover'));
    if (!cell || cell.classList.contains('prediction-table-account')) return;
    const columnIndex = cell.cellIndex;
    [...(table.tBodies[0]?.rows || [])].forEach(row => row.cells[columnIndex]?.classList.add('is-column-hover'));
    getPredictionTableHeaderCell(table, columnIndex)?.classList.add('is-column-hover');
  }

  function renderPredictionTable() {
    const table = document.getElementById('prediction-table');
    const empty = document.getElementById('prediction-table-empty');
    if (!table || !empty) return;
    renderPredictionTableViewToggle();
    const entries = state.leaderboard;
    const showTable = state.tableReady && entries.length > 0
      && (state.tableView === 'matches' || state.bonusQuestions.length > 0);
    table.dataset.view = state.tableView;
    table.innerHTML = showTable
      ? state.tableView === 'bonus' ? renderPredictionBonusTable(entries) : renderPredictionMatchTable(entries)
      : '';
    table.hidden = !showTable;
    empty.textContent = state.tableError
      ? 'Die Tippübersicht kann gerade nicht geladen werden.'
      : !state.tableReady || !state.leaderboardReady
        ? 'Tippübersicht wird geladen …'
        : !entries.length
          ? state.seasonCompleted ? 'In dieser Saison wurden keine Tipps abgegeben.' : 'Die Tippübersicht füllt sich, sobald der erste Tipp gespeichert wurde.'
          : !showTable ? 'In dieser Saison gibt es keine Bonustipps.' : '';
    if (showTable && state.tableView === 'matches') requestAnimationFrame(focusPredictionTable);
  }

  async function loadPredictionTable() {
    const seasonId = state.season?.databaseId || state.season?.id;
    const legacySeasonId = LEGACY_DATABASE_SEASON_IDS[seasonId];
    try {
      let rows = [];
      for (const candidateId of legacySeasonId ? [seasonId, legacySeasonId] : [seasonId]) {
        const { data, error } = await state.client.rpc('get_prediction_overview', { p_season_id: candidateId });
        if (error) throw error;
        rows = data || [];
        if (rows.length) break;
      }
      const entries = new Map();
      rows.forEach(row => {
        if (!entries.has(row.user_id)) entries.set(row.user_id, new Map());
        entries.get(row.user_id).set(`${row.item_type}:${row.item_id}`, row);
      });
      state.tableEntries = entries;
      state.tableReady = true;
      state.tableError = null;
    } catch (error) {
      state.tableError = error.message || 'Unbekannter Fehler';
      console.warn('Tippübersicht nicht verfügbar:', state.tableError);
    }
  }

  function onSectionShown(sectionId) {
    if (sectionId !== 'tipptabelle') return;
    if (state.tableRequested) {
      renderPredictionTable();
      return;
    }
    state.tableRequested = true;
    renderPredictionTable();
    if (!state.client || !state.season) return;
    loadPredictionTable().then(renderPredictionTable);
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

  async function loadBonusPredictions({ accountReady } = {}) {
    if (accountReady) {
      await accountReady;
      state.session = window.PadelKonto?.getSession?.() || null;
      state.profile = window.PadelKonto?.getProfile?.() || null;
    }
    const requestedUserId = state.session?.user?.id || null;
    const seasonId = state.season?.databaseId || state.season?.id;
    const legacySeasonId = LEGACY_DATABASE_SEASON_IDS[seasonId];
    const seasonIds = legacySeasonId ? [seasonId, legacySeasonId] : [seasonId];
    let questions = [];
    for (const candidateId of seasonIds) {
      const { data, error } = await state.client.rpc('get_prediction_bonus_state', { p_season_id: candidateId });
      if (error) {
        state.bonusQuestions = [];
        state.bonusAnswers.clear();
        console.warn('Bonustipps nicht verfügbar:', error.message);
        return;
      }
      if (Array.isArray(data) && data.length) {
        questions = data;
        break;
      }
    }
    if ((window.PadelKonto?.getSession?.()?.user?.id || null) !== requestedUserId) return;
    state.bonusQuestions = questions;
    state.bonusAnswers = new Map(questions.map(question => [
      question.question_id,
      Array.isArray(question.answers) ? question.answers : []
    ]));
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
    state.seasonParticipants = participants;
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

  async function saveBonusPrediction(questionId, slot, answer) {
    if (!state.session?.user) {
      window.PadelKonto?.openDialog?.();
      renderMatches();
      return;
    }
    const question = state.bonusQuestions.find(item => item.question_id === questionId);
    if (!question || !isBonusQuestionOpen(question) || state.bonusSaving.has(questionId)) return;

    const previous = getBonusAnswers(questionId);
    const nextSlots = [...previous, ...Array(Math.max(0, Number(question.max_selections) - previous.length)).fill('')]
      .slice(0, Number(question.max_selections));
    nextSlots[slot] = answer;
    const next = [...new Set(nextSlots.filter(Boolean))];
    state.bonusAnswers.set(questionId, next);
    state.bonusSaving.add(questionId);
    renderMatches();

    const { error } = await state.client.rpc('save_prediction_bonus_answers', {
      p_question_id: questionId,
      p_answers: next
    });
    state.bonusSaving.delete(questionId);
    if (error) {
      state.bonusAnswers.set(questionId, previous);
      window.PadelKonto?.setMessage?.(error.message, 'error');
    } else {
      const seasonId = state.season?.databaseId || state.season?.id;
      const legacySeasonId = LEGACY_DATABASE_SEASON_IDS[seasonId];
      await Promise.all([
        loadBonusPredictions(),
        loadLeaderboard(seasonId, legacySeasonId)
      ]);
    }
    render();
  }

  function normalizeBonusPlayerSearch(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('de-DE');
  }

  function filterBonusPlayerOptions(picker, query = '') {
    if (!picker) return;
    const normalizedQuery = normalizeBonusPlayerSearch(query);
    let visibleOptions = 0;
    picker.querySelectorAll('[data-bonus-picker-value]').forEach(option => {
      const matches = !normalizedQuery
        || normalizeBonusPlayerSearch(option.dataset.bonusPickerSearchText).includes(normalizedQuery);
      option.hidden = !matches;
      if (matches) visibleOptions += 1;
    });
    const emptyState = picker.querySelector('[data-bonus-picker-search-empty]');
    if (emptyState) emptyState.hidden = visibleOptions > 0;
  }

  function closeBonusPlayerPickers(exceptPicker = null) {
    document.querySelectorAll('[data-bonus-picker].open').forEach(picker => {
      if (picker === exceptPicker) return;
      picker.classList.remove('open');
      picker.querySelector('[data-bonus-picker-toggle]')?.setAttribute('aria-expanded', 'false');
      const searchInput = picker.querySelector('[data-bonus-picker-search]');
      if (!searchInput) return;
      searchInput.value = '';
      searchInput.setAttribute('aria-expanded', 'false');
      searchInput.blur();
      searchInput.disabled = true;
      filterBonusPlayerOptions(picker);
    });
  }

  function keepBonusPlayerSearchVisible(searchInput) {
    if (!searchInput || !window.matchMedia('(max-width: 768px)').matches) return;
    const alignInput = () => {
      if (document.activeElement !== searchInput) return;
      const viewportTop = window.visualViewport?.offsetTop || 0;
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const targetOffset = Math.min(200, Math.max(80, viewportHeight * 0.4));
      const scrollDelta = searchInput.getBoundingClientRect().top - viewportTop - targetOffset;
      if (Math.abs(scrollDelta) < 8) return;
      window.scrollBy({ top: scrollDelta, behavior: 'smooth' });
    };
    requestAnimationFrame(alignInput);
    window.setTimeout(alignInput, 350);
  }

  function toggleBonusPlayerPicker(toggle) {
    const picker = toggle.closest('[data-bonus-picker]');
    if (!picker) return;
    const shouldOpen = !picker.classList.contains('open');
    closeBonusPlayerPickers(picker);
    picker.classList.toggle('open', shouldOpen);
    toggle.setAttribute('aria-expanded', String(shouldOpen));
    const searchInput = picker.querySelector('[data-bonus-picker-search]');
    if (!searchInput) return;
    searchInput.setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen) {
      searchInput.disabled = false;
      searchInput.value = '';
      filterBonusPlayerOptions(picker);
      searchInput.focus({ preventScroll: true });
      keepBonusPlayerSearchVisible(searchInput);
    } else {
      searchInput.blur();
      searchInput.disabled = true;
    }
  }

  function selectBonusPlayerOption(option) {
    const picker = option.closest('[data-bonus-picker]');
    if (!picker || option.disabled) return;
    const questionId = picker.dataset.bonusQuestion;
    const slot = Number(picker.dataset.bonusSlot);
    const value = option.dataset.bonusPickerValue || '';
    closeBonusPlayerPickers();
    void saveBonusPrediction(questionId, slot, value);
  }

  function render() {
    renderAuthHint();
    renderOverview();
    renderMatches();
    renderLeaderboard();
    renderPredictionTable();
  }

  async function refresh({ accountReady } = {}) {
    state.client = window.PadelKonto?.getClient?.() || state.client;
    state.session = window.PadelKonto?.getSession?.() || null;
    state.profile = window.PadelKonto?.getProfile?.() || null;
    if (!state.client || !state.season) return;
    try {
      await Promise.all([
        loadPublicData(),
        loadPredictions({ accountReady }),
        loadBonusPredictions({ accountReady }),
        state.tableRequested ? loadPredictionTable() : null
      ]);
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
      const articleControl = event.target.closest('[data-expand-prediction-article]');
      if (!articleControl) return;
      state.articleExpanded = true;
      document.getElementById('prediction-home-article-preview')?.classList.add('expanded');
      articleControl.hidden = true;
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('[data-bonus-picker]')) closeBonusPlayerPickers();
      const rankingSortButton = event.target.closest('[data-prediction-ranking-sort]');
      if (rankingSortButton) {
        const nextMode = rankingSortButton.dataset.predictionRankingSort;
        if (nextMode === state.leaderboardSortMode) return;
        state.leaderboardSortMode = nextMode;
        renderLeaderboard();
        return;
      }
      const pickerToggle = event.target.closest('[data-bonus-picker-toggle]');
      if (pickerToggle) {
        toggleBonusPlayerPicker(pickerToggle);
        return;
      }
      const pickerOption = event.target.closest('[data-bonus-picker-value]');
      if (pickerOption) {
        selectBonusPlayerOption(pickerOption);
        return;
      }
      const tableViewButton = event.target.closest('[data-prediction-table-view]');
      if (tableViewButton) {
        if (tableViewButton.dataset.predictionTableView === state.tableView) return;
        state.tableView = tableViewButton.dataset.predictionTableView;
        renderPredictionTable();
        return;
      }
      const sortButton = event.target.closest('[data-prediction-sort]');
      if (!sortButton) return;
      // Ein erneuter Klick dreht die Richtung um, ein Wechsel beginnt wieder aufsteigend.
      state.sortDescending = sortButton.dataset.predictionSort === state.sortMode && !state.sortDescending;
      state.sortMode = sortButton.dataset.predictionSort;
      renderSortToggle();
      renderMatches();
    });
    document.addEventListener('click', event => {
      const prediction = event.target.closest('[data-prediction-match]');
      if (!prediction) return;
      savePrediction(prediction.dataset.predictionMatch, prediction.dataset.predictionValue);
    });
    const predictionTable = document.getElementById('prediction-table');
    predictionTable?.addEventListener('mouseover', event => {
      highlightPredictionTableColumn(event.target.closest('tbody :is(td, th)'));
    });
    predictionTable?.addEventListener('mouseleave', () => highlightPredictionTableColumn(null));
    document.addEventListener('input', event => {
      const searchInput = event.target.closest('[data-bonus-picker-search]');
      if (!searchInput) return;
      filterBonusPlayerOptions(searchInput.closest('[data-bonus-picker]'), searchInput.value);
    });
    document.addEventListener('keydown', event => {
      const searchInput = event.target.closest('[data-bonus-picker-search]');
      if (searchInput) {
        const picker = searchInput.closest('[data-bonus-picker]');
        const visibleOptions = [...picker.querySelectorAll('[data-bonus-picker-value]')]
          .filter(option => !option.hidden && !option.disabled);
        if (event.key === 'Escape') {
          event.preventDefault();
          closeBonusPlayerPickers();
          picker.querySelector('[data-bonus-picker-toggle]')?.focus({ preventScroll: true });
          return;
        }
        if (event.key === 'ArrowDown' && visibleOptions.length) {
          event.preventDefault();
          visibleOptions[0].focus();
          return;
        }
        if (event.key === 'Enter' && searchInput.value && visibleOptions.length) {
          event.preventDefault();
          selectBonusPlayerOption(visibleOptions[0]);
          return;
        }
      }
      if (event.key === 'Escape') closeBonusPlayerPickers();
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
    state.tableRequested = isPredictionTableVisible();
    state.leaderboardSortMode = 'points';
    state.seasonParticipants = Array.isArray(season?.participants) ? season.participants : [];
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
    state.leaderboardSortMode = 'points';
    state.seasonParticipants = Array.isArray(season?.participants) ? season.participants : [];
    applyPlayerElos(season?.participants || []);
    render();
  }

  window.PadelTippspiel = { init, refresh, render, setSeasonData, onSectionShown };
})();
