(function () {
  const VALID_PREDICTIONS = ['2:0', '2:1', '1:2', '0:2'];
  const state = {
    client: null,
    season: null,
    session: null,
    profile: null,
    authMode: 'login',
    databaseMatches: new Map(),
    predictions: new Map(),
    leaderboard: [],
    saving: new Set(),
    ready: false,
    error: null
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getOpenLocalMatches() {
    if (!state.season) return [];
    return state.season.matches.filter(match =>
      match.sieger === null &&
      match.matchday !== 8 &&
      match.team1.playerIds.length > 0 &&
      match.team2.playerIds.length > 0 &&
      state.databaseMatches.get(match.id)?.betting_open === true &&
      state.databaseMatches.get(match.id)?.actual_sets === null &&
      (
        !state.databaseMatches.get(match.id)?.lock_at ||
        new Date(state.databaseMatches.get(match.id).lock_at).getTime() > Date.now()
      )
    );
  }

  function formatMatchDate(match) {
    if (!match.datum) return `Spieltag ${match.spieltag}`;
    const date = new Date(`${match.datum}T12:00:00`);
    const dateLabel = Number.isNaN(date.getTime())
      ? match.datum
      : new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    return `${dateLabel}${match.uhrzeit ? ` · ${match.uhrzeit} Uhr` : ''}`;
  }

  function renderTeam(team) {
    return team.spieler.map(escapeHtml).join('<span class="mc-player-sep"> / </span>');
  }

  function renderAuthState() {
    const button = document.getElementById('auth-button');
    const guestView = document.getElementById('auth-guest-view');
    const accountView = document.getElementById('auth-account-view');
    if (!button || !guestView || !accountView) return;

    const isLoggedIn = Boolean(state.session?.user);
    const displayName = state.profile?.display_name || state.session?.user?.user_metadata?.display_name || 'Konto';
    button.textContent = isLoggedIn ? displayName : 'Login';
    button.classList.toggle('is-authenticated', isLoggedIn);
    guestView.hidden = isLoggedIn;
    accountView.hidden = !isLoggedIn;

    if (isLoggedIn) {
      document.getElementById('account-display-name').textContent = displayName;
      document.getElementById('account-email').textContent = state.session.user.email || '';
      document.querySelector('#profile-form [name="displayName"]').value = displayName;
    }
  }

  function renderAuthHint() {
    const target = document.getElementById('prediction-auth-hint');
    if (!target) return;
    target.innerHTML = state.session
      ? `<div class="prediction-session-note"><span>Du tippst als <strong>${escapeHtml(state.profile?.display_name || state.session.user.email)}</strong>.</span><button class="text-link inline-link" type="button" data-auth-open>Konto öffnen</button></div>`
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

    const matches = getOpenLocalMatches();
    if (meta) meta.textContent = `${matches.length} offene ${matches.length === 1 ? 'Partie' : 'Partien'}`;
    if (!matches.length) {
      target.innerHTML = '<div class="widget empty-state">Aktuell gibt es keine offenen Spiele zum Tippen.</div>';
      return;
    }

    target.innerHTML = matches.map(match => {
      const selected = state.predictions.get(match.id);
      const isSaving = state.saving.has(match.id);
      return `
        <article class="prediction-match-card ${selected ? 'has-prediction' : ''}">
          <div class="prediction-match-meta">
            <span>Partie ${escapeHtml(match.id.match(/\d+$/)?.[0] || match.id)}</span>
            <span>Spieltag ${escapeHtml(match.spieltag)} · ${escapeHtml(formatMatchDate(match))}</span>
          </div>
          <div class="prediction-teams">
            <div class="prediction-team prediction-team-1">${renderTeam(match.team1)}</div>
            <div class="prediction-versus">VS</div>
            <div class="prediction-team prediction-team-2">${renderTeam(match.team2)}</div>
          </div>
          <div class="prediction-options" role="group" aria-label="Satzergebnis für Partie ${escapeHtml(match.id)} tippen">
            ${VALID_PREDICTIONS.map(prediction => `
              <button
                type="button"
                class="prediction-option ${selected === prediction ? 'active' : ''}"
                data-prediction-match="${escapeHtml(match.id)}"
                data-prediction-value="${prediction}"
                aria-pressed="${selected === prediction}"
                ${isSaving ? 'disabled' : ''}
              >${prediction}</button>
            `).join('')}
          </div>
          <div class="prediction-save-state ${selected ? 'saved' : ''}">${isSaving ? 'Wird gespeichert …' : selected ? `Gespeichert: ${selected}` : 'Noch kein Tipp'}</div>
        </article>
      `;
    }).join('');
  }

  function renderLeaderboard() {
    const body = document.getElementById('prediction-ranking-body');
    const empty = document.getElementById('prediction-ranking-empty');
    if (!body || !empty) return;

    body.innerHTML = state.leaderboard.map((entry, index) => `
      <tr class="${state.session?.user?.id === entry.user_id ? 'viewer-highlight' : ''}">
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

  function render() {
    renderAuthState();
    renderAuthHint();
    renderMatches();
    renderLeaderboard();
  }

  async function loadProfile() {
    state.profile = null;
    if (!state.session?.user) return;
    const { data, error } = await state.client
      .from('profiles')
      .select('id, display_name, player_id')
      .eq('id', state.session.user.id)
      .single();
    if (error) throw error;
    state.profile = data;
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
        .select('id, betting_open, actual_sets, lock_at')
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
    document.getElementById('auth-name-field').hidden = state.authMode !== 'signup';
    const nameInput = document.querySelector('#auth-form [name="displayName"]');
    nameInput.required = state.authMode === 'signup';
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
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');
    const displayName = String(form.get('displayName') || '').trim();
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
            data: { display_name: displayName },
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
      event.currentTarget.reset();
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
    if (/already registered/i.test(message)) return 'Für diese E-Mail gibt es bereits ein Konto.';
    if (/password/i.test(message) && /characters/i.test(message)) return 'Das Passwort muss mindestens 8 Zeichen lang sein.';
    return message;
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    const displayName = String(new FormData(event.currentTarget).get('displayName') || '').trim();
    setAuthMessage('Name wird gespeichert …');
    const { error } = await state.client.rpc('update_my_profile', { p_display_name: displayName });
    if (error) {
      setAuthMessage(error.message, 'error');
      return;
    }
    await loadProfile();
    render();
    setAuthMessage('Name gespeichert.', 'success');
  }

  async function savePrediction(matchId, prediction) {
    if (!state.session?.user) {
      openAuthDialog();
      return;
    }
    if (!VALID_PREDICTIONS.includes(prediction) || !state.databaseMatches.get(matchId)?.betting_open) return;

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
      const prediction = event.target.closest('[data-prediction-match]');
      if (prediction) {
        savePrediction(prediction.dataset.predictionMatch, prediction.dataset.predictionValue);
      }
    });

    document.getElementById('auth-form')?.addEventListener('submit', handleAuthSubmit);
    document.getElementById('profile-form')?.addEventListener('submit', handleProfileSubmit);
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

    state.client = window.supabase.createClient(config.url, config.publishableKey);
    bindEvents();
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
