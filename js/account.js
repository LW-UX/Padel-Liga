(function () {
  const ACCOUNT_SUCCESS_MESSAGE_DURATION = 5000;
  const initialSearch = String(window.location?.search || '');
  const initialHash = String(window.location?.hash || '');
  const readInitialUrlParam = (source, name) => {
    const value = source.match(new RegExp(`(?:^[?#]|[&])${name}=([^&]*)`))?.[1];
    if (value === undefined) return null;
    try {
      return decodeURIComponent(value.replaceAll('+', ' '));
    } catch (_error) {
      return null;
    }
  };
  const requestedConfirmationUrl = readInitialUrlParam(initialSearch, 'auth') === 'confirm'
    ? readInitialUrlParam(initialSearch, 'confirmation_url')
      || (/^https?:\/\//i.test(String(window.location.hash || '').slice(1))
        ? String(window.location.hash).slice(1)
        : null)
    : null;
  const requestedConfirmationPurpose = readInitialUrlParam(initialSearch, 'purpose') || 'invite';
  const initialAuthError = readInitialUrlParam(initialSearch, 'error_description')
    || readInitialUrlParam(initialHash, 'error_description')
    || (readInitialUrlParam(initialSearch, 'error') || readInitialUrlParam(initialHash, 'error')
      ? 'Der Link ist ungültig oder abgelaufen.'
      : null);
  const requestedAccountOpen = readInitialUrlParam(initialSearch, 'konto') === '1';
  // Supabase verwirft ?auth=…, wenn die Zieladresse nicht freigegeben ist; type=… im Hash kommt immer mit.
  const requestedAuthFlow = String(window.location?.search || '')
    .match(/(?:^|[?&])auth=(invite|recovery)(?:&|$)/)?.[1]
    || String(window.location?.hash || '').match(/(?:^#|&)type=(invite|recovery)(?:&|$)/)?.[1]
    || null;
  const state = {
    client: null,
    session: null,
    profile: null,
    authMode: 'login',
    passwordFlow: requestedAuthFlow,
    confirmationUrl: requestedConfirmationUrl,
    confirmationPurpose: requestedConfirmationPurpose,
    settingsOpen: false,
    notificationPreferences: {
      resultEntry: true,
      resultConfirmation: true,
      predictionReminder: true
    },
    notificationPreferencesReady: false,
    notificationPreferencesAvailable: true,
    resultTaskScope: 'relevant',
    resultTasks: [],
    trainingTasks: [],
    players: [],
    invitationPlayers: [],
    invitationDraft: null,
    extendedPlayerFeatures: true,
    playerToolsVersion: 0,
    playerToolsReady: false,
    playerToolsLoading: false,
    playerToolsError: null,
    ready: false,
    error: null,
    bound: false
  };
  let initPromise = null;
  let playerToolsPromise = null;
  let playerToolsTimer = null;
  let unscheduleTrigger = null;
  let unrateTrigger = null;
  let accountMessageTimer = null;
  let shouldOpenAccountFromLink = requestedAccountOpen;
  const TRAINING_GUEST_OPTION = '__guest__';
  const TRAINING_GUEST_KEY_PATTERN = /^guest:([1-4])$/;
  const RACKET_CHECK_DELAY_MS = 450;
  const RACKET_AUTO_SYNC_LIMIT = 10;
  const racketCheckTimers = new WeakMap();
  const racketStatusCache = new Map();
  const racketSyncAttempted = new Set();
  let racketStatusRun = Promise.resolve();

  const browserUserAgent = String(window.navigator?.userAgent || '');
  const browserPlatform = String(window.navigator?.platform || '');
  const isIosWebKit = /iP(?:hone|ad|od)/.test(browserUserAgent)
    || (browserPlatform === 'MacIntel' && Number(window.navigator?.maxTouchPoints) > 1);
  const isDesktopSafari = /Safari\//.test(browserUserAgent)
    && !/(?:Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|OPiOS|FxiOS|Android)\//.test(browserUserAgent);
  document.documentElement?.classList?.toggle('has-controlled-datetime-hints', isIosWebKit || isDesktopSafari);

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function syncDateTimeHint(input) {
    if (!input?.matches?.('input:is([type="date"], [type="time"])')) return;
    input.closest('[data-datetime-field]')?.classList.toggle('is-empty', !input.value);
  }

  function syncDateTimeHints(root = document) {
    root?.querySelectorAll?.('[data-datetime-field] input:is([type="date"], [type="time"])')
      .forEach(syncDateTimeHint);
  }

  function getMatchAtTimestamp(value, fallback = Number.POSITIVE_INFINITY) {
    const timestamp = value ? new Date(value).getTime() : NaN;
    return Number.isNaN(timestamp) ? fallback : timestamp;
  }

  function getTrainingTaskTimestamp(task, fallback = Number.POSITIVE_INFINITY) {
    const rawTime = String(task?.display_time || '23:59').replace('.', ':');
    const time = /^\d{1,2}:\d{2}$/.test(rawTime) ? `${rawTime}:00` : rawTime;
    return getMatchAtTimestamp(`${task?.played_on || '9999-12-31'}T${time}`, fallback);
  }

  function isScheduledTrainingTask(task) {
    return task?.status === 'scheduled';
  }

  function isScheduledTrainingDue(task, now = Date.now()) {
    return isScheduledTrainingTask(task) && getTrainingTaskTimestamp(task) <= now;
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

  function buildMatchAtValue(dateValue, timeValue) {
    return `${dateValue}T${timeValue}:00`;
  }

  async function invokeRacketBooking(body) {
    if (!state.client?.functions) return { state: 'unavailable' };
    try {
      const { data, error } = await state.client.functions.invoke('racket-booking', { body });
      if (error) throw error;
      return data?.state ? data : { state: 'unavailable' };
    } catch (error) {
      console.warn('Schläger-Status nicht prüfbar:', error);
      return { state: 'unavailable' };
    }
  }

  function describeRacketCheck(result) {
    const slot = result?.from && result?.until ? ` · ${result.from}–${result.until}` : '';
    switch (result?.state) {
      case 'checking': return { text: 'Schläger werden geprüft …', tone: 'is-pending' };
      case 'free': return { text: `✓ Schläger frei${slot}`, tone: 'is-free' };
      case 'partial': return { text: `✓ Schläger frei, wegen der Bürozeiten nur ${result.from}–${result.until}`, tone: 'is-free' };
      case 'busy': return { text: `⚠ Schläger ${result.busyFrom}–${result.busyUntil} schon belegt. Der Termin lässt sich trotzdem speichern.`, tone: 'is-busy' };
      case 'outside_hours': return {
        text: result.openFrom
          ? `⚠ Schläger nur zu Bürozeiten (${result.openFrom}–${result.openUntil}) buchbar.`
          : '⚠ Schläger sind an diesem Tag nicht buchbar.',
        tone: 'is-busy'
      };
      case 'unavailable': return { text: 'Schläger-Status gerade nicht prüfbar.', tone: 'is-pending' };
      default: return null;
    }
  }

  function describeRacketBooking(result) {
    switch (result?.state) {
      case 'booked': return { text: `✓ Schläger reserviert · ${result.from}–${result.until}`, tone: 'is-free' };
      case 'partial': return { text: `✓ Schläger reserviert · ${result.from}–${result.until} (Bürozeiten)`, tone: 'is-free' };
      case 'busy': return { text: `⚠ Keine Schläger reserviert – ${result.busyFrom}–${result.busyUntil} schon belegt`, tone: 'is-busy' };
      case 'outside_hours': return { text: '⚠ Keine Schläger reserviert – außerhalb der Bürozeiten', tone: 'is-busy' };
      case 'failed': return { text: '⚠ Schlägerbuchung fehlgeschlagen', tone: 'is-busy' };
      default: return null;
    }
  }

  function renderRacketNote(target, description) {
    if (!target) return;
    target.hidden = !description;
    target.textContent = description?.text || '';
    target.className = `${target.dataset.racketCheck !== undefined ? 'racket-check' : 'racket-status'}${description ? ` ${description.tone}` : ''}`;
  }

  function getRacketFormContext(form) {
    if (form?.matches('.match-schedule-form')) {
      return {
        subjectType: 'match',
        subjectId: form.dataset.matchSchedule,
        date: String(form.querySelector('[name="scheduledDate"]')?.value || ''),
        time: String(form.querySelector('[name="scheduledTime"]')?.value || '')
      };
    }
    if (form?.matches('.training-form') && !form.dataset.trainingAlternative) {
      return {
        subjectType: form.dataset.trainingScheduled ? 'training' : null,
        subjectId: form.dataset.trainingScheduled || null,
        date: String(form.querySelector('[name="playedOn"]')?.value || ''),
        time: String(form.querySelector('[name="displayTime"]')?.value || '')
      };
    }
    return null;
  }

  function scheduleRacketCheck(form) {
    const target = form?.querySelector('[data-racket-check]');
    if (!target) return;
    window.clearTimeout(racketCheckTimers.get(form));
    const context = getRacketFormContext(form);
    const timestamp = context?.date && context?.time
      ? getMatchAtTimestamp(buildMatchAtValue(context.date, context.time), NaN)
      : NaN;
    if (form.closest('[hidden]') || !Number.isFinite(timestamp) || timestamp <= Date.now()) {
      delete target.dataset.racketRequest;
      renderRacketNote(target, null);
      return;
    }
    const requestKey = `${context.date} ${context.time}`;
    if (target.dataset.racketRequest === requestKey) return;
    target.dataset.racketRequest = requestKey;
    renderRacketNote(target, describeRacketCheck({ state: 'checking' }));
    racketCheckTimers.set(form, window.setTimeout(async () => {
      const result = await invokeRacketBooking({ action: 'check', ...context });
      if (target.dataset.racketRequest === requestKey) renderRacketNote(target, describeRacketCheck(result));
    }, RACKET_CHECK_DELAY_MS));
  }

  async function syncRacketBooking(subjectType, subjectId) {
    const key = `${subjectType}:${subjectId}`;
    racketSyncAttempted.add(key);
    const result = await invokeRacketBooking({ action: 'sync', subjectType, subjectId: String(subjectId) });
    if (result.state !== 'unavailable') racketStatusCache.set(key, result);
    return result;
  }

  function withRacketNote(message, result) {
    const note = describeRacketBooking(result)?.text.replace(/^[✓⚠]\s*/, '');
    return note ? `${message} ${note}.` : message;
  }

  function applyRacketStatuses(root = document) {
    root.querySelectorAll('[data-racket-status]').forEach(target => {
      renderRacketNote(target, describeRacketBooking(racketStatusCache.get(target.dataset.racketStatus)));
    });
  }

  // Läufe werden nacheinander ausgeführt, damit derselbe Termin nie doppelt nachgebucht wird.
  function loadRacketStatuses() {
    racketStatusRun = racketStatusRun.then(runRacketStatusLoad, runRacketStatusLoad);
    return racketStatusRun;
  }

  async function runRacketStatusLoad() {
    const keys = [...document.querySelectorAll('#result-task-list [data-racket-status]')]
      .map(target => target.dataset.racketStatus);
    applyRacketStatuses();
    const missing = keys.filter(key => !racketStatusCache.has(key));
    if (!missing.length) return;
    const ids = type => missing.filter(key => key.startsWith(`${type}:`)).map(key => key.slice(type.length + 1));
    const response = await invokeRacketBooking({ action: 'status', matchIds: ids('match'), trainingIds: ids('training') });
    (response?.bookings || []).forEach(row => racketStatusCache.set(`${row.subjectType}:${row.subjectId}`, row));
    applyRacketStatuses();
    // Termine ohne oder mit fehlgeschlagener Buchung werden einmal je Seitenaufruf nachgebucht.
    const pending = keys.filter(key => !racketSyncAttempted.has(key)
      && (!racketStatusCache.has(key) || racketStatusCache.get(key)?.state === 'failed'));
    for (const key of pending.slice(0, RACKET_AUTO_SYNC_LIMIT)) {
      const [type, ...idParts] = key.split(':');
      await syncRacketBooking(type, idParts.join(':'));
      applyRacketStatuses();
    }
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
    return getMatchAtTimestamp(task?.match_at) <= Date.now();
  }

  function isTestResultTask(task) {
    const seasonId = String(task?.season_id || '');
    return seasonId === '2026-test' || seasonId === 'test-2026';
  }

  function getVisibleResultTasks() {
    if (state.profile?.app_role !== 'admin' || state.resultTaskScope === 'all') return state.resultTasks;
    return state.resultTasks.filter(task => !isTestResultTask(task));
  }

  function getPlayerResultTaskGroups(tasks = [], now = Date.now(), includeAll = false) {
    const compareBySchedule = (first, second) => getMatchAtTimestamp(first.match_at)
      - getMatchAtTimestamp(second.match_at);
    const scopedTasks = includeAll
      ? tasks
      : tasks.filter(task => [1, 2].includes(Number(task?.my_team)));
    const resultEntries = scopedTasks.filter(task => task.task_type === 'enter');
    const scheduledEntries = resultEntries.filter(task => task.match_at);

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
          .filter(task => getMatchAtTimestamp(task.match_at) <= now)
          .sort(compareBySchedule)
      },
      {
        key: 'future',
        label: 'Terminierte Partien',
        tasks: scheduledEntries
          .filter(task => getMatchAtTimestamp(task.match_at) > now)
          .sort(compareBySchedule)
      },
      {
        key: 'planned',
        label: 'Geplante Partien',
        tasks: resultEntries
          .filter(task => !task.match_at)
          .sort((first, second) => Number(first.matchday) - Number(second.matchday)
            || String(first.match_id).localeCompare(String(second.match_id), 'de', { numeric: true }))
      }
    ];
  }

  function getActionableResultTasks() {
    const groups = getPlayerResultTaskGroups(
      getVisibleResultTasks(),
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

  function publishOfficialResultChange(matchId = null) {
    window.dispatchEvent(new CustomEvent('padel:official-result-changed', {
      detail: { matchId }
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
    const passwordView = document.getElementById('auth-password-view');
    const confirmationView = document.getElementById('auth-confirmation-view');
    if (!button || !guestView || !accountView || !passwordView || !confirmationView) return;

    const isLoggedIn = Boolean(state.session?.user);
    const isConfirmingLink = Boolean(state.confirmationUrl);
    const isSettingPassword = isLoggedIn && ['invite', 'recovery', 'change'].includes(state.passwordFlow);
    const displayName = getProfileDisplayName();
    const taskCount = getActionableResultTasks().length
      + state.trainingTasks.filter(task => isTrainingTaskVisible(task) && (
        isScheduledTrainingDue(task)
        || (!isScheduledTrainingTask(task) && !task.created_by_me)
      )).length
      + Number(window.PadelLiveTicker?.pendingTaskCount || 0);
    button.innerHTML = isLoggedIn
      ? `<svg class="auth-user-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0"/>
        </svg><span class="auth-button-label">Konto</span>${taskCount ? `<span class="auth-task-badge">${taskCount}</span>` : ''}`
      : `<svg class="auth-user-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0"/>
        </svg><span class="auth-button-label">Login</span>`;
    window.PadelGlobalActions?.setAccountTaskCount(taskCount);
    button.classList.toggle('is-authenticated', isLoggedIn);
    button.classList.toggle('secondary-button', isLoggedIn);
    button.setAttribute('aria-label', isLoggedIn ? `Partienübersicht von ${displayName} öffnen` : 'Einloggen');
    button.title = isLoggedIn ? displayName : '';
    guestView.hidden = isLoggedIn || isConfirmingLink;
    accountView.hidden = !isLoggedIn || isSettingPassword || isConfirmingLink;
    passwordView.hidden = !isSettingPassword;
    confirmationView.hidden = !isConfirmingLink;

    if (isConfirmingLink) {
      const confirmationContent = {
        signup: {
          title: 'E-Mail-Adresse bestätigen',
          copy: 'Bestätige jetzt deine E-Mail-Adresse. Der eigentliche Einmal-Link wird erst durch deinen Klick verwendet.',
          button: 'E-Mail-Adresse bestätigen'
        },
        recovery: {
          title: 'Passwort zurücksetzen',
          copy: 'Öffne jetzt den geschützten Einmal-Link, um anschließend ein neues Passwort festzulegen.',
          button: 'Weiter zum neuen Passwort'
        },
        invite: {
          title: 'Spielerzugang einrichten',
          copy: 'Bestätige jetzt deine Einladung. Der eigentliche Einmal-Link wird erst durch deinen Klick verwendet.',
          button: 'Einladung bestätigen'
        }
      }[state.confirmationPurpose] || {
        title: 'Link bestätigen',
        copy: 'Öffne jetzt den geschützten Einmal-Link.',
        button: 'Weiter'
      };
      document.getElementById('auth-confirmation-title').textContent = confirmationContent.title;
      document.getElementById('auth-confirmation-copy').textContent = confirmationContent.copy;
      document.querySelector('[data-auth-confirmation-continue]').textContent = confirmationContent.button;
    }

    if (isSettingPassword) {
      const isChangingPassword = state.passwordFlow === 'change';
      document.getElementById('auth-password-title').textContent = isChangingPassword ? 'Passwort ändern' : 'Passwort festlegen';
      document.getElementById('auth-password-copy').textContent = isChangingPassword
        ? 'Bestätige dein aktuelles Passwort und lege ein neues mit mindestens 8 Zeichen fest.'
        : 'Lege ein persönliches Passwort mit mindestens 8 Zeichen fest.';
      const currentPasswordField = document.querySelector('[data-current-password-field]');
      const currentPasswordInput = currentPasswordField?.querySelector('input');
      if (currentPasswordField) currentPasswordField.hidden = !isChangingPassword;
      if (currentPasswordInput) currentPasswordInput.required = isChangingPassword;
      const cancelButton = document.querySelector('[data-password-change-cancel]');
      if (cancelButton) cancelButton.hidden = !isChangingPassword;
    }

    const dialog = document.getElementById('auth-dialog');
    dialog?.setAttribute('aria-labelledby', isConfirmingLink
      ? 'auth-confirmation-title'
      : isSettingPassword ? 'auth-password-title' : isLoggedIn ? 'account-display-name' : 'auth-dialog-title');

    if (isLoggedIn) {
      document.getElementById('account-display-name').textContent = displayName;
      document.getElementById('account-email').textContent = state.session.user.email || '';
      const playerArea = document.getElementById('account-player-area');
      if (playerArea) playerArea.hidden = !isPlayerAccount() || !state.extendedPlayerFeatures;
      const trainingButton = document.querySelector('[data-training-toggle]');
      if (trainingButton) trainingButton.disabled = state.playerToolsLoading || !state.playerToolsReady;
      const resultScopeToggle = document.querySelector('[data-account-result-scope-toggle]');
      if (resultScopeToggle) {
        resultScopeToggle.hidden = state.profile?.app_role !== 'admin';
        resultScopeToggle.querySelectorAll('[data-account-result-scope]').forEach(button => {
          const isActive = button.dataset.accountResultScope === state.resultTaskScope;
          button.classList.toggle('active', isActive);
          button.setAttribute('aria-pressed', String(isActive));
        });
      }
      const gamesEmpty = document.getElementById('account-games-empty');
      if (gamesEmpty) gamesEmpty.hidden = isPlayerAccount() && state.extendedPlayerFeatures;
      const inviteButton = document.getElementById('player-invite-open');
      if (inviteButton) inviteButton.hidden = state.profile?.app_role !== 'admin';
      const playerProfileButton = document.querySelector('[data-account-player-profile]');
      if (playerProfileButton) {
        playerProfileButton.hidden = !isPlayerAccount();
        if (state.profile?.player_id) playerProfileButton.dataset.playerId = state.profile.player_id;
        else delete playerProfileButton.dataset.playerId;
      }
      const settingsButton = document.querySelector('[data-account-settings]');
      const settingsPanel = document.querySelector('[data-account-settings-panel]');
      if (settingsButton) settingsButton.setAttribute('aria-expanded', String(state.settingsOpen));
      if (settingsPanel) settingsPanel.hidden = !state.settingsOpen;
      document.querySelectorAll('[data-email-notification]').forEach(input => {
        const key = input.dataset.emailNotification;
        input.checked = Boolean(state.notificationPreferences[key]);
        input.disabled = !state.notificationPreferencesReady || !state.notificationPreferencesAvailable;
      });
      const settingsMessage = document.querySelector('[data-account-settings-message]');
      if (settingsMessage && !state.notificationPreferencesAvailable) {
        settingsMessage.textContent = 'Die E-Mail-Einstellungen sind gerade nicht verfügbar.';
        settingsMessage.className = 'auth-message account-settings-message error';
      }
    }
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

  function formatMatchAt(value) {
    const { date, time } = getBerlinMatchAtParts(value);
    return formatTaskDate(date, time);
  }

  function getTodayInputValue() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function getResultFormDate(task) {
    return getBerlinMatchAtParts(task.proposed_match_at || task.match_at).date || getTodayInputValue();
  }

  function getResultFormTime(task) {
    const stored = getBerlinMatchAtParts(task.proposed_match_at || task.match_at).time;
    if (stored) return stored;
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  const UNCHANGED_PROPOSAL_MESSAGE = 'Das entspricht dem bestehenden Vorschlag. Bitte bestätige das Ergebnis stattdessen.';

  function isUnchangedResultProposal(task, resultDetails, actualSets, winner, playedOn, playedTime) {
    if (!task || task.task_type !== 'review') return false;
    const proposedTime = getBerlinMatchAtParts(task.proposed_match_at);
    return String(task.proposed_result || '').trim() === String(resultDetails || '').trim()
      && String(task.proposed_sets || '') === String(actualSets || '')
      && Number(task.proposed_winner) === Number(winner)
      && proposedTime.date === playedOn
      && proposedTime.time === String(playedTime || '').slice(0, 5);
  }

  function getTaskNumber(task) {
    return task.match_id.match(/\d+$/)?.[0] || task.match_id;
  }

  function getTaskMatchLabel(task) {
    if (task.display_label) return task.display_label;
    const number = getTaskNumber(task);
    switch (task.competition_stage) {
      case 'quarterfinal': return `Viertelfinale ${number}`;
      case 'semifinal': return `Halbfinale ${number}`;
      case 'final_four': return `Final Four ${number}`;
      case 'final': return 'Finale';
      default: return `Partie ${number}`;
    }
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
    return `<div class="score-counter-pair">
      ${[1, 2].map((team, teamIndex) => `<div class="score-counter-field">
        <button class="score-counter-step" type="button" tabindex="-1" data-result-score-step="-1" aria-label="${label}, Team ${team}: eins abziehen"${disabled ? ' disabled' : ''}>−</button>
        <input
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="2"
          autocomplete="off"
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
        <button class="score-counter-step" type="button" tabindex="-1" data-result-score-step="1" aria-label="${label}, Team ${team}: eins addieren"${disabled ? ' disabled' : ''}>+</button>
      </div>`).join('<span class="score-counter-separator">:</span>')}
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

  function renderResultForm(task, counter = false, collapsed = false, allowUnschedule = false, allowCancel = false) {
    const initialResult = counter ? task.proposed_result : '';
    const matchFormat = task.match_format || 'best-of-three';
    return `<form class="result-entry-form ${counter ? 'is-counterproposal' : ''}" data-result-submit="${escapeHtml(task.match_id)}" data-result-format="${escapeHtml(matchFormat)}" ${counter || collapsed ? 'hidden' : ''}>
      <div class="result-entry-timing">
        <label>
          <span>Datum</span>
          <span class="datetime-input-shell" data-datetime-field data-datetime-hint="TT.MM.JJJJ"><input type="date" name="playedOn" required max="${getTodayInputValue()}" value="${escapeHtml(getResultFormDate(task))}"></span>
        </label>
        <label>
          <span>Uhrzeit</span>
          <span class="datetime-input-shell" data-datetime-field data-datetime-hint="--:--"><input type="time" name="playedTime" required value="${escapeHtml(getResultFormTime(task))}"></span>
        </label>
      </div>
      ${renderScoreCounters(initialResult, matchFormat)}
      <div class="result-entry-actions">
        <div class="result-entry-summary" data-result-summary aria-live="polite">Satzergebnis wird automatisch berechnet.</div>
        <div class="result-entry-buttons">
          ${allowCancel ? renderCancelMatchButton(task) : ''}
          ${allowUnschedule ? `<button class="secondary-button" type="button" data-match-unschedule="${escapeHtml(task.match_id)}">Termin löschen</button>` : ''}
          <button class="primary-button" type="submit">${state.profile?.app_role === 'admin' ? 'Ergebnis eintragen' : counter ? 'Alternative senden' : 'Zur Bestätigung senden'}</button>
        </div>
      </div>
    </form>`;
  }

  function renderScheduleForm(task, collapsed = false, allowCancel = false) {
    const matchTime = getBerlinMatchAtParts(task.match_at);
    return `<form class="match-schedule-form" data-match-schedule="${escapeHtml(task.match_id)}" ${collapsed ? 'hidden' : ''}>
      <div class="result-entry-timing">
        <label>
          <span>Datum</span>
          <span class="datetime-input-shell" data-datetime-field data-datetime-hint="TT.MM.JJJJ"><input type="date" name="scheduledDate" required value="${escapeHtml(matchTime.date || '')}"></span>
        </label>
        <label>
          <span>Uhrzeit</span>
          <span class="datetime-input-shell" data-datetime-field data-datetime-hint="--:--"><input type="time" name="scheduledTime" required value="${escapeHtml(matchTime.time || '')}"></span>
        </label>
      </div>
      <div class="racket-check" data-racket-check role="status" aria-live="polite" hidden></div>
      <div class="match-schedule-actions">
        ${allowCancel ? renderCancelMatchButton(task) : ''}
        <button class="secondary-button" type="submit">${task.match_at ? 'Termin speichern' : 'Terminieren'}</button>
      </div>
    </form>`;
  }

  function renderResultTaskStatus(task) {
    if (task.task_type === 'completed') return '<span class="account-task-status is-complete">Bestätigt</span>';
    if (task.task_type === 'waiting') return '<span class="account-task-status">Auf Bestätigung warten</span>';
    if (task.task_type === 'review') return '<span class="account-task-status is-open">Zu bestätigen</span>';
    return isResultTaskOpen(task)
      ? '<span class="account-task-status is-open">Offen</span>'
      : `<span class="account-task-status">${task.match_at ? 'Terminiert' : 'Geplant'}</span>`;
  }

  function renderCancelMatchButton(task) {
    if (state.profile?.app_role !== 'admin' || task.competition_stage !== 'league') return '';
    return `<button class="secondary-button match-cancel-button" type="button" data-match-cancel="${escapeHtml(task.match_id)}">Nicht werten</button>`;
  }

  function renderProposedResult(task, ownProposal = false) {
    return `<div class="result-proposal">
      <span>${ownProposal ? 'Dein Vorschlag' : 'Vorschlag des anderen Teams'}<br>${escapeHtml(formatMatchAt(task.proposed_match_at))}</span>
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
    if (window.PadelLiveTicker?.isMatchLive(task.match_id)) {
      return `<div class="result-proposal">
          <span>Diese Partie wird gerade im Liveticker geführt.</span>
          <strong>LIVE</strong>
        </div>
        <div class="account-task-actions">
          <button class="secondary-button" type="button" data-live-open-match="${escapeHtml(task.match_id)}">Liveticker öffnen</button>
        </div>`;
    }
    if (task.task_type === 'waiting') {
      return `${renderProposedResult(task, true)}
        <div class="account-task-actions"><span class="account-waiting">Auf Bestätigung warten</span></div>`;
    }
    if (task.task_type === 'review') {
      return `${renderProposedResult(task)}
        <div class="account-task-actions result-review-actions">
          <button class="secondary-button" type="button" data-counterproposal-toggle="${escapeHtml(task.match_id)}">Alternative eingeben</button>
          <button class="primary-button" type="button" data-result-confirm="${task.proposal_id}">Ergebnis bestätigen</button>
        </div>
        ${renderResultForm(task, true)}`;
    }
    if (groupKey === 'planned') {
      return renderScheduleForm(task, false, true);
    }
    if (groupKey === 'future') {
      return `<div class="account-task-actions scheduled-result-actions">
          ${renderCancelMatchButton(task)}
          <button class="secondary-button" type="button" data-match-unschedule="${escapeHtml(task.match_id)}">Termin löschen</button>
          <button class="secondary-button" type="button" data-match-schedule-toggle="${escapeHtml(task.match_id)}">Termin ändern</button>
        </div>
        ${renderResultForm(task, false, true)}
        ${renderScheduleForm(task, true)}`;
    }
    if (groupKey === 'past') {
      return renderResultForm(task, false, false, true, true);
    }
    return renderResultForm(task, false, false, false, true);
  }

  function renderResultTaskCard(task, groupKey) {
    const isActionable = task.task_type === 'review' || groupKey === 'past';
    const isWaiting = task.task_type === 'waiting';
    const hasAuthenticatedPlayer = [1, 2].includes(Number(task.my_team));
    return `<div class="result-task-wrap">
      <article class="account-task-card result-task-card${hasAuthenticatedPlayer ? ' has-authenticated-player' : ''}${isActionable ? ' is-actionable' : ''}${isWaiting ? ' is-waiting' : ''}">
        <div class="account-task-meta">
          <span class="mc-nr">${escapeHtml(getTaskLeagueLabel(task))} · ${escapeHtml(getTaskMatchLabel(task))}</span>
          ${renderResultTaskStatus(task)}
        </div>
        ${groupKey === 'future' ? `<div class="result-card-timing">${escapeHtml(formatMatchAt(task.proposed_match_at || task.match_at))}</div>
          <div class="racket-status" data-racket-status="match:${escapeHtml(task.match_id)}" hidden></div>` : ''}
        ${renderTaskMatchup(task)}
        ${renderResultTaskBody(task, groupKey)}
        ${typeof window !== 'undefined' ? window.PadelLiveTicker?.renderGameAssignment(task.match_id) || '' : ''}
      </article>
    </div>`;
  }

  function renderResultTaskGroups(target, groups, trainingTasks = []) {
    if (!target) return;
    const groupedItems = groups.map(group => {
      const items = group.tasks.map(task => ({ kind: 'league', task }));
      if (group.key === 'review') {
        trainingTasks
          .filter(task => !isScheduledTrainingTask(task))
          .forEach((task, index) => items.push({ kind: 'training', task, index }));
      }
      if (group.key === 'past') {
        trainingTasks
          .filter(task => isScheduledTrainingDue(task))
          .forEach((task, index) => items.push({ kind: 'training-scheduled', task, index }));
      }
      if (group.key === 'future') {
        trainingTasks
          .filter(task => isScheduledTrainingTask(task) && !isScheduledTrainingDue(task))
          .forEach((task, index) => items.push({ kind: 'training-scheduled', task, index }));
      }
      if (group.key !== 'planned') {
        items.sort((first, second) => {
          const getItemTimestamp = item => item.kind.startsWith('training')
            ? getTrainingTaskTimestamp(item.task)
            : getMatchAtTimestamp(item.task.match_at);
          return getItemTimestamp(first) - getItemTimestamp(second);
        });
      }
      return { ...group, items };
    });
    target.innerHTML = groupedItems
      .map(group => `<section class="account-task-group" data-result-task-group="${group.key}">
          <div class="spieltag-label"><span>${escapeHtml(group.label)}</span></div>
          ${group.items.length
            ? `<div class="account-task-list">${group.items.map(item => item.kind === 'training'
                ? renderTrainingTaskCard(item.task, item.index)
                : item.kind === 'training-scheduled'
                  ? renderScheduledTrainingTaskCard(item.task, group.key)
                : renderResultTaskCard(item.task, group.key)).join('')}</div>`
            : '<div class="account-empty">Derzeit keine Partie.</div>'}
        </section>`)
      .join('');
  }

  function renderResultTasks() {
    const target = document.getElementById('result-task-list');
    if (target && isPlayerAccount() && (state.playerToolsLoading || state.playerToolsError)) {
      target.setAttribute('aria-busy', String(state.playerToolsLoading));
      target.innerHTML = state.playerToolsLoading
        ? '<div class="account-empty" role="status">Partien werden geladen …</div>'
        : '<div class="account-empty" role="status">Partien konnten nicht geladen werden. <button class="text-link" type="button" data-account-tasks-retry>Erneut versuchen</button></div>';
      return;
    }
    target?.setAttribute('aria-busy', 'false');
    const isAdmin = state.profile?.app_role === 'admin';
    const groups = getPlayerResultTaskGroups(getVisibleResultTasks(), Date.now(), isAdmin);
    const visibleTrainingTasks = state.trainingTasks.filter(isTrainingTaskVisible);
    renderResultTaskGroups(document.getElementById('result-task-list'), groups, visibleTrainingTasks);
    visibleTrainingTasks.forEach(task => {
      if (isScheduledTrainingTask(task)) {
        const form = document.querySelector(`[data-training-scheduled="${CSS.escape(String(task.session_id))}"]`);
        if (form) {
          renderTrainingPlayerFields(task.player_ids, task.guest_names, form);
          if (isScheduledTrainingDue(task)) {
            renderTrainingRounds([], form, 1);
          }
          syncTrainingFormMode(form);
        }
        return;
      }
      if (!task.created_by_me) {
        const form = document.querySelector(`[data-training-alternative="${CSS.escape(String(task.session_id))}"]`);
        if (form) renderTrainingForm(task.player_ids, getTrainingRoundValues(task), form, task.guest_names);
      }
    });
    syncDateTimeHints(document.getElementById('result-task-list'));
    void loadRacketStatuses();
  }

  function isTrainingGuestKey(value) {
    return TRAINING_GUEST_KEY_PATTERN.test(String(value || ''));
  }

  function normalizeTrainingGuestNames(guestNames = {}) {
    if (!guestNames || typeof guestNames !== 'object' || Array.isArray(guestNames)) return {};
    return Object.fromEntries(Object.entries(guestNames)
      .filter(([key, name]) => isTrainingGuestKey(key) && String(name || '').trim())
      .map(([key, name]) => [key, String(name).trim()]));
  }

  function getTrainingGuestDisplayName(playerId, guestNames = {}, participantIds = []) {
    const normalizedGuestNames = normalizeTrainingGuestNames(guestNames);
    const guestName = normalizedGuestNames[playerId];
    if (!guestName) return null;
    const matchingGuests = (participantIds.length ? participantIds : Object.keys(normalizedGuestNames))
      .filter(id => normalizedGuestNames[id]?.toLocaleLowerCase('de-DE') === guestName.toLocaleLowerCase('de-DE'));
    const duplicateIndex = matchingGuests.indexOf(playerId);
    return matchingGuests.length > 1
      ? `${guestName} · Gast ${duplicateIndex + 1}`
      : `${guestName} · Gast`;
  }

  function getPlayerName(playerId, guestNames = {}, participantIds = []) {
    const guestDisplayName = getTrainingGuestDisplayName(playerId, guestNames, participantIds);
    if (guestDisplayName) return guestDisplayName;
    return state.players.find(player => player.id === playerId)?.display_name
      || (window.PADEL_PLAYERS || []).find(player => player.id === playerId)?.name
      || playerId;
  }

  function renderTrainingTaskTeam(playerIds = [], guestNames = {}, participantIds = []) {
    return playerIds.map(playerId => {
      const isAuthenticated = playerId === state.profile?.player_id;
      const isGuest = isTrainingGuestKey(playerId);
      return `<span class="account-task-player-name${isAuthenticated ? ' is-authenticated' : ''}${isGuest ? ' is-guest' : ''}">${escapeHtml(getPlayerName(playerId, guestNames, participantIds))}</span>`;
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
    const regularResult = renderedSets.join('<span class="training-result-divider">,</span>');
    if (matchTiebreakPart) {
      const matchTiebreak = parseScorePair(matchTiebreakPart);
      const classification = window.PadelScoreInput.classifyTiebreak(matchTiebreak[0], matchTiebreak[1], 10);
      const className = classification.state === 'complete' ? '' : ' class="training-result-partial"';
      return `${regularResult}<span class="training-result-divider">–</span><span${className}>${escapeHtml(matchTiebreakPart)}</span>`;
    }
    return regularResult;
  }

  function renderTrainingTaskRound(task, round, roundIndex, roundCount) {
    const proposalLabel = task.created_by_me ? 'Dein Vorschlag' : 'Vorschlag des anderen Teams';
    const roundLabel = roundCount > 1 ? ` · Partie ${roundIndex + 1}` : '';
    return `<div class="training-task-round">
      <div class="account-task-matchup">
        <strong>${renderTrainingTaskTeam(round.team_one_ids, task.guest_names, task.player_ids)}</strong>
        <span>vs.</span>
        <strong>${renderTrainingTaskTeam(round.team_two_ids, task.guest_names, task.player_ids)}</strong>
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

  function readTrainingRoundValues(form = document) {
    return [...form.querySelectorAll('[data-training-round]')].map(round => {
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

  function renderTrainingPickerText(option, showMatchup = false) {
    if (showMatchup && Array.isArray(option?.teams) && option.teams.length === 2) {
      const renderTeam = (players, side) => `<span class="training-picker-team training-picker-team--${side}">
        ${players.map((player, index) => `<span class="training-picker-player">
          <span class="training-picker-player-name">${escapeHtml(player)}</span>${index === 0 ? '<span class="training-picker-separator">&amp;</span>' : ''}
        </span>`).join('')}
      </span>`;
      return `<span class="training-picker-matchup">
        ${renderTeam(option.teams[0], 'left')}
        <span class="training-picker-versus">vs.</span>
        ${renderTeam(option.teams[1], 'right')}
      </span>`;
    }
    return `<span class="training-picker-display-line">${escapeHtml(option?.label || 'Auswählen')}</span>`;
  }

  function renderTrainingPicker({ label, name, value, options, menuId, searchable = false, playerField = false }) {
    const selected = options.find(option => option.value === value) || options[0];
    const toggle = `<button class="secondary-button secondary-button--dropdown training-picker-toggle" type="button" data-training-picker-toggle aria-label="${escapeHtml(selected?.label || 'Auswählen')}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${escapeHtml(menuId)}">
        <span class="training-picker-display" data-training-picker-label>${renderTrainingPickerText(selected)}</span>
      </button>`;
    return `<div class="training-picker" data-training-picker${playerField ? ' data-training-player-field' : ''}>
      <span class="training-picker-label">${escapeHtml(label)}</span>
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(selected?.value || '')}">
      ${searchable ? `<div class="training-picker-search-control">
        ${toggle}
        <input class="training-picker-search-input" type="search" data-training-picker-search role="combobox" aria-label="${escapeHtml(label)} suchen" aria-controls="${escapeHtml(menuId)}" aria-expanded="false" autocomplete="off" spellcheck="false" placeholder="Spieler suchen …" disabled>
      </div>` : toggle}
      <div class="viewer-menu training-picker-menu" id="${escapeHtml(menuId)}" role="listbox" aria-label="${escapeHtml(label)} auswählen">
        ${options.map(option => `<button
          class="viewer-option training-picker-option${option.value === selected?.value ? ' active' : ''}"
          type="button"
          role="option"
          aria-label="${escapeHtml(option.label)}"
          aria-selected="${option.value === selected?.value}"
          data-training-picker-value="${escapeHtml(option.value)}"
          data-training-picker-search-text="${escapeHtml(option.label)} ${escapeHtml(option.meta || '')}"
          ${option.isGuestAction ? 'data-training-guest-option' : ''}
        ><span class="training-picker-option-label">${renderTrainingPickerText(option, true)}</span>${option.meta ? `<span>${escapeHtml(option.meta)}</span>` : ''}</button>`).join('')}
        ${searchable ? '<div class="picker-search-empty" data-training-picker-search-empty hidden>Kein Spieler gefunden.</div>' : ''}
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

  function getTrainingPairingOptions(form) {
    const selectedPlayerIds = getTrainingParticipantIds(form);
    const guestNames = getTrainingGuestNames(form);
    const playerLabels = Array.from({ length: 4 }, (_, index) => {
      const playerId = selectedPlayerIds[index];
      return playerId ? getPlayerName(playerId, guestNames, selectedPlayerIds) : `Spieler ${index + 1}`;
    });
    const pairingOption = (value, first, second, third, fourth) => {
      const teams = [
        [playerLabels[first], playerLabels[second]],
        [playerLabels[third], playerLabels[fourth]]
      ];
      return {
        value,
        label: `${teams[0].join(' & ')} vs. ${teams[1].join(' & ')}`,
        teams
      };
    };
    return [
      pairingOption('ab_cd', 0, 1, 2, 3),
      pairingOption('ac_bd', 0, 2, 1, 3),
      pairingOption('ad_bc', 0, 3, 1, 2)
    ];
  }

  function renderTrainingRounds(preserved = [], form = document.getElementById('training-form'), roundCount = null) {
    const target = form?.querySelector('[data-training-rounds]');
    if (!target) return;
    const pairingOptions = getTrainingPairingOptions(form);
    const resolvedRoundCount = roundCount ?? Math.max(1, preserved.length || 1);
    const menuPrefix = form.dataset.trainingAlternative
      ? `training-alternative-${form.dataset.trainingAlternative}`
      : 'training';
    const formatOptions = [
      { value: 'one_set', label: '1 Satz' },
      { value: 'two_sets', label: '2 Sätze' },
      { value: 'two_sets_match_tiebreak', label: '2 Sätze + Match-Tiebreak' },
      { value: 'three_sets', label: '3 Sätze' }
    ];
    target.innerHTML = Array.from({ length: resolvedRoundCount }, (_, index) => {
      const value = preserved[index] || { pairing: 'ab_cd', resultFormat: 'one_set', sets: [], matchTiebreak: [] };
      return `<div class="training-round-field" data-training-round="${index}">
        <div class="training-round-head">
          ${renderTrainingPicker({ label: 'Paarung', name: 'pairing', value: value.pairing, options: pairingOptions, menuId: `${menuPrefix}-pairing-menu-${index}` })}
          ${renderTrainingPicker({ label: 'Ergebnisformat', name: 'resultFormat', value: value.resultFormat, options: formatOptions, menuId: `${menuPrefix}-format-menu-${index}` })}
          <button class="training-round-remove" type="button" data-training-round-remove="${index}" aria-label="${index === 0 ? 'Trainingseingabe schließen' : `Paarung ${index + 1} entfernen`}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6 18 18M18 6 6 18"/></svg></button>
        </div>
        ${renderTrainingScoreCounters(value, value.resultFormat)}
        <div class="result-entry-summary training-round-summary" data-training-round-summary aria-live="polite">Satzergebnis wird automatisch berechnet.</div>
      </div>`;
    }).join('');
    target.querySelectorAll('[data-training-round]').forEach(updateTrainingRoundSummary);
  }

  function isTestTrainingPlayer(player) {
    return ['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'test_net'].includes(String(player?.id || ''));
  }

  function getSelectableTrainingPlayers(players = state.players, profile = state.profile) {
    const authenticatedPlayer = players.find(player => String(player.id) === String(profile?.player_id));
    const canSeeTestPlayers = profile?.app_role === 'admin' || isTestTrainingPlayer(authenticatedPlayer);
    return canSeeTestPlayers ? players : players.filter(player => !isTestTrainingPlayer(player));
  }

  function getTrainingParticipantIds(form = document) {
    return [...form.querySelectorAll('[data-training-player-fields] [name="playerId"]')]
      .map(input => String(input.value || ''));
  }

  function getTrainingGuestNames(form = document) {
    return Object.fromEntries([...form.querySelectorAll('[data-training-guest-name]')]
      .map(input => [String(input.dataset.trainingGuestName), String(input.value || '').trim()])
      .filter(([key, name]) => isTrainingGuestKey(key) && name));
  }

  function renderTrainingGuestField(label, playerId, guestName = '') {
    return `<div class="training-picker training-guest-field" data-training-player-field>
      <span class="training-picker-label">${escapeHtml(label)}</span>
      <input type="hidden" name="playerId" value="${escapeHtml(playerId)}">
      <div class="training-guest-control">
        <span class="training-guest-badge">Gast</span>
        <input
          class="training-guest-name-input"
          type="text"
          name="guestName"
          value="${escapeHtml(guestName)}"
          minlength="2"
          maxlength="40"
          required
          autocomplete="off"
          placeholder="Name des Gastes"
          aria-label="${escapeHtml(label)}: Name des Gastes"
          data-training-guest-name="${escapeHtml(playerId)}"
        >
        <button class="training-guest-remove" type="button" data-training-guest-remove aria-label="Gast entfernen und Spieler auswählen">×</button>
      </div>
    </div>`;
  }

  function renderTrainingPlayerFields(playerIds = null, guestNames = {}, form = document.getElementById('training-form')) {
    const target = form?.querySelector('[data-training-player-fields]');
    if (!target || !state.players.length) return;
    const selectablePlayers = getSelectableTrainingPlayers();
    const normalizedGuestNames = normalizeTrainingGuestNames(guestNames);
    const menuPrefix = form.dataset.trainingAlternative
      ? `training-alternative-${form.dataset.trainingAlternative}`
      : 'training';
    target.innerHTML = Array.from({ length: 4 }, (_, index) => {
      const selectedId = playerIds?.[index] || (index === 0 ? state.profile?.player_id || '' : '');
      if (isTrainingGuestKey(selectedId)) {
        return renderTrainingGuestField(`Spieler ${index + 1}`, selectedId, normalizedGuestNames[selectedId] || '');
      }
      return renderTrainingPicker({
        label: `Spieler ${index + 1}`,
        name: 'playerId',
        value: selectedId,
        options: [
          { value: '', label: 'Auswählen' },
          ...selectablePlayers.map(player => ({ value: player.id, label: player.display_name, meta: player.initials || '' })),
          { value: TRAINING_GUEST_OPTION, label: '+ Gast hinzufügen', meta: 'Name eingeben', isGuestAction: true }
        ],
        menuId: `${menuPrefix}-player-menu-${index}`,
        searchable: true,
        playerField: true
      });
    }).join('');
  }

  function renderTrainingForm(playerIds = null, roundValues = [], form = document.getElementById('training-form'), guestNames = {}) {
    renderTrainingPlayerFields(playerIds, guestNames, form);
    renderTrainingRounds(roundValues, form, Math.max(1, roundValues.length || 1));
    syncTrainingFormMode(form);
  }

  function getTrainingFormTimestamp(form) {
    const dateValue = String(form?.querySelector('[name="playedOn"]')?.value || '');
    const timeValue = String(form?.querySelector('[name="displayTime"]')?.value || '');
    if (!dateValue || !timeValue) return NaN;
    return getMatchAtTimestamp(`${dateValue}T${timeValue}:00`, NaN);
  }

  function syncTrainingFormMode(form) {
    if (!form || form.dataset.trainingAlternative) return;
    const timestamp = getTrainingFormTimestamp(form);
    const hasCompleteTime = Number.isFinite(timestamp);
    const schedulesFuture = hasCompleteTime && timestamp > Date.now();
    const resultFields = form.querySelector('[data-training-result-fields]');
    if (resultFields) resultFields.hidden = !hasCompleteTime || schedulesFuture;
    if (hasCompleteTime && !schedulesFuture && !form.querySelector('[data-training-round]')) {
      renderTrainingRounds([], form, 1);
    }
    form.dataset.trainingMode = schedulesFuture ? 'scheduled' : 'result';
    scheduleRacketCheck(form);
    const submit = form.querySelector('[type="submit"]');
    if (!submit) return;
    if (schedulesFuture) submit.textContent = form.dataset.trainingScheduled ? 'Termin speichern' : 'Training terminieren';
    else submit.textContent = state.profile?.app_role === 'admin' ? 'Training eintragen' : 'Zur Bestätigung senden';
  }

  function closeTrainingPickerMenus(exceptPicker = null) {
    document.querySelectorAll('[data-training-picker].open').forEach(picker => {
      if (picker === exceptPicker) return;
      picker.classList.remove('open');
      picker.querySelector('[data-training-picker-toggle]')?.setAttribute('aria-expanded', 'false');
      const searchInput = picker.querySelector('[data-training-picker-search]');
      if (searchInput) {
        searchInput.value = '';
        searchInput.setAttribute('aria-expanded', 'false');
        searchInput.blur();
        searchInput.disabled = true;
        filterTrainingPlayerOptions(picker);
      }
    });
  }

  function normalizeTrainingPlayerSearch(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('de-DE');
  }

  function filterTrainingPlayerOptions(picker, query = '') {
    if (!picker) return;
    const normalizedQuery = normalizeTrainingPlayerSearch(query);
    let visibleOptions = 0;
    picker.querySelectorAll('[data-training-picker-value]').forEach(option => {
      const matches = option.hasAttribute('data-training-guest-option') || !normalizedQuery
        || normalizeTrainingPlayerSearch(option.dataset.trainingPickerSearchText).includes(normalizedQuery);
      option.hidden = !matches;
      if (matches) visibleOptions += 1;
    });
    const emptyState = picker.querySelector('[data-training-picker-search-empty]');
    if (emptyState) emptyState.hidden = visibleOptions > 0;
  }

  function keepTrainingPickerSearchVisible(searchInput) {
    if (!searchInput || !window.matchMedia('(max-width: 768px)').matches) return;
    const alignInput = () => {
      if (document.activeElement !== searchInput) return;
      const viewportTop = window.visualViewport?.offsetTop || 0;
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const targetOffset = Math.min(200, Math.max(80, viewportHeight * 0.4));
      const scrollDelta = searchInput.getBoundingClientRect().top - viewportTop - targetOffset;
      if (Math.abs(scrollDelta) < 8) return;

      let scrollParent = searchInput.parentElement;
      while (scrollParent && scrollParent !== document.body) {
        const { overflowY } = window.getComputedStyle(scrollParent);
        if (/(auto|scroll|overlay)/.test(overflowY)
          && scrollParent.scrollHeight > scrollParent.clientHeight) break;
        scrollParent = scrollParent.parentElement;
      }

      const scrollTarget = scrollParent && scrollParent !== document.body ? scrollParent : window;
      scrollTarget.scrollBy({ top: scrollDelta, behavior: 'smooth' });
    };

    requestAnimationFrame(alignInput);
    window.setTimeout(alignInput, 350);
  }

  function setTrainingPickerValue(picker, value) {
    if (!picker) return;
    const input = picker.querySelector('input[type="hidden"]');
    const label = picker.querySelector('[data-training-picker-label]');
    const selectedOption = [...picker.querySelectorAll('[data-training-picker-value]')]
      .find(option => option.dataset.trainingPickerValue === value);
    if (input) input.value = selectedOption ? value : '';
    if (label) {
      const selectedLabel = selectedOption?.getAttribute('aria-label') || 'Auswählen';
      label.innerHTML = renderTrainingPickerText({ label: selectedLabel });
      label.closest('[data-training-picker-toggle]')?.setAttribute('aria-label', selectedLabel);
    }
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
    const searchInput = picker.querySelector('[data-training-picker-search]');
    if (searchInput) {
      searchInput.setAttribute('aria-expanded', String(shouldOpen));
      if (shouldOpen) {
        searchInput.disabled = false;
        searchInput.value = '';
        filterTrainingPlayerOptions(picker);
        searchInput.focus({ preventScroll: true });
        keepTrainingPickerSearchVisible(searchInput);
      } else {
        searchInput.blur();
        searchInput.disabled = true;
      }
    }
  }

  function selectTrainingPickerOption(option) {
    const picker = option.closest('[data-training-picker]');
    const restoreToggleFocus = picker?.classList.contains('open');
    const form = picker?.closest('.training-form');
    const inputName = picker?.querySelector('input[type="hidden"]')?.name;
    if (form && inputName === 'playerId' && option.dataset.trainingPickerValue === TRAINING_GUEST_OPTION) {
      const preservedRounds = readTrainingRoundValues(form);
      const participantIds = getTrainingParticipantIds(form);
      const guestNames = getTrainingGuestNames(form);
      const playerFields = [...form.querySelectorAll('[data-training-player-fields] [data-training-player-field]')];
      const playerIndex = playerFields.indexOf(picker);
      const guestKey = `guest:${playerIndex + 1}`;
      const searchedName = String(picker.querySelector('[data-training-picker-search]')?.value || '').trim();
      participantIds[playerIndex] = guestKey;
      guestNames[guestKey] = searchedName;
      closeTrainingPickerMenus();
      renderTrainingPlayerFields(participantIds, guestNames, form);
      renderTrainingRounds(preservedRounds, form, preservedRounds.length);
      form.querySelector(`[data-training-guest-name="${CSS.escape(guestKey)}"]`)?.focus();
      setTrainingMessage('', '', form);
      return;
    }
    setTrainingPickerValue(picker, option.dataset.trainingPickerValue);
    closeTrainingPickerMenus();
    if (form && (inputName === 'resultFormat' || inputName === 'playerId')) {
      const preserved = readTrainingRoundValues(form);
      renderTrainingRounds(preserved, form, preserved.length);
    }
    if (restoreToggleFocus) {
      picker.querySelector('[data-training-picker-toggle]')?.focus({ preventScroll: true });
    }
    setTrainingMessage('', '', form);
  }

  function getTrainingRoundValues(task) {
    return (task.rounds || []).map(round => {
      const [a, b, c, d] = task.player_ids;
      const teamOne = new Set(round.team_one_ids);
      const pairing = teamOne.has(a) && teamOne.has(c) ? 'ac_bd' : teamOne.has(a) && teamOne.has(d) ? 'ad_bc' : 'ab_cd';
      const resultFormat = getTrainingRoundFormat(round);
      return { pairing, resultFormat, ...parseTrainingResultValues(round.result_details, resultFormat) };
    });
  }

  function renderTrainingAlternativeForm(task) {
    return `<form class="training-form training-alternative-form" data-training-alternative="${escapeHtml(task.session_id)}" hidden>
      <div class="training-form-meta">
        <label><span>Datum</span><span class="datetime-input-shell" data-datetime-field data-datetime-hint="TT.MM.JJJJ"><input type="date" name="playedOn" required value="${escapeHtml(task.played_on)}"></span></label>
        <label><span>Uhrzeit</span><span class="datetime-input-shell" data-datetime-field data-datetime-hint="--:--"><input type="time" name="displayTime" required value="${escapeHtml(String(task.display_time).slice(0, 5))}"></span></label>
      </div>
      <div class="training-player-fields" data-training-player-fields></div>
      <div class="training-rounds" data-training-rounds></div>
      <div class="auth-message training-message" data-training-message role="status" aria-live="polite"></div>
      <button class="secondary-button" type="button" data-training-round-add>Weitere Paarung</button>
      <button class="primary-button" type="submit">${state.profile?.app_role === 'admin' ? 'Training eintragen' : 'Alternative senden'}</button>
    </form>`;
  }

  function renderTrainingParticipants(task) {
    return `<div class="training-task-participants">${task.player_ids.map(playerId => {
      const name = getPlayerName(playerId, task.guest_names, task.player_ids);
      const isAuthenticated = playerId === state.profile?.player_id;
      const isGuest = isTrainingGuestKey(playerId);
      return `<span class="account-task-player-name${isAuthenticated ? ' is-authenticated' : ''}${isGuest ? ' is-guest' : ''}">${escapeHtml(name)}</span>`;
    }).join('')}</div>`;
  }

  function renderScheduledTrainingForm(task, due) {
    const canManage = task.created_by_me || state.profile?.app_role === 'admin';
    return `<form class="training-form training-alternative-form scheduled-training-form${due ? ' is-result-entry' : ''}" data-training-scheduled="${escapeHtml(task.session_id)}" ${due ? '' : 'hidden'}>
      <div class="training-form-meta">
        <label><span>Datum</span><span class="datetime-input-shell" data-datetime-field data-datetime-hint="TT.MM.JJJJ"><input type="date" name="playedOn" required value="${escapeHtml(task.played_on)}"></span></label>
        <label><span>Uhrzeit</span><span class="datetime-input-shell" data-datetime-field data-datetime-hint="--:--"><input type="time" name="displayTime" required value="${escapeHtml(String(task.display_time).slice(0, 5))}"></span></label>
      </div>
      <div class="racket-check" data-racket-check role="status" aria-live="polite" hidden></div>
      <div class="training-player-fields" data-training-player-fields></div>
      <div class="training-result-fields" data-training-result-fields ${due ? '' : 'hidden'}>
        <div class="training-rounds" data-training-rounds></div>
        <button class="secondary-button" type="button" data-training-round-add>Weitere Paarung</button>
      </div>
      <div class="auth-message training-message" data-training-message role="status" aria-live="polite"></div>
      <div class="training-form-actions">
        ${canManage ? `<button class="secondary-button" type="button" data-training-delete="${escapeHtml(task.session_id)}">Training löschen</button>` : ''}
        <button class="primary-button" type="submit">${due
          ? state.profile?.app_role === 'admin' ? 'Ergebnis eintragen' : 'Zur Bestätigung senden'
          : 'Termin speichern'}</button>
      </div>
    </form>`;
  }

  function renderScheduledTrainingTaskCard(task, groupKey) {
    const due = groupKey === 'past';
    const canManage = task.created_by_me || state.profile?.app_role === 'admin';
    const hasAuthenticatedPlayer = Boolean(state.profile?.player_id && task.player_ids.includes(state.profile.player_id));
    return `<article class="account-task-card training-task-card scheduled-training-card${hasAuthenticatedPlayer ? ' has-authenticated-player' : ''}${due ? ' is-actionable' : ''}">
      <div class="account-task-meta">
        <span class="mc-nr">Training · Partie ${escapeHtml(task.training_number || task.session_id)}</span>
        <span class="account-task-status${due ? ' is-open' : ''}">${due ? 'Ergebnis eintragen' : 'Terminiert'}</span>
      </div>
      ${due ? '' : `<div class="result-card-timing">${escapeHtml(formatTaskDate(task.played_on, task.display_time))}</div>
      <div class="racket-status" data-racket-status="training:${escapeHtml(task.session_id)}" hidden></div>`}
      ${due ? '' : renderTrainingParticipants(task)}
      ${!due && canManage ? `<div class="account-task-actions">
        <button class="secondary-button" type="button" data-training-schedule-toggle="${escapeHtml(task.session_id)}">Termin ändern</button>
      </div>` : ''}
      ${renderScheduledTrainingForm(task, due)}
    </article>`;
  }

  function renderTrainingTaskCard(task, index) {
    const rounds = Array.isArray(task.rounds) ? task.rounds : [];
    const hasAuthenticatedPlayer = Boolean(state.profile?.player_id && task.player_ids.includes(state.profile.player_id));
    return `<article class="account-task-card training-task-card${hasAuthenticatedPlayer ? ' has-authenticated-player' : ''}${task.created_by_me ? ' is-waiting' : ' is-actionable'}">
      <div class="account-task-meta">
        <span class="mc-nr">Training · Partie ${escapeHtml(task.training_number || index + 1)}</span>
        <span class="account-task-status${task.created_by_me ? '' : ' is-open'}">${task.created_by_me ? 'Auf Bestätigung warten' : 'Zu bestätigen'}</span>
      </div>
      <div class="training-task-rounds">${rounds.map((round, roundIndex) => renderTrainingTaskRound(task, round, roundIndex, rounds.length)).join('')}</div>
      <div class="account-task-actions${task.created_by_me ? '' : ' result-review-actions'}">
        ${task.created_by_me
          ? '<span class="account-waiting">Auf Bestätigung warten</span>'
          : `<button class="secondary-button" type="button" data-training-edit="${task.session_id}">Alternative eingeben</button>
          <button class="primary-button" type="button" data-training-confirm="${task.session_id}">Training bestätigen</button>`}
      </div>
      ${task.created_by_me ? '' : renderTrainingAlternativeForm(task)}
    </article>`;
  }

  async function loadProfile() {
    state.profile = null;
    if (!state.session?.user) {
      publishAuthenticatedPlayer();
      return;
    }
    const userId = state.session.user.id;

    const profileResponse = await state.client
      .from('profiles')
      .select('id, display_name, player_id, app_role, players(display_name)')
      .eq('id', userId)
      .single();
    if (state.session?.user?.id !== userId) return;

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
      .eq('id', userId)
      .single();
    if (state.session?.user?.id !== userId) return;
    if (legacyResponse.error) throw legacyResponse.error;

    state.extendedPlayerFeatures = false;
    state.profile = {
      ...legacyResponse.data,
      app_role: legacyResponse.data.player_id ? 'player' : 'tipper'
    };
    publishAuthenticatedPlayer();
  }

  async function loadNotificationPreferences() {
    state.notificationPreferencesReady = false;
    state.notificationPreferencesAvailable = true;
    if (!state.session?.user) return;
    const { data, error } = await state.client.rpc('get_my_email_notification_preferences');
    if (error) {
      state.notificationPreferencesAvailable = false;
      console.error('E-Mail-Einstellungen konnten nicht geladen werden:', error);
      return;
    }
    state.notificationPreferences = {
      resultEntry: data?.resultEntry !== false,
      resultConfirmation: data?.resultConfirmation !== false,
      predictionReminder: data?.predictionReminder !== false
    };
    state.notificationPreferencesReady = true;
  }

  function hasCompleteMatchLineup(match) {
    const players = match?.match_players || [];
    return players.length === 4
      && players.every(player => player.player_id)
      && new Set(players.map(player => player.player_id)).size === 4
      && players.filter(player => Number(player.team) === 1).length === 2
      && players.filter(player => Number(player.team) === 2).length === 2;
  }

  async function loadPlayerTools() {
    const version = state.playerToolsVersion;
    state.resultTasks = [];
    state.trainingTasks = [];
    state.players = [];
    if (!isPlayerAccount() || !state.extendedPlayerFeatures) return;

    const [playersResponse, resultResponse, trainingTaskResponse] = await Promise.all([
      state.client.from('players').select('id, display_name, initials, company').order('display_name'),
      state.client.rpc('get_my_result_tasks', { p_season_id: null }),
      state.client.rpc('get_my_training_tasks')
    ]);
    if (state.playerToolsVersion !== version) return;
    const error = playersResponse.error || resultResponse.error || trainingTaskResponse.error;
    if (error) throw error;
    const resultTasks = resultResponse.data || [];
    let completeResultTasks = [];
    if (resultTasks.length) {
      const { data: taskMatches, error: taskMatchesError } = await state.client
        .from('matches')
        .select('id, display_label, match_players(player_id, team)')
        .in('id', resultTasks.map(task => task.match_id));
      if (taskMatchesError) throw taskMatchesError;
      if (state.playerToolsVersion !== version) return;
      const matchesById = new Map((taskMatches || []).map(match => [match.id, match]));
      completeResultTasks = resultTasks
        .filter(task => hasCompleteMatchLineup(matchesById.get(task.match_id)))
        .map(task => ({
          ...task,
          display_label: matchesById.get(task.match_id).display_label
        }));
    }
    state.players = playersResponse.data || [];
    state.resultTasks = completeResultTasks;
    state.trainingTasks = trainingTaskResponse.data || [];
    renderTrainingForm();
  }

  function resetPlayerTools() {
    state.playerToolsVersion += 1;
    state.playerToolsReady = false;
    state.playerToolsLoading = false;
    state.playerToolsError = null;
    state.resultTaskScope = 'relevant';
    state.resultTasks = [];
    state.trainingTasks = [];
    state.players = [];
    playerToolsPromise = null;
    window.clearTimeout(playerToolsTimer);
    playerToolsTimer = null;
  }

  function refreshPlayerTools({ force = false } = {}) {
    if (!isPlayerAccount() || !state.extendedPlayerFeatures) return Promise.resolve();
    window.clearTimeout(playerToolsTimer);
    playerToolsTimer = null;
    if (playerToolsPromise) return playerToolsPromise;
    if (state.playerToolsReady && !force) return Promise.resolve();
    const version = state.playerToolsVersion;
    state.playerToolsLoading = true;
    state.playerToolsError = null;
    render();
    const request = Promise.all([loadPlayerTools(), window.PadelLiveTicker?.refreshAccount()])
      .then(() => {
        if (state.playerToolsVersion === version) state.playerToolsReady = true;
      })
      .catch(error => {
        if (state.playerToolsVersion !== version) return;
        state.playerToolsError = error.message || 'Partien konnten nicht geladen werden.';
        console.error('Partien konnten nicht geladen werden:', error);
      })
      .finally(() => {
        if (playerToolsPromise !== request) return;
        playerToolsPromise = null;
        state.playerToolsLoading = false;
        render();
      });
    playerToolsPromise = request;
    return request;
  }

  function schedulePlayerTools() {
    if (!isPlayerAccount() || state.playerToolsReady || playerToolsPromise || playerToolsTimer !== null) return;
    // Keep the header badge current without competing with the initial page load.
    playerToolsTimer = window.setTimeout(() => {
      playerToolsTimer = null;
      void refreshPlayerTools();
    }, 1500);
  }


  function render() {
    renderAuthState();
    renderResultTasks();
  }

  function publishAuthState() {
    window.dispatchEvent(new CustomEvent('padel:auth-state-changed', {
      detail: { session: state.session, profile: state.profile }
    }));
  }

  async function refresh({ includeTasks = Boolean(document.getElementById('auth-dialog')?.open) } = {}) {
    if (!state.client) return;
    const userId = state.session?.user?.id;
    try {
      await loadProfile();
      if (state.session?.user?.id !== userId) return;
      await loadNotificationPreferences();
      if (state.session?.user?.id !== userId) return;
      publishAuthState();
      if (includeTasks) await refreshPlayerTools({ force: true });
      else schedulePlayerTools();
      state.ready = true;
      state.error = null;
    } catch (error) {
      state.error = error.message || 'Unbekannter Fehler';
      console.error('Konto konnte nicht geladen werden:', error);
    }
    render();
  }



  function clearAccountMessageTimer() {
    if (accountMessageTimer === null) return;
    window.clearTimeout?.(accountMessageTimer);
    accountMessageTimer = null;
  }

  function dismissAccountMessage() {
    clearAccountMessageTimer();
    const target = document.getElementById('account-auth-message');
    if (!target) return;
    const text = target.querySelector('[data-account-auth-message-text]');
    if (text) text.textContent = '';
    target.className = 'auth-message account-auth-message';
    target.hidden = true;
  }

  function setAuthMessage(message, type = '') {
    clearAccountMessageTimer();
    const accountMessageIsVisible = Boolean(state.session?.user)
      && !['invite', 'recovery', 'change'].includes(state.passwordFlow)
      && !state.confirmationUrl;
    const authTarget = document.getElementById('auth-message');
    const accountTarget = document.getElementById('account-auth-message');
    const accountText = accountTarget?.querySelector('[data-account-auth-message-text]');

    if (authTarget) {
      authTarget.textContent = accountMessageIsVisible ? '' : message || '';
      authTarget.className = `auth-message${!accountMessageIsVisible && type ? ` ${type}` : ''}`;
    }

    if (!accountMessageIsVisible || !message) {
      dismissAccountMessage();
      return;
    }

    if (accountText) accountText.textContent = message;
    accountTarget.className = `auth-message account-auth-message${type ? ` ${type}` : ''}`;
    accountTarget.hidden = false;

    if (type === 'success') {
      accountMessageTimer = window.setTimeout(dismissAccountMessage, ACCOUNT_SUCCESS_MESSAGE_DURATION);
    }
  }

  function setAuthMode(mode) {
    state.authMode = mode === 'signup' ? 'signup' : 'login';
    document.querySelectorAll('[data-auth-mode]').forEach(button => {
      button.classList.toggle('active', button.dataset.authMode === state.authMode);
    });
    const passwordInput = document.querySelector('#auth-form [name="password"]');
    if (passwordInput) passwordInput.autocomplete = state.authMode === 'signup' ? 'new-password' : 'current-password';
    const resetButton = document.getElementById('auth-password-reset');
    if (resetButton) resetButton.hidden = state.authMode === 'signup';
    document.getElementById('auth-dialog-title').textContent = state.authMode === 'signup' ? 'Konto erstellen' : 'Einloggen';
    document.getElementById('auth-submit').textContent = state.authMode === 'signup' ? 'Konto erstellen' : 'Einloggen';
    setAuthMessage(state.authMode === 'signup' ? 'Die Registrierung ist nur mit einer freigegebenen Firmen-E-Mail möglich.' : '');
  }

  function openAuthDialog() {
    const dialog = document.getElementById('auth-dialog');
    renderAuthState();
    setAuthMessage(state.authMode === 'signup' ? 'Die Registrierung ist nur mit einer freigegebenen Firmen-E-Mail möglich.' : '');
    if (!dialog.open) dialog.showModal();
    void init().then(() => {
      if (dialog.open) return refreshPlayerTools({ force: true });
    });
  }

  function closeAuthDialog() {
    document.getElementById('auth-dialog')?.close();
  }

  function consumeRequestedAccountOpen() {
    if (!shouldOpenAccountFromLink || !state.session?.user) return;
    shouldOpenAccountFromLink = false;
    const url = new URL(window.location.href);
    url.searchParams.delete('konto');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
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
        const { data, error } = await state.client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: getAuthRedirectUrl() }
        });
        if (error) throw error;
        if (!data.session) {
          setAuthMessage('Bitte bestätige deine E-Mail und logge dich danach ein. Schau bitte auch in deinem Spam-Ordner nach.', 'success');
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

  function getSafeConfirmationUrl() {
    if (!state.confirmationUrl) return null;
    try {
      const confirmationUrl = new URL(state.confirmationUrl);
      const supabaseUrl = new URL(window.PADEL_SUPABASE_CONFIG?.url || '');
      if (confirmationUrl.protocol !== 'https:' || confirmationUrl.origin !== supabaseUrl.origin) return null;
      if (confirmationUrl.pathname !== '/auth/v1/verify') return null;
      if (!confirmationUrl.searchParams.get('token') || !confirmationUrl.searchParams.get('type')) return null;
      return confirmationUrl;
    } catch (_error) {
      return null;
    }
  }

  function continueAuthConfirmation() {
    const confirmationUrl = getSafeConfirmationUrl();
    if (!confirmationUrl) {
      setAuthMessage('Dieser Bestätigungslink ist ungültig. Bitte fordere einen neuen Link an.', 'error');
      return;
    }
    window.location.assign(confirmationUrl.href);
  }

  function openPasswordChange() {
    if (!state.session?.user) return;
    state.passwordFlow = 'change';
    setAuthMessage('');
    renderAuthState();
  }

  function cancelPasswordChange() {
    if (state.passwordFlow !== 'change') return;
    state.passwordFlow = null;
    document.getElementById('auth-password-form')?.reset();
    setAuthMessage('');
    renderAuthState();
  }

  function getAuthRedirectUrl(flow) {
    if (!['http:', 'https:'].includes(window.location.protocol)) return undefined;
    const redirectUrl = new URL(window.location.pathname, window.location.origin);
    if (flow) redirectUrl.searchParams.set('auth', flow);
    return redirectUrl.href;
  }

  async function requestPasswordReset() {
    const emailInput = document.querySelector('#auth-form [name="email"]');
    const email = String(emailInput?.value || '').trim();
    if (!email || !emailInput?.checkValidity()) {
      emailInput?.reportValidity();
      setAuthMessage('Bitte gib zuerst deine E-Mail-Adresse ein.', 'error');
      return;
    }

    setAuthMessage('Link wird gesendet …');
    const { error } = await state.client.auth.resetPasswordForEmail(email, {
      redirectTo: getAuthRedirectUrl('recovery')
    });
    if (error) setAuthMessage(getFriendlyAuthError(error), 'error');
    else setAuthMessage('Du erhältst eine E-Mail zum Zurücksetzen deines Passworts. Durch den Firmen-Mailfilter kann die Zustellung ein paar Minuten dauern. Schau bitte auch in deinem Spam-Ordner nach.', 'success');
  }

  function setAccountSettingsMessage(message, type = '') {
    const target = document.querySelector('[data-account-settings-message]');
    if (!target) return;
    target.textContent = message || '';
    target.className = `auth-message account-settings-message${type ? ` ${type}` : ''}`;
  }

  async function saveNotificationPreferences(changedInput) {
    if (!state.session?.user || !state.notificationPreferencesReady) return;
    const key = changedInput?.dataset?.emailNotification;
    if (!Object.hasOwn(state.notificationPreferences, key)) return;
    const previous = { ...state.notificationPreferences };
    state.notificationPreferences[key] = Boolean(changedInput.checked);
    state.notificationPreferencesReady = false;
    setAccountSettingsMessage('Einstellung wird gespeichert …');
    renderAuthState();

    const { data, error } = await state.client.rpc('update_my_email_notification_preferences', {
      p_result_entry: state.notificationPreferences.resultEntry,
      p_result_confirmation: state.notificationPreferences.resultConfirmation,
      p_prediction_reminder: state.notificationPreferences.predictionReminder
    });
    if (error) {
      state.notificationPreferences = previous;
      state.notificationPreferencesReady = true;
      renderAuthState();
      setAccountSettingsMessage(getFriendlyAuthError(error), 'error');
      return;
    }
    state.notificationPreferences = {
      resultEntry: data?.resultEntry !== false,
      resultConfirmation: data?.resultConfirmation !== false,
      predictionReminder: data?.predictionReminder !== false
    };
    state.notificationPreferencesReady = true;
    renderAuthState();
    setAccountSettingsMessage('E-Mail-Einstellung gespeichert.', 'success');
  }

  function finishPasswordFlow() {
    state.passwordFlow = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('auth');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    renderAuthState();
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const currentPassword = String(formData.get('currentPassword') || '');
    const password = String(formData.get('password') || '');
    const confirmation = String(formData.get('passwordConfirmation') || '');
    if (password !== confirmation) {
      setAuthMessage('Die beiden Passwörter stimmen nicht überein.', 'error');
      return;
    }

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    setAuthMessage('Passwort wird gespeichert …');
    if (state.passwordFlow === 'change') {
      const { error: signInError } = await state.client.auth.signInWithPassword({
        email: state.session?.user?.email || '',
        password: currentPassword
      });
      if (signInError) {
        setAuthMessage(/invalid login credentials/i.test(String(signInError.message || ''))
          ? 'Das aktuelle Passwort stimmt nicht.'
          : getFriendlyAuthError(signInError), 'error');
        submit.disabled = false;
        return;
      }
    }
    const { error } = await state.client.auth.updateUser({ password });
    if (error) setAuthMessage(getFriendlyAuthError(error), 'error');
    else {
      form.reset();
      finishPasswordFlow();
      setAuthMessage('Dein Passwort wurde gespeichert.', 'success');
    }
    submit.disabled = false;
  }

  function setPlayerInviteMessage(message, type = '') {
    const target = document.getElementById('player-invite-message');
    if (!target) return;
    target.textContent = message || '';
    target.className = `auth-message ${type}`.trim();
  }

  const PLAYER_INVITE_SUBJECT = 'Du bist zur PadelLiga eingeladen';


  function buildPlayerInviteCopy(actionLink, playerName) {
    return `Du bist zur PadelLiga eingeladen

Hallo ${playerName}, für dich wurde ein persönliches Spielerprofil vorbereitet. Lege über den folgenden Link dein eigenes Passwort fest und aktiviere deinen Zugang.

Zugang einrichten
${actionLink}

Mit deinem Spielerzugang kannst du:

- deine anstehenden Partien und offenen Aufgaben sehen,
- Termine für deine Partien eintragen,
- Spielergebnisse melden und Vorschläge bestätigen,
- Trainings erfassen und bestätigen.

Dein persönliches Passwort stellt sicher, dass nur du Aktionen für dein Spielerprofil ausführen kannst. Der Administrator kennt dein Passwort nicht.

Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.

Viele Grüße
Dein Hanako-Leben-Squad`;
  }

  function buildPlayerInviteHtml(actionLink, playerName) {
    const safeLink = escapeHtml(actionLink);
    const safePlayerName = escapeHtml(playerName);
    return `<p><strong>Du bist zur PadelLiga eingeladen</strong></p>
<p>Hallo ${safePlayerName}, für dich wurde ein persönliches Spielerprofil vorbereitet. Lege über den folgenden Link dein eigenes Passwort fest und aktiviere deinen Zugang.</p>
<p><a href="${safeLink}"><strong>Zugang einrichten</strong></a></p>
<p>Mit deinem Spielerzugang kannst du:</p>
<ul>
  <li>deine anstehenden Partien und offenen Aufgaben sehen,</li>
  <li>Termine für deine Partien eintragen,</li>
  <li>Spielergebnisse melden und Vorschläge bestätigen,</li>
  <li>Trainings erfassen und bestätigen.</li>
</ul>
<p>Dein persönliches Passwort stellt sicher, dass nur du Aktionen für dein Spielerprofil ausführen kannst. Der Administrator kennt dein Passwort nicht.</p>
<p>Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.</p>
<p>Viele Grüße<br>Dein Hanako-Leben-Squad</p>`;
  }

  function renderPlayerInviteDraft() {
    const output = document.getElementById('player-invite-output');
    const subject = document.getElementById('player-invite-subject');
    const copy = document.getElementById('player-invite-copy');
    if (!output || !subject || !copy) return;
    output.hidden = !state.invitationDraft;
    subject.value = state.invitationDraft?.subject || '';
    copy.innerHTML = state.invitationDraft?.html || '';
  }

  function clearPlayerInviteDraft() {
    state.invitationDraft = null;
    renderPlayerInviteDraft();
  }

  async function copyPlayerInviteText(value, successMessage, htmlValue = '') {
    if (!value) return;
    try {
      if (htmlValue && navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([value], { type: 'text/plain' }),
          'text/html': new Blob([htmlValue], { type: 'text/html' })
        })]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.append(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setPlayerInviteMessage(successMessage, 'success');
    } catch (_error) {
      setPlayerInviteMessage('Kopieren war nicht möglich. Markiere den Text bitte direkt im Feld.', 'error');
    }
  }

  function renderInvitePlayerOptions() {
    const select = document.getElementById('player-invite-player');
    if (!select) return;
    const selectedValue = select.value;
    select.replaceChildren(new Option('Spieler auswählen', ''));
    state.invitationPlayers.forEach(player => {
      const suffix = player.account_status === 'active'
        ? ' · Konto vorhanden'
        : player.account_status === 'pending'
          ? ' · Einladung offen'
          : player.account_status === 'assigned' ? ' · E-Mail hinterlegt' : '';
      const option = new Option(`${player.display_name}${suffix}`, player.player_id);
      select.add(option);
    });
    if (state.invitationPlayers.some(player => player.player_id === selectedValue)) {
      select.value = selectedValue;
    }
  }

  async function openPlayerInviteDialog() {
    if (state.profile?.app_role !== 'admin') return;
    closeAuthDialog();
    state.invitationPlayers = [];
    clearPlayerInviteDraft();
    renderInvitePlayerOptions();
    const select = document.getElementById('player-invite-player');
    if (select) select.disabled = true;
    setPlayerInviteMessage('Spieler werden geladen …');
    const dialog = document.getElementById('player-invite-dialog');
    if (dialog && !dialog.open) dialog.showModal();

    const { data, error } = await state.client.rpc('get_admin_player_invitation_options');
    if (error) setPlayerInviteMessage(getFriendlyAuthError(error), 'error');
    else {
      state.invitationPlayers = data || [];
      renderInvitePlayerOptions();
      setPlayerInviteMessage('');
    }
    if (select) select.disabled = Boolean(error);
  }

  function closePlayerInviteDialog() {
    document.getElementById('player-invite-dialog')?.close();
  }

  async function getFunctionErrorMessage(error) {
    try {
      const payload = await error?.context?.json();
      if (payload?.error) return String(payload.error);
    } catch (_error) {
      // The generic SDK error below still gives the admin a useful failure state.
    }
    return String(error?.message || 'Die Einladung konnte nicht vorbereitet werden.');
  }

  async function handlePlayerInviteSubmit(event) {
    event.preventDefault();
    if (state.profile?.app_role !== 'admin') return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const action = event.submitter?.dataset.playerEmailAction === 'prepare' ? 'prepare' : 'assign';
    const buttons = [...form.querySelectorAll('button[type="submit"]')];
    buttons.forEach(button => { button.disabled = true; });
    clearPlayerInviteDraft();
    setPlayerInviteMessage(action === 'prepare' ? 'Einladungslink wird erstellt …' : 'E-Mail wird zugeordnet …');

    const payload = {
      p_player_id: String(formData.get('playerId') || ''),
      p_email: String(formData.get('email') || '').trim()
    };
    const response = action === 'prepare'
      ? await state.client.functions.invoke('invite-player', {
          body: { playerId: payload.p_player_id, email: payload.p_email }
        })
      : await state.client.rpc('save_player_email_assignment', payload);
    const { data, error } = response;
    if (error) {
      setPlayerInviteMessage(
        action === 'prepare' ? await getFunctionErrorMessage(error) : getFriendlyAuthError(error),
        'error'
      );
    }
    else {
      const invitedPlayer = state.invitationPlayers.find(player => player.player_id === String(formData.get('playerId') || ''));
      if (invitedPlayer) {
        invitedPlayer.account_status = data?.status === 'linked'
          ? 'active'
          : action === 'prepare'
            ? (data?.accountStatus === 'active' ? 'active' : 'pending')
            : 'assigned';
      }
      if (data?.status === 'prepared' && data?.actionLink) {
        const invitedPlayerName = invitedPlayer?.display_name || 'Spieler';
        state.invitationDraft = {
          actionLink: data.actionLink,
          subject: PLAYER_INVITE_SUBJECT,
          message: buildPlayerInviteCopy(data.actionLink, invitedPlayerName),
          html: buildPlayerInviteHtml(data.actionLink, invitedPlayerName)
        };
        renderPlayerInviteDraft();
      }
      form.reset();
      renderInvitePlayerOptions();
      setPlayerInviteMessage(
        data?.status === 'linked'
          ? 'Das bestehende Konto wurde mit dem Spieler verknüpft.'
          : action === 'prepare' ? 'Die Einladung ist vorbereitet und kann jetzt kopiert werden.' : 'Arbeits-E-Mail wurde hinterlegt.',
        'success'
      );
    }
    buttons.forEach(button => { button.disabled = false; });
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
      target.classList.add(/fehlt|Match-Tiebreak eingeben/i.test(target.textContent) ? 'is-partial' : 'is-invalid');
    }
  }

  function initializeResultScorePair(input) {
    if (!input || String(input.value).trim() === '') return;
    const pair = input.closest('.score-counter-pair');
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
        p_match_at: buildMatchAtValue(
          String(data.get('scheduledDate') || ''),
          String(data.get('scheduledTime') || '')
        )
      });
      if (error) throw error;
      setAuthMessage('Partie wurde terminiert. Schläger werden gebucht …');
      const racket = await syncRacketBooking('match', form.dataset.matchSchedule);
      setAuthMessage(withRacketNote('Partie wurde terminiert.', racket), 'success');
      await refresh();
    } catch (error) {
      setAuthMessage(error.message || 'Die Partie konnte nicht terminiert werden.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function openUnscheduleDialog(button) {
    const dialog = document.getElementById('unschedule-match-dialog');
    if (!dialog) return;
    dialog.dataset.matchId = button.dataset.matchUnschedule;
    unscheduleTrigger = button;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('.secondary-button[data-unschedule-close]')?.focus();
  }

  function closeUnscheduleDialog() {
    document.getElementById('unschedule-match-dialog')?.close();
  }

  function openUnrateDialog(button) {
    const dialog = document.getElementById('unrate-match-dialog');
    if (!dialog) return;
    dialog.dataset.matchId = button.dataset.matchCancel;
    unrateTrigger = button;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('.secondary-button[data-unrate-close]')?.focus();
  }

  function closeUnrateDialog() {
    document.getElementById('unrate-match-dialog')?.close();
  }

  async function handleUnscheduleMatch(matchId, button) {
    if (button) button.disabled = true;
    setAuthMessage('Termin wird gelöscht …');
    try {
      const { error } = await state.client.rpc('unschedule_match', { p_match_id: matchId });
      if (error) throw error;
      await syncRacketBooking('match', matchId);
      setAuthMessage('Termin wurde gelöscht.', 'success');
      await refresh();
    } catch (error) {
      setAuthMessage(error.message || 'Der Termin konnte nicht gelöscht werden.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function handleCancelMatch(matchId, button) {
    if (button) button.disabled = true;
    setAuthMessage('Partie wird aus der Wertung genommen …');
    try {
      const { error } = await state.client.rpc('cancel_match', { p_match_id: matchId });
      if (error) throw error;
      await syncRacketBooking('match', matchId);
      setAuthMessage('Partie wurde als „ohne Wertung“ markiert.', 'success');
      await refresh();
      publishOfficialResultChange(matchId);
    } catch (error) {
      setAuthMessage(error.message || 'Die Partie konnte nicht aus der Wertung genommen werden.', 'error');
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
    const resultIsOfficialImmediately = state.profile?.app_role === 'admin';
    try {
      const { resultDetails, actualSets, winner } = readResultScore(form);
      const task = state.resultTasks.find(item => String(item.match_id) === String(form.dataset.resultSubmit));
      if (isUnchangedResultProposal(task, resultDetails, actualSets, winner, playedOn, playedTime)) {
        const summary = form.querySelector('[data-result-summary]');
        if (summary) {
          summary.textContent = UNCHANGED_PROPOSAL_MESSAGE;
          summary.className = 'result-entry-summary is-invalid';
        }
        return;
      }
      button.disabled = true;
      setAuthMessage('Ergebnis wird gespeichert …');
      const { error } = await state.client.rpc('submit_match_result', {
        p_match_id: form.dataset.resultSubmit,
        p_result_details: resultDetails,
        p_actual_sets: actualSets,
        p_winner: winner,
        p_match_at: buildMatchAtValue(playedOn, playedTime)
      });
      if (error) throw error;
      setAuthMessage(resultIsOfficialImmediately ? 'Ergebnis wurde direkt eingetragen.' : 'Ergebnis wurde an das andere Team gesendet.', 'success');
      await refresh();
      if (resultIsOfficialImmediately) publishOfficialResultChange(form.dataset.resultSubmit);
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
      setAuthMessage('Ergebnis bestätigt. Rangliste und Elo wurden aktualisiert.', 'success');
      await refresh();
      publishOfficialResultChange();
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

  function getTrainingProposalSignature(proposal) {
    return JSON.stringify({
      playedOn: String(proposal?.played_on || proposal?.playedOn || ''),
      displayTime: String(proposal?.display_time || proposal?.displayTime || '').slice(0, 5),
      playerIds: [...(proposal?.player_ids || proposal?.playerIds || [])].map(String).sort(),
      guestNames: Object.entries(normalizeTrainingGuestNames(proposal?.guest_names || proposal?.guestNames || {}))
        .sort(([left], [right]) => left.localeCompare(right)),
      rounds: (proposal?.rounds || []).map(round => ({
        teamOneIds: [...(round.team_one_ids || round.teamOneIds || [])].map(String).sort(),
        teamTwoIds: [...(round.team_two_ids || round.teamTwoIds || [])].map(String).sort(),
        resultFormat: String(round.result_format || round.resultFormat || ''),
        resultDetails: String(round.result_details || round.resultDetails || '').trim()
      }))
    });
  }

  function getTrainingSetData(round, setIndex) {
    const label = `Satz ${setIndex + 1}`;
    const score = readTrainingScorePair(round, 'set', setIndex);
    const classification = window.PadelScoreInput.classifyRegularSet(score[0], score[1]);
    if (classification.state === 'invalid') {
      throw new Error(`${label}: Nur erreichbare Zwischenstände sowie 6:X, 7:5 oder 7:6 sind gültig.`);
    }
    if (classification.state === 'empty') {
      return {
        state: 'empty',
        score,
        tiebreak: [null, null],
        details: '',
        payload: { team_one: null, team_two: null, tiebreak_team_one: null, tiebreak_team_two: null }
      };
    }

    let tiebreak = [null, null];
    const needsTiebreak = classification.state === 'complete'
      && Math.max(...score) === 7
      && Math.min(...score) === 6;
    if (needsTiebreak) {
      tiebreak = readTrainingScorePair(round, 'set-tiebreak', setIndex);
      const tiebreakClassification = window.PadelScoreInput.classifyTiebreak(tiebreak[0], tiebreak[1], 7);
      if (tiebreakClassification.state !== 'complete') {
        throw new Error(`${label}: Der Satz-Tiebreak benötigt einen regelkonformen Endstand.`);
      }
      const setWinner = score[0] > score[1] ? 1 : 2;
      const tiebreakWinner = tiebreak[0] > tiebreak[1] ? 1 : 2;
      if (setWinner !== tiebreakWinner) {
        throw new Error(`${label}: Satz- und Tiebreak-Sieger stimmen nicht überein.`);
      }
    }

    return {
      state: classification.state,
      score,
      tiebreak,
      details: `${score[0]}:${score[1]}${needsTiebreak ? ` (${tiebreak[0]}:${tiebreak[1]})` : ''}`,
      payload: {
        team_one: score[0],
        team_two: score[1],
        tiebreak_team_one: needsTiebreak ? tiebreak[0] : null,
        tiebreak_team_two: needsTiebreak ? tiebreak[1] : null
      }
    };
  }

  function getTrainingResultData(round) {
    const resultFormat = round.querySelector('[name="resultFormat"]').value;
    const config = getTrainingFormatConfig(resultFormat);
    const sets = Array.from({ length: config.regularSetCount }, (_, setIndex) => getTrainingSetData(round, setIndex));
    let foundEmptySet = false;
    sets.forEach(set => {
      if (set.state === 'empty') foundEmptySet = true;
      else if (foundEmptySet) throw new Error('Zwischen ausgefüllten Sätzen darf kein Satz leer bleiben.');
    });
    const enteredSets = sets.filter(set => set.state !== 'empty');
    if (!enteredSets.length || !enteredSets.some(set => set.score.some(value => Number(value) > 0))) {
      throw new Error('Bitte mindestens einen Spielstand eingeben.');
    }

    const completedSetCount = sets.filter(set => set.state === 'complete').length;
    const regularScores = sets.map(set => set.score);
    let matchTiebreak = { state: 'empty', score: [null, null], details: '' };
    if (config.hasMatchTiebreak) {
      const firstTwoComplete = sets.every(set => set.state === 'complete');
      const splitSets = firstTwoComplete && hasSplitFirstTwoSets(regularScores);
      const score = readTrainingScorePair(round, 'match-tiebreak', 0);
      const classification = window.PadelScoreInput.classifyTiebreak(score[0], score[1], 10);
      if (firstTwoComplete && !splitSets) {
        throw new Error('Beim Format „2 Sätze + Match-Tiebreak“ müssen die ersten beiden Sätze 1:1 enden.');
      }
      if (!splitSets && classification.state !== 'empty') {
        throw new Error('Der Match-Tiebreak wird erst nach einem Satzstand von 1:1 eingegeben.');
      }
      if (classification.state === 'invalid') {
        throw new Error('Der Match-Tiebreak benötigt einen erreichbaren Zwischen- oder Endstand.');
      }
      matchTiebreak = {
        state: splitSets ? classification.state : 'empty',
        score,
        details: splitSets && classification.state !== 'empty' ? `${score[0]}:${score[1]}` : ''
      };
    }

    const regularResult = enteredSets.map(set => set.details).join(', ');
    const resultDetails = matchTiebreak.details ? `${regularResult} – ${matchTiebreak.details}` : regularResult;
    const isComplete = sets.every(set => set.state === 'complete')
      && (!config.hasMatchTiebreak || matchTiebreak.state === 'complete');
    return {
      resultDetails,
      resultFormat,
      setCount: config.sectionCount,
      isComplete,
      completedSetCount,
      matchWeight: completedSetCount * 0.5,
      sets: sets.map(set => set.payload),
      matchTiebreak: config.hasMatchTiebreak ? {
        team_one: matchTiebreak.score[0],
        team_two: matchTiebreak.score[1]
      } : null
    };
  }

  function isTrainingSetComplete(round, setIndex) {
    try {
      return getTrainingSetData(round, setIndex).state === 'complete';
    } catch (_error) {
      return false;
    }
  }

  function updateTrainingRoundSummary(round) {
    if (!round) return;
    const format = round.querySelector('[name="resultFormat"]')?.value || 'one_set';
    const config = getTrainingFormatConfig(format);
    const scores = Array.from({ length: config.regularSetCount }, (_, setIndex) => readTrainingScorePair(round, 'set', setIndex));
    scores.forEach((score, setIndex) => {
      const needsTiebreak = score.every(Number.isInteger) && Math.max(...score) === 7 && Math.min(...score) === 6;
      const tiebreak = round.querySelector(`[data-result-set-tiebreak="${setIndex}"]`);
      if (tiebreak) tiebreak.hidden = !needsTiebreak;
      tiebreak?.querySelectorAll('input, button').forEach(control => {
        if (!needsTiebreak && control.matches('input')) control.value = '';
        control.disabled = !needsTiebreak;
      });
    });

    const decisionEnabled = Boolean(config.hasMatchTiebreak
      && scores.every((_score, setIndex) => isTrainingSetComplete(round, setIndex))
      && hasSplitFirstTwoSets(scores));
    round.querySelector('[data-result-decision]')?.querySelectorAll('input, button').forEach(control => {
      if (!decisionEnabled && control.matches('input')) control.value = '';
      control.disabled = !decisionEnabled;
    });

    const target = round.querySelector('[data-training-round-summary]');
    if (!target) return;
    target.classList.remove('is-valid', 'is-invalid', 'is-partial');
    const hasStarted = [...round.querySelectorAll('[data-result-score]:not(:disabled)')]
      .some(input => String(input.value).trim() !== '');
    if (!hasStarted) {
      target.textContent = 'Satzergebnis wird automatisch berechnet.';
      return;
    }
    try {
      const result = getTrainingResultData(round);
      const weightLabel = result.matchWeight.toLocaleString('de-DE');
      target.textContent = `${result.resultDetails} · ${result.isComplete ? 'vollständig' : 'unvollständig'} · ${weightLabel} Wertung`;
      target.classList.add(result.isComplete ? 'is-valid' : 'is-partial');
    } catch (error) {
      target.textContent = error.message || 'Bitte das Ergebnis prüfen.';
      target.classList.add('is-invalid');
    }
  }

  function setTrainingMessage(message, type = '', form = document.getElementById('training-form')) {
    const target = form?.querySelector('[data-training-message]');
    if (!target) return;
    target.textContent = message || '';
    target.className = `auth-message training-message${type ? ` ${type}` : ''}`;
  }

  function closeTrainingForm(form = document.getElementById('training-form')) {
    if (!form) return;
    form.hidden = true;
    const formGroup = form.closest('[data-training-form-group]');
    if (formGroup) formGroup.hidden = true;
    closeTrainingPickerMenus();
    setTrainingMessage('', '', form);
    if (form.dataset.trainingAlternative) {
      const task = state.trainingTasks.find(item => Number(item.session_id) === Number(form.dataset.trainingAlternative));
      if (task) renderTrainingForm(task.player_ids, getTrainingRoundValues(task), form, task.guest_names);
      const toggle = form.closest('.training-task-card')?.querySelector('[data-training-edit]');
      if (toggle) toggle.textContent = 'Alternative eingeben';
      return;
    }
    form.reset();
    syncDateTimeHints(form);
    renderTrainingForm();
  }

  function handleTrainingInvalid(event) {
    const form = event.target.closest('.training-form');
    if (!form) return;
    if (form.querySelector(':invalid') !== event.target) return;
    const label = event.target.closest('label')?.querySelector('span')?.textContent?.trim()
      || event.target.getAttribute('aria-label')
      || 'Pflichtfeld';
    setTrainingMessage(`Bitte „${label}“ ausfüllen.`, 'error', form);
  }

  async function handleTrainingSubmit(event) {
    event.preventDefault();
    const form = event.target;
    setTrainingMessage('', '', form);
    const data = new FormData(form);
    const playerIds = data.getAll('playerId').map(String);
    if (new Set(playerIds).size !== 4 || playerIds.some(id => !id)) {
      setTrainingMessage('Bitte vier verschiedene Spieler oder Gäste auswählen.', 'error', form);
      return;
    }
    const guestNames = getTrainingGuestNames(form);
    const guestIds = playerIds.filter(isTrainingGuestKey);
    if (guestIds.some(id => !guestNames[id] || guestNames[id].length < 2 || guestNames[id].length > 40)) {
      setTrainingMessage('Bitte für jeden Gast einen Namen mit 2 bis 40 Zeichen eingeben.', 'error', form);
      return;
    }
    const button = form.querySelector('[type="submit"]');
    const editingTrainingId = form.dataset.trainingAlternative || null;
    const scheduledTrainingId = form.dataset.trainingScheduled || null;
    const trainingTimestamp = getTrainingFormTimestamp(form);
    if (!Number.isFinite(trainingTimestamp)) {
      setTrainingMessage('Bitte Datum und Uhrzeit vollständig eintragen.', 'error', form);
      return;
    }
    const schedulesFuture = trainingTimestamp > Date.now();
    if (editingTrainingId && schedulesFuture) {
      setTrainingMessage('Ein Ergebnisvorschlag darf nicht in der Zukunft liegen.', 'error', form);
      return;
    }
    let rounds = [];
    if (!schedulesFuture) {
      try {
        rounds = [...form.querySelectorAll('[data-training-round]')].map(round => {
          const [teamOne, teamTwo] = getTrainingPairing(playerIds, round.querySelector('[name="pairing"]').value);
          const result = getTrainingResultData(round);
          return {
            team_one_ids: teamOne,
            team_two_ids: teamTwo,
            result_format: result.resultFormat,
            result_details: result.resultDetails,
            sets: result.sets,
            match_tiebreak: result.matchTiebreak
          };
        });
      } catch (error) {
        setTrainingMessage(error.message, 'error', form);
        return;
      }
    }
    const rpcName = schedulesFuture
      ? scheduledTrainingId ? 'update_scheduled_training' : 'schedule_training_session'
      : scheduledTrainingId ? 'submit_scheduled_training_result'
        : editingTrainingId ? 'replace_pending_training_session' : 'create_training_session';
    const payload = {
      p_played_on: String(data.get('playedOn')),
      p_display_time: String(data.get('displayTime')),
      p_player_ids: playerIds,
      p_guest_names: guestNames
    };
    if (!schedulesFuture) payload.p_rounds = rounds;
    if (editingTrainingId) payload.p_session_id = Number(editingTrainingId);
    if (scheduledTrainingId) payload.p_session_id = Number(scheduledTrainingId);
    const editedTraining = editingTrainingId
      ? state.trainingTasks.find(item => Number(item.session_id) === Number(editingTrainingId))
      : null;
    if (editedTraining && getTrainingProposalSignature(editedTraining) === getTrainingProposalSignature({
      playedOn: payload.p_played_on,
      displayTime: payload.p_display_time,
      playerIds,
      guestNames,
      rounds
    })) {
      setTrainingMessage(UNCHANGED_PROPOSAL_MESSAGE, 'error', form);
      button.disabled = false;
      return;
    }
    button.disabled = true;
    setTrainingMessage(schedulesFuture ? 'Training wird terminiert …' : 'Training wird gespeichert …', '', form);
    let savedTrainingId = null;
    try {
      const { data: savedId, error } = await state.client.rpc(rpcName, payload);
      if (error) throw error;
      savedTrainingId = scheduledTrainingId || savedId;
    } catch (error) {
      setTrainingMessage(getFriendlyAuthError(error), 'error', form);
      button.disabled = false;
      return;
    }
    const racket = schedulesFuture && savedTrainingId
      ? await syncRacketBooking('training', savedTrainingId)
      : null;
    button.disabled = false;
    setTrainingMessage('', '', form);
    form.reset();
    syncDateTimeHints(form);
    form.hidden = true;
    const formGroup = form.closest('[data-training-form-group]');
    if (formGroup) formGroup.hidden = true;
    setAuthMessage(schedulesFuture
      ? withRacketNote(scheduledTrainingId ? 'Trainingstermin wurde geändert.' : 'Training wurde terminiert.', racket)
      : state.profile?.app_role === 'admin' ? 'Training wurde direkt eingetragen.' : 'Training wurde zur Bestätigung gesendet.', 'success');
    await refresh();
    window.dispatchEvent(new CustomEvent('padel:training-data-changed'));
  }

  function editTraining(sessionId) {
    const task = state.trainingTasks.find(item => Number(item.session_id) === Number(sessionId));
    if (!task) return;
    const form = document.querySelector(`[data-training-alternative="${CSS.escape(String(sessionId))}"]`);
    if (!form) return;
    const opening = form.hidden;
    form.hidden = !opening;
    const toggle = form.closest('.training-task-card')?.querySelector('[data-training-edit]');
    if (toggle) toggle.textContent = opening ? 'Alternative schließen' : 'Alternative eingeben';
    if (opening) {
      renderTrainingForm(task.player_ids, getTrainingRoundValues(task), form, task.guest_names);
      form.querySelector('[name="playedOn"]').value = task.played_on;
      form.querySelector('[name="displayTime"]').value = String(task.display_time).slice(0, 5);
      syncDateTimeHints(form);
      setTrainingMessage('', '', form);
    }
  }

  async function confirmTraining(sessionId) {
    setAuthMessage('Training wird bestätigt …');
    const { error } = await state.client.rpc('confirm_training_session', { p_session_id: Number(sessionId) });
    if (error) return setAuthMessage(error.message, 'error');
    setAuthMessage('Training bestätigt.', 'success');
    await refresh();
    window.dispatchEvent(new CustomEvent('padel:profile-data-changed'));
    window.dispatchEvent(new CustomEvent('padel:training-data-changed'));
  }

  async function deleteScheduledTraining(sessionId) {
    if (!window.confirm('Soll dieser Trainingstermin wirklich gelöscht werden?')) return;
    setAuthMessage('Trainingstermin wird gelöscht …');
    const { error } = await state.client.rpc('delete_scheduled_training', { p_session_id: Number(sessionId) });
    if (error) return setAuthMessage(getFriendlyAuthError(error), 'error');
    await syncRacketBooking('training', sessionId);
    setAuthMessage('Trainingstermin wurde gelöscht.', 'success');
    await refresh();
    window.dispatchEvent(new CustomEvent('padel:training-data-changed'));
  }

  function bindEvents() {
    window.addEventListener('padel:live-account-updated', () => {
      renderAuthState();
      renderResultTasks();
    });
    document.addEventListener('click', async event => {
      if (!event.target.closest('[data-training-picker]')) closeTrainingPickerMenus();
      const open = event.target.closest('[data-auth-open]');
      if (open) {
        openAuthDialog();
        return;
      }
      if (event.target.closest('[data-account-tasks-retry]')) {
        void refreshPlayerTools({ force: true });
        return;
      }
      const resultScopeButton = event.target.closest('[data-account-result-scope]');
      if (resultScopeButton && state.profile?.app_role === 'admin') {
        state.resultTaskScope = resultScopeButton.dataset.accountResultScope === 'all' ? 'all' : 'relevant';
        render();
        return;
      }
      if (event.target.closest('[data-auth-close]')) {
        closeAuthDialog();
        return;
      }
      if (event.target.closest('[data-account-auth-message-dismiss]')) {
        dismissAccountMessage();
        return;
      }
      const mode = event.target.closest('[data-auth-mode]');
      if (mode) {
        setAuthMode(mode.dataset.authMode);
        return;
      }
      if (event.target.closest('[data-password-reset]')) {
        await requestPasswordReset();
        return;
      }
      if (event.target.closest('[data-auth-confirmation-continue]')) {
        continueAuthConfirmation();
        return;
      }
      if (event.target.closest('[data-password-change]')) {
        openPasswordChange();
        return;
      }
      if (event.target.closest('[data-account-settings]')) {
        state.settingsOpen = !state.settingsOpen;
        setAccountSettingsMessage('');
        renderAuthState();
        return;
      }
      if (event.target.closest('[data-password-change-cancel]')) {
        cancelPasswordChange();
        return;
      }
      if (event.target.closest('[data-player-invite-open]')) {
        await openPlayerInviteDialog();
        return;
      }
      if (event.target.closest('[data-player-invite-close]')) {
        closePlayerInviteDialog();
        return;
      }
      if (event.target.closest('[data-player-invite-copy-link]')) {
        await copyPlayerInviteText(state.invitationDraft?.actionLink, 'Einladungslink wurde kopiert.');
        return;
      }
      if (event.target.closest('[data-player-invite-copy-message]')) {
        await copyPlayerInviteText(
          state.invitationDraft?.message,
          'Nachricht und Link wurden kopiert.',
          state.invitationDraft?.html
        );
        return;
      }
      const playerProfileButton = event.target.closest('[data-account-player-profile]');
      if (playerProfileButton) {
        const playerId = playerProfileButton.dataset.playerId || state.profile?.player_id;
        if (!playerId) return;
        closeAuthDialog();
        if (typeof window.PadelLigaOpenPlayerProfile === 'function') {
          await window.PadelLigaOpenPlayerProfile(playerId, document.querySelector('[data-auth-open]'));
        } else {
          const seasonId = window.PadelSeasonRouting?.getRequestedSeasonId();
          const ligaUrl = window.PadelSeasonRouting?.getSeasonUrl(seasonId, 'league') || new URL('../', window.location.href);
          ligaUrl.searchParams.set('spielerprofil', playerId);
          window.location.assign(ligaUrl);
        }
        return;
      }
      if (event.target.closest('[data-auth-logout]')) {
        await state.client.auth.signOut();
        state.settingsOpen = false;
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
      const scheduleToggle = event.target.closest('[data-match-schedule-toggle]');
      if (scheduleToggle) {
        const card = scheduleToggle.closest('.result-task-card');
        const form = card?.querySelector('.match-schedule-form');
        if (form) {
          form.hidden = !form.hidden;
          scheduleToggle.textContent = form.hidden ? 'Termin ändern' : 'Termin schließen';
          scheduleRacketCheck(form);
        }
        return;
      }
      const unscheduleButton = event.target.closest('[data-match-unschedule]');
      if (unscheduleButton) {
        openUnscheduleDialog(unscheduleButton);
        return;
      }
      if (event.target.closest('[data-unschedule-close]')) {
        closeUnscheduleDialog();
        return;
      }
      if (event.target.closest('[data-unschedule-confirm]')) {
        const dialog = document.getElementById('unschedule-match-dialog');
        const matchId = dialog?.dataset.matchId;
        const trigger = unscheduleTrigger;
        closeUnscheduleDialog();
        if (matchId) await handleUnscheduleMatch(matchId, trigger);
        return;
      }
      const cancelMatchButton = event.target.closest('[data-match-cancel]');
      if (cancelMatchButton) {
        openUnrateDialog(cancelMatchButton);
        return;
      }
      if (event.target.closest('[data-unrate-close]')) {
        closeUnrateDialog();
        return;
      }
      if (event.target.closest('[data-unrate-confirm]')) {
        const dialog = document.getElementById('unrate-match-dialog');
        const matchId = dialog?.dataset.matchId;
        const trigger = unrateTrigger;
        closeUnrateDialog();
        if (matchId) await handleCancelMatch(matchId, trigger);
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
        window.PadelScoreInput.setActivePair(input.closest('.score-counter-pair'));
        const trainingRound = input.closest('[data-training-round]');
        if (trainingRound) updateTrainingRoundSummary(trainingRound);
        else updateResultSummary(input.closest('[data-result-submit]'));
        return;
      }
      const trainingToggle = event.target.closest('[data-training-toggle]');
      if (trainingToggle) {
        const form = document.getElementById('training-form');
        const opening = form.hidden;
        form.hidden = !opening;
        const formGroup = form.closest('[data-training-form-group]');
        if (formGroup) formGroup.hidden = !opening;
        if (opening) {
          setTrainingMessage('', '', form);
          renderTrainingForm();
          syncTrainingFormMode(form);
        } else {
          closeTrainingForm(form);
        }
        return;
      }
      const trainingScheduleToggle = event.target.closest('[data-training-schedule-toggle]');
      if (trainingScheduleToggle) {
        const form = trainingScheduleToggle.closest('.training-task-card')
          ?.querySelector('[data-training-scheduled]');
        if (form) {
          form.hidden = !form.hidden;
          trainingScheduleToggle.textContent = form.hidden ? 'Termin ändern' : 'Termin schließen';
          if (!form.hidden) syncTrainingFormMode(form);
        }
        return;
      }
      const trainingPickerToggle = event.target.closest('[data-training-picker-toggle]');
      if (trainingPickerToggle) {
        toggleTrainingPickerMenu(trainingPickerToggle);
        return;
      }
      const trainingPickerOption = event.target.closest('[data-training-picker-value]');
      if (trainingPickerOption) {
        selectTrainingPickerOption(trainingPickerOption);
        return;
      }
      const removeTrainingGuest = event.target.closest('[data-training-guest-remove]');
      if (removeTrainingGuest) {
        const form = removeTrainingGuest.closest('.training-form');
        const guestField = removeTrainingGuest.closest('[data-training-player-field]');
        if (!form || !guestField) return;
        const preservedRounds = readTrainingRoundValues(form);
        const participantIds = getTrainingParticipantIds(form);
        const guestNames = getTrainingGuestNames(form);
        const playerFields = [...form.querySelectorAll('[data-training-player-fields] [data-training-player-field]')];
        const playerIndex = playerFields.indexOf(guestField);
        delete guestNames[participantIds[playerIndex]];
        participantIds[playerIndex] = '';
        renderTrainingPlayerFields(participantIds, guestNames, form);
        renderTrainingRounds(preservedRounds, form, preservedRounds.length);
        form.querySelectorAll('[data-training-player-field]')[playerIndex]
          ?.querySelector('[data-training-picker-toggle]')?.focus();
        setTrainingMessage('', '', form);
        return;
      }
      if (event.target.closest('[data-training-round-add]')) {
        const form = event.target.closest('.training-form');
        if (!form) return;
        const preserved = readTrainingRoundValues(form);
        renderTrainingRounds(preserved, form, preserved.length + 1);
        return;
      }
      const removeRound = event.target.closest('[data-training-round-remove]');
      if (removeRound) {
        const removeIndex = Number(removeRound.dataset.trainingRoundRemove);
        const form = removeRound.closest('.training-form');
        if (!form) return;
        if (removeIndex === 0) {
          if (form.dataset.trainingScheduled) {
            renderTrainingRounds([], form, 1);
            return;
          }
          closeTrainingForm(form);
          return;
        }
        const preserved = readTrainingRoundValues(form);
        preserved.splice(removeIndex, 1);
        renderTrainingRounds(preserved, form, preserved.length);
        return;
      }
      const confirmTrainingButton = event.target.closest('[data-training-confirm]');
      if (confirmTrainingButton) {
        await confirmTraining(confirmTrainingButton.dataset.trainingConfirm);
        return;
      }
      const deleteTrainingButton = event.target.closest('[data-training-delete]');
      if (deleteTrainingButton) {
        await deleteScheduledTraining(deleteTrainingButton.dataset.trainingDelete);
        return;
      }
      const editTrainingButton = event.target.closest('[data-training-edit]');
      if (editTrainingButton) {
        editTraining(editTrainingButton.dataset.trainingEdit);
        return;
      }
    });

    document.getElementById('auth-form')?.addEventListener('submit', handleAuthSubmit);
    document.getElementById('auth-password-form')?.addEventListener('submit', handlePasswordSubmit);
    document.getElementById('player-invite-form')?.addEventListener('submit', handlePlayerInviteSubmit);
    document.addEventListener('submit', event => {
      if (event.target.matches('[data-match-schedule]')) handleScheduleSubmit(event);
      else if (event.target.matches('[data-result-submit]')) handleResultSubmit(event);
      else if (event.target.matches('.training-form')) handleTrainingSubmit(event);
    });
    document.addEventListener('invalid', event => {
      if (event.target.closest('.training-form')) handleTrainingInvalid(event);
    }, true);
    document.addEventListener('input', event => {
      syncDateTimeHint(event.target);
      if (event.target.matches('.match-schedule-form input:is([type="date"], [type="time"])')) {
        scheduleRacketCheck(event.target.closest('.match-schedule-form'));
        return;
      }
      if (event.target.matches('.training-form input:is([type="date"], [type="time"])')) {
        syncTrainingFormMode(event.target.closest('.training-form'));
        return;
      }
      const trainingPickerSearch = event.target.closest('[data-training-picker-search]');
      if (trainingPickerSearch) {
        filterTrainingPlayerOptions(
          trainingPickerSearch.closest('[data-training-picker]'),
          trainingPickerSearch.value
        );
        return;
      }
      if (event.target.matches('[data-training-guest-name]')) {
        setTrainingMessage('', '', event.target.closest('.training-form'));
        return;
      }
      if (event.target.matches('[data-result-score]')) {
        event.target.value = window.PadelScoreInput.sanitizeScoreValue(event.target.value);
        initializeResultScorePair(event.target);
        window.PadelScoreInput.setActivePair(event.target.closest('.score-counter-pair'));
        const trainingRound = event.target.closest('[data-training-round]');
        if (trainingRound) updateTrainingRoundSummary(trainingRound);
        else updateResultSummary(event.target.closest('[data-result-submit]'));
      }
    });
    document.addEventListener('change', event => {
      syncDateTimeHint(event.target);
      if (event.target.matches('[data-email-notification]')) {
        void saveNotificationPreferences(event.target);
        return;
      }
      if (event.target.matches('.match-schedule-form input:is([type="date"], [type="time"])')) {
        scheduleRacketCheck(event.target.closest('.match-schedule-form'));
        return;
      }
      if (event.target.matches('.training-form input:is([type="date"], [type="time"])')) {
        syncTrainingFormMode(event.target.closest('.training-form'));
        return;
      }
      if (event.target.matches('[data-training-guest-name]')) {
        const form = event.target.closest('.training-form');
        if (!form) return;
        const preservedRounds = readTrainingRoundValues(form);
        renderTrainingRounds(preservedRounds, form, preservedRounds.length);
      }
    });
    document.addEventListener('pointerdown', event => {
      const scoreControl = event.target.closest('[data-result-score], [data-result-score-step]');
      if (!scoreControl) return;
      window.PadelScoreInput.setActivePair(scoreControl.closest('.score-counter-pair'));
      const input = event.target.closest('[data-result-score]');
      if (input && input.value) {
        input.value = '';
        const trainingRound = input.closest('[data-training-round]');
        if (trainingRound) updateTrainingRoundSummary(trainingRound);
        else updateResultSummary(input.closest('[data-result-submit]'));
      }
    });
    document.addEventListener('focusin', event => {
      const scoreControl = event.target.closest('[data-result-score], [data-result-score-step]');
      if (scoreControl) window.PadelScoreInput.setActivePair(scoreControl.closest('.score-counter-pair'));
    });
    document.addEventListener('keydown', event => {
      const trainingPickerSearch = event.target.closest('[data-training-picker-search]');
      if (trainingPickerSearch) {
        const picker = trainingPickerSearch.closest('[data-training-picker]');
        const visibleOptions = [...picker.querySelectorAll('[data-training-picker-value]')]
          .filter(option => !option.hidden);
        if (event.key === 'Escape') {
          event.preventDefault();
          closeTrainingPickerMenus();
          picker.querySelector('[data-training-picker-toggle]')?.focus();
          return;
        }
        if (event.key === 'ArrowDown' && visibleOptions.length) {
          event.preventDefault();
          visibleOptions[0].focus();
          return;
        }
        if (event.key === 'Enter' && trainingPickerSearch.value && visibleOptions.length) {
          event.preventDefault();
          selectTrainingPickerOption(visibleOptions[0]);
          return;
        }
      }
      if (event.key === 'Enter' && event.target.matches('[data-result-score]')) {
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') closeTrainingPickerMenus();
    });
    document.getElementById('auth-dialog')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) closeAuthDialog();
    });
    document.getElementById('player-invite-dialog')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) closePlayerInviteDialog();
    });
    document.getElementById('unschedule-match-dialog')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) closeUnscheduleDialog();
    });
    document.getElementById('unschedule-match-dialog')?.addEventListener('close', event => {
      delete event.currentTarget.dataset.matchId;
      unscheduleTrigger = null;
    });
    document.getElementById('unrate-match-dialog')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) closeUnrateDialog();
    });
    document.getElementById('unrate-match-dialog')?.addEventListener('close', event => {
      delete event.currentTarget.dataset.matchId;
      unrateTrigger = null;
    });
    window.addEventListener('padel:live-status-changed', renderResultTasks);
    syncDateTimeHints();
  }

  async function initialize() {
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
    state.client.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'INITIAL_SESSION') return;
      if (event === 'PASSWORD_RECOVERY') state.passwordFlow = 'recovery';
      state.session = nextSession;
      if (event === 'TOKEN_REFRESHED') return;
      resetPlayerTools();
      window.setTimeout(async () => {
        await refresh();
        if (nextSession && ['invite', 'recovery'].includes(state.passwordFlow)) openAuthDialog();
        else if (nextSession && shouldOpenAccountFromLink) {
          consumeRequestedAccountOpen();
          openAuthDialog();
        }
      }, 0);
    });
    await refresh({ includeTasks: false });
    if (state.confirmationUrl) {
      openAuthDialog();
      if (!getSafeConfirmationUrl()) {
        setAuthMessage('Dieser Bestätigungslink ist ungültig. Bitte fordere einen neuen Link an.', 'error');
      }
    } else if (state.session && ['invite', 'recovery'].includes(state.passwordFlow)) openAuthDialog();
    else if (!state.session && (['invite', 'recovery'].includes(state.passwordFlow) || initialAuthError)) {
      openAuthDialog();
      setAuthMessage(initialAuthError || 'Dieser Link ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.', 'error');
    } else if (shouldOpenAccountFromLink) {
      consumeRequestedAccountOpen();
      openAuthDialog();
    }
  }

  function init() {
    if (!initPromise) {
      initPromise = initialize().catch(error => {
        state.error = error?.message || 'Das Konto konnte nicht initialisiert werden.';
        console.error('Konto konnte nicht initialisiert werden:', error);
        render();
      });
    }
    return initPromise;
  }

  window.PadelKonto = {
    init,
    refresh,
    render,
    openDialog: openAuthDialog,
    setMessage: setAuthMessage,
    getClient: () => state.client,
    getSession: () => state.session,
    getProfile: () => state.profile,
    getDisplayName: getProfileDisplayName
  };
})();
