import { normalizeName } from './name-policy.mjs';
export { normalizeName } from './name-policy.mjs';

export function formatDuration(ms) {
  const hundredths = Math.round(ms / 10);
  const seconds = Math.floor(hundredths / 100);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')},${String(hundredths % 100).padStart(2, '0')}`;
}
export function winningEntry(state, roundId) {
  if (state.phase !== 'over' || state.winner !== 1 || state.score[1] !== 7 || state.score[0] < 0 || state.score[0] > 6) return null;
  return Object.freeze({ roundId, humanScore: 7, computerScore: state.score[0], durationMs: Math.round(state.time * 1000) });
}
export function createLeaderboardApi(config, fetcher = fetch) {
  async function rpc(method, body) {
    if (!config?.url || !config?.publishableKey) throw new Error('Die Bestenliste ist noch nicht eingerichtet.');
    let response;
    try {
      response = await fetcher(`${config.url}/rest/v1/rpc/${method}`, {
        method: 'POST', headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(12000)
      });
    } catch { throw new Error('Verbindung fehlgeschlagen. Bitte versuche es erneut.'); }
    if (!response.ok) {
      const error = await response.json?.().catch(() => ({})) || {};
      if (error.message === 'ARCADE_NAME_BLOCKED') throw new Error('Dieser Name ist nicht erlaubt. Bitte wähle einen anderen.');
      if (error.message === 'ARCADE_NAME_INVALID') throw new Error('Bitte verwende 1 bis 16 Buchstaben oder Zahlen, ohne Leerzeichen und Sonderzeichen.');
      throw new Error(response.status === 404 ? 'Die Bestenliste wird gerade eingerichtet. Bitte versuche es später erneut.' : 'Die Bestenliste ist gerade nicht erreichbar. Bitte versuche es erneut.');
    }
    return response.json();
  }
  return {
    list: (roundId = null) => rpc('get_arcade_leaderboard', { p_round_id: roundId }),
    save: (entry, name) => rpc('submit_arcade_win', { p_round_id: entry.roundId, p_name: normalizeName(name), p_human_score: entry.humanScore, p_computer_score: entry.computerScore, p_duration_ms: entry.durationMs })
  };
}
export function mountLeaderboard({ pauseGame, api = createLeaderboardApi(window.PADEL_SUPABASE_CONFIG) }) {
  const panel = document.getElementById('leaderboard');
  const game = document.getElementById('game'), controls = document.querySelector('.controls');
  const form = document.getElementById('win-form'), name = document.getElementById('winner-name');
  const list = document.getElementById('leaderboard-results'), body = document.getElementById('leaderboard-rows');
  const message = document.getElementById('leaderboard-message'), result = document.getElementById('win-result');
  const saveButton = document.getElementById('save-win');
  const ownBody = document.getElementById('leaderboard-own');
  const retry = document.getElementById('leaderboard-retry');
  let pending = null, lastRound = null, saving = false, generation = 0, savedRoundId = null, returnFocus;
  function view() {
    pauseGame(); returnFocus = document.activeElement;
    game.hidden = true; controls.hidden = true; panel.hidden = false;
    document.querySelector('.arcade-shell').classList.add('show-leaderboard');
  }
  function appendEntry(target, entry) {
    const row = document.createElement('tr');
    row.classList.toggle('is-own-result', entry.isOwn === true);
    if (entry.isOwn) row.setAttribute('aria-label', 'Dein Ergebnis');
    for (const value of [entry.rank, entry.name, `7:${entry.computerScore}`, formatDuration(entry.durationMs)]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    target.append(row);
  }
  async function load(notice = '') {
    const request = ++generation;
    form.hidden = true; list.hidden = false; retry.hidden = true;
    body.replaceChildren(); ownBody.replaceChildren(); ownBody.hidden = true;
    message.textContent = notice || 'Bestenliste wird geladen …';
    try {
      const data = await api.list(savedRoundId);
      if (request !== generation) return;
      for (const entry of data.entries) appendEntry(body, entry);
      if (data.ownEntry) {
        const labelRow = document.createElement('tr'), label = document.createElement('th');
        label.colSpan = 4; label.scope = 'rowgroup'; label.textContent = 'Dein Ergebnis';
        labelRow.append(label); ownBody.append(labelRow);
        appendEntry(ownBody, data.ownEntry); ownBody.hidden = false;
      }
      message.textContent = notice || (data.entries.length ? '' : 'Noch keine Siege eingetragen. Setze die erste Bestmarke!');
    } catch (error) {
      if (request !== generation) return;
      message.textContent = notice ? `${notice} ${error.message}` : error.message;
      retry.hidden = false;
    }
  }
  function openList() { view(); load(); document.getElementById('leaderboard-title').focus(); }
  function showWin() {
    view(); ++generation; form.hidden = false; list.hidden = true; retry.hidden = true;
    message.textContent = ''; name.value = ''; saveButton.disabled = false;
    result.textContent = `Dein Sieg: 7:${pending.computerScore} · Spielzeit ${formatDuration(pending.durationMs)}`;
    name.focus();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!pending || saving) return;
    let enteredName;
    try { enteredName = normalizeName(name.value); } catch (error) { message.textContent = error.message; return; }
    const entry = pending;
    saving = true; saveButton.disabled = true; name.disabled = true;
    document.getElementById('leaderboard-back').disabled = true;
    document.getElementById('skip-win').disabled = true;
    message.textContent = 'Sieg wird gespeichert …';
    try {
      const saved = await api.save(entry, enteredName);
      savedRoundId = entry.roundId;
      pending = null;
      await load( `Sieg gespeichert – Platz ${saved.rank}.`);
    } catch (error) { message.textContent = error.message; }
    finally {
      saving = false; saveButton.disabled = false; name.disabled = false;
      document.getElementById('leaderboard-back').disabled = false;
      document.getElementById('skip-win').disabled = false;
    }
  });
  document.getElementById('leaderboard-open').addEventListener('click', openList);
  document.getElementById('leaderboard-after-game').addEventListener('click', openList);
  document.getElementById('enter-win').addEventListener('click', () => pending ? showWin() : openList());
  document.getElementById('skip-win').addEventListener('click', () => load());
  retry.addEventListener('click', () => load());
  document.getElementById('leaderboard-back').addEventListener('click', () => {
    ++generation; panel.hidden = true; game.hidden = false; controls.hidden = false;
    document.querySelector('.arcade-shell').classList.remove('show-leaderboard');
    (returnFocus?.isConnected ? returnFocus : document.getElementById('start-button')).focus();
  });
  return {
    finish(state, roundId) {
      if (lastRound === roundId) return;
      lastRound = roundId; pending = winningEntry(state, roundId);
      document.getElementById('enter-win').hidden = !pending;
      if (pending) showWin();
    },
    reset() { pending = null; document.getElementById('enter-win').hidden = true; }
  };
}
