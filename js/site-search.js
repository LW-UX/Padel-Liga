(function () {
  'use strict';

  const core = window.PadelSearchCore;
  const routing = window.PadelSeasonRouting;
  const isSearchShortcut = event => !event.isComposing && !event.altKey && !event.shiftKey
    && event.key.toLowerCase() === 'k' && event.metaKey !== event.ctrlKey;
  if (document.documentElement.classList.contains('is-detail-embed')) {
    window.addEventListener('keydown', event => {
      if (!isSearchShortcut(event) || window.parent === window) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) window.parent.postMessage({ type: 'padel:toggle-search' }, location.origin);
    }, true);
    return;
  }
  const button = document.querySelector('[data-site-search-open]');
  if (!button) return;

  const isTip = document.body.classList.contains('tip-page');
  const isApple = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgentData?.platform || navigator.platform);
  button.querySelector('kbd').textContent = isApple ? '⌘ K' : 'Strg K';
  button.setAttribute('aria-keyshortcuts', isApple ? 'Meta+K' : 'Control+K');
  const mobile = matchMedia('(max-width: 768px)');
  const stackedFilters = matchMedia('(max-width: 768px), (hover: none), (any-pointer: coarse)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const actions = button.parentElement;
  const pongLink = document.getElementById('external-game-link');
  const placeButton = () => mobile.matches ? actions.prepend(button) : pongLink.after(button);
  placeButton();
  mobile.addEventListener?.('change', placeButton);

  const dialog = document.createElement('dialog');
  dialog.id = 'site-search-dialog';
  dialog.className = 'dialog dialog--page site-search-dialog';
  dialog.setAttribute('aria-label', 'Website durchsuchen');
  dialog.innerHTML = `
    <div class="dialog-card site-search-card">
      <div class="dialog-copy site-search-content">
        <div class="site-search-field">
          <div class="auth-form site-search-input">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
            <input type="search" aria-label="Suchbegriff" placeholder="Website durchsuchen" autocomplete="off" enterkeyhint="search" autofocus>
          </div>
          <button type="button" class="secondary-button secondary-button--icon site-search-close" aria-label="Suche schließen">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
          <div class="site-search-filter-tray" inert>
            <div class="site-search-filters" role="group" aria-label="Treffer filtern">
              <button type="button" class="secondary-button" data-search-filter="all" aria-pressed="true">Alles</button>
              <button type="button" class="secondary-button" data-search-filter="matches" aria-pressed="false">Partien</button>
              <button type="button" class="secondary-button" data-search-filter="players" aria-pressed="false">Spieler</button>
              <button type="button" class="secondary-button" data-search-filter="articles" aria-pressed="false">Artikel</button>
            </div>
          </div>
        </div>
        <div class="site-search-output" data-expanded="false" inert>
          <div class="site-search-output-clip">
            <div class="site-search-output-content">
              <p class="hint site-search-status" role="status"></p>
              <button type="button" class="text-link site-search-retry" hidden>Erneut laden</button>
              <div class="site-search-results"></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  document.body.append(dialog);

  const input = dialog.querySelector('input');
  const searchField = dialog.querySelector('.site-search-field');
  const filterTray = dialog.querySelector('.site-search-filter-tray');
  const filterChips = dialog.querySelector('.site-search-filters');
  const output = dialog.querySelector('.site-search-output');
  const status = dialog.querySelector('[role="status"]');
  const results = dialog.querySelector('.site-search-results');
  const retry = dialog.querySelector('.site-search-retry');
  const cache = { matches: new Map(), articles: new Map(), trainings: new Map() };
  const trainingSources = [{ id: 'scheduled' }, { id: 'confirmed' }];
  const delay = 230;
  const maxAge = 60_000;
  const pageSize = 16;
  let filter = 'all';
  let query = { kind: 'idle' };
  let timer = null;
  let closeTimer = null;
  let returnFocus = null;
  let isComposing = false;
  let filtersRevealed = false;
  let limits = new Map();

  function hasSearchAccess() {
    const user = window.PadelKonto?.getSession()?.user;
    const profile = window.PadelKonto?.getProfile();
    return Boolean(user?.id && user.email_confirmed_at && profile?.id === user.id && profile.app_role === 'admin');
  }

  function syncSearchAccess() {
    const allowed = hasSearchAccess();
    button.removeAttribute('data-search-loading');
    button.hidden = !allowed;
    button.disabled = !allowed;
    button.setAttribute('aria-hidden', String(!allowed));
    if (allowed) return;
    cache.trainings.clear();
    clearTimeout(timer);
    timer = null;
    if (dialog.open) {
      returnFocus = document.getElementById('auth-button');
      dialog.close();
    }
    input.value = '';
    results.replaceChildren();
    retry.hidden = true;
    status.textContent = '';
    setOutputVisible(false);
    isComposing = false;
  }

  function seasons() {
    return (window.PADEL_SEASONS || []).filter(season => !season.hidden && !/(?:^|-)test(?:-|$)/i.test(season.id));
  }

  function currentSeason() {
    return seasons().find(season => season.id === routing.getRequestedSeasonId())
      || seasons().find(season => season.default) || seasons()[0];
  }

  function getClient() {
    const config = window.PADEL_SUPABASE_CONFIG;
    if (window.PADEL_SUPABASE_CLIENT) return window.PADEL_SUPABASE_CLIENT;
    if (!config || !window.supabase) throw new Error('Saisonabfrage nicht verfügbar.');
    window.PADEL_SUPABASE_CLIENT = window.supabase.createClient(config.url, config.publishableKey);
    return window.PADEL_SUPABASE_CLIENT;
  }

  async function loadMatches(season) {
    const { data, error } = await getClient().rpc('get_public_season', { p_season_id: season.databaseId || season.id });
    if (error || !Array.isArray(data?.matches) || !Array.isArray(data?.participants)) {
      throw error || new Error('Saisondaten fehlen.');
    }
    return data;
  }

  async function loadTrainings(source) {
    const client = getClient();
    const request = source.id === 'scheduled'
      ? client.rpc('get_my_training_tasks').select('session_id,played_on,display_time,status,player_ids,guest_names').eq('status', 'scheduled')
      : client.rpc('get_training_sessions').select('session_id,played_on,display_time,players');
    const { data, error } = await request;
    if (error || !Array.isArray(data)) throw error || new Error('Trainingsdaten fehlen.');
    const playersById = new Map((window.PADEL_PLAYERS || []).map(player => [player.id, player]));
    return data.map(row => core.normalizeTraining(row, source.id, playersById)).filter(Boolean);
  }

  function loadArticles(season) {
    if (!season.file) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const cleanup = () => script.remove();
      script.padelSearchReceive = editorial => {
        cleanup();
        resolve(editorial.articles || []);
      };
      script.onerror = () => {
        cleanup();
        reject(new Error('Artikel konnten nicht geladen werden.'));
      };
      script.onload = () => {
        cleanup();
        reject(new Error('Artikeldatei konnte nicht gelesen werden.'));
      };
      script.src = isTip ? `../${season.file}` : season.file;
      document.head.append(script);
    });
  }

  function remember(kind, id, data) {
    if (kind !== 'trainings' && !seasons().some(season => season.id === id)) return;
    cache[kind].set(id, { data, time: Date.now() });
    if (dialog.open && timer === null) render();
  }

  function load(kind, source, retryErrors) {
    const entry = cache[kind].get(source.id);
    if (entry?.loading || (entry?.error && !retryErrors)
      || (entry?.data && !entry.error && (kind === 'articles' || Date.now() - entry.time < maxAge))) return;
    const pending = { ...entry, loading: true, error: false };
    cache[kind].set(source.id, pending);
    const fetchData = { matches: loadMatches, articles: loadArticles, trainings: loadTrainings }[kind];
    fetchData(source).then(data => {
      if (cache[kind].get(source.id) === pending) remember(kind, source.id, data);
    }).catch(() => {
      if (cache[kind].get(source.id) !== pending) return;
      cache[kind].set(source.id, { ...entry, error: true });
      if (dialog.open && timer === null) render();
    });
  }

  function relevantKinds() {
    if (query.kind === 'artikel') return filter === 'all' || filter === 'articles' ? ['articles'] : [];
    const showsMatches = filter === 'all' || filter === 'matches';
    if (query.kind === 'date') return showsMatches ? ['matches', 'trainings'] : [];
    if (['partie', 'final-four'].includes(query.kind)) return showsMatches ? ['matches'] : [];
    if (query.kind !== 'text') return [];
    if (filter === 'articles') return ['articles'];
    if (filter === 'all') return ['matches', 'trainings', 'articles'];
    return showsMatches ? ['matches', 'trainings'] : ['matches'];
  }

  function loadResults(retryErrors = false) {
    if (!hasSearchAccess()) return;
    const active = currentSeason();
    const ordered = [...seasons()].sort((a, b) => Number(b.id === active?.id) - Number(a.id === active?.id));
    relevantKinds().forEach(kind => (kind === 'trainings' ? trainingSources : ordered)
      .forEach(source => load(kind, source, retryErrors)));
    render();
  }

  function titleLink(title, url, description = '') {
    return { title, url, description };
  }

  function pickerLink() {
    return { title: 'Spieler suchen', openPlayers: true };
  }

  function pageLinks(active, players) {
    if (!active) return [];
    const tipUrl = routing.getSeasonUrl(active.id, 'tipp');
    tipUrl.hash = 'tipptabelle';
    const leagueUrl = section => routing.getSectionUrl(active.id, section);
    const bookingUrl = leagueUrl('infos');
    bookingUrl.hash = 'platzbuchung';
    const isCup = active.visualTheme === 'cup';
    const items = [
      titleLink(isCup ? 'Turnierbaum' : 'Startseite', leagueUrl(isCup ? 'partien' : 'start')),
      titleLink('Partien', leagueUrl('partien')),
      titleLink('Infos', leagueUrl('infos')),
      { ...titleLink('Platzbuchung', bookingUrl, 'Infos'), aliases: ['buchen', 'platz buchen'] },
      titleLink('Tippübersicht', tipUrl, 'PadelTipp')
    ];
    if (!isCup) {
      items.push(titleLink('Rangliste', leagueUrl('rangliste')), titleLink('Statistik', leagueUrl('verlauf')));
      if (!(active.completedAt || cache.matches.get(active.id)?.data?.completedAt)) {
        items.push(titleLink('Rechner', leagueUrl('rechner')));
      }
    }
    const selectedId = window.PadelLigaGetSelectedViewerId?.();
    const selected = players.find(player => player.id === selectedId);
    items.push(selected
      ? titleLink('Profil', routing.getPlayerProfileUrl(active.id, selected.id), selected.name)
      : { ...pickerLink(), title: 'Profil' });
    return items;
  }

  function matchLabel(match) {
    const finalFour = match.stage === 'final-four';
    const number = core.matchNumber(match, finalFour);
    return match.displayLabel || [finalFour ? 'Final Four' : 'Partie', number || ''].join(' ').trim();
  }

  const dateLabel = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short'
  });

  function matchLink({ match, season, data }, playerById) {
    const team = item => item?.playerIds?.length
      ? item.playerIds.map(id => playerById.get(id)?.name).filter(Boolean).join(' & ')
      : item?.qualifierLabels?.filter(Boolean).join(' & ');
    const pairing = [team(match.team1), team(match.team2)].filter(Boolean).join(` ${match.sets || 'gegen'} `);
    const listUrl = routing.getSectionUrl(season.id, 'partien');
    listUrl.hash = `suchpartie-${match.id}`;
    const hasLive = match.stage === 'final-four' && (window.PadelLiveTicker?.hasHistory?.(match.id)
      || window.PadelLiveTicker?.activeMatch?.matchId === match.id);
    const availability = window.PadelPreviewWindow.availability(match, data);
    const url = hasLive ? routing.getLiveUrl(season.id, match)
      : ['analysis', 'preview'].includes(availability) ? routing.getMatchUrl(season.id, match) : listUrl;
    return {
      ...titleLink(matchLabel(match), url, pairing),
      seasonLabel: season.label,
      dateLabel: match.matchAt && dateLabel.format(new Date(match.matchAt))
    };
  }

  function getMatches(availableSeasons) {
    return availableSeasons.flatMap(season => {
      const payload = cache.matches.get(season.id)?.data;
      if (!payload) return [];
      const matches = payload.matches.filter(match => match.type === 'season').map(match => ({
        ...match, spieltag: match.matchday, sieger: match.winner
      }));
      const data = { ...payload, matches };
      return matches.map(match => ({ season, match, data }));
    });
  }

  function getArticleLinks(availableSeasons) {
    return availableSeasons.flatMap(season => (cache.articles.get(season.id)?.data || [])
      .filter(article => core.articleMatches(article, query, { includeText: filter === 'articles' }))
      .map(article => {
        const url = routing.getSectionUrl(season.id, 'infos');
        url.searchParams.set('artikelLesen', '1');
        url.hash = `artikel-${article.spieltag}`;
        return titleLink(article.title, url, season.label);
      }));
  }

  const trainingDateLabel = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', dateStyle: 'medium' });

  function getTrainingResults() {
    const timestamp = training => `${training.date}T${training.time}`;
    const byId = new Map(trainingSources.flatMap(source => (cache.trainings.get(source.id)?.data || [])
      .map(training => [training.id, training])));
    return [...byId.values()]
      .filter(training => core.trainingMatches(training, query))
      .sort((a, b) => query.kind === 'date' ? timestamp(a).localeCompare(timestamp(b))
        : Number(a.confirmed) - Number(b.confirmed) || (a.confirmed
          ? timestamp(b).localeCompare(timestamp(a)) : timestamp(a).localeCompare(timestamp(b))))
      .map(training => ({
        title: 'Training',
        seasonLabel: training.confirmed ? 'Bestätigt' : 'Terminiert',
        description: training.participants.map(player => player.name).join(' · '),
        dateLabel: [trainingDateLabel.format(new Date(`${training.date}T00:00:00Z`)), training.time].filter(Boolean).join(', ')
      }));
  }

  function getGroups() {
    const active = currentSeason();
    const availableSeasons = [...seasons()].sort((a, b) => Number(b.id === active?.id) - Number(a.id === active?.id));
    const allowed = new Set(availableSeasons.flatMap(season =>
      (cache.matches.get(season.id)?.data?.participants || []).map(player => player.playerId)));
    const players = (window.PADEL_PLAYERS || []).filter(player => allowed.has(player.id) && player.firma !== 'Test');
    const byId = new Map(players.map(player => [player.id, player]));
    const names = query.kind === 'text' ? core.resolveNames(players, query.query) : [];
    const official = getMatches(availableSeasons);
    const matchTime = entry => entry.match.matchAt ? Date.parse(entry.match.matchAt) : Infinity;
    const matches = official.filter(({ match }) => core.matchesQuery(match, query, names)).sort((a, b) => {
      if (query.kind === 'date') return matchTime(a) - matchTime(b);
      const bySeason = availableSeasons.indexOf(a.season) - availableSeasons.indexOf(b.season);
      if (bySeason) return bySeason;
      return (matchTime(a) === Infinity) - (matchTime(b) === Infinity) || matchTime(b) - matchTime(a);
    });
    const textMatches = value => query.kind === 'text' && core.normalize(value).includes(query.query);
    const playerLinks = names.length === 1 ? names[0].map(player => {
      const season = availableSeasons.find(item =>
        cache.matches.get(item.id)?.data?.participants.some(participant => participant.playerId === player.id));
      return titleLink(player.name, routing.getPlayerProfileUrl(season.id, player.id), player.firma);
    }) : [];
    return {
      pair: filter === 'all' ? core.summarizePair(matches.map(entry => entry.match), names) : null,
      groups: [
        ['pages', 'Seiten', filter === 'all' ? pageLinks(active, players)
          .filter(item => textMatches(item.title) || item.aliases?.some(textMatches)) : []],
        ['seasons', 'Saisons', filter === 'all' ? availableSeasons.filter(season =>
          [season.label, season.shortLabel].some(textMatches)).map(season =>
          titleLink(season.label, routing.getSeasonUrl(season.id, isTip ? 'tipp' : 'league'))) : []],
        ['players', 'Spieler', filter === 'all' || filter === 'players' ? playerLinks : []],
        ['matches', 'Partien', filter === 'all' || filter === 'matches' ? matches.map(entry => matchLink(entry, byId)) : []],
        ['trainings', 'Trainings', filter === 'all' || filter === 'matches' ? getTrainingResults() : []],
        ['articles', 'Artikel', filter === 'all' || filter === 'articles' ? getArticleLinks(availableSeasons) : []]
      ]
    };
  }

  function renderGroup(key, title, items) {
    if (!items.length) return;
    const heading = document.createElement('h2');
    heading.textContent = title;
    results.append(heading);
    const limit = limits.get(key) || pageSize;
    for (const item of items.slice(0, limit)) {
      const row = document.createElement(item.url ? 'a' : item.openPlayers ? 'button' : 'div');
      if (item.url) row.href = item.url;
      else if (item.openPlayers) row.type = 'button';
      if (item.openPlayers) row.dataset.searchOpenPlayers = '';
      row.className = 'site-search-result';
      const label = document.createElement('strong');
      label.textContent = item.title;
      if (key === 'matches' || key === 'trainings') {
        const topLine = document.createElement('div');
        topLine.className = 'site-search-match-heading';
        const identity = document.createElement('span');
        identity.className = 'site-search-match-identity';
        const season = document.createElement('span');
        season.className = 'site-search-match-season';
        season.textContent = item.seasonLabel;
        identity.append(label, season);
        topLine.append(identity);
        row.append(topLine);
      } else {
        row.append(label);
      }
      if (item.description) {
        const description = document.createElement('span');
        description.textContent = item.description;
        if (key === 'matches' || key === 'trainings') {
          const details = document.createElement('div');
          details.className = 'site-search-match-details';
          details.append(description);
          if (item.dateLabel) {
            const date = document.createElement('span');
            date.className = 'site-search-match-date';
            date.textContent = item.dateLabel;
            details.append(date);
          }
          row.append(details);
        } else {
          row.append(description);
        }
      }
      results.append(row);
    }
    if (limit < items.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'text-link site-search-more';
      more.dataset.searchMore = key;
      more.textContent = `Weitere Treffer (${items.length - limit})`;
      results.append(more);
    }
  }

  function setOutputVisible(visible) {
    output.dataset.expanded = String(visible);
    output.inert = !visible;
  }

  function render() {
    if (closeTimer !== null) return;
    if (query.kind === 'idle') {
      setOutputVisible(false);
      return;
    }
    const focused = document.activeElement;
    const focusedUrl = results.contains(focused) ? focused.getAttribute('href') : null;
    results.replaceChildren();
    retry.hidden = true;
    if (query.kind === 'invalid-date') {
      status.textContent = 'Dieses Datum gibt es nicht.';
      setOutputVisible(true);
      return;
    }

    const matchEntries = relevantKinds().includes('matches') ? seasons().map(season => cache.matches.get(season.id)) : [];
    const articleEntries = relevantKinds().includes('articles') ? seasons().map(season => cache.articles.get(season.id)) : [];
    const trainingEntries = relevantKinds().includes('trainings') ? trainingSources.map(source => cache.trainings.get(source.id)) : [];
    const entries = [...matchEntries, ...articleEntries, ...trainingEntries];
    const loading = entries.some(entry => !entry || entry.loading);
    const failed = entries.some(entry => entry?.error);
    const { pair, groups } = getGroups();
    const hasResults = groups.some(([, , items]) => items.length);
    const base = query.label || '';
    const message = loading ? 'Suche läuft …'
      : failed ? 'Ein Teil der Suche ist gerade nicht verfügbar.' : hasResults ? '' : 'Keine Treffer.';
    retry.hidden = !failed;
    status.textContent = [base, message].filter(Boolean).join(' · ');
    if (pair && matchEntries.every(entry => entry?.data && !entry.loading && !entry.error)) {
      const card = document.createElement('div');
      card.className = 'site-search-comparison';
      const names = document.createElement('strong');
      names.textContent = `${pair.first.name} und ${pair.second.name}`;
      const balance = document.createElement('span');
      balance.textContent = [
        pair.duel.some(Boolean) && `Siege im Duell ${pair.duel.join(':')}`,
        pair.team.some(Boolean) && `Als Team ${pair.team[0]} Siege, ${pair.team[1]} Niederlagen`
      ].filter(Boolean).join(' · ');
      card.append(names, balance);
      results.append(card);
    }
    groups.forEach(group => renderGroup(...group));
    setOutputVisible(true);
    if (focusedUrl) [...results.querySelectorAll('a')].find(link => link.getAttribute('href') === focusedUrl)?.focus({ preventScroll: true });
  }

  function schedule(immediate = false) {
    if (closeTimer !== null) return;
    clearTimeout(timer);
    timer = null;
    query = core.parseQuery(input.value);
    limits = new Map();
    if (immediate || query.kind === 'idle') {
      if (query.kind !== 'idle') retractFilters();
      loadResults();
      return;
    }
    // Keep the panel steady while typing, but make the old matches temporarily inert.
    output.inert = true;
    timer = setTimeout(() => {
      timer = null;
      retractFilters();
      loadResults();
    }, delay);
  }

  function syncFilterTray() {
    if (stackedFilters.matches) {
      filterTray.inert = false;
      return;
    }
    filterTray.inert = !filtersRevealed;
    if (filtersRevealed) filterTray.style.setProperty('--search-filters-width', `${filterChips.offsetWidth}px`);
  }

  function revealFilters() {
    filtersRevealed = true;
    syncFilterTray();
  }

  function retractFilters() {
    if (!filtersRevealed || stackedFilters.matches) return;
    if (filterTray.contains(document.activeElement)) input.focus({ preventScroll: true });
    filtersRevealed = false;
    syncFilterTray();
  }

  function open() {
    if (!hasSearchAccess()) return;
    if (dialog.open) {
      input.focus();
      return;
    }
    returnFocus = mobile.matches
      ? document.querySelector('[data-global-actions-toggle]') : document.activeElement;
    window.PadelGlobalActions?.close();
    filtersRevealed = false;
    syncFilterTray();
    dialog.showModal();
    // Establish the collapsed layout before restoring a query from the previous opening.
    void output.offsetHeight;
    schedule(true);
    input.focus();
    input.select();
  }

  function closeSearch() {
    if (closeTimer !== null) return;
    if (mobile.matches || output.dataset.expanded !== 'true' || reducedMotion.matches) {
      dialog.close();
      return;
    }
    clearTimeout(timer);
    timer = null;
    if (output.contains(document.activeElement)) input.focus({ preventScroll: true });
    setOutputVisible(false);
    closeTimer = setTimeout(() => dialog.close(), 400);
  }

  function selectFilter(value) {
    filter = value;
    dialog.querySelectorAll('[data-search-filter]').forEach(node => {
      const selected = node.dataset.searchFilter === filter;
      node.setAttribute('aria-pressed', String(selected));
      if (selected) {
        input.placeholder = filter === 'all' ? 'Website durchsuchen' : `${node.textContent} durchsuchen`;
        input.setAttribute('aria-label', filter === 'all' ? 'Suchbegriff' : `Suchbegriff, Filter ${node.textContent}`);
      }
    });
    retractFilters();
  }

  button.addEventListener('click', open);
  dialog.querySelector('.site-search-close').addEventListener('click', closeSearch);
  stackedFilters.addEventListener?.('change', () => {
    if (dialog.open && filterTray.contains(document.activeElement)) filtersRevealed = true;
    syncFilterTray();
  });
  dialog.addEventListener('pointermove', event => {
    if (!dialog.open || !filterTray.inert || event.pointerType === 'touch' || event.target === dialog) return;
    if (query.kind === 'idle' || searchField.contains(event.target)) revealFilters();
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      closeSearch();
      return;
    }
    const control = event.target.closest('[data-search-filter]');
    if (!control) return;
    selectFilter(control.dataset.searchFilter);
    schedule(true);
  });
  dialog.addEventListener('close', () => {
    clearTimeout(timer);
    timer = null;
    clearTimeout(closeTimer);
    closeTimer = null;
    setOutputVisible(false);
    (returnFocus?.matches('body') ? button : returnFocus)?.focus({ preventScroll: true });
  });
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeSearch();
  });
  output.addEventListener('transitionend', event => {
    if (closeTimer !== null && event.target === output && event.propertyName === 'grid-template-rows') dialog.close();
  });
  input.addEventListener('compositionstart', () => { isComposing = true; });
  input.addEventListener('compositionend', () => {
    isComposing = false;
    schedule();
  });
  input.addEventListener('input', () => { if (!isComposing) schedule(); });
  retry.addEventListener('click', () => loadResults(true));

  results.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (link) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (link.href === location.href) {
        returnFocus = null;
        requestAnimationFrame(() => window.PadelLigaRevealSearchTarget?.());
      }
      dialog.close();
      return;
    }
    if (event.target.closest('[data-search-open-players]')) {
      selectFilter('players');
      input.value = '';
      schedule(true);
      input.focus();
    }
    const more = event.target.closest('[data-search-more]');
    if (more) {
      const index = [...results.querySelectorAll('a, button')].indexOf(more);
      const key = more.dataset.searchMore;
      limits.set(key, (limits.get(key) || pageSize) + pageSize);
      render();
      results.querySelectorAll('a, button')[index]?.focus();
    }
  });

  dialog.addEventListener('keydown', event => {
    if (isComposing || event.isComposing) return;
    if (event.key === 'Tab' && !event.shiftKey && event.target === input && filterTray.inert) {
      event.preventDefault();
      revealFilters();
      filterChips.querySelector('button').focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
      return;
    }
    const rows = output.inert ? [] : [...results.querySelectorAll('a, button')];
    if (event.key === 'Enter' && event.target === input) {
      if (timer !== null) schedule(true);
      else rows[0]?.click();
      event.preventDefault();
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const index = rows.indexOf(event.target);
    if (event.target !== input && index < 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' && index <= 0) input.focus();
    else rows[Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))]?.focus();
  });

  window.addEventListener('keydown', event => {
    if (!isSearchShortcut(event) || !hasSearchAccess()) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (dialog.open) closeSearch();
    else open();
  }, true);

  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.type !== 'padel:toggle-search'
      || ![...document.querySelectorAll('iframe')].some(frame => frame.contentWindow === event.source)
      || !hasSearchAccess()) return;
    if (dialog.open) closeSearch();
    else open();
  });

  window.addEventListener('padel:auth-state-changed', syncSearchAccess);
  window.addEventListener('padel:account-initialized', syncSearchAccess, { once: true });
  window.addEventListener('padel:training-data-changed', () => {
    cache.trainings.clear();
    if (dialog.open && timer === null) loadResults();
  });
  if (!window.PadelKonto || hasSearchAccess()) syncSearchAccess();

  window.PadelSiteSearch = {
    finishLoading: syncSearchAccess,
    rememberSeason: (id, data) => remember('matches', id, data),
    rememberEditorial: data => remember('articles', data.id, data.articles || [])
  };
})();
