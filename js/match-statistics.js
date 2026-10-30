/* Partiestatistik: fresh RPCs per opening, no live subscription. Neighbours in the browsing order are prefetched while the view stays open. */
(function () {
  'use strict';
  const eloForecast = typeof module !== 'undefined' ? require('./elo-forecast.js') : window.PadelEloForecast;
  const tableCore = typeof module !== 'undefined' ? require('./table-core.js') : window.PadelTable;
  const previewWindow = typeof module !== 'undefined' ? require('./preview-window.js') : window.PadelPreviewWindow;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const number = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  const signed = value => value == null ? '—' : `${value > 0 ? '+' : ''}${number(value)}`;
  const date = value => value ? new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Noch nicht terminiert';
  const headerDate = value => value ? new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date(value)) : '';
  const headerMeta = data => [data?.seasonLabel, headerDate(data?.matchAt)].filter(Boolean).join(' · ');
  const playedOrderLabel = data => Number.isInteger(Number(data?.leaguePlayedOrdinal)) && Number(data.leaguePlayedOrdinal) > 0
    ? `Gespielt als ${Number(data.leaguePlayedOrdinal)}. Partie`
    : '';
  const icon = '<span class="mc-score-details-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M4 6h9M4 11h6M4 16h5"></path><circle cx="15.5" cy="14.5" r="3.5"></circle><path d="m18 17 3 3"></path></svg></span>';
  const availability = (match, season, now) => previewWindow.availability(match, season, now);
  function entry(match, season) {
    const mode = availability(match, season);
    // Weiter entfernte Partien besitzen noch keine ausführliche Vorschau und bleiben unverlinkt.
    if (!mode || mode === 'basic') return null;
    return {
      mode,
      attributes: `data-match-statistics="${esc(match.id)}" aria-label="${esc(mode === 'analysis' ? 'Partieanalyse öffnen' : 'Partievorschau öffnen')}"`,
      icon: ''
    };
  }
  const relationshipTerms = {
    successPartner: ['Erfolgspartner', 'Erfolgspartnerin'],
    fearedPartner: ['Angstpartner', 'Angstpartnerin'],
    favoriteOpponent: ['Lieblingsgegner', 'Lieblingsgegnerin'],
    fearedOpponent: ['Angstgegner', 'Angstgegnerin']
  };
  function section(title, body, helpText = '') {
    const helpId = title === 'Elo-Entwicklung' ? 'match-statistics-elo-help' : 'match-statistics-form-help';
    const help = !helpText ? '' : `<span class="th-help-wrap match-statistics-heading-help">
      <span class="help-icon" tabindex="0" role="button" aria-label="${esc(title)} erklären" aria-describedby="${helpId}" aria-expanded="false" data-help-tooltip-anchor>?</span>
      <span class="help-tooltip" id="${helpId}" role="tooltip">${esc(helpText)}</span>
    </span>`;
    return body ? `<section class="widget match-statistics-section"><h3><span class="heading-row heading-row--center match-statistics-heading">${esc(title)}${help}</span></h3>${body}</section>` : '';
  }
  function playerEmoji(player) {
    if (['👨', '👩'].includes(player?.profileEmoji)) return player.profileEmoji;
    if (typeof window === 'undefined') return '👤';
    return (window.PADEL_PLAYERS || []).find(item => item.id === player?.playerId)?.profileEmoji || '👤';
  }
  function relationshipPhrase(kind, subject, other) {
    const terms = relationshipTerms[kind];
    if (!terms) return '';
    const subjectIsFemale = playerEmoji(subject) === '👩';
    const otherIsFemale = playerEmoji(other) === '👩';
    const term = terms[otherIsFemale ? 1 : 0];
    if (kind === 'successPartner' || kind === 'fearedPartner') {
      const possessive = subjectIsFemale
        ? (otherIsFemale ? 'ihrer aktuellen' : 'ihrem aktuellen')
        : (otherIsFemale ? 'seiner aktuellen' : 'seinem aktuellen');
      return `spielt mit ${possessive} ${term}`;
    }
    const possessive = subjectIsFemale
      ? (otherIsFemale ? 'ihre aktuelle' : 'ihren aktuellen')
      : (otherIsFemale ? 'seine aktuelle' : 'seinen aktuellen');
    return `trifft auf ${possessive} ${term}`;
  }
  const viewerClass = (player, selectedPlayerId) => player?.playerId === selectedPlayerId ? ' viewer-player' : '';
  function playerBlock(p, selectedPlayerId) {
    return `<button type="button" class="match-detail-player player-profile-link" data-player-profile-id="${esc(p.playerId)}">
      <span class="match-detail-player-photo" aria-hidden="true"><img class="match-detail-player-image" src="assets/players/${encodeURIComponent(p.playerId)}/profile.webp" alt="" data-detail-player-image><span class="match-detail-player-emoji" hidden>${esc(playerEmoji(p))}</span></span>
      <span class="match-detail-player-name${viewerClass(p, selectedPlayerId)}">${esc(p.displayName)}</span>${p.elo ? `<small class="hint match-detail-player-elo">${number(p.elo.before)} Elo</small>` : ''}</button>`;
  }
  function renderHead(data, selectedPlayerId) {
    const teamOneProbability = data.probability == null ? null : Math.round(data.probability * 100);
    const teamTwoProbability = teamOneProbability == null ? null : 100 - teamOneProbability;
    const probability = teamOneProbability == null ? '' : `${teamOneProbability} : ${teamTwoProbability}`;
    const previewProbability = teamOneProbability == null ? '' : `<span class="match-probability match-detail-probability match-statistics-probability" aria-label="Gewinnwahrscheinlichkeit ${teamOneProbability} zu ${teamTwoProbability} Prozent">
        <span class="match-probability-value">${teamOneProbability}</span>
        <span class="match-probability-separator" aria-hidden="true">:</span>
        <span class="match-probability-value">${teamTwoProbability}</span>
      </span>`;
    const analysisProbability = probability.replace(/(\d+)/g, '$1%');
    const analysis = data.availability === 'analysis';
    return `<article class="match-detail"><div class="match-detail-meta"><span class="match-detail-status${analysis ? ' is-finished' : ''}">${analysis ? 'Beendet' : 'Offen'}</span></div>
      <div class="match-detail-matchup"><div class="match-detail-team match-detail-team-1">${data.players.filter(p => p.team === 1).map(p => playerBlock(p, selectedPlayerId)).join('')}</div>
      <div class="match-detail-scoreboard"><span class="match-detail-score-label">${analysis ? 'Ergebnis' : 'Gewinnchance'}</span>
      ${analysis ? `<strong class="score score--match">${esc(data.sets || '—')}</strong>` : previewProbability || '<strong class="score score--match">—</strong>'}
      ${analysis ? `<span class="match-detail-score-note">${esc(data.result)}</span>${analysisProbability ? `<span class="match-detail-score-note">${analysisProbability}</span>` : ''}` : previewProbability ? '<span class="match-detail-score-note">Prozent</span>' : ''}
      </div>
      <div class="match-detail-team match-detail-team-2">${data.players.filter(p => p.team === 2).map(p => playerBlock(p, selectedPlayerId)).join('')}</div></div></article>`;
  }
  // Solange eine Partie offen ist und kein eigener Tipp vorliegt, ersetzt ein je Partie fester Scheinwert die echte Verteilung.
  function isForecastConcealed(forecast, { isOwnMatch = false, hasOwnPrediction = false } = {}) {
    return Boolean(forecast?.open && !isOwnMatch && !hasOwnPrediction);
  }
  function concealedForecastPercentage(matchId) {
    let hash = 2166136261;
    for (const char of String(matchId || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return 20 + ((hash >>> 0) % 61);
  }
  const forecastOwnTipIcon = '<svg class="match-forecast-own-tip-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0"/></svg>';
  function renderForecastResult(forecast, { lockedAction = '', concealed = false } = {}) {
    const totalVotes = concealed ? 1 : Math.max(0, Number(forecast?.totalVotes) || 0);
    const teamOnePercentage = concealed
      ? concealedForecastPercentage(forecast?.matchId)
      : totalVotes
      ? Math.min(100, Math.max(0, Number(forecast?.team1Percentage) || 0))
      : 0;
    const teamTwoPercentage = totalVotes ? 100 - teamOnePercentage : 0;
    const hasBothTeamColors = teamOnePercentage > 0 && teamTwoPercentage > 0;
    const ownTipTeam = ['2:0', '2:1'].includes(forecast?.userPrediction)
      ? 1
      : ['1:2', '0:2'].includes(forecast?.userPrediction) ? 2 : null;
    const label = concealed
      ? 'Tipps: Verteilung erst nach eigenem Tipp sichtbar'
      : `Tipps: Team 1 ${teamOnePercentage} Prozent, Team 2 ${teamTwoPercentage} Prozent${ownTipTeam ? `; eigener Tipp: Team ${ownTipTeam}` : ''}`;
    return `<div class="match-forecast-result-wrap${lockedAction ? ' is-guest-locked' : ''}">
      <div class="match-forecast-result" aria-label="${label}">
        <div class="match-forecast-percentages">
          <span class="match-forecast-percentage match-forecast-percentage--team-one">${teamOnePercentage} %${ownTipTeam === 1 ? forecastOwnTipIcon : ''}</span>
          <span class="match-forecast-percentage match-forecast-percentage--team-two">${ownTipTeam === 2 ? forecastOwnTipIcon : ''}${teamTwoPercentage} %</span>
        </div>
        <div class="match-forecast-bar${totalVotes ? ' has-votes' : ''}${hasBothTeamColors ? ' has-both-team-colors' : ''}">
          <span class="match-forecast-team-one" style="width:${teamOnePercentage / 2}%"></span>
          <span class="match-forecast-team-two" style="width:${teamTwoPercentage / 2}%"></span>
        </div>
      </div>
      ${lockedAction ? `<button type="button" class="match-forecast-login" data-auth-open>${esc(lockedAction)}</button>` : ''}
    </div>`;
  }
  function renderMatchForecast(data, forecast, options = {}) {
    if (data.availability === 'basic') return '';
    if (forecast === null && !options.message) return '';
    if (!forecast || forecast.error) {
      return `<section class="match-forecast" data-match-forecast>
        <strong class="eyebrow match-forecast-question">Wer wird gewinnen?</strong>
        <div class="hint match-forecast-status" role="status">${esc(options.message || 'Die Tipps konnten nicht geladen werden.')}</div>
      </section>`;
    }
    const session = options.session || null;
    const authenticatedPlayerId = options.profile?.player_id || null;
    const isOwnMatch = Boolean(authenticatedPlayerId && data.players?.some(player => player.playerId === authenticatedPlayerId));
    const emailConfirmed = Boolean(session?.user?.email_confirmed_at);
    const selectionOpen = Boolean(options.selectionOpen);
    const submitting = Boolean(options.submitting);
    const selectedPrediction = forecast.userPrediction || null;
    const showSelection = Boolean(!isOwnMatch && emailConfirmed && forecast.open && (!selectedPrediction || selectionOpen));
    const control = showSelection
      ? `<div class="match-forecast-choices" aria-label="Exakten Tipp auswählen">
          <button type="button" class="live-point-team-button match-forecast-choice${selectedPrediction === '2:0' ? ' active' : ''}" data-match-forecast-prediction="2:0" aria-pressed="${selectedPrediction === '2:0'}"${submitting ? ' disabled' : ''}>
            <strong>Team 1</strong><span>2:0</span>
          </button>
          <button type="button" class="live-point-team-button match-forecast-choice${selectedPrediction === '2:1' ? ' active' : ''}" data-match-forecast-prediction="2:1" aria-pressed="${selectedPrediction === '2:1'}"${submitting ? ' disabled' : ''}>
            <strong>Team 1</strong><span>2:1</span>
          </button>
          <button type="button" class="live-point-team-button match-forecast-choice${selectedPrediction === '1:2' ? ' active' : ''}" data-match-forecast-prediction="1:2" aria-pressed="${selectedPrediction === '1:2'}"${submitting ? ' disabled' : ''}>
            <strong>Team 2</strong><span>1:2</span>
          </button>
          <button type="button" class="live-point-team-button match-forecast-choice${selectedPrediction === '0:2' ? ' active' : ''}" data-match-forecast-prediction="0:2" aria-pressed="${selectedPrediction === '0:2'}"${submitting ? ' disabled' : ''}>
            <strong>Team 2</strong><span>0:2</span>
          </button>
        </div>`
      : renderForecastResult(forecast, {
          lockedAction: !isOwnMatch && forecast.open && !emailConfirmed
            ? session ? 'E-Mail bestätigen, um zu tippen' : 'Einloggen, um zu tippen'
            : '',
          concealed: isForecastConcealed(forecast, { isOwnMatch, hasOwnPrediction: Boolean(selectedPrediction) })
        });
    const change = !isOwnMatch && emailConfirmed && forecast.open && selectedPrediction && !showSelection
      ? '<button type="button" class="text-link match-forecast-change" data-match-forecast-change>Tipp ändern</button>'
      : '';
    const ownMatchNotice = isOwnMatch && forecast.open
      ? '<span class="hint match-forecast-own-notice" role="status">Eigene Partie. Kein Tipp möglich.</span>'
      : '';
    return `<section class="match-forecast" data-match-forecast>
      <strong class="eyebrow match-forecast-question">Wer wird gewinnen?</strong>
      <div class="match-forecast-control">${control}</div>
      <div class="match-forecast-action">${change}${ownMatchNotice}</div>
      ${options.message ? `<div class="match-forecast-message" role="status">${esc(options.message)}</div>` : ''}
    </section>`;
  }
  function historyFacts(data) {
    const facts = [];
    const company = data.company;
    const companyText = !company ? '' : company.kind === 'internal' ? `Firmeninternes Duell · ${company.company}`
      : `Firmenduell · ${company.team1} gegen ${company.team2} · Bilanz ${company.wins1}:${company.wins2}`;
    if (companyText) facts.push(`<p class="match-statistics-context-fact">${esc(companyText)}</p>`);
    const latest = data.rematches?.[0];
    const rematchLabel = !latest ? '' : data.availability !== 'analysis' ? 'Rematch'
      : latest.outcome === (data.winner === 1 ? 'win' : 'loss') ? 'Erneuter Sieg' : latest.outcome === 'draw' ? 'Rematch' : 'Revanche';
    const rematches = data.rematches || [];
    const rematchLines = rematches.map((r, index) => {
      const result = r.team === 2 ? String(r.result).replace(/(\d+)\s*:\s*(\d+)/g, '$2:$1') : r.result;
      const label = index === 0 ? `${rematchLabel} #${rematches.length}` : 'Früheres Duell';
      return `<span><strong>${esc(label)}</strong> · ${esc(date(r.date))} · ${esc(r.season)} · ${esc(result)}</span>`;
    });
    if (rematchLines.length) facts.push(`<p class="match-statistics-context-fact match-statistics-rematches">${rematchLines.join('<br>')}</p>`);
    const resultImpact = (data.impacts || []).find(impact => ['upset', 'favoriteConfirmed'].includes(impact.kind));
    const resultTeam = Number(resultImpact?.team);
    const resultProbability = Number(resultImpact?.probability);
    const resultThresholdReached = resultImpact?.kind === 'upset' ? resultProbability <= 0.45 : resultProbability >= 0.55;
    if ([1, 2].includes(resultTeam) && Number.isFinite(resultProbability) && resultThresholdReached) {
      const resultText = resultImpact.kind === 'upset'
        ? `Team ${resultTeam} sorgt für eine statistische Überraschung bei zuvor ${Math.round(resultProbability * 100)} % Gewinnchance.`
        : `Team ${resultTeam} bestätigt Favoritenrolle bei zuvor ${Math.round(resultProbability * 100)} % Gewinnchance.`;
      facts.push(`<p class="match-statistics-context-fact">${resultText}</p>`);
    }
    return facts;
  }
  function relationshipPlayerLink(playerId, displayName, selectedPlayerId) {
    return `<button type="button" class="match-statistics-relationship-name player-profile-link${viewerClass({ playerId }, selectedPlayerId)}" data-player-profile-id="${esc(playerId)}">${esc(displayName)}</button>`;
  }
  function joinRelationshipClauses(clauses) {
    if (clauses.length < 2) return clauses[0] || '';
    return `${clauses.slice(0, -1).join(', ')} und ${clauses.at(-1)}`;
  }
  function renderContext(data, selectedPlayerId) {
    const seen = new Set();
    const facts = historyFacts(data);
    (data.players || []).forEach(player => {
      const clauses = [];
      (player.relationships || []).forEach(relationship => {
        const relationshipPlayerId = relationship.playerId || relationship.name;
        const relationshipPlayer = (data.players || []).find(candidate => candidate.playerId === relationshipPlayerId)
          || { playerId: relationshipPlayerId };
        const phrase = relationshipPhrase(relationship.kind, player, relationshipPlayer);
        if (!phrase) return;
        const pairKey = [player.playerId, relationshipPlayerId].sort().join(':');
        const key = `${relationship.kind}:${pairKey}`;
        if (seen.has(key)) return;
        seen.add(key);
        const other = relationshipPlayerLink(relationshipPlayerId, relationship.name, selectedPlayerId);
        clauses.push(`${phrase} ${other} <span class="match-statistics-relationship-record">(${number(relationship.wins)} von ${number(relationship.matches)})</span>`);
      });
      if (!clauses.length) return;
      const subject = relationshipPlayerLink(player.playerId, player.displayName, selectedPlayerId);
      facts.push(`<p class="match-statistics-context-fact match-statistics-relationship">${subject} ${joinRelationshipClauses(clauses)}.</p>`);
    });
    return facts.length
      ? `<section class="match-statistics-context" aria-label="Einordnung der Partie">${facts.join('')}</section>`
      : '';
  }
  function getQualificationPlaces(data) {
    if (data?.qualificationPlaces != null && Number.isFinite(Number(data.qualificationPlaces))) {
      return Math.max(0, Number(data.qualificationPlaces));
    }
    if (typeof window === 'undefined') return 0;
    const season = (window.PADEL_SEASONS || []).find(option =>
      option.id === data?.seasonId || option.databaseId === data?.seasonId
    );
    return Math.max(0, Number(season?.qualificationPlaces) || 0);
  }
  function renderRankChange(statistics, analysis) {
    if (!analysis) return '';
    const rank = Number(statistics?.rank);
    const previousRank = Number(statistics?.previousRank);
    if (!Number.isFinite(rank) || !Number.isFinite(previousRank)) return '';
    const direction = rank < previousRank ? 'up' : rank > previousRank ? 'down' : 'same';
    const symbol = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '–';
    const label = direction === 'up' ? 'Tabellenplatz verbessert'
      : direction === 'down' ? 'Tabellenplatz verschlechtert'
        : 'Tabellenplatz unverändert';
    return `<span class="match-statistics-rank-change ${direction}" aria-label="${label}">${symbol}</span>`;
  }
  function renderPlayerRanking(data, selectedPlayerId) {
    const activePlayers = new Map(data.players.map(player => [player.playerId, player]));
    const rankingPlayers = Array.isArray(data.ranking) && data.ranking.length ? data.ranking : data.players;
    const players = rankingPlayers.map(player => {
      const activePlayer = activePlayers.get(player.playerId);
      return activePlayer ? { ...player, ...activePlayer, statistics: player.statistics || activePlayer.statistics } : player;
    }).sort((a, b) => Number(a.statistics?.rank ?? Infinity) - Number(b.statistics?.rank ?? Infinity));
    const hasRanking = players.length > 0 && players.every(player => Number.isFinite(Number(player.statistics?.rank)));
    const qualificationPlaces = getQualificationPlaces(data);
    const analysis = data.availability === 'analysis';
    const rows = [];
    players.forEach(player => {
      const statistics = player.statistics || {};
      const rank = Number(statistics.rank);
      const activePlayer = activePlayers.get(player.playerId);
      const teamClass = !activePlayer ? '' : Number(activePlayer.team) === 2 ? ' match-statistics-team-2' : ' match-statistics-team-1';
      const rowClass = activePlayer ? 'match-statistics-ranking-player' : 'match-statistics-ranking-other';
      const qualificationClass = hasRanking && qualificationPlaces > 0 && rank <= qualificationPlaces
        ? ' match-statistics-ranking-qualified'
        : '';
      rows.push(`<tr class="${rowClass}${hasRanking ? ` r${Math.min(rank, 4)}` : ''}${qualificationClass}${teamClass}"${tableCore.renderPlayerProfileRowAttributes({ id: player.playerId, name: player.displayName })}>
        ${hasRanking ? `<td class="col-rank rank-position"><span class="match-statistics-rank-position">${number(rank)}</span></td>${analysis ? `<td class="col-rank-change">${renderRankChange(statistics, analysis)}</td>` : ''}` : ''}
        <td class="col-name"><button type="button" class="pname player-profile-link${viewerClass(player, selectedPlayerId)}" data-player-profile-id="${esc(player.playerId)}">${esc(player.displayName)}</button></td>
        <td class="col-games">${number(statistics.played)}</td>
        ${hasRanking ? `<td class="col-wins">${number(statistics.wins)}</td>` : ''}
        ${hasRanking ? `<td class="col-points rank-score">${number(statistics.points)}</td>` : ''}
        <td class="col-diff"><span class="${Number(statistics.gameDiff) > 0 ? 'pos' : Number(statistics.gameDiff) < 0 ? 'neg' : 'neu'}">${signed(statistics.gameDiff)}</span></td>
      </tr>`);
    });
    return `<div class="ranking-wrap match-statistics-ranking-wrap"><table class="rt match-statistics-ranking${analysis ? ' has-rank-change' : ''}">
      <thead><tr>${hasRanking ? `<th class="col-rank"><span aria-hidden="true">#</span><span class="sr-only">Platz</span></th>${analysis ? '<th class="col-rank-change"><span class="sr-only">Platzänderung</span></th>' : ''}` : ''}<th class="col-name">Spieler</th><th class="col-games">Partien</th>${hasRanking ? '<th class="col-wins">Siege</th><th class="col-points">Punkte</th>' : ''}<th class="col-diff">Diff.</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>`;
  }
  function renderPlayersAndImpacts(data, impactGroups, selectedPlayerId) {
    const impactTitle = data.availability === 'analysis' ? 'Was sich verändert hat' : 'Was sich verändern kann';
    const impactBody = impactGroups.length
      ? `<div class="match-statistics-impact-groups">${impactGroups.map(({ player, facts }) => `<div class="match-statistics-impact-player">
        <h4><button type="button" class="match-statistics-impact-player-name player-profile-link${viewerClass(player, selectedPlayerId)}" data-player-profile-id="${esc(player.playerId)}">${esc(player.displayName)}</button></h4>
        <ul>${facts.map(text => `<li>${esc(text)}</li>`).join('')}</ul>
      </div>`).join('')}</div>`
      : '<p class="match-statistics-empty-impact">Keine bedeutenden Auswirkungen.</p>';
    return `<div class="match-statistics-ranking-layout">
      <section class="widget match-statistics-section match-statistics-ranking-panel"><h3>Rangliste</h3>${renderPlayerRanking(data, selectedPlayerId)}</section>
      <div class="match-statistics-side-panels">
        <section class="widget match-statistics-section match-statistics-impact-panel"><h3>${impactTitle}</h3>${impactBody}</section>
      </div>
    </div>`;
  }
  function renderForm(data, selectedPlayerId) {
    const renderPlayer = player => {
      const form = Array.isArray(player.form) ? player.form.slice(-5) : [];
      const groups = form.map(item => Array.isArray(item?.matches)
        ? item
        : { groupId: item?.matchId, kind: item?.kind || 'official', date: item?.date, competition: item?.competition, matches: [item] });
      const chips = groups.length ? groups.map((group, index) => {
        const matches = (group.matches || []).filter(Boolean);
        const recency = Math.max(0, groups.length - index - 1);
        const groupClass = matches.length > 1 ? ' is-multi-match' : '';
        const groupLabel = group.kind === 'training' ? `Training mit ${matches.length} Paarungen` : matches[0]?.label || 'Partie';
        return `<span class="match-statistics-form-group${groupClass}" aria-label="${esc(groupLabel)}">${matches.map(match => {
          const won = match.outcome === 'win';
          const matchTiebreak = Boolean(match.decidedByMatchTiebreak);
          const outcome = won ? 'Sieg' : 'Niederlage';
          const competition = match.competition || group.competition || (group.kind === 'training' ? 'Training' : '');
          const matchDate = match.date || group.date || '';
          const partnerNames = Array.isArray(match.partnerNames) ? match.partnerNames.join(' & ') : match.partnerNames || '';
          const opponentNames = Array.isArray(match.opponentNames) ? match.opponentNames.join(' & ') : match.opponentNames || '';
          const title = [match.label, `${outcome}${matchTiebreak ? ' im Match-Tie-Break' : ''}`, match.result]
            .filter(Boolean).join(' · ');
          return `<span class="form-chip form-recency-${recency} ${won ? 'form-win' : 'form-loss'}${group.kind === 'training' ? ' form-training' : ''}${matchTiebreak ? ' form-tiebreak' : ''}" tabindex="0" aria-label="${esc(title)}" data-form-player="${esc(player.displayName)}" data-form-match-id="${esc(match.matchId)}" data-form-date="${esc(matchDate ? date(matchDate) : '')}" data-form-competition="${esc(competition)}" data-form-partner="${esc(partnerNames)}" data-form-opponents="${esc(opponentNames)}" data-form-result="${esc(match.result || '')}">${won ? 'S' : 'N'}</span>`;
        }).join('')}</span>`;
      }).join('') : '<span class="neu">—</span>';
      const teamClass = Number(player.team) === 2 ? 'match-statistics-team-2' : 'match-statistics-team-1';
      return `<div class="match-statistics-form-player ${teamClass}">
        <span class="match-statistics-form-name${viewerClass(player, selectedPlayerId)}">${esc(player.displayName)}</span>
        <span class="match-statistics-form-chips">${chips}</span>
      </div>`;
    };
    const teams = [1, 2].map(team => {
      const players = (data.players || []).filter(player => Number(player.team) === team).map(renderPlayer).join('');
      return players ? `<div class="match-statistics-form-team match-statistics-team-${team}" data-form-team="${team}">${players}</div>` : '';
    }).join('');
    return teams ? section('Form der letzten 5 Partien', `<div class="match-statistics-form-scroll"><div class="match-statistics-form-row">${teams}</div></div>`,
      'S steht für Sieg, N für Niederlage. Trainings erscheinen mit Kontur; mehrere überlappende Kreise gehören zu demselben Training und zählen gemeinsam als eine Partie. Orange markierte Kreise kennzeichnen Entscheidungen im Match-Tiebreak. Links steht die älteste, rechts die jüngste Partie.') : '';
  }
  function eloPathForecast(data) {
    if (data.probability == null) return null;
    return eloForecast?.getAutoTipForecast(
      Number(data.probability) * 100,
      data.players.filter(player => Number(player.team) === 1).map(player => player.elo?.before),
      data.players.filter(player => Number(player.team) === 2).map(player => player.elo?.before)
    );
  }
  function graphGeometry(players, analysis) {
    const values = players.flatMap(p => [
      p.elo?.before,
      ...(analysis ? [p.elo?.after] : []),
      p.elo?.winMin,
      p.elo?.winMax,
      p.elo?.lossMin,
      p.elo?.lossMax
    ]).filter(v => v != null && Number.isFinite(Number(v))).map(Number);
    const low = values.length ? Math.min(...values) : 0;
    const high = values.length ? Math.max(...values) : 0;
    const padding = Math.max(10, (high - low) * 0.12);
    const min = Math.floor((low - padding) / 10) * 10, max = Math.ceil((high + padding) / 10) * 10;
    const plotTop = 28, plotBottom = 515, nameY = 556;
    const y = value => plotBottom - ((Number(value) - min) / (max - min)) * (plotBottom - plotTop);
    return { min, max, y, plotTop, plotBottom, nameY, ticks: Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4) };
  }
  function smoothLinePath(x1, y1, x2, y2) {
    const width = x2 - x1;
    return `M${x1},${y1} C${x1 + width * .42},${y1} ${x1 + width * .72},${y2} ${x2},${y2}`;
  }
  function smoothBandPath(x1, startA, startB, x2, yA, yB) {
    const width = x2 - x1;
    const c1 = x1 + width * .42;
    const c2 = x1 + width * .72;
    return `M${x1},${startA} C${c1},${startA} ${c2},${yA} ${x2},${yA} L${x2},${yB} C${c2},${yB} ${c1},${startB} ${x1},${startB} Z`;
  }
  function projectionBand(x1, startY, x2, valueA, valueB, geometry, cls) {
    const startHeight = 2;
    const low = Math.min(Number(valueA), Number(valueB));
    const high = Math.max(Number(valueA), Number(valueB));
    return `<path d="${smoothBandPath(x1, startY - startHeight / 2, startY + startHeight / 2, x2, geometry.y(high), geometry.y(low))}" class="match-statistics-projection-band ${cls}"/>`;
  }
  function projectionRange(x1, startY, x2, valueA, valueB, geometry, cls) {
    return `<path d="${smoothBandPath(x1, startY, startY, x2, geometry.y(valueA), geometry.y(valueB))}" class="match-statistics-projection-range ${cls}"/>`;
  }
  function forecastProjection(data, player) {
    const teamOne = data.players.filter(item => Number(item.team) === 1);
    const teamTwo = data.players.filter(item => Number(item.team) === 2);
    const teamOneElos = teamOne.map(item => Number(item.elo?.before));
    const teamTwoElos = teamTwo.map(item => Number(item.elo?.before));
    const forecast = eloPathForecast(data);
    if (!forecast) return null;
    const ownTeam = Number(player.team);
    const opponentElos = ownTeam === 1 ? teamTwoElos : teamOneElos;
    const won = ownTeam === forecast.winner;
    const value = eloForecast.projectElo(player.elo?.before, opponentElos, won, forecast.pointFactor);
    return value == null ? null : { outcome: won ? 'win' : 'loss', value };
  }
  function peakStarIcon(rightX, textY, label, state) {
    const size = 14;
    const gap = 5;
    const textWidth = [...String(label)].length * 6.6;
    const x = rightX - textWidth - gap - size;
    return `<use href="#statistics-peak-star-icon" x="${x}" y="${textY - 11}" width="${size}" height="${size}" class="match-statistics-peak-star ${state}"/>`;
  }
  function analysisResultY(geometry, before, after) {
    const endpointY = geometry.y(after);
    const aboveY = endpointY - 30;
    const belowY = endpointY + 24;
    const fitsAbove = aboveY - 11 >= geometry.plotTop;
    const fitsBelow = belowY + 18 <= geometry.nameY - 18;
    if (Number(after) >= Number(before)) return fitsAbove ? aboveY : belowY;
    return fitsBelow ? belowY : aboveY;
  }
  function projectionValueLabel(x, y, valueA, valueB, className, peakBefore) {
    const high = Math.max(Number(valueA), Number(valueB));
    const low = Math.min(Number(valueA), Number(valueB));
    const highLabel = `↗ ${number(high)}`;
    const peakIcon = peakBefore != null && high > Number(peakBefore)
      ? peakStarIcon(x, y, highLabel, 'possible')
      : '';
    return `${peakIcon}<text x="${x}" y="${y}" text-anchor="end" class="match-statistics-value ${className}">${highLabel}</text><text x="${x}" y="${y + 15}" text-anchor="end" class="match-statistics-value ${className}">↘ ${number(low)}</text>`;
  }
  function renderGraph(data, selectedPlayerId) {
    if (!data.countsForElo) return '';
    const analysis = data.availability === 'analysis';
    const g = graphGeometry(data.players, analysis);
    const initialTeam = 1;
    const lanes = data.players.map((p, i) => {
      const team = Number(p.team) === 2 ? 2 : 1;
      const teamPlayers = data.players.filter(player => Number(player.team) === team);
      const teamPlayerIndex = Math.max(0, teamPlayers.findIndex(player => player.playerId === p.playerId));
      const e = p.elo || {}, x = 60 + i * 235;
      const lineStartX = x + 30, lineEndX = x + 195;
      const teamClass = team === 2 ? 'match-statistics-team-2' : 'match-statistics-team-1';
      const playerClass = `match-statistics-team-player-${teamPlayerIndex + 1}`;
      const available = e.before != null && (!analysis || e.after != null);
      const analysisRanges = !analysis || !available ? ''
        : [['lossMin', 'lossMax', 'loss'], ['winMin', 'winMax', 'win']].map(([a, b, cls]) => e[a] == null || e[b] == null ? ''
          : projectionRange(lineStartX, g.y(e.before), lineEndX, e[a], e[b], g, cls)).join('');
      const forecast = analysis || !available ? null : forecastProjection(data, p);
      const forecastLine = !forecast ? ''
        : `<path d="${smoothLinePath(lineStartX, g.y(e.before), lineEndX, g.y(forecast.value))}" class="match-statistics-forecast-line ${forecast.outcome}"/><circle cx="${lineEndX}" cy="${g.y(forecast.value)}" r="4" class="match-statistics-forecast-dot ${forecast.outcome}"/>`;
      const shape = !available ? '' : analysis
        ? `${analysisRanges}<path d="${smoothLinePath(lineStartX, g.y(e.before), lineEndX, g.y(e.after))}" class="match-statistics-line"/><circle cx="${lineEndX}" cy="${g.y(e.after)}" r="5" class="match-statistics-dot"/>`
        : [['lossMin', 'lossMax', 'loss'], ['winMin', 'winMax', 'win']].map(([a, b, cls]) => e[a] == null || e[b] == null ? ''
          : projectionBand(lineStartX, g.y(e.before), lineEndX, e[a], e[b], g, cls)).join('') + forecastLine;
      const startValue = available ? `<text x="${x + 22}" y="${g.y(e.before) + 24}" text-anchor="end" class="match-statistics-value match-statistics-start-value">${number(e.before)}</text>` : '';
      const resultY = analysis && available ? analysisResultY(g, e.before, e.after) : null;
      const resultLabel = analysis && available ? number(e.after) : '';
      const resultDelta = analysis && available
        ? Number.isFinite(Number(e.delta)) ? Number(e.delta) : Number(e.after) - Number(e.before)
        : null;
      const resultDeltaClass = resultDelta > 0 ? 'pos' : resultDelta < 0 ? 'neg' : 'neu';
      const peakReached = analysis && e.peakBefore != null && e.after != null && e.after > e.peakBefore;
      const resultValues = !available ? '' : analysis
        ? `${peakReached ? peakStarIcon(lineEndX, resultY, resultLabel, 'achieved') : ''}<text x="${lineEndX}" y="${resultY}" text-anchor="end" class="match-statistics-value match-statistics-result-value">${resultLabel}</text><text x="${lineEndX}" y="${resultY + 15}" text-anchor="end" class="match-statistics-value match-statistics-delta-value ${resultDeltaClass}">${signed(resultDelta)}</text>`
        : `${projectionValueLabel(
            lineEndX,
            Math.max(g.plotTop + 14, Math.min(g.y(e.winMin), g.y(e.winMax)) - 27),
            e.winMin,
            e.winMax,
            'match-statistics-win-value',
            e.peakBefore
          )}${projectionValueLabel(
            lineEndX,
            Math.min(g.nameY - 51, Math.max(g.y(e.lossMin), g.y(e.lossMax)) + 24),
            e.lossMin,
            e.lossMax,
            'match-statistics-loss-value',
            e.peakBefore
          )}`;
      const panelOffset = teamPlayerIndex * 470 - i * 235;
      return { team, playerId: p.playerId, markup: `<g class="match-statistics-player-graph ${teamClass} ${playerClass}${i === 0 ? ' is-player-selected' : ''}${team === initialTeam ? ' is-team-selected' : ''}" data-statistics-graph-player="${esc(p.playerId)}" data-statistics-graph-team="${team}" style="--statistics-mobile-offset:${-i * 235}px;--statistics-panel-offset:${panelOffset}px">
        <clipPath id="statistics-lane-${i}"><rect x="${x}" y="${g.plotTop}" width="225" height="${g.plotBottom - g.plotTop + 1}"/></clipPath>
        <g clip-path="url(#statistics-lane-${i})">${shape}${available ? `<circle cx="${lineStartX}" cy="${g.y(e.before)}" r="5" class="match-statistics-dot"/>` : ''}</g>
        ${startValue}${resultValues}
        <text x="${x + 115}" y="${g.nameY}" text-anchor="middle" class="match-statistics-player-label${viewerClass(p, selectedPlayerId)}">${esc(p.displayName)}</text>
      </g>` };
    });
    const initialPlayerId = data.players[0]?.playerId;
    const selectedTeamLast = [
      ...lanes.filter(lane => lane.team !== initialTeam),
      ...lanes.filter(lane => lane.team === initialTeam && lane.playerId !== initialPlayerId),
      ...lanes.filter(lane => lane.playerId === initialPlayerId)
    ]
      .map(lane => lane.markup).join('');
    const playerSelect = `<div class="site-nav" data-statistics-graph-picker="player" role="group" aria-label="Spieler für Elo-Entwicklung auswählen">
      ${data.players.map((player, index) => `<button type="button"${index === 0 ? ' class="active"' : ''} data-statistics-graph-select="${esc(player.playerId)}" aria-pressed="${index === 0 ? 'true' : 'false'}">${esc(player.displayName)}</button>`).join('')}
    </div>`;
    const teamSelect = `<div class="site-nav" data-statistics-graph-picker="team" role="group" aria-label="Team für Elo-Entwicklung auswählen">
      ${[1, 2].map(team => {
        const active = team === initialTeam;
        return `<button type="button"${active ? ' class="active"' : ''} data-statistics-graph-team-select="${team}" aria-pressed="${active ? 'true' : 'false'}">Team ${team}</button>`;
      }).join('')}
    </div>`;
    return section('Elo-Entwicklung', `${playerSelect}${teamSelect}<div class="match-statistics-graph" tabindex="0" role="region" aria-label="Elo-Diagramm der vier Spieler">
      <svg viewBox="0 0 1000 590" width="1000" height="590" aria-hidden="true" class="match-statistics-svg">
        <defs><symbol id="statistics-peak-star-icon" viewBox="0 0 24 24"><path d="M12 2.5 14.94 8.46 21.52 9.42 16.76 14.06 17.88 20.61 12 17.52 6.12 20.61 7.24 14.06 2.48 9.42 9.06 8.46 12 2.5Z"/></symbol></defs>
        ${g.ticks.map(t => `<path d="M60 ${g.y(t)} H995" class="match-statistics-grid"/>`).join('')}${selectedTeamLast}
      </svg><div class="match-statistics-axis" aria-hidden="true">${g.ticks.map(t => `<span style="top:${g.y(t)}px">${number(Math.round(t))}</span>`).join('')}</div></div>`,
      analysis
        ? 'Die Flächen zeigen, welche Elo-Werte bei dieser Partie möglich waren: grün bei einem Sieg und rot bei einer Niederlage. Die durchgezogene Linie zeigt die tatsächliche Elo-Entwicklung. Am Endwert steht die Veränderung durch diese Partie.'
        : 'Die Fächer zeigen die Bereiche der möglichen Elo-Werte nach der Partie: grün bei einem Sieg und rot bei einer Niederlage. Die gestrichelte Linie zeigt die Elo-Prognose des wahrscheinlichsten Ergebnisses.');
  }
  function impactText(impact, data) {
    const condition = impact.onWin ? 'bei einem Sieg' : 'bei einer Niederlage';
    if ((impact.kind === 'leaderPossible' || impact.kind === 'qualificationPossible') && !impact.onWin) return '';
    if ((impact.kind === 'leaderLossPossible' || impact.kind === 'qualificationLossPossible') && impact.onWin) return '';
    const texts = {
      leaderPossible: `Kann ${condition} die Tabellenführung übernehmen.`,
      leaderLossPossible: `Kann ${condition} die Tabellenführung verlieren.`,
      qualificationPossible: `Kann ${condition} die Top ${impact.places} erreichen.`,
      qualificationLossPossible: `Kann ${condition} aus den Top ${impact.places} fallen.`,
      leaderGained: 'Übernimmt die Tabellenführung.', leaderLost: 'Verliert die Tabellenführung',
      qualificationGained: `Erreicht die Top ${impact.places}.`, qualificationLost: `Fällt aus den Top ${impact.places}.`,
      streakStarted: impact.outcome === 'win' ? `Beginnt eine Siegesserie: ${impact.length} in Folge.` : `Eine Niederlagenserie beginnt: ${impact.length} in Folge.`,
      streakExtended: impact.outcome === 'win' ? `Verlängert die Siegesserie auf ${impact.length}.` : `Niederlagenserie verlängert sich auf ${impact.length}.`,
      streakEnded: impact.outcome === 'win' ? `Siegesserie nach ${impact.length} Partien beendet.` : `Beendet die Niederlagenserie nach ${impact.length} Partien.`,
      streakPossible: impact.length >= 3
        ? impact.outcome === 'win' ? `Kann die Siegesserie von ${impact.length} Partien ausbauen.` : `Kann die Niederlagenserie von ${impact.length} Partien beenden.`
        : impact.outcome === 'win' ? 'Kann eine Siegesserie von drei Partien erreichen.' : 'Kann eine Niederlagenserie von drei Partien verhindern.',
      eloPeakPossible: 'Kann einen neuen Elo-Höchstwert erreichen.',
      eloPeak: 'Erreicht einen neuen Elo-Höchstwert.'
    };
    return texts[impact.kind] || '';
  }
  function groupImpacts(data) {
    const factsByPlayer = new Map(data.players.map(player => [player.playerId, []]));
    (data.impacts || []).forEach(impact => {
      const text = impactText(impact, data);
      if (!text) return;
      const targets = impact.playerId
        ? [impact.playerId]
        : data.players.filter(player => Number(player.team) === Number(impact.team)).map(player => player.playerId);
      targets.forEach(playerId => {
        const facts = factsByPlayer.get(playerId);
        if (facts && !facts.includes(text)) facts.push(text);
      });
    });
    return data.players.map(player => ({ player, facts: factsByPlayer.get(player.playerId) || [] })).filter(group => group.facts.length);
  }
  function render(data, selectedPlayerId = null, forecastOptions = {}) {
    const head = renderHead(data, selectedPlayerId);
    if (data.availability === 'basic') return `${head}<p class="match-statistics-note">Die ausführliche Vorschau folgt näher am Spieltag.</p>`;
    const forecast = Object.prototype.hasOwnProperty.call(forecastOptions, 'forecast')
      ? renderMatchForecast(data, forecastOptions.forecast, forecastOptions)
      : '';
    return head + forecast
      + renderContext(data, selectedPlayerId) + renderForm(data, selectedPlayerId) + renderPlayersAndImpacts(data, groupImpacts(data), selectedPlayerId) + renderGraph(data, selectedPlayerId)
      + (data.availability === 'preview' ? '<p class="match-statistics-note">Werte und Prognosen können sich durch weitere bestätigte Partien bis zum Spielbeginn verändern.</p>' : '');
  }
  function skeleton() {
    const card = '<div class="match-statistics-skeleton-card"><span class="loading-skeleton"></span><span class="loading-skeleton"></span><span class="loading-skeleton"></span></div>';
    return `<p class="sr-only" role="status">Partiestatistik wird geladen …</p><div aria-hidden="true" class="match-statistics-skeleton">
      <div class="match-statistics-players">${card.repeat(4)}</div><div class="loading-skeleton match-statistics-skeleton-meta"></div>
      <div class="loading-skeleton match-statistics-skeleton-history"></div><div class="match-statistics-players">${card.repeat(4)}</div>
      <div class="loading-skeleton match-statistics-skeleton-graph"></div><div class="loading-skeleton match-statistics-skeleton-history"></div></div>`;
  }
  const api = { availability, entry, icon, render, renderMatchForecast, renderForecastResult, isForecastConcealed, concealedForecastPercentage, skeleton, graphGeometry, analysisResultY, headerMeta, playedOrderLabel };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  let request = 0, active = null, returnState = null, profileOnTop = false, profileReplacesDetail = false, currentRoute = null, routeNumber = 0;
  let activeData = null, activeForecast = null, forecastSelectionOpen = false, forecastSubmitting = false, forecastMessage = '';
  let forecastRefreshPromise = null;
  let sequence = [];
  let presentation = 'modal', presentationPreference = null, panelContextActive = false, embeddedPanelAvailable = false, sharedDetailFlow = false;
  let lastTrigger = null;
  const routeContexts = new Map();
  // Vorgeladene Nachbarpartien gelten nur, solange die Detailansicht geöffnet bleibt.
  const prefetched = new Map();
  const PREFETCH_MAX_AGE = 2 * 60 * 1000;
  const PREFETCH_DELAY = 300;
  const panelLayout = window.PadelLigaPanelLayout;
  const presentationStore = panelLayout.createPresentationPreference('padel-liga-match-statistics-presentation');
  const isDetailEmbed = document.documentElement.classList.contains('is-detail-embed');
  const dialog = () => document.getElementById('detail-view-dialog');
  const content = () => document.getElementById('detail-view-body');
  const panelHost = () => document.getElementById('match-statistics-panel-host');
  const modalHost = () => document.getElementById('detail-view-modal-host');
  function postEmbedMessage(message) {
    if (!isDetailEmbed || window.parent === window) return;
    const targetOrigin = window.location.protocol === 'file:' ? '*' : window.location.origin;
    window.parent.postMessage(message, targetOrigin);
  }
  function canUsePanel() {
    if (!panelContextActive) return false;
    if (isDetailEmbed) return embeddedPanelAvailable;
    const section = document.getElementById('partien');
    return Boolean(section?.classList.contains('active') && panelHost() && panelLayout.hasPanelSpace(panelLayout.layouts.matchList));
  }
  function shouldUsePanel() {
    return presentationPreference === 'panel' && canUsePanel();
  }
  function updatePanelMetrics() {
    if (isDetailEmbed || presentation !== 'panel') return;
    panelLayout.applySplitLeft(panelLayout.layouts.matchList, '--match-statistics-split-left');
  }
  function updatePresentationControls() {
    const toggle = document.getElementById('match-statistics-presentation-toggle');
    const backControl = document.querySelector('[data-detail-view-back]');
    const panelAvailable = panelContextActive && canUsePanel();
    if (toggle) {
      const target = presentation === 'panel' ? 'modal' : 'panel';
      const label = target === 'panel'
        ? 'Partiestatistik als Seitenpanel öffnen'
        : 'Partiestatistik als Vollbild öffnen';
      toggle.hidden = !active || !panelAvailable;
      toggle.dataset.targetPresentation = target;
      toggle.setAttribute('aria-label', label);
      toggle.title = label;
    }
    if (backControl) backControl.hidden = false;
  }
  function updateActiveMatchHighlights() {
    document.querySelectorAll('#partien [data-match-statistics]').forEach(control => {
      const selected = Boolean(active) && !profileOnTop && control.dataset.matchStatistics === active;
      control.setAttribute('aria-expanded', String(selected && presentation === 'panel'));
      control.setAttribute('aria-controls', 'detail-view-dialog');
      control.closest('.mc, .cup-match-card')?.classList.toggle('match-statistics-open-highlight', selected && presentation === 'panel');
    });
  }
  function announcePanel() {
    const status = document.getElementById('match-statistics-panel-status');
    if (!status) return;
    status.textContent = presentation === 'panel' && active
      ? 'Partievorschau oder Partierückschau als Seitenpanel geöffnet.'
      : '';
  }
  function setPresentation(nextPresentation, { preserveScroll = true, focusToggle = false } = {}) {
    const target = nextPresentation === 'panel' && canUsePanel() ? 'panel' : 'modal';
    const targetDialog = dialog();
    if (!targetDialog) return;
    const shell = targetDialog.querySelector('.detail-view-shell');
    const scrollTop = preserveScroll ? shell?.scrollTop || 0 : 0;
    const wasOpen = targetDialog.open;

    if (!isDetailEmbed && (target !== presentation || !wasOpen)) {
      if (wasOpen) targetDialog.close();
      const host = target === 'panel' ? panelHost() : modalHost();
      if (host && targetDialog.parentElement !== host) host.append(targetDialog);
    }

    presentation = target;
    if (active && target === 'panel') sharedDetailFlow = true;
    targetDialog.dataset.presentation = target;
    targetDialog.classList.toggle(
      'is-detail-panel-swap',
      target === 'panel' && document.body.classList.contains('detail-panel-switching')
    );
    if (target === 'panel') targetDialog.setAttribute('aria-modal', 'false');
    else targetDialog.removeAttribute('aria-modal');
    document.body.classList.toggle('match-statistics-panel-open', target === 'panel' && !isDetailEmbed);
    if (target === 'panel' && !isDetailEmbed) updatePanelMetrics();
    else if (!isDetailEmbed) document.body.style.removeProperty('--match-statistics-split-left');

    if (!wasOpen || (!isDetailEmbed && targetDialog.parentElement)) {
      if (!targetDialog.open) {
        if (target === 'panel' && !isDetailEmbed) targetDialog.show();
        else targetDialog.showModal();
      }
    }
    updatePresentationControls();
    updatePager();
    updateActiveMatchHighlights();
    announcePanel();
    postEmbedMessage({ type: 'padel:detail-presentation', presentation: target, matchId: active, view: 'match' });
    requestAnimationFrame(() => {
      if (shell) shell.scrollTop = scrollTop;
      if (focusToggle) document.getElementById('match-statistics-presentation-toggle')?.focus({ preventScroll: true });
      else if (target === 'panel' && lastTrigger?.isConnected) lastTrigger.focus({ preventScroll: true });
    });
  }
  function reconcilePresentation() {
    if (!active || dialog()?.dataset.mode !== 'statistics') return;
    if (profileOnTop && profileReplacesDetail) {
      window.PadelLigaReconcilePlayerProfile?.();
      return;
    }
    const target = shouldUsePanel() ? 'panel' : 'modal';
    if (target === presentation) {
      updatePanelMetrics();
      updatePresentationControls();
      updateActiveMatchHighlights();
      return;
    }
    setPresentation(target);
  }
  function togglePresentation() {
    if (!active || !panelContextActive || !canUsePanel()) return;
    const target = presentation === 'panel' ? 'modal' : 'panel';
    presentationPreference = target;
    presentationStore.set(target);
    setPresentation(target, { focusToggle: true });
  }
  function setEmbeddedPanelAvailability(available) {
    if (!isDetailEmbed) return;
    embeddedPanelAvailable = Boolean(available);
    reconcilePresentation();
  }
  function setSequence(nextSequence) {
    if (!Array.isArray(nextSequence)) return;
    sequence = [...new Set(nextSequence.filter(Boolean))];
    updatePager();
  }
  const getClient = () => {
    const config = window.PADEL_SUPABASE_CONFIG;
    return window.PadelKonto?.getClient?.()
      || window.PADEL_SUPABASE_CLIENT
      || (config && window.supabase?.createClient(config.url, config.publishableKey));
  };
  const getSession = () => window.PadelKonto?.getSession?.() || null;
  function renderActiveContent() {
    if (!activeData) return;
    content().innerHTML = render(activeData, window.PadelLigaGetSelectedViewerId?.(), {
      forecast: activeForecast,
      session: getSession(),
      profile: window.PadelKonto?.getProfile?.() || null,
      selectionOpen: forecastSelectionOpen,
      submitting: forecastSubmitting,
      message: forecastMessage
    });
    content().setAttribute('aria-busy', 'false');
  }
  async function loadForecast(client, matchId) {
    const { data, error } = await client.rpc('get_public_match_forecast', { p_match_id: matchId });
    if (error) return { error: true };
    return data ?? null;
  }
  function takePrefetched(matchId) {
    const entry = prefetched.get(matchId);
    prefetched.delete(matchId);
    return entry && Date.now() - entry.time < PREFETCH_MAX_AGE ? entry : null;
  }
  async function loadDetail(client, matchId, cached) {
    const result = cached ? await cached.detail : null;
    if (result && !result.error && result.data) return result;
    return client.rpc('get_public_match_detail', { p_match_id: matchId });
  }
  async function loadInitialForecast(client, matchId, cached) {
    if (cached) {
      const forecast = await cached.forecast;
      if (!forecast?.error) return forecast;
    }
    return loadForecast(client, matchId);
  }
  function neighbours(matchId) {
    const index = sequence.indexOf(matchId);
    return index === -1 ? [] : [sequence[index + 1], sequence[index - 1]].filter(Boolean);
  }
  // Die aktuelle Partie lädt zuerst; Nachbarn folgen danach nacheinander und blockieren nichts.
  function schedulePrefetch(token) {
    setTimeout(async () => {
      for (const matchId of neighbours(active)) {
        if (token !== request) return;
        const existing = prefetched.get(matchId);
        if (existing && Date.now() - existing.time < PREFETCH_MAX_AGE) continue;
        const client = getClient();
        if (!client) return;
        const entry = {
          time: Date.now(),
          detail: Promise.resolve(client.rpc('get_public_match_detail', { p_match_id: matchId })).catch(() => ({ error: true })),
          forecast: loadForecast(client, matchId).catch(() => ({ error: true }))
        };
        prefetched.set(matchId, entry);
        await Promise.all([entry.detail, entry.forecast]);
      }
    }, PREFETCH_DELAY);
  }
  function updatePager() {
    const pager = document.getElementById('match-statistics-pager');
    if (!pager) return;
    const index = active ? sequence.indexOf(active) : -1;
    const focused = pager.contains(document.activeElement) ? document.activeElement : null;
    pager.hidden = presentation === 'panel' || index === -1 || sequence.length < 2;
    pager.querySelector('[data-statistics-step="-1"]').disabled = index <= 0;
    pager.querySelector('[data-statistics-step="1"]').disabled = index === -1 || index >= sequence.length - 1;
    // Am Listenende bleibt der Fokus im Dialog statt mit dem deaktivierten Pfeil zu verschwinden.
    if (focused?.disabled) (pager.querySelector('[data-statistics-step]:not(:disabled)') || document.querySelector('[data-detail-view-back]'))?.focus({ preventScroll: true });
  }
  function step(direction) {
    if (!active || profileOnTop) return;
    const target = sequence[sequence.indexOf(active) + direction];
    if (!target) return;
    void open(target, { keepSequence: true, step: direction });
  }
  async function refreshActiveForecast() {
    if (!active || !activeData) return;
    if (forecastRefreshPromise) return forecastRefreshPromise;
    const matchId = active;
    const client = getClient();
    if (!client) return;
    const requestPromise = loadForecast(client, matchId);
    forecastRefreshPromise = requestPromise;
    try {
      const forecast = await requestPromise;
      if (active !== matchId) return;
      if (forecast?.error && activeForecast && !activeForecast.error) {
        forecastMessage = 'Die Tipps konnten nicht aktualisiert werden.';
        renderActiveContent();
        return;
      }
      activeForecast = forecast;
      forecastSelectionOpen = false;
      forecastMessage = '';
      renderActiveContent();
    } finally {
      if (forecastRefreshPromise === requestPromise) forecastRefreshPromise = null;
    }
  }
  function setPlayedOrder(data = null) {
    const target = document.getElementById('match-statistics-played-order');
    if (!target) return;
    const label = playedOrderLabel(data);
    target.textContent = label;
    target.hidden = !label;
  }
  function getSeasonBaseUrl() {
    const season = window.PadelLigaGetSeasonData?.();
    if (!season?.id || !window.PadelSeasonRouting) {
      const url = new URL(window.location.href);
      url.searchParams.delete('partie');
      return url;
    }
    const url = window.PadelSeasonRouting.getSeasonUrl(season.id, 'league', {
      preserveSearch: true,
      preserveHash: true
    });
    url.searchParams.delete('partie');
    return url;
  }
  function getRequestedMatchId() {
    const season = window.PadelLigaGetSeasonData?.();
    return window.PadelSeasonRouting?.getRequestedMatchId(season?.matches || [])
      || new URL(window.location.href).searchParams.get('partie');
  }
  function restore() {
    const closingReturnState = returnState;
    ++request; active = null; activeData = null; activeForecast = null; currentRoute = null;
    forecastSelectionOpen = false; forecastSubmitting = false; forecastMessage = '';
    sequence = []; prefetched.clear(); updatePager();
    if (dialog()?.dataset.mode !== 'statistics') return;
    const profile = document.getElementById('player-profile-dialog');
    profileOnTop = false;
    profileReplacesDetail = false;
    if (profile?.open) window.PadelLigaClosePlayerProfile?.({ fromHistory: true });
    dialog().close();
    dialog().classList.remove('is-detail-panel-swap');
    delete dialog().dataset.mode;
    const detailModalHost = modalHost();
    if (!isDetailEmbed && detailModalHost && dialog().parentElement !== detailModalHost) detailModalHost.append(dialog());
    presentation = 'modal';
    presentationPreference = null;
    panelContextActive = false;
    embeddedPanelAvailable = false;
    sharedDetailFlow = false;
    lastTrigger = null;
    dialog().dataset.presentation = 'modal';
    dialog().removeAttribute('aria-modal');
    document.body.classList.remove('match-statistics-panel-open');
    document.body.style.removeProperty('--match-statistics-split-left');
    updatePresentationControls();
    updateActiveMatchHighlights();
    announcePanel();
    document.getElementById('final-four-view-switcher').hidden = false;
    const closeControl = document.querySelector('[data-detail-view-back]');
    closeControl?.setAttribute('aria-label', 'Final Four schließen');
    if (closeControl) closeControl.title = 'Final Four schließen';
    document.getElementById('detail-view-title').textContent = 'FINAL FOUR';
    setPlayedOrder();
    if (closingReturnState) {
      window.scrollTo({ top: closingReturnState.scroll, behavior: 'instant' });
      if (closingReturnState.profileOpen) {
        if (!document.getElementById('player-profile-dialog').open || window.PadelLigaCapturePlayerProfile?.().data !== closingReturnState.profileSnapshot?.data) window.PadelLigaRestorePlayerProfile?.(closingReturnState.profileSnapshot);
        const profileShell = document.querySelector('#player-profile-dialog .player-profile-shell');
        if (profileShell) profileShell.scrollTop = closingReturnState.profileScroll;
      }
      const trigger = closingReturnState.trigger?.isConnected ? closingReturnState.trigger : closingReturnState.triggerMatch
        ? document.querySelector(`#partien [data-match-statistics="${CSS.escape(closingReturnState.triggerMatch)}"], #player-profile-dialog [data-match-statistics="${CSS.escape(closingReturnState.triggerMatch)}"]`) : null;
      const focusTarget = trigger
        || document.querySelector('#match-scope-toggle .active, #match-sort-toggle .active, nav [data-section="partien"]');
      focusTarget?.focus({ preventScroll: true });
      returnState = null;
    }
  }
  function close() {
    if (!active) return;
    // Eingebettet teilt der Rahmen den Verlauf der Tippseite; ein Zurück könnte die Tippseite verlassen.
    if (!isDetailEmbed && window.history.state?.matchStatistics) window.history.back();
    else { window.history.replaceState(window.history.state, '', getSeasonBaseUrl()); restore(); }
  }
  function notice(message) {
    let target = document.getElementById('match-statistics-notice');
    if (!target) { target = document.createElement('p'); target.id = 'match-statistics-notice'; target.className = 'match-statistics-notice'; target.setAttribute('role', 'status'); document.body.append(target); }
    target.textContent = message;
    setTimeout(() => target.remove(), 6000);
  }
  function rejectUnavailable(message) {
    window.history.replaceState({ ...window.history.state, matchStatistics: null }, '', getSeasonBaseUrl());
    restore(); notice(message);
  }
  const previewPendingMessage = 'Die Partievorschau ist erst näher am Spieltag verfügbar.';
  async function open(matchId, { updateUrl = true, direct = false, trigger = null, returnContext = null, keepSequence = false, step: stepDirection = 0, sequence: suppliedSequence = null, panelAvailable = null } = {}) {
    if (!matchId) return;
    // Manuell geänderte Partie-Links öffnen keine Vorschau außerhalb ihres Fensters.
    const season = window.PadelLigaGetSeasonData?.();
    const seasonMatch = season?.matches?.find(match => match.id === matchId);
    if (seasonMatch && availability(seasonMatch, season) === 'basic') { rejectUnavailable(previewPendingMessage); return; }
    const openingFresh = !active;
    const standaloneProfileContext = openingFresh
      ? window.PadelLigaGetPlayerProfileDetailContext?.()
      : null;
    if (openingFresh) {
      presentationPreference = standaloneProfileContext?.presentationPreference
        || presentationStore.get();
      const contextTrigger = trigger || returnContext?.trigger;
      panelContextActive = isDetailEmbed
        ? Boolean(standaloneProfileContext?.panelAvailable ?? panelAvailable)
        : Boolean(
            standaloneProfileContext?.origin === 'match-list'
            || (!direct && contextTrigger?.closest('#partien') && document.getElementById('partien')?.classList.contains('active'))
          );
      embeddedPanelAvailable = isDetailEmbed
        && Boolean(standaloneProfileContext?.panelAvailable ?? panelAvailable);
    } else if (isDetailEmbed && panelAvailable !== null) {
      panelContextActive = true;
      embeddedPanelAvailable = Boolean(panelAvailable);
    }
    if (standaloneProfileContext?.returnContext) {
      returnContext = returnContext || standaloneProfileContext.returnContext;
      sharedDetailFlow = true;
      window.PadelLigaBeginDetailPanelSwitch?.();
      window.PadelLigaClosePlayerProfile?.({ fromHistory: true, restoreFocus: false });
      postEmbedMessage({ type: 'padel:detail-active-view', view: 'match', matchId });
    }
    lastTrigger = standaloneProfileContext?.returnContext?.trigger || trigger || lastTrigger;
    window.PadelLiveTicker?.close();
    const fromProfileAbove = profileOnTop
      && (profileReplacesDetail || trigger?.closest('#player-profile-dialog'));
    const retainedActiveData = fromProfileAbove && active === matchId ? activeData : null;
    const retainedActiveForecast = retainedActiveData ? activeForecast : null;
    if (fromProfileAbove) {
      const replacedDetail = profileReplacesDetail;
      profileOnTop = false;
      profileReplacesDetail = false;
      if (replacedDetail) {
        window.PadelLigaBeginDetailPanelSwitch?.();
        window.PadelLigaClosePlayerProfile?.({ fromHistory: true, restoreFocus: false });
      }
      else if (dialog().open) dialog().close();
      postEmbedMessage({ type: 'padel:detail-active-view', view: 'match', matchId });
    }
    if (!active) {
      const profile = document.getElementById('player-profile-dialog');
      returnState = returnContext || { trigger: trigger || document.activeElement, triggerMatch: (trigger || document.activeElement)?.dataset.matchStatistics, scroll: window.scrollY, profileOpen: profile?.open, profileScroll: profile?.querySelector('.player-profile-shell')?.scrollTop || 0, profileSnapshot: window.PadelLigaCapturePlayerProfile?.() };
      if (returnContext?.profileOpen && (!profile?.open || window.PadelLigaCapturePlayerProfile?.().data !== returnContext.profileSnapshot?.data)) window.PadelLigaRestorePlayerProfile?.(returnContext.profileSnapshot);
    }
    if (!keepSequence) {
      sequence = Array.isArray(suppliedSequence)
        ? [...new Set(suppliedSequence.filter(Boolean))]
        : (!active && returnContext?.sequence) || window.PadelLigaGetMatchStatisticsSequence?.(trigger, matchId) || [];
      if (returnState) returnState.sequence = sequence;
    }
    active = matchId;
    activeData = retainedActiveData;
    activeForecast = retainedActiveForecast;
    forecastSelectionOpen = false;
    forecastSubmitting = false;
    forecastMessage = '';
    const token = ++request;
    dialog().dataset.mode = 'statistics';
    const closeControl = document.querySelector('[data-detail-view-back]');
    closeControl?.setAttribute('aria-label', 'Partiestatistik schließen');
    if (closeControl) closeControl.title = 'Partiestatistik schließen';
    document.getElementById('detail-view-title').textContent = retainedActiveData?.label || 'PARTIE';
    document.getElementById('detail-view-context').textContent = retainedActiveData
      ? headerMeta(retainedActiveData)
      : '';
    setPlayedOrder(retainedActiveData);
    document.getElementById('final-four-view-switcher').hidden = true;
    updatePager();
    const cached = takePrefetched(matchId);
    if (retainedActiveData) renderActiveContent();
    else { content().innerHTML = skeleton(); content().setAttribute('aria-busy', 'true'); }
    setPresentation(shouldUsePanel() ? 'panel' : 'modal', { preserveScroll: false });
    if (stepDirection) window.PadelSwipeGesture?.animateIn(content(), stepDirection);
    else if (presentation === 'modal') document.querySelector('[data-detail-view-back]')?.focus({ preventScroll: true });
    dialog().querySelector('.detail-view-shell').scrollTop = 0;
    updateActiveMatchHighlights();
    postEmbedMessage({ type: 'padel:detail-active-match', matchId: active });
    if (updateUrl) {
      const replacing = isDetailEmbed || Boolean(getRequestedMatchId()) || Boolean(currentRoute);
      const url = window.PadelSeasonRouting?.getMatchUrl(season?.id, seasonMatch || matchId, {
        preserveSearch: true,
        preserveHash: true
      }) || new URL(window.location.href);
      url.searchParams.delete('live'); url.searchParams.delete('liveView');
      if (!window.PadelSeasonRouting) url.searchParams.set('partie', matchId);
      currentRoute = replacing && currentRoute ? currentRoute : `statistics-${++routeNumber}`;
      routeContexts.set(currentRoute, returnState);
      window.history[replacing ? 'replaceState' : 'pushState']({ ...window.history.state, matchStatistics: matchId, statisticsRoute: currentRoute, statisticsProfile: null, statisticsTop: 'match' }, '', url);
    }
    if (!updateUrl) currentRoute = window.history.state?.statisticsRoute || null;
    if (retainedActiveData) {
      schedulePrefetch(token);
      return;
    }
    try {
      const client = getClient();
      if (!client) throw new Error('Verbindung nicht verfügbar');
      const detailResult = await loadDetail(client, matchId, cached);
      if (token !== request) return;
      const { data, error } = detailResult;
      if (error) throw error;
      if (!data) { rejectUnavailable('Für diese Partie ist keine Partiestatistik verfügbar.'); return; }
      if (data.availability === 'basic') { rejectUnavailable(previewPendingMessage); return; }
      // Direct links get an in-page return destination only after successful validation.
      if (direct && !isDetailEmbed) {
        const route = new URL(window.location.href), base = getSeasonBaseUrl();
        window.history.replaceState({ ...window.history.state, matchStatistics: null }, '', base);
        currentRoute = `statistics-${++routeNumber}`;
        routeContexts.set(currentRoute, returnState);
        window.history.pushState({ ...window.history.state, matchStatistics: matchId, statisticsRoute: currentRoute, statisticsProfile: null, statisticsTop: 'match' }, '', route);
      }
      document.getElementById('detail-view-title').textContent = data.label;
      setPlayedOrder(data);
      document.getElementById('detail-view-context').textContent = headerMeta(data);
      activeData = data;
      forecastMessage = 'Tipps werden geladen …';
      renderActiveContent();
      if (direct) { schedulePrefetch(token); return; }
      const forecast = await loadInitialForecast(client, matchId, cached);
      if (token !== request) return;
      activeForecast = forecast;
      forecastMessage = '';
      renderActiveContent();
      schedulePrefetch(token);
    } catch (error) {
      if (token !== request) return;
      content().setAttribute('aria-busy', 'false');
      content().innerHTML = '<div class="hint" role="alert">Die Partiestatistik konnte nicht geladen werden.<br><button type="button" class="secondary-button" data-statistics-retry>Erneut laden</button></div>';
    }
  }
  function prepareProfileOpen(trigger, playerId, fromHistory = false, sharedDetail = false) {
    const fromStatistics = Boolean(trigger?.closest('#detail-view-dialog'));
    const withinReplacingProfile = Boolean(profileOnTop && profileReplacesDetail && trigger?.closest('#player-profile-dialog'));
    const fromSharedList = Boolean(sharedDetail || (sharedDetailFlow && trigger?.closest('#partien')));
    if (!active || (!fromHistory && !fromStatistics && !withinReplacingProfile && !fromSharedList)) return false;
    profileOnTop = true;
    profileReplacesDetail = sharedDetailFlow;
    if (profileReplacesDetail) window.PadelLigaBeginDetailPanelSwitch?.();
    if (profileReplacesDetail && dialog()?.open) dialog().close();
    if (profileReplacesDetail) {
      const status = document.getElementById('match-statistics-panel-status');
      if (status) status.textContent = '';
    }
    updateActiveMatchHighlights();
    postEmbedMessage({ type: 'padel:detail-active-view', view: 'profile', matchId: active, playerId });
    if (!fromHistory) window.history.replaceState({ ...window.history.state, statisticsProfile: playerId, statisticsTop: 'profile' }, '', window.location.href);
    return {
      active: true,
      replacesDetail: profileReplacesDetail,
      presentation,
      presentationPreference: presentationPreference || presentation,
      panelAvailable: canUsePanel()
    };
  }
  function syncProfilePresentation(nextPresentation, { persistPreference = false } = {}) {
    if (!profileOnTop || !profileReplacesDetail) return false;
    const target = nextPresentation === 'panel' && canUsePanel() ? 'panel' : 'modal';
    presentation = target;
    if (persistPreference) {
      presentationPreference = target;
      presentationStore.set(target);
    }
    if (!isDetailEmbed) {
      document.body.classList.toggle('match-statistics-panel-open', target === 'panel');
      if (target === 'panel') updatePanelMetrics();
      else document.body.style.removeProperty('--match-statistics-split-left');
    }
    updateActiveMatchHighlights();
    postEmbedMessage({ type: 'padel:detail-presentation', presentation: target, matchId: active, view: 'profile' });
    return target;
  }
  function closeProfile() {
    if (!profileOnTop) return false;
    if (profileReplacesDetail) {
      close();
      return true;
    }
    profileOnTop = false;
    window.history.replaceState({ ...window.history.state, statisticsProfile: null, statisticsTop: 'match' }, '', window.location.href);
    return false;
  }
  async function submitQuickPrediction(prediction) {
    if (!active || !activeData || !activeForecast?.open || forecastSubmitting || !['2:0', '2:1', '1:2', '0:2'].includes(prediction)) return;
    const authenticatedPlayerId = window.PadelKonto?.getProfile?.()?.player_id;
    if (authenticatedPlayerId && activeData.players?.some(player => player.playerId === authenticatedPlayerId)) return;
    const client = getClient();
    if (!client) return;
    forecastSubmitting = true;
    forecastMessage = '';
    renderActiveContent();
    const matchId = active;
    const { data, error } = await client.rpc('submit_match_quick_prediction', {
      p_match_id: matchId,
      p_prediction: prediction
    });
    if (active !== matchId) return;
    forecastSubmitting = false;
    if (error) {
      const errorMessage = String(error.message || '');
      forecastMessage = /bestätigen/i.test(errorMessage)
        ? 'Bitte bestätige zuerst deine E-Mail-Adresse.'
        : /Eigene Partien/i.test(errorMessage)
        ? 'Die eigene Partie kann nicht getippt werden.'
        : /beendet|geöffnet|geschlossen/i.test(errorMessage)
        ? 'Die Tippabgabe ist bereits beendet.'
        : 'Der Tipp konnte gerade nicht gespeichert werden.';
      renderActiveContent();
      return;
    }
    activeForecast = data;
    forecastSelectionOpen = false;
    forecastMessage = '';
    renderActiveContent();
    window.dispatchEvent(new CustomEvent('padel:match-forecast-changed', {
      detail: { forecast: data }
    }));
  }
  Object.assign(api, {
    open,
    close,
    restore,
    prepareProfileOpen,
    syncProfilePresentation,
    closeProfile,
    refreshForecast: refreshActiveForecast,
    reconcilePresentation,
    setEmbeddedPanelAvailability,
    setSequence
  });
  Object.defineProperty(api, 'active', { get: () => active });
  Object.defineProperty(api, 'presentation', { get: () => presentation });
  Object.defineProperty(api, 'profileContext', {
    get: () => ({
      active: profileOnTop && profileReplacesDetail,
      presentation,
      panelAvailable: canUsePanel()
    })
  });
  window.PadelMatchStatistics = api;
  document.addEventListener('click', event => {
    if (event.target.closest('[data-match-statistics-presentation-toggle]')) {
      togglePresentation();
      return;
    }
    const forecastChoice = event.target.closest('[data-match-forecast-prediction]');
    if (forecastChoice) {
      void submitQuickPrediction(forecastChoice.dataset.matchForecastPrediction);
      return;
    }
    if (event.target.closest('[data-match-forecast-change]')) {
      forecastSelectionOpen = true;
      forecastMessage = '';
      renderActiveContent();
      return;
    }
    const retry = event.target.closest('[data-statistics-retry]');
    if (retry && active) { void open(active, { updateUrl: false, keepSequence: true }); return; }
    const stepButton = event.target.closest('[data-statistics-step]');
    if (stepButton) { step(Number(stepButton.dataset.statisticsStep)); return; }
    const graphPlayerButton = event.target.closest('[data-statistics-graph-select]');
    if (graphPlayerButton) {
      const picker = graphPlayerButton.closest('[data-statistics-graph-picker]');
      const graph = picker?.closest('.match-statistics-section')?.querySelector('.match-statistics-svg');
      const players = [...(graph?.querySelectorAll('[data-statistics-graph-player]') || [])];
      const selected = players.find(player => player.dataset.statisticsGraphPlayer === graphPlayerButton.dataset.statisticsGraphSelect);
      picker.querySelectorAll('[data-statistics-graph-select]').forEach(button => {
        const isActive = button === graphPlayerButton;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      });
      players.forEach(player => player.classList.toggle('is-player-selected', player === selected));
      if (selected) selected.parentElement.append(selected);
      return;
    }
    const graphTeamButton = event.target.closest('[data-statistics-graph-team-select]');
    if (graphTeamButton) {
      const picker = graphTeamButton.closest('[data-statistics-graph-picker]');
      const graph = picker?.closest('.match-statistics-section')?.querySelector('.match-statistics-svg');
      const players = [...(graph?.querySelectorAll('[data-statistics-graph-player]') || [])];
      const selectedTeam = graphTeamButton.dataset.statisticsGraphTeamSelect;
      picker.querySelectorAll('[data-statistics-graph-team-select]').forEach(button => {
        const isActive = button === graphTeamButton;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      });
      const selectedPlayers = players.filter(player => player.dataset.statisticsGraphTeam === selectedTeam);
      players.forEach(player => player.classList.toggle('is-team-selected', selectedPlayers.includes(player)));
      selectedPlayers.forEach(player => player.parentElement.append(player));
      return;
    }
    const button = event.target.closest('[data-match-statistics]');
    if (button && !event.target.closest('[data-player-profile-id]')) { event.preventDefault(); void open(button.dataset.matchStatistics, { trigger: button }); }
  });
  window.addEventListener('padel:auth-state-changed', () => {
    // Prognosen enthalten den eigenen Tipp und dürfen kontoübergreifend nicht wiederverwendet werden.
    prefetched.clear();
    if (active && activeData) void refreshActiveForecast();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active && presentation === 'panel' && !profileOnTop) {
      if ([...document.querySelectorAll('dialog:modal')].some(other => other !== dialog())) return;
      event.preventDefault();
      close();
      return;
    }
    if (!active || profileOnTop || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!dialog()?.open || dialog().dataset.mode !== 'statistics' || presentation !== 'modal') return;
    // Andere Dialoge oberhalb der Partiestatistik behalten ihre Pfeiltasten.
    if ([...document.querySelectorAll('dialog[open]')].some(other => other !== dialog() && other.id !== 'player-profile-dialog')) return;
    if (event.target.closest?.('input, select, textarea, [contenteditable]')) return;
    event.preventDefault();
    step(event.key === 'ArrowRight' ? 1 : -1);
  });
  window.PadelSwipeGesture?.attach(dialog()?.querySelector('.detail-view-shell'), {
    enabled: () => Boolean(active) && !profileOnTop && presentation === 'modal' && dialog()?.dataset.mode === 'statistics',
    onSwipe: step
  });
  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(reconcilePresentation);
  });
  window.addEventListener('popstate', async () => {
    const id = getRequestedMatchId();
    const route = window.history.state?.statisticsRoute;
    const profileId = window.history.state?.statisticsProfile;
    if (profileOnTop && !profileId) {
      profileOnTop = false;
      profileReplacesDetail = false;
      window.PadelLigaClosePlayerProfile?.({ fromHistory: true });
    }
    if (!id) { if (active) restore(); return; }
    if (id !== active || route !== currentRoute) {
      if (active) restore();
      await open(id, { updateUrl: false, returnContext: routeContexts.get(route) });
    }
    if (active === id && currentRoute === route && profileId && !profileOnTop) {
      const trigger = dialog().querySelector(`[data-player-profile-id="${CSS.escape(profileId)}"]`);
      void window.PadelLigaOpenPlayerProfile?.(profileId, trigger, { fromHistory: true });
    }
  });
})();
