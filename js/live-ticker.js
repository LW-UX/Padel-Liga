(function () {
  const state = {
    client: null,
    initialized: false,
    activeMatch: null,
    historyMatchIds: new Set(),
    matchId: null,
    view: 'match',
    payload: null,
    overviewPayloads: [],
    statusChannel: null,
    statusConnected: false,
    auth: null,
    accountData: { matches: [], requests: [] },
    candidates: new Map(),
    assignmentEditors: new Set(),
    startModes: new Map(),
    selectedWinners: new Map(),
    pendingScoreActions: new Map(),
    processingMatches: new Set(),
    accountMessage: '',
    loadRequestId: 0
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getClient() {
    if (state.client) return state.client;
    const config = window.PADEL_SUPABASE_CONFIG;
    if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) return null;
    state.client = window.PADEL_SUPABASE_CLIENT || window.supabase.createClient(config.url, config.publishableKey);
    window.PADEL_SUPABASE_CLIENT = state.client;
    return state.client;
  }

  function isMissingRpc(error) {
    return error?.code === 'PGRST202' || /live_(?:ticker|status|scorer|match|point|game|tiebreak)/i.test(String(error?.message || ''));
  }

  function triggersGlobalLiveButton(activeMatch) {
    if (!activeMatch?.matchId) return false;
    const season = (window.PADEL_SEASONS || []).find(option => String(option.id) === String(activeMatch.seasonId));
    return !season?.hidden;
  }

  function formatDateTime(value) {
    if (!value) return 'Termin offen';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(date).replace(',', ' ·') + ' Uhr';
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(date);
  }

  function renderDialogSeasonLabel(payload) {
    const target = document.getElementById('live-ticker-season-label');
    if (!target) return;
    target.textContent = [payload?.seasonLabel, formatDate(payload?.matchAt)].filter(Boolean).join(' · ');
  }

  function pointLabel(session) {
    if (!session) return '0:0';
    if (session.isTiebreak) return `${session.teamOneTiebreak}:${session.teamTwoTiebreak}`;
    const values = ['0', '15', '30', '40'];
    return `${values[session.teamOnePoints] || '0'}:${values[session.teamTwoPoints] || '0'}`;
  }

  function scoringMode(session) {
    return session?.scoringMode === 'games' ? 'games' : 'points';
  }

  function scoringModeLabel(session) {
    return scoringMode(session) === 'games' ? 'Einfacher Liveticker' : 'Detaillierter Liveticker';
  }

  function createActionId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function profileEmoji(playerId) {
    return (window.PADEL_PLAYERS || []).find(player => player.id === playerId)?.profileEmoji || '👤';
  }

  function renderPlayer(player, currentServerId) {
    const serving = player.playerId === currentServerId;
    return `<button class="live-ticker-player player-profile-link" type="button" data-player-profile-id="${escapeHtml(player.playerId)}">
      ${serving ? '<span class="live-ticker-serve" title="Aufschlag" aria-label="hat Aufschlag">◉</span>' : ''}
      <span class="live-ticker-player-photo" aria-hidden="true">
        <img class="live-ticker-player-image" src="assets/players/${encodeURIComponent(player.playerId)}/profile.webp" alt="" data-live-player-image>
        <span class="live-ticker-player-emoji" hidden>${escapeHtml(profileEmoji(player.playerId))}</span>
      </span>
      <span class="live-ticker-player-name">${escapeHtml(player.displayName)}</span>
      <small class="live-ticker-player-elo">${Number.isFinite(Number(player.currentElo)) ? `${Math.round(Number(player.currentElo))} Elo` : 'Elo –'}</small>
    </button>`;
  }

  function renderTeam(players, team, currentServerId) {
    return `<div class="live-ticker-team live-ticker-team-${team}">
      ${players.filter(player => Number(player.team) === team).map(player => renderPlayer(player, currentServerId)).join('')}
    </div>`;
  }

  function groupGames(events = []) {
    const groups = [];
    events.forEach(event => {
      let group = groups.find(item => item.gameNumber === event.gameNumber);
      if (!group) {
        group = { gameNumber: event.gameNumber, events: [] };
        groups.push(group);
      }
      group.events.push(event);
    });
    return groups.filter(group => group.events.some(event => event.gameEnded));
  }

  function getHistoryGameServer(game, playersById) {
    const serverIds = [...new Set(game.events.map(event => event.serverPlayerId).filter(Boolean))];
    return serverIds.length === 1 ? playersById.get(serverIds[0]) : null;
  }

  function renderHistory(payload) {
    if (payload.corrected) {
      return '<div class="live-ticker-empty">Der ursprüngliche Liveticker-Verlauf wurde nachträglich korrigiert. Maßgeblich ist das offizielle Ergebnis.</div>';
    }
    const session = payload.session;
    const players = payload.players || [];
    const playersById = new Map(players.map(player => [player.playerId, player]));
    const games = groupGames(session?.events || []);
    if (!games.length) return '<div class="live-ticker-empty">Nach dem ersten abgeschlossenen Spiel erscheint hier der Spielverlauf.</div>';
    return `<div class="live-ticker-history">${games.map(game => {
      const last = game.events.at(-1);
      const server = getHistoryGameServer(game, playersById);
      const serverTeam = Number(server?.team);
      const breakLabel = last.break ? '<strong>BREAK</strong>' : '';
      const serverName = server ? escapeHtml(server.displayName) : '';
      const left = serverTeam === 1 ? `${breakLabel}${serverName} <span aria-hidden="true">◉</span>` : '';
      const right = serverTeam === 2 ? `<span aria-hidden="true">◉</span> ${serverName}${breakLabel}` : '';
      const points = scoringMode(session) === 'games'
        ? (last.tiebreakScore ? `Tiebreak ${escapeHtml(last.tiebreakScore)}` : '')
        : game.events
          .map(event => event.pointLabel)
          .filter(label => label && label !== 'Spiel')
          .map(escapeHtml)
          .join(' · ');
      return `<article class="live-ticker-game" data-live-game-row>
        <div class="live-ticker-game-line">
          <div class="live-ticker-game-server live-ticker-game-server-1">${left}</div>
          <div class="live-ticker-game-score">${last.teamOneGames}:${last.teamTwoGames}</div>
          <div class="live-ticker-game-server live-ticker-game-server-2">${right}</div>
        </div>
        ${points ? `<div class="live-ticker-game-points" data-live-game-points>${points}</div>` : ''}
      </article>`;
    }).join('')}</div>`;
  }

  function renderMatchSwitchStatus(match) {
    if (match.isLive) return '● Live';
    if (match.result) return escapeHtml(match.result);
    if (match.hasHistory) return 'Beendet';
    return 'Offen';
  }

  function renderSwitcher(payload) {
    const switcher = document.getElementById('live-match-switcher');
    if (!switcher) return;
    switcher.innerHTML = `<button type="button"
      class="${state.view === 'overview' ? 'active' : ''}"
      aria-label="Final-Four-Übersicht"
      data-live-overview>Übersicht</button>${(payload.matches || []).map((match, index) => `<button type="button"
      class="${state.view === 'match' && match.matchId === payload.matchId ? 'active' : ''}"
      aria-label="Partie ${index + 1}, ${renderMatchSwitchStatus(match)}"
      data-live-match-id="${escapeHtml(match.matchId)}">Partie ${index + 1}</button>`).join('')}`;
  }

  function getTeamPlayers(payload, team) {
    return (payload.players || []).filter(player => Number(player.team) === team);
  }

  function renderOverviewTeam(payload, team) {
    return getTeamPlayers(payload, team)
      .map(player => `<span>${escapeHtml(player.displayName)}</span>`)
      .join('<span class="live-overview-team-separator">&amp;</span>');
  }

  function getOverviewMatchState(payload) {
    const session = payload.session;
    const isLive = ['live', 'needs_server', 'ready_to_finish'].includes(session?.status);
    if (isLive) {
      return {
        isLive: true,
        isFinished: false,
        score: `${session.teamOneGames}:${session.teamTwoGames}`
      };
    }
    if (payload.result) return { isLive: false, isFinished: true, score: payload.result };
    return { isLive: false, isFinished: false, score: '–:–' };
  }

  function getOverviewStats(payloads) {
    const players = new Map();
    payloads.forEach(payload => {
      (payload.players || []).forEach(player => {
        if (players.has(player.playerId)) return;
        players.set(player.playerId, {
          ...player,
          seed: players.size + 1,
          matches: 0,
          wins: 0,
          gamesWon: 0,
          gamesLost: 0
        });
      });
    });
    payloads.forEach(payload => {
      const score = String(payload.result || '').match(/(\d+)\s*:\s*(\d+)/);
      if (!score || ![1, 2].includes(Number(payload.winner))) return;
      const teamGames = { 1: Number(score[1]), 2: Number(score[2]) };
      (payload.players || []).forEach(player => {
        const stat = players.get(player.playerId);
        const team = Number(player.team);
        if (!stat || ![1, 2].includes(team)) return;
        stat.matches += 1;
        stat.wins += team === Number(payload.winner) ? 1 : 0;
        stat.gamesWon += teamGames[team];
        stat.gamesLost += teamGames[team === 1 ? 2 : 1];
      });
    });
    return [...players.values()].sort((a, b) =>
      b.wins - a.wins
      || (b.gamesWon - b.gamesLost) - (a.gamesWon - a.gamesLost)
      || b.gamesWon - a.gamesWon
      || a.seed - b.seed
    );
  }

  function renderOverview() {
    const target = document.getElementById('live-ticker-content');
    const connection = document.getElementById('live-ticker-connection');
    if (!target) return;
    const payloads = state.overviewPayloads;
    if (!payloads.length) {
      target.innerHTML = '<div class="empty-state">Die Übersicht wird geladen …</div>';
      if (connection) connection.textContent = 'Wird aktualisiert …';
      return;
    }
    const stats = getOverviewStats(payloads);
    const livePayload = payloads.find(payload => ['live', 'needs_server', 'ready_to_finish'].includes(payload.session?.status));
    target.innerHTML = `<div class="live-overview">
      <section class="live-overview-section">
        <div class="live-overview-heading spieltag-label">Partien</div>
        <div class="live-overview-matches">
          ${payloads.map((payload, index) => {
            const matchState = getOverviewMatchState(payload);
            const teamOneWinner = matchState.isFinished && Number(payload.winner) === 1;
            const teamTwoWinner = matchState.isFinished && Number(payload.winner) === 2;
            return `<button class="live-overview-match${matchState.isFinished ? ' is-finished' : ''}" type="button" data-live-match-id="${escapeHtml(payload.matchId)}">
              <span class="live-overview-match-meta">
                <span>${escapeHtml(payload.displayLabel || `Partie ${index + 1}`)}</span>
                ${matchState.isLive ? '<span class="live-overview-live"><span class="live-overview-score-dot" aria-hidden="true">●</span>Live</span>' : ''}
              </span>
              <span class="live-overview-matchup">
                <span class="live-overview-team live-overview-team-1${teamOneWinner ? ' is-winner' : ''}">${renderOverviewTeam(payload, 1)}</span>
                <span class="live-overview-result"><strong>${escapeHtml(matchState.score)}</strong></span>
                <span class="live-overview-team live-overview-team-2${teamTwoWinner ? ' is-winner' : ''}">${renderOverviewTeam(payload, 2)}</span>
              </span>
            </button>`;
          }).join('')}
        </div>
      </section>
      <section class="live-overview-section">
        <div class="live-overview-heading spieltag-label">Tabelle</div>
        <div class="ranking-wrap live-overview-ranking-wrap">
          <table class="rt calculator-ranking-table final-four-calculator-ranking-table live-overview-table">
            <thead><tr>
              <th class="col-rank">#</th><th class="col-name">Spieler</th><th class="col-games">Partien</th>
              <th class="col-wins">Siege</th><th class="col-diff">Diff.</th>
            </tr></thead>
            <tbody>${stats.map((player, index) => {
              const diff = player.gamesWon - player.gamesLost;
              const diffClass = diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'neu';
              return `<tr class="r${index + 1}">
                <td class="col-rank rank-position">${index + 1}</td>
                <td class="col-name"><button class="pname player-profile-link" type="button" data-player-profile-id="${escapeHtml(player.playerId)}">${escapeHtml(player.displayName)}</button></td>
                <td class="col-games">${player.matches}</td><td class="col-wins rank-score">${player.wins}</td>
                <td class="col-diff"><span class="${diffClass}">${diff > 0 ? `+${diff}` : diff}</span></td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
        <div class="sh-meta live-overview-note">Sortierung: Siege · Spiel-Differenz · gewonnene Spiele · Ausgangsplatzierung<br>Stand nach abgeschlossenen Partien</div>
      </section>
    </div>`;
    if (connection) connection.textContent = livePayload
      ? (state.statusConnected ? 'Live verbunden' : 'Verbindung wird hergestellt …')
      : 'Übersicht';
    bindRealtime(livePayload?.session?.id || null);
  }

  function renderPublic() {
    const target = document.getElementById('live-ticker-content');
    const switcher = document.getElementById('live-match-switcher');
    const connection = document.getElementById('live-ticker-connection');
    const payload = state.payload;
    if (!target || !switcher) return;
    if (!payload) {
      target.innerHTML = '<div class="empty-state">Für diese Partie ist kein Liveticker verfügbar.</div>';
      switcher.innerHTML = '';
      if (connection) connection.textContent = 'Nicht verfügbar';
      return;
    }
    renderDialogSeasonLabel(payload);
    renderSwitcher(payload);
    if (state.view === 'overview') {
      renderOverview();
      return;
    }
    const session = payload.session;
    const isLive = ['live', 'needs_server', 'ready_to_finish'].includes(session?.status);
    const isGamesMode = scoringMode(session) === 'games';
    const currentServerId = isLive ? session.currentServerPlayerId : null;
    const statusLabel = session?.status === 'finished' ? 'Beendet'
      : session?.status === 'ready_to_finish' ? 'Ergebnis bereit'
        : isLive ? 'LIVE' : 'Offen';
    const score = session?.status === 'finished'
      ? (payload.result || `${session.teamOneGames}:${session.teamTwoGames}`)
      : session ? `${session.teamOneGames}:${session.teamTwoGames}` : (payload.result || '–:–');
    const players = payload.players || [];
    const currentServer = players.find(player => player.playerId === currentServerId);
    const scoreNote = isLive
      ? (isGamesMode && session?.isTiebreak && session?.status === 'live'
          ? 'Tiebreak läuft'
          : currentServer ? `${currentServer.displayName} schlägt auf` : 'Aufschläger wird festgelegt')
      : session?.status === 'finished' ? 'Offizielles Ergebnis' : 'Noch nicht begonnen';
    target.innerHTML = `
      <article class="live-ticker-match" data-live-scoreboard>
        <div class="live-ticker-match-meta">
          <span class="live-ticker-status${isLive ? ' is-live' : session?.status === 'finished' ? ' is-finished' : ''}">${statusLabel}${payload.corrected ? ' · Nachträglich korrigiert' : ''}</span>
        </div>
        <div class="live-ticker-matchup">
          ${renderTeam(players, 1, currentServerId)}
          <div class="live-ticker-scoreboard">
            <span class="live-ticker-score-label">Spielstand</span>
            <strong class="live-ticker-score">${escapeHtml(score)}</strong>
            ${isLive && !isGamesMode ? `<strong class="live-ticker-points" data-live-current-points>${escapeHtml(pointLabel(session))}</strong>` : ''}
            <span class="live-ticker-score-note">${escapeHtml(scoreNote)}</span>
          </div>
          ${renderTeam(players, 2, currentServerId)}
        </div>
        ${isLive ? `<div class="live-ticker-actions" data-live-public-actions>
          <span class="live-ticker-mode">${escapeHtml(scoringModeLabel(session))}</span>
          <button class="secondary-button" type="button" data-live-refresh>Ergebnis aktualisieren</button>
        </div>` : ''}
      </article>
      <section class="live-ticker-history-section">
        <div class="live-ticker-history-head spieltag-label">Spielverlauf</div>
        ${renderHistory(payload)}
      </section>`;
    if (connection) connection.textContent = isLive
      ? (state.statusConnected ? 'Live verbunden' : 'Verbindung wird hergestellt …')
      : 'Archiv';
    bindRealtime(isLive ? session.id : null);
  }

  async function load(matchId, { updateUrl = true, view = 'match' } = {}) {
    const client = getClient();
    if (!client || !matchId) return null;
    const requestId = ++state.loadRequestId;
    state.matchId = matchId;
    state.view = view === 'overview' ? 'overview' : 'match';
    state.overviewPayloads = [];
    const connection = document.getElementById('live-ticker-connection');
    if (connection) connection.textContent = 'Wird aktualisiert …';
    const { data, error } = await client.rpc('get_public_live_ticker', { p_match_id: matchId });
    if (requestId !== state.loadRequestId) return null;
    if (error) {
      if (!isMissingRpc(error)) console.error(error);
      state.payload = null;
      renderPublic();
      return null;
    }
    state.payload = data;
    renderPublic();
    if (state.view === 'overview') {
      const overviewResults = await Promise.all((data.matches || []).map(async match => {
        if (match.matchId === data.matchId) return data;
        const result = await client.rpc('get_public_live_ticker', { p_match_id: match.matchId });
        if (result.error) {
          if (!isMissingRpc(result.error)) console.error(result.error);
          return null;
        }
        return result.data;
      }));
      if (requestId !== state.loadRequestId) return null;
      state.overviewPayloads = overviewResults.filter(Boolean);
      renderPublic();
    }
    if (updateUrl) {
      const url = new URL(window.location.href);
      const replacesExistingLiveRoute = url.searchParams.has('live');
      url.searchParams.set('live', matchId);
      if (state.view === 'overview') url.searchParams.set('liveView', 'overview');
      else url.searchParams.delete('liveView');
      const updateHistory = replacesExistingLiveRoute ? 'replaceState' : 'pushState';
      window.history[updateHistory]({ liveMatchId: matchId }, '', `${url.pathname}${url.search}${url.hash}`);
    }
    return data;
  }

  function close() {
    state.loadRequestId += 1;
    state.matchId = null;
    state.view = 'match';
    state.payload = null;
    state.overviewPayloads = [];
  }

  function bindRealtime(sessionId) {
    const connection = document.getElementById('live-ticker-connection');
    if (connection && sessionId) connection.textContent = state.statusConnected
      ? 'Live verbunden'
      : 'Verbindung wird hergestellt …';
  }

  function bindStatusRealtime() {
    const client = getClient();
    if (!client || state.statusChannel) return;
    state.statusChannel = client.channel('live-match-status')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'live_match_sessions'
      }, async () => {
        await refreshStatus();
        if (state.matchId) await load(state.matchId, { updateUrl: false, view: state.view });
        if (state.auth?.session) await refreshAccount();
      })
      .subscribe(status => {
        state.statusConnected = status === 'SUBSCRIBED';
        const connection = document.getElementById('live-ticker-connection');
        if (connection && state.payload?.session && ['live', 'needs_server', 'ready_to_finish'].includes(state.payload.session.status)) {
          connection.textContent = state.statusConnected ? 'Live verbunden' : 'Verbindung wird hergestellt …';
        }
      });
  }

  async function refreshCurrent() {
    if (!state.matchId) return;
    await load(state.matchId, { updateUrl: false, view: state.view });
    await refreshStatus();
  }

  async function refreshStatus() {
    const client = getClient();
    if (!client) return;
    const { data, error } = await client.rpc('get_public_live_status');
    if (error) {
      if (!isMissingRpc(error)) console.error(error);
      return;
    }
    state.activeMatch = data?.activeMatch || null;
    state.historyMatchIds = new Set(data?.historyMatchIds || []);
    const liveButton = document.getElementById('live-ticker-link');
    if (liveButton) liveButton.hidden = !triggersGlobalLiveButton(state.activeMatch);
    window.dispatchEvent(new CustomEvent('padel:live-status-changed', {
      detail: { activeMatch: state.activeMatch, historyMatchIds: [...state.historyMatchIds] }
    }));
  }

  function matchCanBeWritten(task) {
    const profileId = state.auth?.profile?.id;
    return Boolean(task.isAdmin || (
      task.assignment?.status === 'accepted' && task.assignment?.scorerProfileId === profileId
    ));
  }

  function getAccountTask(matchId) {
    return (state.accountData.matches || []).find(task => String(task.matchId) === String(matchId));
  }

  function renderLivePicker({
    label,
    name,
    value = '',
    options,
    menuId,
    searchable = false,
    searchPlaceholder = 'Suchen …',
    searchEmptyText = 'Kein Eintrag gefunden.'
  }) {
    const selected = options.find(option => option.value === value) || options[0];
    const toggle = `<button class="secondary-button secondary-button--dropdown training-picker-toggle" type="button" data-training-picker-toggle aria-label="${escapeHtml(selected.label)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${escapeHtml(menuId)}">
        <span class="training-picker-display" data-training-picker-label><span class="training-picker-display-line">${escapeHtml(selected.label)}</span></span>
      </button>`;
    return `<div class="training-picker" data-training-picker>
      <span class="training-picker-label">${escapeHtml(label)}</span>
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(selected.value)}">
      ${searchable ? `<div class="training-picker-search-control">
        ${toggle}
        <input class="training-picker-search-input" type="search" data-training-picker-search role="combobox" aria-label="${escapeHtml(label)} suchen" aria-controls="${escapeHtml(menuId)}" aria-expanded="false" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(searchPlaceholder)}" disabled>
      </div>` : toggle}
      <div class="viewer-menu training-picker-menu" id="${escapeHtml(menuId)}" role="listbox" aria-label="${escapeHtml(label)} auswählen">
        ${options.map(option => `<button
          class="viewer-option training-picker-option${option.value === selected.value ? ' active' : ''}"
          type="button"
          role="option"
          aria-label="${escapeHtml(option.label)}"
          aria-selected="${option.value === selected.value}"
          data-training-picker-value="${escapeHtml(option.value)}"
          data-training-picker-search-text="${escapeHtml(option.label)}"
        ><span class="training-picker-option-label"><span class="training-picker-display-line">${escapeHtml(option.label)}</span></span></button>`).join('')}
        ${searchable ? `<div class="picker-search-empty" data-training-picker-search-empty hidden>${escapeHtml(searchEmptyText)}</div>` : ''}
      </div>
    </div>`;
  }

  function renderScorerPicker(task, candidates) {
    return renderLivePicker({
      label: 'Schreiberkonto',
      name: 'scorerProfileId',
      options: [
        { value: '', label: 'Konto auswählen' },
        ...candidates.map(candidate => ({
          value: candidate.profile_id,
          label: `${candidate.display_name}${candidate.profile_id === state.auth?.profile?.id ? ' (du)' : ''}`
        }))
      ],
      menuId: `live-scorer-menu-${task.matchId}`,
      searchable: true,
      searchPlaceholder: 'Konto suchen …',
      searchEmptyText: 'Kein Konto gefunden.'
    });
  }

  function renderServerPicker(task, players, { team = null, value = '' } = {}) {
    const label = team ? `Erster Aufschläger Team ${team}` : 'Erster Aufschläger';
    return renderLivePicker({
      label,
      name: 'serverPlayerId',
      value,
      options: [
        { value: '', label: 'Spieler auswählen' },
        ...players.map(player => ({ value: player.playerId, label: player.displayName }))
      ],
      menuId: `live-server-menu-${task.matchId}-${team || 'start'}`,
      searchable: false
    });
  }

  function renderStartModePicker(task) {
    const selected = state.startModes.get(task.matchId) === 'games' ? 'games' : 'points';
    return `<fieldset class="live-mode-fieldset">
      <legend>Erfassungsart</legend>
      <input type="hidden" name="scoringMode" value="${selected}">
      <div class="live-mode-toggle" aria-label="Erfassungsart auswählen">
        <button class="${selected === 'points' ? 'active' : ''}" type="button" data-live-start-mode="points" aria-pressed="${selected === 'points'}">
          <strong>Detailliert</strong><span>Jeder Punkt</span>
        </button>
        <button class="${selected === 'games' ? 'active' : ''}" type="button" data-live-start-mode="games" aria-pressed="${selected === 'games'}">
          <strong>Einfach</strong><span>Jedes Spiel</span>
        </button>
      </div>
      <small>${selected === 'games'
        ? 'Du trägst nur gewonnene Spiele und am Ende gegebenenfalls den Tiebreak ein.'
        : 'Du trägst jeden Punkt ein; Spielstand und Aufschlagfolge werden automatisch berechnet.'}</small>
    </fieldset>`;
  }

  function renderLiveTiebreakForm(task) {
    const session = task.session;
    const processing = state.processingMatches.has(task.matchId);
    const pending = state.pendingScoreActions.get(task.matchId);
    const pendingValues = pending?.kind === 'tiebreak'
      ? { 1: pending.teamOnePoints, 2: pending.teamTwoPoints }
      : { 1: '', 2: '' };
    return `<form class="result-entry-form live-tiebreak-form" data-live-tiebreak-form="${escapeHtml(task.matchId)}" data-live-version="${session.version}">
      <div class="result-proposal"><span>Tiebreak läuft</span><strong>Endstand eintragen</strong></div>
      <div class="score-counter-pair live-tiebreak-score">
        ${[1, 2].map(team => `<div class="score-counter-field">
          <button class="score-counter-step" type="button" data-live-tiebreak-step="-1" data-live-tiebreak-team="${team}" aria-label="Team ${team}: eins abziehen"${processing ? ' disabled' : ''}>−</button>
          <input type="number" name="team${team}Points" value="${pendingValues[team]}" min="0" max="99" inputmode="numeric" placeholder="0" aria-label="Tiebreak-Punkte Team ${team}"${processing ? ' disabled' : ''}>
          <button class="score-counter-step" type="button" data-live-tiebreak-step="1" data-live-tiebreak-team="${team}" aria-label="Team ${team}: eins addieren"${processing ? ' disabled' : ''}>+</button>
        </div>`).join('<span class="score-counter-separator">:</span>')}
      </div>
      <div class="result-entry-buttons">
        <button class="secondary-button" type="button" data-live-undo="${escapeHtml(task.matchId)}" data-live-version="${session.version}"${processing ? ' disabled' : ''}>Letztes Spiel zurücknehmen</button>
        <button class="primary-button" type="submit"${processing ? ' disabled' : ''}>${processing ? 'Wird gespeichert …' : 'Tiebreak übernehmen'}</button>
      </div>
      <div class="live-ticker-text-actions">
        <button class="text-link" type="button" data-live-cancel="${escapeHtml(task.matchId)}" data-live-version="${session.version}"${processing ? ' disabled' : ''}>Liveticker verwerfen</button>
        <button class="text-link" type="button" data-live-open-match="${escapeHtml(task.matchId)}">Spielverlauf öffnen</button>
      </div>
    </form>`;
  }

  function renderGameAssignment(matchId) {
    const task = getAccountTask(matchId);
    if (!task || task.result || task.session) return '';
    const assignment = task.assignment;
    const canNominate = task.isAdmin || [1, 2].includes(Number(task.myTeam));
    if (!canNominate) return '';
    const editorOpen = state.assignmentEditors.has(task.matchId);
    const candidates = state.candidates.get(task.matchId) || [];
    return `<div class="account-task-actions">
        ${assignment ? `<span class="account-waiting">${assignment.status === 'accepted' ? 'Schreiber' : 'Angefragt'}: ${escapeHtml(assignment.scorerName)}</span>
          <button class="secondary-button" type="button" data-live-revoke="${escapeHtml(task.matchId)}">Aufheben</button>` : ''}
        <button class="secondary-button" type="button" data-live-assignment-toggle="${escapeHtml(task.matchId)}">${editorOpen ? 'Vergabe schließen' : 'Liveticker vergeben'}</button>
      </div>
      ${editorOpen ? `<form class="match-schedule-form" data-live-nominate-form="${escapeHtml(task.matchId)}">
        ${renderScorerPicker(task, candidates)}
        <div class="match-schedule-actions"><button class="primary-button" type="submit">Liveticker vergeben</button></div>
      </form>` : ''}`;
  }

  function renderWriterControls(task) {
    if (!matchCanBeWritten(task) || task.result) return '';
    const session = task.session;
    if (!session) {
      if (task.assignment?.status !== 'accepted') {
        return '<div class="account-waiting">Der Schreiber muss die Zuweisung zuerst annehmen.</div>';
      }
      return `<form class="auth-form" data-live-start-form="${escapeHtml(task.matchId)}">
        ${renderStartModePicker(task)}
        ${renderServerPicker(task, task.players || [])}
        <button class="primary-button" type="submit">Liveticker starten</button>
      </form>`;
    }
    if (session.status === 'needs_server') {
      const missingTeam = session.teamOneFirstServerId ? 2 : 1;
      const teamPlayers = (task.players || []).filter(player => Number(player.team) === missingTeam);
      return `<form class="auth-form" data-live-server-form="${escapeHtml(task.matchId)}" data-live-team="${missingTeam}" data-live-version="${session.version}">
        ${renderServerPicker(task, teamPlayers, { team: missingTeam })}
        <div class="result-entry-buttons">
          <button class="primary-button" type="submit">Aufschläger übernehmen</button>
        </div>
        <div class="live-ticker-text-actions">
          <button class="text-link" type="button" data-live-cancel="${escapeHtml(task.matchId)}" data-live-version="${session.version}">Liveticker verwerfen</button>
          <button class="text-link" type="button" data-live-open-match="${escapeHtml(task.matchId)}">Spielverlauf öffnen</button>
        </div>
      </form>`;
    }
    if (session.status === 'ready_to_finish') {
      const isGamesMode = scoringMode(session) === 'games';
      return `<div class="result-entry-form">
        <div class="live-finish-summary">
          <span>${escapeHtml(scoringModeLabel(session))}</span>
          <strong>Endstand ${Number(session.teamOneGames) || 0}:${Number(session.teamTwoGames) || 0}${session.isTiebreak ? ` · Tiebreak ${Number(session.teamOneTiebreak) || 0}:${Number(session.teamTwoTiebreak) || 0}` : ''}</strong>
          <small>Mit dem Abschluss wird dieses Ergebnis sofort offiziell.</small>
        </div>
        <div class="account-task-actions">
          <button class="secondary-button" type="button" data-live-undo="${escapeHtml(task.matchId)}" data-live-version="${session.version}">${isGamesMode ? 'Letztes Spiel' : 'Letzten Punkt'} zurücknehmen</button>
          <button class="primary-button" type="button" data-live-finish="${escapeHtml(task.matchId)}" data-live-version="${session.version}">Partie abschließen</button>
        </div>
        <div class="live-ticker-text-actions">
          <button class="text-link" type="button" data-live-cancel="${escapeHtml(task.matchId)}" data-live-version="${session.version}">Liveticker verwerfen</button>
          <button class="text-link" type="button" data-live-open-match="${escapeHtml(task.matchId)}">Spielverlauf öffnen</button>
        </div>
      </div>`;
    }
    if (scoringMode(session) === 'games' && session.isTiebreak) {
      return renderLiveTiebreakForm(task);
    }
    const selected = state.selectedWinners.get(task.matchId);
    const isGamesMode = scoringMode(session) === 'games';
    const processing = state.processingMatches.has(task.matchId);
    const correctionForms = [1, 2].filter(team => team === 1 ? session.teamOneFirstServerId : session.teamTwoFirstServerId)
      .map(team => `<form class="auth-form" data-live-server-form="${escapeHtml(task.matchId)}" data-live-team="${team}" data-live-version="${session.version}">
        ${renderServerPicker(
          task,
          (task.players || []).filter(player => Number(player.team) === team),
          { team, value: team === 1 ? session.teamOneFirstServerId : session.teamTwoFirstServerId }
        )}
        <button class="secondary-button" type="submit">Korrigieren</button>
      </form>`).join('');
    return `<div class="result-entry-form">
      <div class="live-writer-mode">${escapeHtml(scoringModeLabel(session))}</div>
      <div class="live-point-team-buttons" aria-label="${isGamesMode ? 'Spielgewinner' : 'Punktgewinner'} auswählen">
        <button type="button" class="live-point-team-button${selected === 1 ? ' active' : ''}" data-live-select-winner="1" data-live-match="${escapeHtml(task.matchId)}" aria-pressed="${selected === 1}"${processing ? ' disabled' : ''}>
          <span>${isGamesMode ? 'Spiel' : 'Punkt'} für</span><strong>${escapeHtml(task.teamOneLabel)}</strong>
        </button>
        <button type="button" class="live-point-team-button${selected === 2 ? ' active' : ''}" data-live-select-winner="2" data-live-match="${escapeHtml(task.matchId)}" aria-pressed="${selected === 2}"${processing ? ' disabled' : ''}>
          <span>${isGamesMode ? 'Spiel' : 'Punkt'} für</span><strong>${escapeHtml(task.teamTwoLabel)}</strong>
        </button>
      </div>
      <div class="result-entry-buttons">
        <button class="secondary-button" type="button" data-live-undo="${escapeHtml(task.matchId)}" data-live-version="${session.version}"${processing ? ' disabled' : ''}>${isGamesMode ? 'Letztes Spiel' : 'Letzten Punkt'} zurücknehmen</button>
        <button class="primary-button" type="button" data-live-submit-score="${escapeHtml(task.matchId)}" data-live-version="${session.version}" ${selected && !processing ? '' : 'disabled'}>${processing ? 'Wird gespeichert …' : `${isGamesMode ? 'Spiel' : 'Punkt'} eintragen`}</button>
      </div>
      <div class="live-ticker-text-actions">
        <button class="text-link" type="button" data-live-cancel="${escapeHtml(task.matchId)}" data-live-version="${session.version}">Liveticker verwerfen</button>
        <button class="text-link" type="button" data-live-correction-toggle="${escapeHtml(task.matchId)}" aria-expanded="false">Aufschläger korrigieren</button>
        <button class="text-link" type="button" data-live-open-match="${escapeHtml(task.matchId)}">Spielverlauf öffnen</button>
      </div>
      <div class="live-server-correction-forms" data-live-correction-forms="${escapeHtml(task.matchId)}" hidden>${correctionForms}</div>
    </div>`;
  }

  function renderAccountTeamLabel(task, team) {
    const players = (task.players || []).filter(player => Number(player.team) === team);
    if (!players.length) {
      return escapeHtml(team === 1 ? task.teamOneLabel : task.teamTwoLabel);
    }
    const currentServerId = task.session?.currentServerPlayerId;
    return players.map(player => {
      const serving = currentServerId && String(player.playerId) === String(currentServerId);
      return `<span class="account-live-player">${escapeHtml(player.displayName)}${serving
        ? '<span class="account-live-server" role="img" aria-label="hat Aufschlag" title="Aufschlag">◉</span>'
        : ''}</span>`;
    }).join('<span class="mc-player-sep">&amp;</span>');
  }

  function renderAccount() {
    const section = document.getElementById('live-account-section');
    const target = document.getElementById('live-account-list');
    if (!section || !target) return;
    const requests = state.accountData.requests || [];
    const profileId = state.auth?.profile?.id;
    const matches = (state.accountData.matches || []).filter(task => task.session || (
      task.assignment && (
        task.isAdmin
        || (task.assignment.status === 'accepted' && task.assignment.scorerProfileId === profileId)
      )
    ));
    section.hidden = !state.auth?.session || (!requests.length && !matches.length);
    if (section.hidden) return;
    const requestHtml = requests.map(request => `<article class="account-task-card is-actionable">
      <div class="account-task-meta"><span class="widget-label">Schreiberanfrage</span><span class="account-task-status is-open">Offen</span></div>
      <strong>${escapeHtml(request.seasonLabel)} · ${escapeHtml(request.displayLabel)}</strong>
      <div class="result-card-timing">${escapeHtml(formatDateTime(request.matchAt))}</div>
      <div class="account-task-actions">
        <button class="secondary-button" type="button" data-live-assignment="${request.assignmentId}" data-live-accept="false">Ablehnen</button>
        <button class="primary-button" type="button" data-live-assignment="${request.assignmentId}" data-live-accept="true">Annehmen</button>
      </div>
    </article>`).join('');
    const matchHtml = matches.map(task => `<article class="account-task-card${task.session ? ' is-actionable' : ''}">
      <div class="account-task-meta">
        <span class="widget-label">${escapeHtml(task.seasonLabel)} · ${escapeHtml(task.displayLabel)}</span>
        <span class="account-task-status ${task.session ? 'is-open' : ''}">${task.session ? 'Live' : task.assignment?.status === 'accepted' ? 'Bereit' : 'Zuweisung offen'}</span>
      </div>
      <div class="result-card-timing">${escapeHtml(formatDateTime(task.matchAt))}</div>
      <div class="account-task-matchup">
        <strong>${renderAccountTeamLabel(task, 1)}</strong>
        ${task.session ? `<div class="account-task-live-score" aria-label="Aktueller Stand ${Number(task.session.teamOneGames) || 0} zu ${Number(task.session.teamTwoGames) || 0}${scoringMode(task.session) === 'points' ? `, Punkte ${escapeHtml(pointLabel(task.session))}` : ''}">
          <span class="mc-score-main">${Number(task.session.teamOneGames) || 0}:${Number(task.session.teamTwoGames) || 0}</span>
          <span class="mc-score-detail">${scoringMode(task.session) === 'points'
            ? escapeHtml(pointLabel(task.session))
            : '–'}</span>
        </div>` : '<span>vs.</span>'}
        <strong>${renderAccountTeamLabel(task, 2)}</strong>
      </div>
      ${task.assignment && task.assignment.scorerProfileId !== profileId
        ? `<div class="account-waiting">Schreiber: ${escapeHtml(task.assignment.scorerName)}</div>`
        : ''}
      ${renderWriterControls(task)}
      ${task.result ? `<button class="text-link" type="button" data-live-open-match="${escapeHtml(task.matchId)}">Spielverlauf öffnen</button>` : ''}
    </article>`).join('');
    target.innerHTML = `${state.accountMessage ? `<div class="auth-message">${escapeHtml(state.accountMessage)}</div>` : ''}${requestHtml}${matchHtml}`;
  }

  async function refreshAccount() {
    const client = getClient();
    if (!client || !state.auth?.session) {
      state.accountData = { matches: [], requests: [] };
      renderAccount();
      return;
    }
    const { data, error } = await client.rpc('get_my_live_ticker_tasks');
    if (error) {
      if (!isMissingRpc(error)) console.error(error);
      state.accountData = { matches: [], requests: [] };
    } else {
      state.accountData = data || { matches: [], requests: [] };
    }
    renderAccount();
    window.dispatchEvent(new CustomEvent('padel:live-account-updated'));
  }

  async function runRpc(name, args, successMessage = '') {
    const client = getClient();
    if (!client) return null;
    state.accountMessage = '';
    const { data, error } = await client.rpc(name, args);
    if (error) {
      state.accountMessage = error.message || 'Die Aktion konnte nicht ausgeführt werden.';
      renderAccount();
      return null;
    }
    state.accountMessage = successMessage;
    await Promise.all([refreshAccount(), refreshStatus()]);
    if (state.matchId) await refreshCurrent();
    return data ?? true;
  }

  function openCancelDialog(cancelButton) {
    const dialog = document.getElementById('live-cancel-dialog');
    if (!dialog) return;
    dialog.dataset.matchId = cancelButton.dataset.liveCancel;
    dialog.dataset.version = cancelButton.dataset.liveVersion;
    if (!dialog.open) dialog.showModal();
  }

  function closeCancelDialog() {
    document.getElementById('live-cancel-dialog')?.close();
  }

  function bindEvents() {
    document.addEventListener('error', event => {
      const image = event.target.closest?.('[data-live-player-image]');
      if (!image) return;
      image.hidden = true;
      image.nextElementSibling?.removeAttribute('hidden');
    }, true);
    document.addEventListener('click', async event => {
      if (event.target.closest('[data-live-cancel-close]')) {
        closeCancelDialog();
        return;
      }
      const cancelConfirm = event.target.closest('[data-live-cancel-confirm]');
      if (cancelConfirm) {
        const dialog = document.getElementById('live-cancel-dialog');
        const matchId = dialog?.dataset.matchId;
        const version = Number(dialog?.dataset.version);
        closeCancelDialog();
        if (!matchId || !Number.isFinite(version)) return;
        await runRpc('cancel_live_match', {
          p_match_id: matchId, p_expected_version: version
        }, 'Der Liveticker wurde verworfen. Die Partie kann normal eingetragen oder neu gestartet werden.');
        return;
      }
      const active = event.target.closest('[data-live-open-active]');
      if (active && triggersGlobalLiveButton(state.activeMatch)) {
        window.PadelLigaOpenLiveTicker?.(state.activeMatch.matchId, {
          seasonId: state.activeMatch.seasonId
        });
        return;
      }
      if (event.target.closest('[data-live-overview]') && state.matchId) {
        await load(state.matchId, { view: 'overview' });
        return;
      }
      const matchButton = event.target.closest('[data-live-match-id], [data-live-open-match]');
      if (matchButton) {
        const options = {};
        if (matchButton.dataset.liveSeasonId) options.seasonId = matchButton.dataset.liveSeasonId;
        if (matchButton.dataset.liveView) options.view = matchButton.dataset.liveView;
        window.PadelLigaOpenLiveTicker?.(
          matchButton.dataset.liveMatchId || matchButton.dataset.liveOpenMatch,
          Object.keys(options).length ? options : undefined
        );
        return;
      }
      if (event.target.closest('[data-live-refresh]')) {
        await refreshCurrent();
        return;
      }
      const assignmentToggle = event.target.closest('[data-live-assignment-toggle]');
      if (assignmentToggle) {
        const matchId = assignmentToggle.dataset.liveAssignmentToggle;
        if (state.assignmentEditors.has(matchId)) {
          state.assignmentEditors.delete(matchId);
          window.dispatchEvent(new CustomEvent('padel:live-account-updated'));
          return;
        }
        const { data, error } = await getClient().rpc('get_live_scorer_candidates', { p_match_id: matchId });
        if (error) {
          window.PadelKonto?.setMessage(error.message || 'Die Konten konnten nicht geladen werden.', 'error');
          return;
        }
        state.candidates.set(matchId, data || []);
        state.assignmentEditors.add(matchId);
        window.dispatchEvent(new CustomEvent('padel:live-account-updated'));
        return;
      }
      const revoke = event.target.closest('[data-live-revoke]');
      if (revoke) {
        const result = await runRpc('revoke_live_scorer', { p_match_id: revoke.dataset.liveRevoke }, 'Die Schreiberzuweisung wurde aufgehoben.');
        if (result) window.PadelKonto?.setMessage('Die Liveticker-Zuweisung wurde aufgehoben.', 'success');
        return;
      }
      const assignment = event.target.closest('[data-live-assignment]');
      if (assignment) {
        await runRpc('respond_live_scorer_assignment', {
          p_assignment_id: Number(assignment.dataset.liveAssignment),
          p_accept: assignment.dataset.liveAccept === 'true'
        }, assignment.dataset.liveAccept === 'true' ? 'Du bist als Schreiber bestätigt.' : 'Die Anfrage wurde abgelehnt.');
        return;
      }
      const correctionToggle = event.target.closest('[data-live-correction-toggle]');
      if (correctionToggle) {
        const forms = correctionToggle.closest('.account-task-card')?.querySelector('[data-live-correction-forms]');
        if (!forms) return;
        const willOpen = forms.hidden;
        forms.hidden = !willOpen;
        correctionToggle.setAttribute('aria-expanded', String(willOpen));
        return;
      }
      const startMode = event.target.closest('[data-live-start-mode]');
      if (startMode) {
        const form = startMode.closest('[data-live-start-form]');
        const matchId = form?.dataset.liveStartForm;
        const mode = startMode.dataset.liveStartMode === 'games' ? 'games' : 'points';
        if (!form || !matchId) return;
        state.startModes.set(matchId, mode);
        form.querySelector('input[name="scoringMode"]').value = mode;
        form.querySelectorAll('[data-live-start-mode]').forEach(button => {
          const active = button.dataset.liveStartMode === mode;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', String(active));
        });
        const note = form.querySelector('.live-mode-fieldset small');
        if (note) note.textContent = mode === 'games'
          ? 'Du trägst nur gewonnene Spiele und am Ende gegebenenfalls den Tiebreak ein.'
          : 'Du trägst jeden Punkt ein; Spielstand und Aufschlagfolge werden automatisch berechnet.';
        return;
      }
      const tiebreakStep = event.target.closest('[data-live-tiebreak-step]');
      if (tiebreakStep) {
        const form = tiebreakStep.closest('[data-live-tiebreak-form]');
        const team = Number(tiebreakStep.dataset.liveTiebreakTeam);
        const input = form?.querySelector(`[name="team${team}Points"]`);
        if (!input) return;
        const nextValue = window.PadelScoreInput?.stepScoreValue(input.value, Number(tiebreakStep.dataset.liveTiebreakStep));
        if (nextValue !== null && nextValue !== undefined) input.value = nextValue;
        const otherTeam = team === 1 ? 2 : 1;
        const otherInput = form.querySelector(`[name="team${otherTeam}Points"]`);
        if (input.value && otherInput && !otherInput.value) otherInput.value = '0';
        return;
      }
      const winner = event.target.closest('[data-live-select-winner]');
      if (winner) {
        const matchId = winner.dataset.liveMatch;
        const team = Number(winner.dataset.liveSelectWinner);
        const task = getAccountTask(matchId);
        const kind = scoringMode(task?.session) === 'games' ? 'game' : 'point';
        const pending = state.pendingScoreActions.get(matchId);
        if (pending && pending.team !== team) {
          state.accountMessage = kind === 'game'
            ? 'Das vorherige Spiel ist noch nicht eindeutig bestätigt. Bitte dieselbe Eingabe erneut senden.'
            : 'Der vorherige Punkt ist noch nicht eindeutig bestätigt. Bitte dieselbe Eingabe erneut senden.';
          renderAccount();
          return;
        }
        state.selectedWinners.set(matchId, team);
        renderAccount();
        return;
      }
      const submitScore = event.target.closest('[data-live-submit-score]');
      if (submitScore) {
        const matchId = submitScore.dataset.liveSubmitScore;
        const task = getAccountTask(matchId);
        const kind = scoringMode(task?.session) === 'games' ? 'game' : 'point';
        const winningTeam = state.selectedWinners.get(matchId);
        if (!winningTeam) return;
        const pending = state.pendingScoreActions.get(matchId);
        const actionId = pending?.id || createActionId();
        state.pendingScoreActions.set(matchId, { id: actionId, kind, team: winningTeam });
        state.processingMatches.add(matchId);
        renderAccount();
        const result = await runRpc(kind === 'game' ? 'record_live_game' : 'record_live_point', {
          p_match_id: matchId, p_winning_team: winningTeam,
          p_expected_version: Number(submitScore.dataset.liveVersion), p_client_action_id: actionId
        });
        state.processingMatches.delete(matchId);
        if (result) {
          state.selectedWinners.delete(matchId);
          state.pendingScoreActions.delete(matchId);
        }
        renderAccount();
        return;
      }
      const undo = event.target.closest('[data-live-undo]');
      if (undo) {
        const task = getAccountTask(undo.dataset.liveUndo);
        const isGamesMode = scoringMode(task?.session) === 'games';
        const result = await runRpc(isGamesMode ? 'undo_live_game' : 'undo_live_point', {
          p_match_id: undo.dataset.liveUndo, p_expected_version: Number(undo.dataset.liveVersion)
        }, isGamesMode ? 'Das letzte Spiel wurde zurückgenommen.' : 'Der letzte Punkt wurde zurückgenommen.');
        if (result) {
          state.pendingScoreActions.delete(undo.dataset.liveUndo);
          state.selectedWinners.delete(undo.dataset.liveUndo);
        }
        return;
      }
      const finish = event.target.closest('[data-live-finish]');
      if (finish) {
        const result = await runRpc('finish_live_match', {
          p_match_id: finish.dataset.liveFinish, p_expected_version: Number(finish.dataset.liveVersion)
        }, 'Die Partie wurde offiziell abgeschlossen.');
        if (result) {
          await window.PadelKonto?.refresh?.();
          window.dispatchEvent(new CustomEvent('padel:official-result-changed', { detail: { matchId: finish.dataset.liveFinish } }));
        }
        return;
      }
      const cancel = event.target.closest('[data-live-cancel]');
      if (cancel) {
        openCancelDialog(cancel);
      }
    });
    document.getElementById('live-cancel-dialog')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) closeCancelDialog();
    });
    document.getElementById('live-cancel-dialog')?.addEventListener('close', event => {
      delete event.currentTarget.dataset.matchId;
      delete event.currentTarget.dataset.version;
    });
    document.addEventListener('submit', async event => {
      const tiebreak = event.target.closest('[data-live-tiebreak-form]');
      if (tiebreak) {
        event.preventDefault();
        const matchId = tiebreak.dataset.liveTiebreakForm;
        const formData = new FormData(tiebreak);
        const teamOnePoints = Number(formData.get('team1Points'));
        const teamTwoPoints = Number(formData.get('team2Points'));
        const score = window.PadelScoreInput?.classifyTiebreak(
          formData.get('team1Points'), formData.get('team2Points'), 7
        );
        if (score?.state !== 'complete') {
          window.PadelKonto?.setMessage(score?.message || 'Bitte einen vollständigen Tiebreak-Endstand mit zwei Punkten Abstand eingeben.', 'error');
          return;
        }
        const pending = state.pendingScoreActions.get(matchId);
        if (pending && (pending.teamOnePoints !== teamOnePoints || pending.teamTwoPoints !== teamTwoPoints)) {
          window.PadelKonto?.setMessage('Der vorherige Tiebreak-Endstand ist noch nicht eindeutig bestätigt. Bitte dieselben Werte erneut senden.', 'error');
          return;
        }
        const actionId = pending?.id || createActionId();
        state.pendingScoreActions.set(matchId, { id: actionId, kind: 'tiebreak', teamOnePoints, teamTwoPoints });
        state.processingMatches.add(matchId);
        renderAccount();
        const result = await runRpc('record_live_tiebreak_result', {
          p_match_id: matchId,
          p_team_one_points: teamOnePoints,
          p_team_two_points: teamTwoPoints,
          p_expected_version: Number(tiebreak.dataset.liveVersion),
          p_client_action_id: actionId
        });
        state.processingMatches.delete(matchId);
        if (result) state.pendingScoreActions.delete(matchId);
        renderAccount();
        return;
      }
      const nominate = event.target.closest('[data-live-nominate-form]');
      if (nominate) {
        event.preventDefault();
        const matchId = nominate.dataset.liveNominateForm;
        const profileId = new FormData(nominate).get('scorerProfileId');
        if (!profileId) {
          window.PadelKonto?.setMessage('Bitte wähle zuerst ein Schreiberkonto aus.', 'error');
          return;
        }
        const assignmentId = await runRpc('nominate_live_scorer', {
          p_match_id: matchId, p_scorer_profile_id: profileId
        });
        if (!assignmentId) return;
        state.candidates.delete(matchId);
        state.assignmentEditors.delete(matchId);
        if (profileId === state.auth?.profile?.id) {
          const accepted = await runRpc('respond_live_scorer_assignment', {
            p_assignment_id: Number(assignmentId), p_accept: true
          }, 'Der Liveticker wurde dir zugeteilt.');
          if (accepted) window.PadelKonto?.setMessage('Der Liveticker wurde dir zugeteilt.', 'success');
        } else {
          state.accountMessage = 'Die Schreiberanfrage wurde gesendet.';
          window.PadelKonto?.setMessage('Die Schreiberanfrage wurde gesendet.', 'success');
          window.dispatchEvent(new CustomEvent('padel:live-account-updated'));
        }
        return;
      }
      const start = event.target.closest('[data-live-start-form]');
      if (start) {
        event.preventDefault();
        const matchId = start.dataset.liveStartForm;
        const formData = new FormData(start);
        const playerId = formData.get('serverPlayerId');
        const mode = formData.get('scoringMode') === 'games' ? 'games' : 'points';
        if (!playerId) {
          window.PadelKonto?.setMessage('Bitte wähle zuerst den ersten Aufschläger aus.', 'error');
          return;
        }
        window.PadelKonto?.setMessage('');
        await runRpc('start_live_match_with_mode', {
          p_match_id: matchId, p_first_server_player_id: playerId, p_scoring_mode: mode
        }, 'Der Liveticker ist gestartet.');
        return;
      }
      const server = event.target.closest('[data-live-server-form]');
      if (server) {
        event.preventDefault();
        const playerId = new FormData(server).get('serverPlayerId');
        if (!playerId) {
          window.PadelKonto?.setMessage('Bitte wähle zuerst den ersten Aufschläger aus.', 'error');
          return;
        }
        window.PadelKonto?.setMessage('');
        await runRpc('set_live_team_first_server', {
          p_match_id: server.dataset.liveServerForm,
          p_team: Number(server.dataset.liveTeam),
          p_player_id: playerId,
          p_expected_version: Number(server.dataset.liveVersion)
        }, 'Der Aufschläger wurde übernommen.');
      }
    });
    window.addEventListener('padel:auth-state-changed', event => {
      state.auth = event.detail || null;
      void refreshAccount();
    });
    window.addEventListener('popstate', () => {
      const url = new URL(window.location.href);
      const matchId = url.searchParams.get('live');
      const view = url.searchParams.get('liveView') === 'overview' ? 'overview' : 'match';
      if (matchId) window.PadelLigaOpenLiveTicker?.(matchId, { updateUrl: false, view });
      else window.PadelLigaCloseLiveTicker?.({ fromHistory: true });
    });
  }

  async function init() {
    if (state.initialized) return;
    state.initialized = true;
    bindEvents();
    bindStatusRealtime();
    await refreshStatus();
  }

  window.PadelLiveTicker = {
    init,
    load,
    close,
    refreshStatus,
    refreshAccount,
    renderGameAssignment,
    hasHistory: matchId => state.historyMatchIds.has(matchId),
    isMatchLive: matchId => String(state.activeMatch?.matchId || '') === String(matchId || ''),
    get pendingTaskCount() { return (state.accountData.requests || []).length; },
    get activeMatch() { return state.activeMatch; }
  };
})();
