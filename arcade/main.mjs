import { createState, createClock, start, pause, reset, step } from './physics.mjs?v=2026-09-13-audio-events';
import { createComputer } from './computer.mjs?v=2026-09-13-easy-balanced';
import { DIFFICULTIES, requireDifficulty, readDifficulty, saveDifficulty } from './difficulty.mjs?v=2026-09-13-easy-balanced';
import { createInput } from './input.mjs?v=2026-09-12-rules-v2';
import { createRenderer } from './renderer.mjs?v=2026-09-13-audio-events';
import { mountLeaderboard, formatDuration } from './leaderboard.mjs?v=2026-09-12-game-over-actions-v2';
import { OnlineSession, ONLINE, generateCode, normalizeCode } from './online.mjs?v=2026-09-13-audio-events';
import { COUNTDOWN_DURATION_MS, EFFECT_SOUND_NAMES, MUSIC_SOUND_NAMES, countdownLabel, createSoundEffects, soundVolume } from './audio.mjs?v=2026-09-14-unified-audio';

const back = document.getElementById('back-link');
const season = new URLSearchParams(location.search).get('saison');
if (season) {
  const destination = new URL('../', location.href);
  destination.searchParams.set('saison', season);
  back.href = destination.href;
}

async function mount() {
  const canvas = document.getElementById('court');
  const render = await createRenderer(canvas);
  const state = createState();
  let difficulty = readDifficulty();
  let computer = createComputer({ difficulty });
  const startButton = document.getElementById('start-button');
  const pauseButton = document.getElementById('pause-button');
  const resetButton = document.getElementById('reset-button');
  const overlay = document.getElementById('game-overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const countdownDisplay = document.getElementById('countdown-display');
  const humanScore = document.getElementById('human-score');
  const computerScore = document.getElementById('computer-score');
  const gameTime = document.getElementById('game-time');
  const gameTimeFraction = document.getElementById('game-time-fraction');
  const status = document.getElementById('status');
  const power = document.getElementById('power');
  const powerLabel = document.getElementById('power-label');
  const fps = document.getElementById('fps');
  const musicToggle = document.getElementById('music-toggle');
  const effectsToggle = document.getElementById('effects-toggle');
  const menu = document.getElementById('game-menu');
  const menuButton = document.getElementById('menu-open');
  const actions = document.querySelector('.action-buttons');
  const controls = document.querySelector('.controls');
  const game = document.getElementById('game');
  const arena = document.querySelector('.arena');
  const instructions = document.querySelector('.field-notes');
  const rules = document.querySelector('.right-notes');
  const mobileControls = matchMedia('(pointer: coarse), (max-width: 800px)');
  let frameId = 0, previous = null, lastPaint = -Infinity, displayedPhase = '';
  let frameRate = 60;
  const primaryOverlayContent = document.getElementById('primary-overlay-content');
  const modeDivider = document.getElementById('mode-divider');
  const multiplayerOptions = document.getElementById('multiplayer-options');
  const onlineSetupPanel = document.getElementById('online-setup');
  const roomInfo = document.getElementById('room-info');
  const onlineButton = document.getElementById('online-open');
  const leaveButton = document.getElementById('leave-room');
  const localButton = document.getElementById('local-open');
  const localBackButton = document.getElementById('local-back');
  const gameOverBackButton = document.getElementById('game-over-back');
  const opponentPower = document.getElementById('opponent-power');
  let local = false;
  let onlineSetup = false;
  let online = null, networkTimer = null, onlineAudioPending = false, localCountdown = null, localCountdownPending = false, countdownRequest = 0;
  let input, roundId = crypto.randomUUID();
  const musicPreferenceKey = 'padelArcadeMusicEnabled';
  let musicEnabled = true;
  try { musicEnabled = localStorage.getItem(musicPreferenceKey) !== 'false'; } catch {}
  const sounds = createSoundEffects({
    elements: {
      gameMusic: document.getElementById('game-music'),
      countdown: document.getElementById('effect-countdown'),
      dodge: document.getElementById('effect-ball-dodge'),
      hit: document.getElementById('effect-ball-hit'),
      gameOver: document.getElementById('effect-game-over'),
      victory: document.getElementById('effect-victory')
    },
    // Ball samples receive a stronger mobile mix while countdown and music
    // cues retain their existing level.
    volume: name => soundVolume(name, mobileControls.matches),
    toggleNames: EFFECT_SOUND_NAMES
  });
  sounds.preload();
  const unlockEffects = () => {
    sounds.unlock(EFFECT_SOUND_NAMES);
    if (musicEnabled) sounds.unlock(MUSIC_SOUND_NAMES);
  };
  document.addEventListener('pointerdown', unlockEffects, { capture: true });
  document.addEventListener('keydown', unlockEffects, { capture: true });
  let lastEffectSequence = 0, soundPhase = state.phase, lastOnlineStage = null, onlineCountdownVoice = null, musicVoice = null;
  function updateAudioToggle(toggle, enabled, name) {
    const label = enabled ? `${name} stummschalten` : `${name} einschalten`;
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  }
  function updateMusicToggle() {
    updateAudioToggle(musicToggle, musicEnabled, 'Musik');
  }
  function syncMusic() {
    const playing = online ? online.stage === 'playing' : ['rally', 'point'].includes(state.phase);
    const shouldPlay = musicEnabled && playing && !document.hidden && !menu.open && document.getElementById('leaderboard').hidden;
    if (shouldPlay && !musicVoice) musicVoice = sounds.play('gameMusic', { enabled: true, loop: true, elementFallback: false });
    else if (!shouldPlay && musicVoice) { sounds.stop(musicVoice); musicVoice = null; }
  }
  updateMusicToggle();
  updateAudioToggle(effectsToggle, sounds.enabled, 'Effekte');
  musicToggle.addEventListener('click', () => {
    musicEnabled = !musicEnabled;
    if (musicEnabled) sounds.unlock(MUSIC_SOUND_NAMES);
    else { sounds.stopNames(MUSIC_SOUND_NAMES); musicVoice = null; }
    try { localStorage.setItem(musicPreferenceKey, String(musicEnabled)); } catch {}
    updateMusicToggle();
    syncMusic();
  });
  effectsToggle.addEventListener('click', () => {
    const enabled = sounds.toggle();
    if (enabled) sounds.unlock(EFFECT_SOUND_NAMES);
    updateAudioToggle(effectsToggle, enabled, 'Effekte');
  });
  function updateFpsToggle() {
    const nextFrameRate = frameRate === 60 ? 30 : 60;
    fps.textContent = `${frameRate} FPS`;
    fps.setAttribute('aria-label', `Bildrate: ${frameRate} FPS. Zu ${nextFrameRate} FPS wechseln`);
    fps.title = `Zu ${nextFrameRate} FPS wechseln`;
  }
  updateFpsToggle();
  fps.addEventListener('click', () => {
    frameRate = frameRate === 60 ? 30 : 60;
    lastPaint = -Infinity;
    updateFpsToggle();
    schedule();
  });
  function resetSoundTracking() {
    sounds.stopAll();
    musicVoice = null;
    lastEffectSequence = state.effectSequence;
    soundPhase = state.phase;
    lastOnlineStage = online?.stage ?? null;
    onlineCountdownVoice = null;
  }
  function syncSoundEffects() {
    if (state.effectSequence < lastEffectSequence) lastEffectSequence = 0;
    for (const effect of state.effects.filter(effect => effect.id > lastEffectSequence).sort((a, b) => a.id - b.id)) {
      sounds.play(effect.kind === 'hit' ? 'hit' : 'dodge');
    }
    lastEffectSequence = state.effectSequence;
    if (state.phase === 'over' && soundPhase !== 'over') sounds.play(state.winner === 1 ? 'victory' : 'gameOver', { enabled: musicEnabled });
    soundPhase = state.phase;
    const onlineStage = online?.stage ?? null;
    if (onlineStage === 'countdown' && lastOnlineStage !== 'countdown') {
      sounds.stopAll();
      musicVoice = null;
      const remaining = online.role === 'host' ? online.countdownUntil - online.now() : online.countdown;
      const elapsedSeconds = (ONLINE.countdown - Math.max(0, remaining)) / 1000;
      onlineCountdownVoice = sounds.play('countdown', { offsetSeconds: elapsedSeconds });
    }
    if (lastOnlineStage === 'countdown' && onlineStage !== 'countdown') {
      sounds.stop(onlineCountdownVoice);
      onlineCountdownVoice = null;
    }
    lastOnlineStage = onlineStage;
  }
  function finishLocalCountdown() {
    if (!localCountdown) return;
    const voice = localCountdown.voice;
    localCountdown = null;
    sounds.stop(voice);
    start(state); input.clear(); simulation.reset(); previous = null; displayedPhase = '';
    update(); render(state); schedule();
  }
  function cancelLocalCountdown() {
    countdownRequest++;
    localCountdownPending = false;
    if (!localCountdown) return;
    sounds.stop(localCountdown.voice);
    localCountdown = null;
    displayedPhase = '';
  }
  async function beginLocalCountdown() {
    if (localCountdown || localCountdownPending || state.phase !== 'ready') return;
    const request = ++countdownRequest;
    localCountdownPending = true;
    await sounds.unlock(EFFECT_SOUND_NAMES);
    if (musicEnabled) sounds.decode(MUSIC_SOUND_NAMES);
    if (request !== countdownRequest || state.phase !== 'ready') return;
    localCountdownPending = false;
    const durationMs = COUNTDOWN_DURATION_MS;
    sounds.stopAll();
    musicVoice = null;
    const voice = sounds.play('countdown');
    localCountdown = { startedAt: performance.now(), durationMs, voice };
    input.clear(); simulation.reset(); previous = null; displayedPhase = '';
    update(); render(state); schedule();
  }
  function localCountdownElapsed(now = performance.now()) {
    if (!localCountdown) return 0;
    return now - localCountdown.startedAt;
  }
  const simulation = createClock(() => step(state, input.read(), local ? input.readOpponent() : computer.read(state), local ? null : computer.stroke));
  function toggle() {
    if (menu.open || onlineSetup || !document.getElementById('leaderboard').hidden) return;
    if (online) { input.clear(); if (['playing', 'countdown'].includes(online.stage)) online.requestPause(); else online.requestReady(); return; }
    if (localCountdown) return;
    cancelAnimationFrame(frameId); frameId = 0; previous = null;
    if (state.phase === 'rally' || state.phase === 'point') pause(state);
    else if (state.phase === 'ready') { beginLocalCountdown(); return; }
    else if (state.phase !== 'over') start(state);
    input.clear(); simulation.reset(); update(); render(state); schedule();
  }
  input = createInput(canvas, null, () => state.teams[1], toggle);
  function arrangeControls() {
    localButton.disabled = mobileControls.matches;
    localButton.title = mobileControls.matches ? 'Nur mit Tastatur verfügbar' : '';
    if (mobileControls.matches) {
      document.getElementById('menu-actions').append(actions);
      document.getElementById('mobile-instructions').append(instructions, rules);
    } else {
      menu.close();
      controls.insertBefore(actions, menuButton);
      game.insertBefore(instructions, arena);
      game.append(rules);
    }
  }
  arrangeControls();
  mobileControls.addEventListener('change', arrangeControls);
  menuButton.addEventListener('click', () => {
    stopForVisibility();
    menu.showModal();
  });
  document.getElementById('menu-close').addEventListener('click', () => menu.close());
  menu.addEventListener('click', event => {
    if (event.target !== menu) return;
    const rect = menu.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) menu.close();
  });
  actions.addEventListener('click', event => {
    if (event.target.closest('#pause-button, #reset-button, #leaderboard-open')) menu.close();
  }, { capture: true });
  const leaderboard = mountLeaderboard({ pauseGame: stopForVisibility, getDifficulty: () => difficulty });
  function showPower(meter, label, value) {
    meter.value = value;
    label.textContent = value < -0.15 ? 'KURZ' : value > 0.85 ? 'ZU HART!' : value > 0.45 ? 'DRUCK' : 'RUHIG';
    meter.setAttribute('aria-valuetext', label.textContent);
    meter.closest('.power-display').classList.toggle('danger', value > 0.85);
    meter.closest('.power-display').classList.toggle('short-shot', value < -0.15);
  }
  function update() {
    if (online) Object.assign(state, online.view());
    syncSoundEffects();
    syncMusic();
    humanScore.textContent = state.score[1]; computerScore.textContent = state.score[0];
    const formattedGameTime = formatDuration(Math.round(state.time * 1000));
    gameTime.firstChild.nodeValue = formattedGameTime.slice(0, -3);
    gameTimeFraction.textContent = formattedGameTime.slice(-3);
    const message = local && ['point', 'over'].includes(state.phase)
      ? state.message.replace(/^(Dein Punkt|Punkt Computer)/, state.winner === 1 ? 'Punkt Pfeiltasten' : 'Punkt WASD') : state.message;
    if (!online && status.textContent !== message) status.textContent = message;
    showPower(power, powerLabel, state.teams[1].power);
    if (local) showPower(opponentPower, document.getElementById('opponent-power-label'), state.teams[0].power);
    document.getElementById('start-difficulty').hidden = !!online || local || !!localCountdown || state.phase !== 'ready';
    updateOverlayChoices();
    overlay.classList.toggle('game-over-actions', !online && state.phase === 'over');
    countdownDisplay.hidden = !localCountdown && online?.stage !== 'countdown';
    if (online) { updateOnline(); return; }
    setText(document.getElementById('opponent-label'), local ? 'WASD' : 'CPU');
    if (localCountdown) {
      const label = countdownLabel(localCountdownElapsed(), localCountdown.durationMs);
      const countdownPhase = `countdown:${label}`;
      if (displayedPhase === countdownPhase) return;
      displayedPhase = countdownPhase;
      overlay.hidden = true;
      countdownDisplay.textContent = label;
      status.textContent = label === 'GO' ? 'Los geht’s!' : `Start in ${label} …`;
      document.getElementById('leaderboard-after-game').hidden = true;
      gameOverBackButton.hidden = true;
      pauseButton.disabled = true;
      resetButton.disabled = false;
      return;
    }
    countdownDisplay.hidden = true;
    if (displayedPhase === state.phase) return;
    displayedPhase = state.phase;
    overlay.hidden = ['rally', 'point'].includes(state.phase);
    document.getElementById('leaderboard-after-game').hidden = state.phase !== 'over';
    gameOverBackButton.hidden = state.phase !== 'over';
    pauseButton.disabled = ['ready', 'over'].includes(state.phase);
    resetButton.disabled = state.phase === 'ready';
    pauseButton.textContent = state.phase === 'paused' ? 'Weiter' : 'Pause';
    if (state.phase === 'over') {
      overlayTitle.textContent = local ? (state.winner === 1 ? 'Pfeiltasten gewinnen!' : 'WASD gewinnt!') : state.winner === 1 ? 'Gewonnen!' : 'Revanche?';
      overlayText.textContent = `${state.score[1]} : ${state.score[0]} · Spielzeit ${formatDuration(Math.round(state.time * 1000))}`;
      startButton.textContent = 'Noch eine Partie';
      startButton.focus({ preventScroll: true });
      if (!local) {
        overlayText.textContent += ` · ${DIFFICULTIES[difficulty].label}`;
        leaderboard.finish(state, roundId, difficulty);
      }
    } else if (state.phase === 'paused') {
      overlayTitle.textContent = 'Pause'; overlayText.textContent = local ? 'Gemeinsame Pause. Weiter mit Leertaste / P oder dem Button.' : 'Kurz durchatmen. Dein Spiel wartet.';
      startButton.textContent = 'Weiterspielen';
    } else if (state.phase === 'ready') {
      overlayTitle.textContent = local ? 'Zu zweit bereit?' : 'Bereit?'; overlayText.textContent = local ? 'Gelb unten: Pfeiltasten. Korall oben: WASD. Ihr trefft automatisch.' : 'Dein Doppel ist gelb. Triff den Ball automatisch.';
      startButton.textContent = local ? 'Spiel starten' : 'Gegen Computer';
    }
  }
  function frame(now) {
    frameId = 0;
    if (localCountdown) {
      if (localCountdownElapsed(now) >= localCountdown.durationMs) finishLocalCountdown();
      else {
        previous = null;
        const interval = 1000 / frameRate;
        if (now - lastPaint >= interval - 0.5) {
          lastPaint = Number.isFinite(lastPaint) ? lastPaint + Math.max(1, Math.floor((now - lastPaint + 0.5) / interval)) * interval : now;
          render(state); update();
        }
        schedule();
        return;
      }
    } else if (previous !== null) {
      if (online) online.advance((now - previous) / 1000);
      else simulation.advance((now - previous) / 1000);
    }
    if (online) Object.assign(state, online.view());
    previous = now;
    const interval = 1000 / frameRate;
    if (now - lastPaint >= interval - 0.5 || displayedPhase !== state.phase) {
      lastPaint = Number.isFinite(lastPaint) ? lastPaint + Math.max(1, Math.floor((now - lastPaint + 0.5) / interval)) * interval : now;
      render(state); update();
    }
    schedule();
  }
  function schedule() {
    if (!frameId && !document.hidden && (online ? !online.closed : localCountdown || ['rally', 'point'].includes(state.phase))) frameId = requestAnimationFrame(frame);
    else if (!['rally', 'point'].includes(state.phase)) previous = null;
  }
  function stopForVisibility() {
    if (online) online.requestPause();
    cancelLocalCountdown();
    pause(state); input.clear(); simulation.reset(); previous = null;
    cancelAnimationFrame(frameId); frameId = 0;
    update(); render(state);
  }
  startButton.addEventListener('click', async () => {
    if (online) {
      if (onlineAudioPending) return;
      const room = online;
      onlineAudioPending = true;
      input.clear();
      await sounds.unlock(EFFECT_SOUND_NAMES);
      if (musicEnabled) sounds.decode(MUSIC_SOUND_NAMES);
      onlineAudioPending = false;
      if (online !== room) return;
      room.requestReady(); canvas.focus({ preventScroll: true });
      return;
    }
    if (state.phase === 'over') { reset(state); computer.reset(); leaderboard.reset(); roundId = crypto.randomUUID(); resetSoundTracking(); }
    if (state.phase === 'ready') beginLocalCountdown();
    else { start(state); input.clear(); simulation.reset(); previous = null; update(); render(state); }
    canvas.focus({ preventScroll: true }); schedule();
  });
  pauseButton.addEventListener('click', () => { toggle(); canvas.focus({ preventScroll: true }); });
  resetButton.addEventListener('click', showModeSelection);
  document.addEventListener('visibilitychange', () => {
    online?.setVisible(!document.hidden);
    if (document.hidden) stopForVisibility();
    else { sounds.resume(); syncMusic(); previous = null; schedule(); }
  });
  window.addEventListener('blur', () => { online?.setVisible(false); stopForVisibility(); });
  window.addEventListener('focus', () => { online?.setVisible(!document.hidden); sounds.resume(); syncMusic(); previous = null; schedule(); });
  window.addEventListener('pagehide', () => { online?.leave(); sounds.stopAll(); musicVoice = null; stopForVisibility(); });
  function setText(element, value) { if (element.textContent !== value) element.textContent = value; }
  function updateOnline() {
    displayedPhase = state.phase;
    const stage = online.stage;
    const interrupted = online.suspended;
    overlay.classList.add('online-overlay');
    overlay.hidden = ['playing', 'countdown'].includes(stage) && !interrupted;
    roomInfo.hidden = !['waiting', 'paused'].includes(stage) || interrupted;
    setText(document.getElementById('room-code'), online.code);
    setText(document.getElementById('room-players'), online.peer
      ? `Du: ${online.ready[online.side] ? 'bereit' : 'noch nicht bereit'} · Gegner: ${online.ready[1 - online.side] ? 'bereit' : 'noch nicht bereit'}`
      : '1 von 2 Spielern');
    setText(document.getElementById('opponent-label'), 'GEGNER');
    document.getElementById('enter-win').hidden = true;
    document.getElementById('leaderboard-after-game').hidden = true;
    gameOverBackButton.hidden = true;
    leaveButton.hidden = false;
    startButton.hidden = !['waiting', 'paused', 'over'].includes(stage) || interrupted;
    startButton.disabled = !online.peer || !online.connected || interrupted || !online.visible || !online.peerVisible;
    setText(startButton, online.ready[online.side] ? 'Doch nicht bereit' : stage === 'over' ? 'Bereit zur Revanche' : stage === 'paused' ? 'Bereit zum Weiterspielen' : 'Bereit');
    pauseButton.disabled = !['playing', 'countdown'].includes(stage);
    setText(pauseButton, 'Pause'); resetButton.hidden = false; resetButton.disabled = false;
    const titles = { connecting: 'Verbinden …', waiting: 'Warteraum', countdown: 'Gleich geht’s los', paused: 'Pause', over: state.winner === 1 ? 'Gewonnen!' : 'Revanche?', ended: 'Spiel beendet' };
    const countdownRemaining = online.role === 'host' ? online.countdownUntil - online.now() : online.countdown;
    const countdown = countdownLabel(ONLINE.countdown - Math.max(0, countdownRemaining), ONLINE.countdown);
    countdownDisplay.hidden = interrupted || stage !== 'countdown';
    if (stage === 'countdown' && !interrupted) setText(countdownDisplay, countdown);
    setText(overlayTitle, interrupted ? 'Verbindung fehlt' : titles[stage] || '');
    setText(overlayText, stage === 'over' ? `${state.score[1]} : ${state.score[0]} · Spielzeit ${formatDuration(Math.round(state.time * 1000))}` : online.message);
    setText(status, interrupted || stage !== 'playing' ? online.message : state.message);
  }
  function updateOverlayChoices() {
    const initialSelection = !online && !onlineSetup && !localCountdown && !local && state.phase === 'ready';
    primaryOverlayContent.hidden = onlineSetup || !!localCountdown;
    modeDivider.hidden = !initialSelection;
    multiplayerOptions.hidden = !initialSelection;
    onlineSetupPanel.hidden = !onlineSetup;
    localBackButton.hidden = !!localCountdown || !(local && state.phase === 'ready');
  }
  function showOnlineSetup() {
    stopForVisibility(); menu.close();
    onlineSetup = true;
    document.getElementById('join-message').textContent = '';
    overlay.classList.add('setup-overlay');
    overlay.hidden = false;
    overlayTitle.textContent = 'Online';
    updateOverlayChoices();
    document.getElementById('create-room').focus({ preventScroll: true });
  }
  function showModeSelection() {
    if (online) { exitRoom(); return; }
    cancelLocalCountdown();
    menu.close(); cancelAnimationFrame(frameId); frameId = 0; previous = null;
    onlineSetup = false; setLocalMode(false);
    reset(state); computer.reset(); leaderboard.reset(); input.clear(); simulation.reset(); roundId = crypto.randomUUID();
    overlay.classList.remove('setup-overlay'); displayedPhase = '';
    resetSoundTracking(); update(); render(state); startButton.focus({ preventScroll: true });
  }
  function exitRoom() {
    const room = online; online = null; room?.leave(); clearInterval(networkTimer); networkTimer = null;
    cancelAnimationFrame(frameId); frameId = 0; previous = null;
    reset(state); computer.reset(); leaderboard.reset(); input.clear(); simulation.reset(); roundId = crypto.randomUUID();
    onlineSetup = false; overlay.classList.remove('online-overlay', 'setup-overlay'); roomInfo.hidden = true; leaveButton.hidden = true;
    startButton.hidden = false; startButton.disabled = false;
    resetButton.hidden = false;
    document.getElementById('opponent-label').textContent = 'CPU'; displayedPhase = '';
    menu.close(); resetSoundTracking(); update(); render(state); startButton.focus({ preventScroll: true });
  }
  function enterRoom(role, code) {
    if (online) return;
    try {
      code = normalizeCode(code);
      const room = new OnlineSession({ role, code, config: window.PADEL_SUPABASE_CONFIG, readInput: () => input.read(), onChange: () => {
        if (!online) return;
        if (online.closed) clearInterval(networkTimer);
        if (!frameId || document.hidden) { update(); render(state); }
        schedule();
      } });
      stopForVisibility(); leaderboard.reset(); input.clear();
      onlineSetup = false; setLocalMode(false);
      online = room; previous = null; displayedPhase = '';
      overlay.classList.remove('setup-overlay'); menu.close();
      online.setVisible(!document.hidden);
      networkTimer = setInterval(() => online?.tick(), 50);
      resetSoundTracking(); update(); render(state); schedule(); canvas.focus({ preventScroll: true });
    } catch (error) { document.getElementById('join-message').textContent = error.message; }
  }
  function setLocalMode(enabled) {
    local = enabled; input.setLocalMultiplayer(enabled);
    document.body.classList.toggle('local-duel', enabled);
    document.getElementById('human-label').textContent = enabled ? 'PFEILE' : 'DU';
    document.getElementById('opponent-label').textContent = enabled ? 'WASD' : 'CPU';
    document.getElementById('local-instruction').hidden = !enabled;
    document.getElementById('opponent-power-display').hidden = !enabled;
    document.getElementById('power-caption').textContent = enabled ? 'PFEILE · DRUCK' : 'SCHLAGDRUCK';
    canvas.setAttribute('aria-label', enabled
      ? 'PadelArcade zu zweit. Gelb unten mit Pfeiltasten, Korall oben mit WASD. Leertaste oder P pausiert für beide.'
      : 'PadelArcade. Du spielst unten mit den gelben Balken. Bewegen mit Pfeiltasten oder WASD.');
  }
  function chooseLocalMode(enabled) {
    menu.close(); stopForVisibility(); onlineSetup = false;
    overlay.classList.remove('setup-overlay');
    setLocalMode(enabled); reset(state); computer.reset(); leaderboard.reset();
    roundId = crypto.randomUUID(); displayedPhase = ''; simulation.reset();
    resetSoundTracking(); update(); render(state); startButton.focus({ preventScroll: true });
  }
  function syncDifficulty() {
    for (const button of document.querySelectorAll('[data-start-difficulty]')) {
      const selected = button.dataset.startDifficulty === difficulty;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('active', selected);
    }
  }
  function selectDifficulty(value) {
    difficulty = requireDifficulty(value); saveDifficulty(difficulty);
    computer = createComputer({ difficulty });
    syncDifficulty(); update(); render(state);
  }
  for (const button of document.querySelectorAll('[data-start-difficulty]')) button.addEventListener('click', () => {
    if (!online && !local && state.phase === 'ready') selectDifficulty(button.dataset.startDifficulty);
  });
  syncDifficulty();
  localButton.addEventListener('click', () => chooseLocalMode(true));
  localBackButton.addEventListener('click', () => chooseLocalMode(false));
  onlineButton.addEventListener('click', showOnlineSetup);
  gameOverBackButton.addEventListener('click', showModeSelection);
  document.getElementById('online-back').addEventListener('click', showModeSelection);
  document.getElementById('create-room').addEventListener('click', () => enterRoom('host', generateCode()));
  document.getElementById('join-room-form').addEventListener('submit', event => {
    event.preventDefault(); enterRoom('guest', document.getElementById('join-code').value);
  });
  leaveButton.addEventListener('click', exitRoom);
  document.getElementById('copy-room-code').addEventListener('click', async () => {
    if (!online) return;
    try { await navigator.clipboard.writeText(online.code); status.textContent = 'Raumcode kopiert.'; }
    catch { status.textContent = `Raumcode: ${online.code}`; }
  });
  startButton.disabled = false; resetButton.disabled = false; menuButton.disabled = false;
  onlineButton.disabled = false; localButton.disabled = mobileControls.matches;
  update(); render(state);
}
mount().catch(error => {
  document.getElementById('overlay-title').textContent = 'Laden fehlgeschlagen';
  document.getElementById('overlay-text').textContent = 'Bitte lade die Seite erneut. Über „Zurück zur Liga“ kommst du jederzeit zurück.';
  document.getElementById('start-button').hidden = true;
  console.error('PadelArcade:', error);
});
