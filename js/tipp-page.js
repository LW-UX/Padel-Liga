(function () {
  function getSeasonOptions() {
    return Array.isArray(window.PADEL_SEASONS) ? window.PADEL_SEASONS : [];
  }

  function getSelectedSeason() {
    const options = getSeasonOptions();
    const requested = new URLSearchParams(window.location.search).get('saison');
    return options.find(option => option.id === requested)
      || options.find(option => option.default)
      || options[0];
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
          id: `season-${rawSeason.id}-partie-${String(match.id).match(/\d+$/)?.[0] || match.id}`,
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
    const picker = document.getElementById('season-select');
    picker.innerHTML = getSeasonOptions().map(option =>
      `<option value="${option.id}" ${option.id === selected.id ? 'selected' : ''}>${option.label}</option>`
    ).join('');
    picker.addEventListener('change', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('saison', picker.value);
      window.location.assign(url);
    });
    const ligaLink = document.getElementById('liga-link');
    ligaLink.href = `../?saison=${encodeURIComponent(selected.id)}`;
  }

  function bindNavigation() {
    document.addEventListener('click', event => {
      const control = event.target.closest('[data-tip-nav]');
      if (!control) return;
      const id = control.dataset.tipNav;
      document.querySelectorAll('main > .section').forEach(section => section.classList.toggle('active', section.id === id));
      document.querySelectorAll('.tip-site-nav button').forEach(button => button.classList.toggle('active', button.dataset.tipNav === id));
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  }

  async function init() {
    try {
      const selected = getSelectedSeason();
      if (!selected) throw new Error('Keine Saison vorhanden.');
      renderSeasonPicker(selected);
      bindNavigation();
      window.PADEL_SEASON = null;
      await loadScript(`../${selected.file}`);
      const season = hydrateSeason(window.PADEL_SEASON);
      document.querySelectorAll('[data-season-label]').forEach(node => { node.textContent = season.label; });
      await window.PadelTippspiel.init(season);
    } catch (error) {
      document.querySelector('main').innerHTML = `<div class="empty-state">Die Tippspiel-Daten konnten nicht geladen werden.</div>`;
      console.error(error);
    }
  }

  init();
})();
