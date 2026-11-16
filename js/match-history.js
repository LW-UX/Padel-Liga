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
  // Liefert den laufenden Stand und das erste Spiel beziehungsweise den ersten Punkt, der nicht mehr zum Ergebnis passt.
  function sequenceStatus(winners, expected, target) {
    const score = [0, 0];
    let invalidAt = -1;
    winners.forEach((winner, index) => {
      if (invalidAt >= 0) return;
      if (![1, 2].includes(winner) || ended(score, target)) { invalidAt = index; return; }
      score[winner - 1]++;
      if (score.some((value, i) => value > expected[i])) invalidAt = index;
    });
    return { score, invalidAt, complete: invalidAt < 0 && score.every((value, i) => value === expected[i]) };
  }
  const removeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6 18 18M18 6 6 18"/></svg>';
  function editor(data, draft, { busy = false, message = '' } = {}) {
    const disabled = busy ? ' disabled' : '';
    const players = data.players || [];
    const names = team => players.filter(player => Number(player.team) === team).map(player => player.displayName).join(' / ');
    const controls = (set, part, index, points = false) => {
      const winners = points ? part.points : part.winners;
      const expected = points ? set.tiebreak : set.score;
      const target = points ? 7 : set.target;
      const unit = points || set.target ? 'Punkt' : 'Spiel';
      const status = sequenceStatus(winners, expected, target);
      const statusText = status.invalidAt >= 0
        ? `Ab ${unit} ${status.invalidAt + 1} passt der Verlauf nicht zum Ergebnis ${expected.join(':')}.`
        : status.complete ? `Passt zum Ergebnis ${expected.join(':')}.`
          : points && !winners.length ? 'Optional. Noch keine Punkte erfasst.'
            : `Erfasst ${status.score.join(':')} von ${expected.join(':')}.`;
      const running = [0, 0];
      const rows = winners.map((winner, game) => {
        if ([1, 2].includes(winner)) running[winner - 1]++;
        const attributes = `data-history-set="${index}" data-history-index="${game}" data-history-points="${points}"`;
        const noServer = points || set.target || (set.tiebreak && game === 12);
        const server = noServer
          ? `<span class="hint match-history-row-server">${!points && set.tiebreak && game === 12 ? 'Tiebreak' : ''}</span>`
          : `<select class="match-history-row-server" data-history-server="${game}" data-history-set="${index}" aria-label="Aufschläger ${unit} ${game + 1}"${disabled}><option value="">Aufschläger unbekannt</option>${players.map(player => `<option value="${esc(player.playerId)}"${part.servers[game] === player.playerId ? ' selected' : ''}>${esc(player.displayName)}</option>`).join('')}</select>`;
        return `<li class="match-history-row${status.invalidAt >= 0 && game >= status.invalidAt ? ' is-invalid' : ''}">
          <span class="match-history-row-label">${unit} ${game + 1}<span class="hint">${running.join(':')}</span></span>
          <div class="toggle match-history-row-winner" role="group" aria-label="Gewinner ${unit} ${game + 1}">${[1, 2].map(team => `<button type="button" class="${winner === team ? 'active' : ''}" data-history-winner="${team}" ${attributes} aria-pressed="${winner === team}"${disabled}>Team ${team}</button>`).join('')}</div>
          ${server}
          <button type="button" class="secondary-button match-history-row-remove" data-history-remove ${attributes} aria-label="${unit} ${game + 1} löschen" title="${unit} ${game + 1} löschen"${disabled}>${removeIcon}</button>
        </li>`;
      }).join('');
      const blocked = status.complete || status.invalidAt >= 0 || ended(status.score, target);
      return `<div class="match-history-controls">
        <p class="match-history-controls-title">${points ? 'Punkte im Satz-Tiebreak (optional)' : set.target ? 'Punktgewinne' : 'Spielgewinne'}</p>
        ${rows ? `<ol class="match-history-rows">${rows}</ol>` : ''}
        <p class="hint match-history-status${status.invalidAt >= 0 ? ' is-invalid' : status.complete ? ' is-complete' : ''}">${statusText}</p>
        <div class="match-history-actions">${[1, 2].map(team => `<button type="button" class="secondary-button" data-history-add="${team}" data-history-set="${index}" data-history-points="${points}"${disabled}${blocked || status.score[team - 1] >= expected[team - 1] ? ' disabled' : ''}>Team ${team} + ${unit}</button>`).join('')}</div>
      </div>`;
    };
    return `<section class="widget match-statistics-section match-history-editor"><h3>${data.matchHistory?.sections ? 'Spielverlauf bearbeiten' : 'Spielverlauf nachtragen'}</h3>
      <p class="hint">Team 1: ${esc(names(1))}<br>Team 2: ${esc(names(2))}</p>
      <p class="hint">Trage die Spiele in ihrer Reihenfolge ein. In jeder Zeile lassen sich Gewinner und Aufschläger ändern oder das Spiel löschen. Aufschläger und Tiebreak-Punkte sind optional. Das bestätigte Ergebnis bleibt unverändert.</p>
      <div class="match-history-editor-sets">${sections(data.result).map((set, index) => `<div class="match-history-editor-set${set.target ? ' match-history-editor-set--match-tiebreak' : ''}"><h4>${set.title} · ${set.score.join(':')}</h4>${controls(set, draft[index], index)}${set.tiebreak ? controls(set, draft[index], index, true) : ''}</div>`).join('')}</div>
      <label>Grund der Eintragung oder Korrektur<input data-history-reason type="text" minlength="3" maxlength="500" required${disabled}></label>
      <p role="status" class="hint" data-history-message>${esc(message)}</p>
      <div class="match-history-actions"><button type="button" class="primary-button" data-history-save${disabled}>${busy ? 'Wird gespeichert …' : 'Spielverlauf speichern'}</button><button type="button" class="secondary-button" data-history-cancel${disabled}>Abbrechen</button></div>
    </section>`;
  }
  const api = { sections, totals, ended, validateSequence, validate, sequenceStatus, empty, render, editor };
  if (typeof module !== 'undefined') module.exports = api;
  else window.PadelMatchHistory = api;
})();
