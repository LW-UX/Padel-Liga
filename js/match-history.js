/* Optional, retrospective game histories. The confirmed result remains authoritative. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function sections(result) {
    const parts = String(result || '').trim().split(/\s*[,–-]\s*/);
    return parts.map((part, index) => {
      const score = part.match(/^(\d+)\s*:\s*(\d+)(?:\s*\(\s*(\d+)\s*:\s*(\d+)\s*\))?$/);
      if (!score) throw new Error('Das bestätigte Ergebnis kann nicht gelesen werden.');
      return { title: index === 2 ? 'Match-Tiebreak' : `Satz ${index + 1}`, score: [+score[1], +score[2]],
        tiebreak: score[3] == null ? null : [+score[3], +score[4]], target: index === 2 ? 10 : null };
    });
  }
  const totals = winners => winners.reduce((score, winner) => { score[winner - 1]++; return score; }, [0, 0]);
  const ended = (score, target) => target ? Math.max(...score) >= target && Math.abs(score[0] - score[1]) >= 2
    : (Math.max(...score) >= 6 && Math.abs(score[0] - score[1]) >= 2) || Math.max(...score) === 7;
  function validateSequence(winners, expected, target, complete = true) {
    if (!Array.isArray(winners) || winners.length > 1000) throw new Error('Ungültiger Verlauf.');
    const score = [0, 0];
    for (const winner of winners) {
      if (![1, 2].includes(winner) || ended(score, target)) throw new Error('Der Verlauf enthält einen ungültigen Spiel- oder Punktgewinn.');
      score[winner - 1]++;
      if (score.some((value, index) => value > expected[index])) throw new Error('Der Verlauf passt nicht zum bestätigten Ergebnis.');
    }
    if (complete && score.some((value, index) => value !== expected[index])) throw new Error('Bitte den Verlauf bis zum bestätigten Endstand ergänzen.');
    return score;
  }
  function validate(result, history, players = [], complete = true) {
    const expected = sections(result);
    if (!Array.isArray(history) || history.length !== expected.length) throw new Error('Der Verlauf muss alle Sätze enthalten.');
    history.forEach((part, index) => {
      const set = expected[index];
      validateSequence(part.winners, set.score, set.target, complete);
      if (!Array.isArray(part.servers) || part.servers.length !== part.winners.length) throw new Error('Ungültige Aufschlägerzuordnung.');
      part.servers.forEach((id, game) => {
        if (id !== null && (!players.some(player => player.playerId === id) || set.target || (set.tiebreak && game === 12))) throw new Error('Ungültiger Aufschläger.');
      });
      if (!Array.isArray(part.points)) throw new Error('Ungültiger Tiebreak-Verlauf.');
      if (part.points.length) {
        if (!set.tiebreak) throw new Error('Dieser Satz hat keinen Satz-Tiebreak.');
        validateSequence(part.points, set.tiebreak, 7, complete);
      }
    });
    return history;
  }
  const empty = result => sections(result).map(() => ({ winners: [], servers: [], points: [] }));
  function renderRows(winners, servers, players, pointMode = false) {
    const score = [0, 0];
    return `<div class="live-ticker-history">${winners.map((winner, index) => {
      score[winner - 1]++;
      const server = players.find(player => player.playerId === servers[index]);
      const isBreak = server && Number(server.team) !== winner;
      const breakLabel = isBreak ? '<strong>BREAK</strong>' : '';
      const ball = '<span aria-label="Aufschlag">◉</span>';
      const left = Number(server?.team) === 1 ? `${breakLabel}${esc(server.displayName)} ${ball}` : '';
      const right = Number(server?.team) === 2 ? `${ball} ${esc(server.displayName)}${breakLabel}` : '';
      return `<article class="live-ticker-game"><div class="live-ticker-game-line">
        <div class="live-ticker-game-server live-ticker-game-server-1">${left}</div>
        <div class="score score--game">${score.join(':')}</div>
        <div class="live-ticker-game-server live-ticker-game-server-2">${right}</div>
        </div>${pointMode ? '<span class="sr-only">Punktstand</span>' : ''}</article>`;
    }).join('')}</div>`;
  }
  function render(data) {
    const history = data.matchHistory?.sections;
    if (!history) return '<section class="widget match-statistics-section"><p class="hint">Für diese Partie wurde noch kein Spielverlauf eingetragen.</p></section>';
    return sections(data.result).map((set, index) => {
      const part = history[index];
      return `<section class="widget match-statistics-section match-history-set${set.target ? ' match-history-set--match-tiebreak' : ''}"><h3>${set.title} · ${set.score.join(':')}</h3>
        ${renderRows(part.winners, part.servers, data.players || [], Boolean(set.target))}
        ${set.tiebreak ? `<p class="hint match-history-tiebreak">Satz-Tiebreak · ${set.tiebreak.join(':')}</p>${part.points.length ? renderRows(part.points, [], [], true) : ''}` : ''}
      </section>`;
    }).join('');
  }
  function editor(data, draft, { busy = false, message = '' } = {}) {
    const disabled = busy ? ' disabled' : '';
    const names = team => (data.players || []).filter(player => Number(player.team) === team).map(player => player.displayName).join(' / ');
    const controls = (set, part, index, points = false) => {
      const winners = points ? part.points : part.winners;
      const expected = points ? set.tiebreak : set.score;
      const score = totals(winners);
      const done = score.every((value, i) => value === expected[i]);
      return `<div class="match-history-controls"><p>${points ? 'Satz-Tiebreak, Punkte (optional)' : set.target ? 'Punktgewinne' : 'Spielgewinne'} · <strong>${score.join(':')}</strong></p>
        <div class="match-history-actions">${[1, 2].map(team => `<button type="button" class="secondary-button" data-history-add="${team}" data-history-set="${index}" data-history-points="${points}"${disabled}${done || score[team - 1] >= expected[team - 1] || ended(score, points ? 7 : set.target) ? ' disabled' : ''}>Team ${team}${points || set.target ? ' + Punkt' : ' + Spiel'}</button>`).join('')}
        <button type="button" class="text-link" data-history-undo data-history-set="${index}" data-history-points="${points}"${disabled}${!winners.length ? ' disabled' : ''}>Zurücknehmen</button></div>
        <p class="hint">${winners.length ? winners.map(team => `Team ${team}`).join(' · ') : 'Noch keine Gewinne erfasst.'}</p>
        ${!points && !set.target ? winners.map((winner, game) => set.tiebreak && game === 12 ? '' : `<label class="match-history-server">Spiel ${game + 1} · Team ${winner}<select data-history-server="${game}" data-history-set="${index}"${disabled}><option value="">Aufschläger unbekannt</option>${(data.players || []).map(player => `<option value="${esc(player.playerId)}"${part.servers[game] === player.playerId ? ' selected' : ''}>${esc(player.displayName)}</option>`).join('')}</select></label>`).join('') : ''}</div>`;
    };
    return `<section class="widget match-statistics-section match-history-editor"><h3>Spielverlauf nachtragen</h3>
      <p class="hint">Team 1: ${esc(names(1))}<br>Team 2: ${esc(names(2))}</p>
      <p class="hint">Erfasse die Gewinne in ihrer Reihenfolge. Aufschläger und der Punkteverlauf eines Satz-Tiebreaks sind optional. Das bestätigte Ergebnis bleibt unverändert.</p>
      ${sections(data.result).map((set, index) => `<div class="match-history-editor-set"><h4>${set.title} · ${set.score.join(':')}</h4>${controls(set, draft[index], index)}${set.tiebreak ? controls(set, draft[index], index, true) : ''}</div>`).join('')}
      <label>Grund der Eintragung oder Korrektur<input data-history-reason type="text" minlength="3" maxlength="500" required${disabled}></label>
      <p role="status" class="hint" data-history-message>${esc(message)}</p>
      <div class="match-history-actions"><button type="button" class="primary-button" data-history-save${disabled}>${busy ? 'Wird gespeichert …' : 'Spielverlauf speichern'}</button><button type="button" class="secondary-button" data-history-cancel${disabled}>Abbrechen</button></div>
    </section>`;
  }
  const api = { sections, totals, ended, validateSequence, validate, empty, render, editor };
  if (typeof module !== 'undefined') module.exports = api;
  else window.PadelMatchHistory = api;
})();
