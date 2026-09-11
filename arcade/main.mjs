import { createState, createClock, start, pause, reset, step } from './physics.mjs';
import { createComputer } from './computer.mjs';
import { createInput } from './input.mjs';
import { createRenderer } from './renderer.mjs';

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
  const state = createState(), computer = createComputer();
  const startButton = document.getElementById('start-button');
  const pauseButton = document.getElementById('pause-button');
  const resetButton = document.getElementById('reset-button');
  const overlay = document.getElementById('game-overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const humanScore = document.getElementById('human-score');
  const computerScore = document.getElementById('computer-score');
  const status = document.getElementById('status');
  const power = document.getElementById('power');
  const powerLabel = document.getElementById('power-label');
  const fps = document.getElementById('fps');
  let frameId = 0, previous = null, lastPaint = -Infinity, displayedPhase = '';
  let input;
  const simulation = createClock(() => step(state, input.read(), computer.read(state)));
  function toggle() {
    cancelAnimationFrame(frameId); frameId = 0; previous = null;
    if (state.phase === 'rally' || state.phase === 'point') pause(state);
    else if (state.phase !== 'over') start(state);
    input.clear(); simulation.reset(); update(); render(state); schedule();
  }
  input = createInput(canvas, document.getElementById('joystick'), () => state.teams[1], toggle);
  function update() {
    humanScore.textContent = state.score[1]; computerScore.textContent = state.score[0];
    if (status.textContent !== state.message) status.textContent = state.message;
    power.value = state.teams[1].power;
    powerLabel.textContent = power.value > 0.85 ? 'ZU HART!' : power.value > 0.45 ? 'DRUCK' : 'RUHIG';
    power.closest('.power-display').classList.toggle('danger', power.value > 0.85);
    if (displayedPhase === state.phase) return;
    displayedPhase = state.phase;
    overlay.hidden = ['rally', 'point'].includes(state.phase);
    pauseButton.disabled = ['ready', 'over'].includes(state.phase);
    pauseButton.textContent = state.phase === 'paused' ? 'Weiter' : 'Pause';
    if (state.phase === 'over') {
      overlayTitle.textContent = state.winner === 1 ? 'Gewonnen!' : 'Revanche?';
      overlayText.textContent = `${state.score[1]} : ${state.score[0]} · Längster Ballwechsel: ${state.bestRally} Schläge`;
      startButton.textContent = 'Noch eine Partie';
      startButton.focus({ preventScroll: true });
    } else if (state.phase === 'paused') {
      overlayTitle.textContent = 'Pause'; overlayText.textContent = 'Kurz durchatmen. Dein Spiel wartet.';
      startButton.textContent = 'Weiterspielen';
    } else if (state.phase === 'ready') {
      overlayTitle.textContent = 'Bereit?'; overlayText.textContent = 'Dein Doppel ist gelb. Triff den Ball automatisch.';
      startButton.textContent = 'Spiel starten';
    }
  }
  function frame(now) {
    frameId = 0;
    if (previous !== null) simulation.advance((now - previous) / 1000);
    previous = now;
    const interval = 1000 / Number(fps.value);
    if (now - lastPaint >= interval - 0.5 || displayedPhase !== state.phase) {
      lastPaint = Number.isFinite(lastPaint) ? lastPaint + Math.max(1, Math.floor((now - lastPaint + 0.5) / interval)) * interval : now;
      render(state); update();
    }
    schedule();
  }
  function schedule() {
    if (!frameId && !document.hidden && ['rally', 'point'].includes(state.phase)) frameId = requestAnimationFrame(frame);
    else if (!['rally', 'point'].includes(state.phase)) previous = null;
  }
  function stopForVisibility() {
    pause(state); input.clear(); simulation.reset(); previous = null;
    cancelAnimationFrame(frameId); frameId = 0;
    update(); render(state);
  }
  startButton.addEventListener('click', () => {
    if (state.phase === 'over') { reset(state); computer.reset(); }
    start(state); input.clear(); simulation.reset(); previous = null; update(); render(state);
    canvas.focus({ preventScroll: true }); schedule();
  });
  pauseButton.addEventListener('click', () => { toggle(); canvas.focus({ preventScroll: true }); });
  resetButton.addEventListener('click', () => {
    cancelAnimationFrame(frameId); frameId = 0; previous = null;
    reset(state); computer.reset(); input.clear(); simulation.reset(); update(); render(state);
    startButton.focus({ preventScroll: true });
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopForVisibility(); });
  window.addEventListener('blur', stopForVisibility);
  window.addEventListener('pagehide', stopForVisibility);
  startButton.disabled = false; resetButton.disabled = false;
  update(); render(state);
}
mount().catch(error => {
  document.getElementById('overlay-title').textContent = 'Laden fehlgeschlagen';
  document.getElementById('overlay-text').textContent = 'Bitte lade die Seite erneut. Über „Zurück zur Liga“ kommst du jederzeit zurück.';
  document.getElementById('start-button').hidden = true;
  console.error('PadelArcade:', error);
});
