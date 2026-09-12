import { RULESET, requireRuleset } from './ruleset.mjs?v=2026-09-12-rules-v2';
import { DIFFICULTIES, requireDifficulty } from './difficulty.mjs?v=2026-09-12-rules-v2';
import { normalizeName } from './name-policy.mjs?v=2026-09-12-rules-v2';
export { normalizeName } from './name-policy.mjs?v=2026-09-12-rules-v2';

export function formatDuration(ms) {
  const hundredths = Math.round(ms / 10);
  const seconds = Math.floor(hundredths / 100);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')},${String(hundredths % 100).padStart(2, '0')}`;
}
const entryDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
export function formatEntryDate(value) {
  if (!value) return '–';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '–';
  const parts = Object.fromEntries(entryDateFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}
export function winningEntry(state, roundId, difficulty = 'hard') {
  if (state.phase !== 'over' || state.winner !== 1 || state.score[1] !== 7 || state.score[0] < 0 || state.score[0] > 6) return null;
  return Object.freeze({ roundId, ruleset: requireRuleset(state.ruleset), difficulty: requireDifficulty(difficulty), humanScore: 7, computerScore: state.score[0], durationMs: Math.round(state.time * 1000), bestRally: state.bestRally });
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
      if (error.message === 'ARCADE_RULESET_CLOSED') throw new Error('Diese Spielversion ist abgeschlossen. Bitte lade die Seite neu und starte eine neue Partie.');
      if (error.message === 'ARCADE_NAME_BLOCKED') throw new Error('Dieser Name ist nicht erlaubt. Bitte wähle einen anderen.');
      if (error.message === 'ARCADE_NAME_INVALID') throw new Error('Bitte verwende 1 bis 16 Buchstaben oder Zahlen, ohne Leerzeichen und Sonderzeichen.');
      throw new Error(response.status === 404 ? 'Die Bestenliste wird gerade eingerichtet. Bitte versuche es später erneut.' : 'Die Bestenliste ist gerade nicht erreichbar. Bitte versuche es erneut.');
    }
    return response.json();
  }
  return {
    list: (roundId = null, difficulty = 'hard') => rpc('get_arcade_leaderboard', { p_round_id: roundId, p_difficulty: requireDifficulty(difficulty), p_ruleset: RULESET }),
    save: (entry, name) => rpc('submit_arcade_win', { p_round_id: entry.roundId, p_name: normalizeName(name), p_human_score: entry.humanScore, p_computer_score: entry.computerScore, p_duration_ms: entry.durationMs, p_best_rally: entry.bestRally, p_difficulty: requireDifficulty(entry.difficulty ?? 'hard'), p_ruleset: requireRuleset(entry.ruleset) })
  };
}
export function mountLeaderboard({ pauseGame, getDifficulty = () => 'hard', api = createLeaderboardApi(window.PADEL_SUPABASE_CONFIG) }) {
  const panel = document.getElementById('leaderboard');
  const game = document.getElementById('game'), controls = document.querySelector('.controls');
  const form = document.getElementById('win-form'), name = document.getElementById('winner-name');
  const nameError = document.getElementById('winner-name-error'), nameCount = document.getElementById('winner-name-count');
  const list = document.getElementById('leaderboard-results'), body = document.getElementById('leaderboard-rows');
  const message = document.getElementById('leaderboard-message'), result = document.getElementById('win-result');
  const saveButton = document.getElementById('save-win');
  const ownBody = document.getElementById('leaderboard-own');
  const retry = document.getElementById('leaderboard-retry');
  const difficultyChoice = document.getElementById('leaderboard-difficulty');
  const savedRounds = { easy: null, hard: null };
  let difficulty = requireDifficulty(getDifficulty());
  let pending = null, lastRound = null, saving = false, generation = 0, returnFocus;
  function setMessage(value, type = '') {
    message.textContent = value;
    message.classList.toggle('is-success', type === 'success');
  }
  function setNameError(value = '') {
    nameError.textContent = value;
    nameError.hidden = !value;
    name.setAttribute('aria-invalid', String(Boolean(value)));
  }
  function validateName(showEmpty = false) {
    nameCount.textContent = `${[...name.value].length}/16`;
    if (!name.value && !showEmpty) { setNameError(); return null; }
    try {
      const normalized = normalizeName(name.value);
      setNameError();
      return normalized;
    } catch (error) {
      setNameError(!name.value.trim() && showEmpty ? 'Bitte gib einen Namen ein.' : error.message);
      return null;
    }
  }
  function view() {
    pauseGame(); returnFocus = document.activeElement;
    game.hidden = true; controls.hidden = true; panel.hidden = false;
    document.querySelector('.arcade-shell').classList.add('show-leaderboard');
  }
  function appendEntry(target, entry) {
    const row = document.createElement('tr');
    row.classList.toggle('is-own-result', entry.isOwn === true);
    if (entry.isOwn) row.setAttribute('aria-label', 'Dein Ergebnis');
    for (const [index, value] of [entry.rank, entry.name, `7:${entry.computerScore}`, formatDuration(entry.durationMs), entry.bestRally ?? '–'].entries()) {
      const cell = document.createElement('td');
      if (index === 3) {
        const fraction = document.createElement('span');
        fraction.className = 'ranking-time-fraction';
        fraction.textContent = value.slice(-3);
        cell.append(value.slice(0, -3), fraction);
      } else cell.textContent = value;
      row.append(cell);
    }
    const date = document.createElement('time');
    date.className = 'ranking-date';
    date.textContent = formatEntryDate(entry.createdAt);
    if (date.textContent !== '–') date.dateTime = entry.createdAt;
    date.title = 'Eingetragen · deutsche Ortszeit';
    row.children[1].append(date);
    target.append(row);
  }
  async function load(notice = '') {
    const request = ++generation;
    form.hidden = true; list.hidden = false; retry.hidden = true; difficultyChoice.hidden = false;
    for (const button of difficultyChoice.querySelectorAll('button')) {
      const selected = button.dataset.rankingDifficulty === difficulty;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('active', selected);
    }
    document.querySelector('.arcade-ranking caption').textContent = `Globale PadelArcade-Bestenliste · ${DIFFICULTIES[difficulty].label}`;
    body.replaceChildren(); ownBody.replaceChildren(); ownBody.hidden = true;
    setMessage(notice || 'Bestenliste wird geladen …', notice ? 'success' : '');
    try {
      const data = await api.list(savedRounds[difficulty], difficulty);
      if (request !== generation) return;
      for (const entry of data.entries) appendEntry(body, entry);
      if (data.ownEntry) {
        const labelRow = document.createElement('tr'), label = document.createElement('th');
        label.colSpan = 5; label.scope = 'rowgroup'; label.textContent = 'Dein Ergebnis';
        labelRow.append(label); ownBody.append(labelRow);
        appendEntry(ownBody, data.ownEntry); ownBody.hidden = false;
      }
      setMessage(notice || (data.entries.length ? '' : 'Noch keine Siege eingetragen. Setze die erste Bestmarke!'), notice ? 'success' : '');
    } catch (error) {
      if (request !== generation) return;
      setMessage(notice ? `${notice} ${error.message}` : error.message);
      retry.hidden = false;
    }
  }
  function openList() { difficulty = requireDifficulty(getDifficulty()); view(); load(); document.getElementById('leaderboard-title').focus(); }
  function showWin() {
    difficulty = pending.difficulty; difficultyChoice.hidden = true;
    view(); ++generation; form.hidden = false; list.hidden = true; retry.hidden = true;
    setMessage(''); name.value = ''; validateName(); saveButton.disabled = false;
    result.textContent = `Dein Sieg · ${DIFFICULTIES[pending.difficulty].label}: 7:${pending.computerScore} · Spielzeit ${formatDuration(pending.durationMs)} · Längster Ballwechsel: ${pending.bestRally} Schläge`;
    name.focus();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!pending || saving) return;
    const enteredName = validateName(true);
    if (!enteredName) return;
    const entry = pending;
    saving = true; saveButton.disabled = true; name.disabled = true;
    document.getElementById('leaderboard-back').disabled = true;
    document.getElementById('skip-win').disabled = true;
    setMessage('Sieg wird gespeichert …');
    try {
      await api.save(entry, enteredName);
      savedRounds[entry.difficulty] = entry.roundId;
      difficulty = entry.difficulty;
      pending = null;
      await load('Sieg erfolgreich gespeichert.');
    } catch (error) {
      if (/Name|Buchstaben|Zahlen|Leerzeichen|Sonderzeichen/.test(error.message)) {
        name.disabled = false; setMessage(''); setNameError(error.message); name.focus();
      } else setMessage(error.message);
    }
    finally {
      saving = false; saveButton.disabled = false; name.disabled = false;
      document.getElementById('leaderboard-back').disabled = false;
      document.getElementById('skip-win').disabled = false;
    }
  });
  name.addEventListener('input', () => validateName());
  document.getElementById('leaderboard-open').addEventListener('click', openList);
  document.getElementById('leaderboard-after-game').addEventListener('click', openList);
  document.getElementById('enter-win').addEventListener('click', () => pending ? showWin() : openList());
  document.getElementById('skip-win').addEventListener('click', () => load());
  retry.addEventListener('click', () => load());
  for (const button of difficultyChoice.querySelectorAll('button')) button.addEventListener('click', () => {
    if (saving) return;
    difficulty = requireDifficulty(button.dataset.rankingDifficulty); load();
  });
  document.getElementById('leaderboard-back').addEventListener('click', () => {
    ++generation; panel.hidden = true; game.hidden = false; controls.hidden = false;
    document.querySelector('.arcade-shell').classList.remove('show-leaderboard');
    (returnFocus?.isConnected ? returnFocus : document.getElementById('start-button')).focus();
  });
  return {
    finish(state, roundId, difficulty = getDifficulty()) {
      if (lastRound === roundId) return;
      lastRound = roundId; pending = winningEntry(state, roundId, difficulty);
      document.getElementById('enter-win').hidden = !pending;
      if (pending) showWin();
    },
    reset() { pending = null; document.getElementById('enter-win').hidden = true; }
  };
}
