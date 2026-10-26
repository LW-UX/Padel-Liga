(function () {
  const LEGACY_SEASON_IDS = Object.freeze({
    '2026': '2026-sommer',
    'sommer-2026': '2026-sommer',
    'winter-2026': '2026-winter',
    'cup-2027': '2027-cup',
    'test-2026': '2026-test'
  });

  function normalizeSeasonId(id) {
    return LEGACY_SEASON_IDS[id] || id;
  }

  function getAllSeasonOptions() {
    return Array.isArray(window.PADEL_SEASONS) ? window.PADEL_SEASONS : [];
  }

  function getSeasonOptions() {
    return getAllSeasonOptions().filter(option => !option.hidden);
  }

  function getSelectedSeason() {
    const options = getSeasonOptions();
    const requestedValue = new URLSearchParams(window.location.search).get('saison');
    const requested = normalizeSeasonId(requestedValue);
    return getAllSeasonOptions().find(option => option.id === requested)
      || options.find(option => option.default)
      || options[0];
  }

  function normalizeLegacySeasonUrl() {
    const url = new URL(window.location.href);
    const requested = url.searchParams.get('saison');
    const normalized = normalizeSeasonId(requested);
    if (!requested || requested === normalized) return;
    url.searchParams.set('saison', normalized);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
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

  function hydrateSeason(rawSeason) {
    const players = new Map((window.PADEL_PLAYERS || []).map(player => [player.id, player]));
    const playersByName = new Map((window.PADEL_PLAYERS || []).map(player => [player.name, player]));
    const sourceMatches = Array.isArray(rawSeason.participants)
      ? rawSeason.matches
      : rawSeason.matches.map(match => ({
          ...match,
          id: `${rawSeason.matchIdPrefix || `season-${rawSeason.id}`}-partie-${String(match.id).match(/\d+$/)?.[0] || match.id}`,
          matchday: match.spieltag,
          date: match.datum,
          time: match.uhrzeit,
          result: match.ergebnis,
          sets: match.saetze,
          winner: match.sieger,
          team1: { playerIds: (match.team1?.spieler || []).map(name => playersByName.get(name)?.id).filter(Boolean) },
          team2: { playerIds: (match.team2?.spieler || []).map(name => playersByName.get(name)?.id).filter(Boolean) }
        }));
    return {
      ...rawSeason,
      matches: sourceMatches.map(match => ({
        ...match,
        spieltag: match.matchday,
        datum: match.date,
        uhrzeit: match.time,
        ergebnis: match.result,
        saetze: match.sets,
        sieger: match.winner,
        team1: {
          ...match.team1,
          spieler: match.team1.playerIds.map(id => players.get(id)?.name || id)
        },
        team2: {
          ...match.team2,
          spieler: match.team2.playerIds.map(id => players.get(id)?.name || id)
        }
      }))
    };
  }

  function renderSeasonPicker(selected) {
    const picker = document.getElementById('season-picker');
    const toggle = picker.querySelector('[data-season-toggle]');
    const label = document.getElementById('season-picker-label');
    const menu = document.getElementById('season-menu');
    label.textContent = selected.shortLabel || selected.label;
    menu.innerHTML = getSeasonOptions().map(option =>
      `<button type="button" class="season-option ${option.id === selected.id ? 'active' : ''}" role="option" aria-selected="${option.id === selected.id}" data-season-id="${option.id}"><span>${option.label}</span></button>`
    ).join('');

    toggle.addEventListener('click', () => {
      const isOpen = picker.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
    menu.addEventListener('click', event => {
      const option = event.target.closest('[data-season-id]');
      if (!option) return;
      if (option.dataset.seasonId === selected.id) {
        picker.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set('saison', option.dataset.seasonId);
      window.location.assign(url);
    });
    document.addEventListener('click', event => {
      if (picker.contains(event.target)) return;
      picker.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      picker.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
    const ligaLink = document.getElementById('liga-link');
    ligaLink.href = `../?saison=${encodeURIComponent(selected.id)}`;
  }

  function showSection(id) {
    // Wie auf der Ligaseite bleibt eine bereits oben angeheftete Navigation stehen.
    const navigation = document.querySelector('.tip-site-nav');
    const navigationPinned = Boolean(navigation) && navigation.getBoundingClientRect().top <= 1;
    document.querySelectorAll('main > .section').forEach(section => section.classList.toggle('active', section.id === id));
    document.querySelectorAll('.tip-site-nav button').forEach(button => button.classList.toggle('active', button.dataset.tipNav === id));
    if (navigationPinned) window.scrollTo({ top: document.querySelector('.site-header')?.offsetHeight || 0, behavior: 'instant' });
  }

  function bindNavigation() {
    document.addEventListener('click', event => {
      const control = event.target.closest('[data-tip-nav]');
      if (!control) return;
      showSection(control.dataset.tipNav);
    });
    // Mobil per horizontalem Wischen zwischen den Bereichen wechseln, wie auf der Ligaseite.
    const mobileViewportQuery = window.matchMedia('(max-width: 768px)');
    window.PadelSwipeGesture?.attach(document.querySelector('main'), {
      enabled: () => mobileViewportQuery.matches,
      onSwipe: step => {
        const sections = [
          'tippstart',
          ...[...document.querySelectorAll('.tip-site-nav button[data-tip-nav]')]
            .filter(button => !button.hidden)
            .map(button => button.dataset.tipNav)
        ];
        const currentIndex = sections.indexOf(document.querySelector('main > .section.active')?.id);
        const targetId = currentIndex === -1 ? null : sections[currentIndex + step];
        if (!targetId) return;
        showSection(targetId);
        window.PadelSwipeGesture.animateIn(document.getElementById(targetId), step);
      }
    });
  }

  // Spielerprofile und Partiedetails erscheinen über der Tippseite; dafür wird die Liga im Detailmodus eingebettet.
  const ligaDetailFrame = { element: null, ready: false, pendingDetail: null, returnFocus: null, forecastChanged: false };

  function postLigaDetail(detail) {
    const frame = ligaDetailFrame.element;
    frame.hidden = false;
    frame.classList.add('is-loading');
    frame.contentWindow.postMessage({ type: 'padel:open-detail', ...detail }, window.location.origin);
  }

  function openLigaDetail(detail, trigger = null) {
    if (!detail.playerId && !detail.matchId) return;
    ligaDetailFrame.returnFocus = trigger || document.activeElement;
    if (ligaDetailFrame.element) {
      if (ligaDetailFrame.ready) postLigaDetail(detail);
      else ligaDetailFrame.pendingDetail = detail;
      return;
    }
    const url = new URL('../', window.location.href);
    url.searchParams.set('saison', getSelectedSeason()?.id || '');
    url.searchParams.set('einbettung', 'detail');
    if (detail.playerId) url.searchParams.set('spielerprofil', detail.playerId);
    else url.searchParams.set('partie', detail.matchId);
    const element = document.createElement('iframe');
    element.className = 'liga-detail-frame is-loading';
    element.title = detail.playerId ? 'Spielerprofil' : 'Partiedetails';
    element.src = url.href;
    ligaDetailFrame.element = element;
    document.body.append(element);
  }

  function bindLigaDetails() {
    window.PadelLigaOpenPlayerProfile = (playerId, trigger) => openLigaDetail({ playerId }, trigger);
    document.addEventListener('click', event => {
      const link = event.target.closest('[data-player-profile-id], [data-match-statistics]');
      if (!link || event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openLigaDetail(link.dataset.playerProfileId
        ? { playerId: link.dataset.playerProfileId }
        : { matchId: link.dataset.matchStatistics }, link);
    });
    window.addEventListener('message', event => {
      const frame = ligaDetailFrame.element;
      if (!frame || event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
      const type = event.data?.type;
      if (type === 'padel:match-forecast-changed') ligaDetailFrame.forecastChanged = true;
      if (type !== 'padel:detail-opened' && type !== 'padel:detail-closed') return;
      ligaDetailFrame.ready = true;
      const pendingDetail = ligaDetailFrame.pendingDetail;
      ligaDetailFrame.pendingDetail = null;
      if (pendingDetail) {
        postLigaDetail(pendingDetail);
        return;
      }
      if (type === 'padel:detail-opened') {
        frame.classList.remove('is-loading');
        frame.focus();
        return;
      }
      if (frame.hidden) return;
      frame.hidden = true;
      frame.classList.remove('is-loading');
      ligaDetailFrame.returnFocus?.focus?.();
      if (ligaDetailFrame.forecastChanged) {
        ligaDetailFrame.forecastChanged = false;
        void window.PadelTippspiel?.refresh();
      }
    });
  }

  async function init() {
    try {
      normalizeLegacySeasonUrl();
      const selected = getSelectedSeason();
      if (!selected) throw new Error('Keine Saison vorhanden.');
      renderSeasonPicker(selected);
      bindNavigation();
      window.PADEL_SEASON = null;
      const accountReady = window.PadelKonto.init();
      await Promise.all([
        loadScript(`../${selected.file}`),
        loadScript('../js/tippspiel.js?v=2026-10-26-group-counts')
      ]);
      const season = hydrateSeason(window.PADEL_SEASON);
      document.querySelectorAll('[data-season-label]').forEach(node => { node.textContent = season.label; });
      if (!window.PadelTippspiel?.init) throw new Error('Das Tippspiel-Modul ist nicht verfügbar.');
      await window.PadelTippspiel.init(season, { accountReady });
    } catch (error) {
      document.querySelector('main').innerHTML = `<div class="empty-state">Die Tippspiel-Daten konnten nicht geladen werden.</div>`;
      console.error(error);
    }
  }

  bindLigaDetails();
  init();
})();
