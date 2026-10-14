/* Partiestatistik: one fresh RPC per opening, no live subscription or result cache. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const number = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  const signed = value => value == null ? '—' : `${value > 0 ? '+' : ''}${number(value)}`;
  const date = value => value ? new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Noch nicht terminiert';
  const headerDate = value => value ? new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date(value)) : '';
  const headerMeta = data => [data?.seasonLabel, headerDate(data?.matchAt)].filter(Boolean).join(' · ');
  const day = now => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now);
  const icon = '<span class="mc-score-details-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M4 6h9M4 11h6M4 16h5"></path><circle cx="15.5" cy="14.5" r="3.5"></circle><path d="m18 17 3 3"></path></svg></span>';
  function availability(match, season, now = new Date()) {
    if (!match || match.type === 'training' || match.cancelledAt || match.isCancelled || match.stage === 'final-four' || match.stage === 'final_four') return null;
    if (match.team1?.playerIds?.length !== 2 || match.team2?.playerIds?.length !== 2) return null;
    const matches = season?.matches || [];
    const cup = season?.competition?.tournamentMode === 'knockout_redraw';
    if (!cup && match.stage === 'semifinal' && matches.some(m => m.stage === 'league' && !m.cancelledAt && m.sieger == null)) return null;
    if (match.sieger != null) return 'analysis';
    if (match.countsForElo !== true) return null;
    if (match.matchAt || (!cup && match.stage === 'semifinal')) return 'preview';
    if (cup) {
      const stages = ['quarterfinal', 'semifinal', 'final'];
      const active = stages.find(stage => matches.some(m => m.stage === stage && m.sieger == null && !m.cancelledAt));
      return match.stage === active ? 'preview' : 'basic';
    }
    const today = day(now);
    const windows = [...(season?.matchdays || [])].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || a.spieltag - b.spieltag);
    const own = windows.find(d => Number(d.spieltag) === Number(match.spieltag));
    if (own?.endDate < today) return 'preview';
    const upcoming = windows.filter(d => d.endDate >= today).slice(0, 2);
    return upcoming.some(d => Number(d.spieltag) === Number(match.spieltag)) ? 'preview' : 'basic';
  }
  function entry(match, season) {
    const mode = availability(match, season);
    if (!mode) return null;
    return { attributes: `data-match-statistics="${esc(match.id)}" aria-label="${esc(mode === 'analysis' ? 'Partieanalyse öffnen' : 'Partievorschau öffnen')}"`, icon: mode === 'preview' ? icon : '' };
  }
  const relationshipTerms = {
    successPartner: ['Erfolgspartner', 'Erfolgspartnerin'],
    fearedPartner: ['Angstpartner', 'Angstpartnerin'],
    favoriteOpponent: ['Lieblingsgegner', 'Lieblingsgegnerin'],
    fearedOpponent: ['Angstgegner', 'Angstgegnerin']
  };
  function section(title, body) {
    return body ? `<section class="live-ticker-statistics-section"><h2 class="widget-label">${esc(title)}</h2>${body}</section>` : '';
  }
  function playerEmoji(player) {
    if (['👨', '👩'].includes(player?.profileEmoji)) return player.profileEmoji;
    if (typeof window === 'undefined') return '👤';
    return (window.PADEL_PLAYERS || []).find(item => item.id === player?.playerId)?.profileEmoji || '👤';
  }
  function relationshipPhrase(kind, subject, other) {
    const terms = relationshipTerms[kind];
    if (!terms) return '';
    const subjectIsFemale = playerEmoji(subject) === '👩';
    const otherIsFemale = playerEmoji(other) === '👩';
    const term = terms[otherIsFemale ? 1 : 0];
    if (kind === 'successPartner' || kind === 'fearedPartner') {
      const possessive = subjectIsFemale
        ? (otherIsFemale ? 'ihrer aktuellen' : 'ihrem aktuellen')
        : (otherIsFemale ? 'seiner aktuellen' : 'seinem aktuellen');
      return `spielt mit ${possessive} ${term}`;
    }
    const possessive = subjectIsFemale
      ? (otherIsFemale ? 'ihre aktuelle' : 'ihren aktuellen')
      : (otherIsFemale ? 'seine aktuelle' : 'seinen aktuellen');
    return `trifft auf ${possessive} ${term}`;
  }
  const viewerClass = (player, selectedPlayerId) => player?.playerId === selectedPlayerId ? ' viewer-player' : '';
  function playerBlock(p, selectedPlayerId) {
    return `<button type="button" class="live-ticker-player player-profile-link" data-player-profile-id="${esc(p.playerId)}">
      <span class="live-ticker-player-photo" aria-hidden="true"><img class="live-ticker-player-image" src="assets/players/${encodeURIComponent(p.playerId)}/profile.webp" alt="" data-live-player-image><span class="live-ticker-player-emoji" hidden>${esc(playerEmoji(p))}</span></span>
      <span class="live-ticker-player-name${viewerClass(p, selectedPlayerId)}">${esc(p.displayName)}</span>${p.elo ? `<small class="live-ticker-player-elo">${number(p.elo.before)} Elo</small>` : ''}</button>`;
  }
  function renderHead(data, selectedPlayerId) {
    const teamOneProbability = data.probability == null ? null : Math.round(data.probability * 100);
    const teamTwoProbability = teamOneProbability == null ? null : 100 - teamOneProbability;
    const probability = teamOneProbability == null ? '' : `${teamOneProbability} : ${teamTwoProbability}`;
    const previewProbability = teamOneProbability == null ? '' : `<span class="match-probability live-ticker-probability match-statistics-probability" aria-label="Gewinnwahrscheinlichkeit ${teamOneProbability} zu ${teamTwoProbability} Prozent">
        <span class="match-probability-value">${teamOneProbability}</span>
        <span class="match-probability-separator" aria-hidden="true">:</span>
        <span class="match-probability-value">${teamTwoProbability}</span>
      </span>`;
    const analysisProbability = probability.replace(/(\d+)/g, '$1%');
    const analysis = data.availability === 'analysis';
    return `<article class="live-ticker-match"><div class="live-ticker-match-meta"><span class="live-ticker-status${analysis ? ' is-finished' : ''}">${analysis ? 'Beendet' : 'Offen'}</span></div>
      <div class="live-ticker-matchup"><div class="live-ticker-team live-ticker-team-1">${data.players.filter(p => p.team === 1).map(p => playerBlock(p, selectedPlayerId)).join('')}</div>
      <div class="live-ticker-scoreboard"><span class="live-ticker-score-label">${analysis ? 'Ergebnis' : 'Gewinnchance'}</span>
      ${analysis ? `<strong class="live-ticker-score">${esc(data.sets || '—')}</strong>` : previewProbability || '<strong class="live-ticker-score">—</strong>'}
      ${analysis ? `<span class="live-ticker-score-note">${esc(data.result)}</span>${analysisProbability ? `<span class="live-ticker-score-note">${analysisProbability}</span>` : ''}` : previewProbability ? '<span class="live-ticker-score-note">Prozent</span>' : ''}
      </div>
      <div class="live-ticker-team live-ticker-team-2">${data.players.filter(p => p.team === 2).map(p => playerBlock(p, selectedPlayerId)).join('')}</div></div></article>`;
  }
  function historyFacts(data) {
    const facts = [];
    const company = data.company;
    const companyText = !company ? '' : company.kind === 'internal' ? `Firmeninternes Duell · ${company.company}`
      : `Firmenduell · ${company.team1} gegen ${company.team2} · Bilanz ${company.wins1}:${company.wins2}`;
    if (companyText) facts.push(`<p class="live-ticker-statistics-context-fact">${esc(companyText)}</p>`);
    const latest = data.rematches?.[0];
    const rematchLabel = !latest ? '' : data.availability !== 'analysis' ? 'Rematch'
      : latest.outcome === (data.winner === 1 ? 'win' : 'loss') ? 'Erneuter Sieg' : latest.outcome === 'draw' ? 'Rematch' : 'Revanche';
    const rematches = data.rematches || [];
    const rematchLines = rematches.map((r, index) => {
      const result = r.team === 2 ? String(r.result).replace(/(\d+)\s*:\s*(\d+)/g, '$2:$1') : r.result;
      const label = index === 0 ? `${rematchLabel} #${rematches.length}` : 'Früheres Duell';
      return `<span><strong>${esc(label)}</strong> · ${esc(date(r.date))} · ${esc(r.season)} · ${esc(result)}</span>`;
    });
    if (rematchLines.length) facts.push(`<p class="live-ticker-statistics-context-fact live-ticker-statistics-rematches">${rematchLines.join('<br>')}</p>`);
    const resultImpact = (data.impacts || []).find(impact => ['upset', 'favoriteConfirmed'].includes(impact.kind));
    const resultTeam = Number(resultImpact?.team);
    const resultProbability = Number(resultImpact?.probability);
    const resultThresholdReached = resultImpact?.kind === 'upset' ? resultProbability <= 0.45 : resultProbability >= 0.55;
    if ([1, 2].includes(resultTeam) && Number.isFinite(resultProbability) && resultThresholdReached) {
      const resultText = resultImpact.kind === 'upset'
        ? `Team ${resultTeam} sorgt für eine statistische Überraschung bei zuvor ${Math.round(resultProbability * 100)} % Gewinnchance.`
        : `Team ${resultTeam} bestätigt Favoritenrolle bei zuvor ${Math.round(resultProbability * 100)} % Gewinnchance.`;
      facts.push(`<p class="live-ticker-statistics-context-fact">${resultText}</p>`);
    }
    return facts;
  }
  function relationshipPlayerLink(playerId, displayName, selectedPlayerId) {
    return `<button type="button" class="live-ticker-statistics-relationship-name player-profile-link${viewerClass({ playerId }, selectedPlayerId)}" data-player-profile-id="${esc(playerId)}">${esc(displayName)}</button>`;
  }
  function renderContext(data, selectedPlayerId) {
    const seen = new Set();
    const facts = historyFacts(data);
    (data.players || []).forEach(player => {
      (player.relationships || []).forEach(relationship => {
        const relationshipPlayerId = relationship.playerId || relationship.name;
        const relationshipPlayer = (data.players || []).find(candidate => candidate.playerId === relationshipPlayerId)
          || { playerId: relationshipPlayerId };
        const phrase = relationshipPhrase(relationship.kind, player, relationshipPlayer);
        if (!phrase) return;
        const pairKey = [player.playerId, relationshipPlayerId].sort().join(':');
        const key = `${relationship.kind}:${pairKey}`;
        if (seen.has(key)) return;
        seen.add(key);
        const subject = relationshipPlayerLink(player.playerId, player.displayName, selectedPlayerId);
        const other = relationshipPlayerLink(relationshipPlayerId, relationship.name, selectedPlayerId);
        facts.push(`<p class="live-ticker-statistics-context-fact live-ticker-statistics-relationship">${subject} ${phrase} ${other} <span class="live-ticker-statistics-relationship-record">(${number(relationship.wins)} von ${number(relationship.matches)})</span>.</p>`);
      });
    });
    return facts.length
      ? `<section class="live-ticker-statistics-context" aria-label="Einordnung der Partie">${facts.join('')}</section>`
      : '';
  }
  function getQualificationPlaces(data) {
    if (data?.qualificationPlaces != null && Number.isFinite(Number(data.qualificationPlaces))) {
      return Math.max(0, Number(data.qualificationPlaces));
    }
    if (typeof window === 'undefined') return 0;
    const season = (window.PADEL_SEASONS || []).find(option =>
      option.id === data?.seasonId || option.databaseId === data?.seasonId
    );
    return Math.max(0, Number(season?.qualificationPlaces) || 0);
  }
  function renderRankChange(statistics, analysis) {
    if (!analysis) return '';
    const rank = Number(statistics?.rank);
    const previousRank = Number(statistics?.previousRank);
    if (!Number.isFinite(rank) || !Number.isFinite(previousRank)) return '';
    const direction = rank < previousRank ? 'up' : rank > previousRank ? 'down' : 'same';
    const symbol = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '–';
    const label = direction === 'up' ? 'Tabellenplatz verbessert'
      : direction === 'down' ? 'Tabellenplatz verschlechtert'
        : 'Tabellenplatz unverändert';
    return `<span class="live-ticker-statistics-rank-change ${direction}" aria-label="${label}">${symbol}</span>`;
  }
  function renderPlayerRanking(data, selectedPlayerId) {
    const activePlayers = new Map(data.players.map(player => [player.playerId, player]));
    const rankingPlayers = Array.isArray(data.ranking) && data.ranking.length ? data.ranking : data.players;
    const players = rankingPlayers.map(player => {
      const activePlayer = activePlayers.get(player.playerId);
      return activePlayer ? { ...player, ...activePlayer, statistics: player.statistics || activePlayer.statistics } : player;
    }).sort((a, b) => Number(a.statistics?.rank ?? Infinity) - Number(b.statistics?.rank ?? Infinity));
    const hasRanking = players.length > 0 && players.every(player => Number.isFinite(Number(player.statistics?.rank)));
    const qualificationPlaces = getQualificationPlaces(data);
    const analysis = data.availability === 'analysis';
    const rows = [];
    players.forEach(player => {
      const statistics = player.statistics || {};
      const rank = Number(statistics.rank);
      const activePlayer = activePlayers.get(player.playerId);
      const teamClass = !activePlayer ? '' : Number(activePlayer.team) === 2 ? ' live-ticker-statistics-team-2' : ' live-ticker-statistics-team-1';
      const rowClass = activePlayer ? 'live-ticker-statistics-ranking-player' : 'live-ticker-statistics-ranking-other';
      const qualificationClass = hasRanking && qualificationPlaces > 0 && rank <= qualificationPlaces
        ? ' live-ticker-statistics-ranking-qualified'
        : '';
      rows.push(`<tr class="${rowClass}${hasRanking ? ` r${Math.min(rank, 4)}` : ''}${qualificationClass}${teamClass}">
        ${hasRanking ? `<td class="col-rank rank-position"><span class="live-ticker-statistics-rank-position">${number(rank)}</span></td>${analysis ? `<td class="col-rank-change">${renderRankChange(statistics, analysis)}</td>` : ''}` : ''}
        <td class="col-name"><button type="button" class="pname player-profile-link${viewerClass(player, selectedPlayerId)}" data-player-profile-id="${esc(player.playerId)}">${esc(player.displayName)}</button></td>
        <td class="col-games">${number(statistics.played)}</td>
        ${hasRanking ? `<td class="col-wins">${number(statistics.wins)}</td>` : ''}
        ${hasRanking ? `<td class="col-points rank-score">${number(statistics.points)}</td>` : ''}
        <td class="col-diff"><span class="${Number(statistics.gameDiff) > 0 ? 'pos' : Number(statistics.gameDiff) < 0 ? 'neg' : 'neu'}">${signed(statistics.gameDiff)}</span></td>
      </tr>`);
    });
    return `<div class="ranking-wrap live-ticker-statistics-ranking-wrap"><table class="rt live-ticker-statistics-ranking${analysis ? ' has-rank-change' : ''}">
      <thead><tr>${hasRanking ? `<th class="col-rank"><span aria-hidden="true">#</span><span class="sr-only">Platz</span></th>${analysis ? '<th class="col-rank-change"><span class="sr-only">Platzänderung</span></th>' : ''}` : ''}<th class="col-name">Spieler</th><th class="col-games">Partien</th>${hasRanking ? '<th class="col-wins">Siege</th><th class="col-points">Punkte</th>' : ''}<th class="col-diff">Diff.</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>`;
  }
  function renderPlayersAndImpacts(data, impactGroups, selectedPlayerId) {
    const impactTitle = data.availability === 'analysis' ? 'Was sich verändert hat' : 'Was sich verändern kann';
    const impactBody = impactGroups.length
      ? `<div class="live-ticker-statistics-impact-groups">${impactGroups.map(({ player, facts }) => `<div class="live-ticker-statistics-impact-player">
        <h3><button type="button" class="live-ticker-statistics-impact-player-name player-profile-link${viewerClass(player, selectedPlayerId)}" data-player-profile-id="${esc(player.playerId)}">${esc(player.displayName)}</button></h3>
        <ul>${facts.map(text => `<li>${esc(text)}</li>`).join('')}</ul>
      </div>`).join('')}</div>`
      : '<p class="live-ticker-statistics-empty-impact">Keine bedeutenden Auswirkungen.</p>';
    return `<div class="live-ticker-statistics-ranking-layout">
      <section class="live-ticker-statistics-section live-ticker-statistics-ranking-panel"><h2 class="widget-label">Rangliste</h2>${renderPlayerRanking(data, selectedPlayerId)}</section>
      <section class="live-ticker-statistics-section live-ticker-statistics-impact-panel"><h2 class="widget-label">${impactTitle}</h2>${impactBody}</section>
    </div>`;
  }
  function graphGeometry(players, analysis) {
    const values = players.flatMap(p => [
      p.elo?.before,
      ...(analysis ? [p.elo?.after] : []),
      p.elo?.winMin,
      p.elo?.winMax,
      p.elo?.lossMin,
      p.elo?.lossMax
    ]).filter(v => v != null && Number.isFinite(Number(v))).map(Number);
    const low = values.length ? Math.min(...values) : 0;
    const high = values.length ? Math.max(...values) : 0;
    const padding = Math.max(10, (high - low) * 0.12);
    const min = Math.floor((low - padding) / 10) * 10, max = Math.ceil((high + padding) / 10) * 10;
    const plotTop = 28, plotBottom = 515, nameY = 556;
    const y = value => plotBottom - ((Number(value) - min) / (max - min)) * (plotBottom - plotTop);
    return { min, max, y, plotTop, plotBottom, nameY, ticks: Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4) };
  }
  function smoothLinePath(x1, y1, x2, y2) {
    const width = x2 - x1;
    return `M${x1},${y1} C${x1 + width * .42},${y1} ${x1 + width * .72},${y2} ${x2},${y2}`;
  }
  function smoothBandPath(x1, startA, startB, x2, yA, yB) {
    const width = x2 - x1;
    const c1 = x1 + width * .42;
    const c2 = x1 + width * .72;
    return `M${x1},${startA} C${c1},${startA} ${c2},${yA} ${x2},${yA} L${x2},${yB} C${c2},${yB} ${c1},${startB} ${x1},${startB} Z`;
  }
  function projectionBand(x1, startY, x2, valueA, valueB, geometry, cls) {
    const low = Math.min(Number(valueA), Number(valueB));
    const high = Math.max(Number(valueA), Number(valueB));
    const steps = 16;
    const startHeight = 2;
    const strips = Array.from({ length: steps }, (_, index) => {
      const start = index / steps;
      const end = (index + 1) / steps;
      const stripLow = low + (high - low) * start;
      const stripHigh = low + (high - low) * end;
      const stripStartLow = startY + startHeight / 2 - startHeight * start;
      const stripStartHigh = startY + startHeight / 2 - startHeight * end;
      const edgeDistance = (Math.abs(index - (steps - 1) / 2) - .5) / (steps / 2 - 1);
      const opacity = (.75 - edgeDistance * .45).toFixed(3);
      return `<path d="${smoothBandPath(x1, stripStartLow, stripStartHigh, x2, geometry.y(stripLow), geometry.y(stripHigh))}" fill-opacity="${opacity}" class="live-ticker-statistics-projection-band-strip ${cls}"/>`;
    }).join('');
    return `<g class="live-ticker-statistics-projection-band ${cls}">${strips}</g>`;
  }
  function projectionRange(x1, startY, x2, valueA, valueB, geometry, cls) {
    return `<path d="${smoothBandPath(x1, startY, startY, x2, geometry.y(valueA), geometry.y(valueB))}" class="live-ticker-statistics-projection-range ${cls}"/>`;
  }
  function peakStarIcon(rightX, textY, label, state) {
    const size = 14;
    const gap = 5;
    const textWidth = [...String(label)].length * 6.6;
    const x = rightX - textWidth - gap - size;
    return `<use href="#statistics-peak-star-icon" x="${x}" y="${textY - 11}" width="${size}" height="${size}" class="live-ticker-statistics-peak-star ${state}"/>`;
  }
  function analysisResultY(geometry, before, after) {
    const endpointY = geometry.y(after);
    const aboveY = endpointY - 30;
    const belowY = endpointY + 24;
    const fitsAbove = aboveY - 11 >= geometry.plotTop;
    const fitsBelow = belowY + 18 <= geometry.nameY - 18;
    if (Number(after) >= Number(before)) return fitsAbove ? aboveY : belowY;
    return fitsBelow ? belowY : aboveY;
  }
  function projectionValueLabel(x, y, valueA, valueB, className, peakBefore) {
    const high = Math.max(Number(valueA), Number(valueB));
    const low = Math.min(Number(valueA), Number(valueB));
    const highLabel = `↗ ${number(high)}`;
    const peakIcon = peakBefore != null && high > Number(peakBefore)
      ? peakStarIcon(x, y, highLabel, 'possible')
      : '';
    return `${peakIcon}<text x="${x}" y="${y}" text-anchor="end" class="live-ticker-statistics-value ${className}">${highLabel}</text><text x="${x}" y="${y + 15}" text-anchor="end" class="live-ticker-statistics-value ${className}">↘ ${number(low)}</text>`;
  }
  function renderGraph(data, selectedPlayerId) {
    if (!data.countsForElo) return '';
    const analysis = data.availability === 'analysis';
    const g = graphGeometry(data.players, analysis);
    const lanes = data.players.map((p, i) => {
      const e = p.elo || {}, x = 60 + i * 235;
      const teamClass = Number(p.team) === 2 ? 'live-ticker-statistics-team-2' : 'live-ticker-statistics-team-1';
      const available = e.before != null && (!analysis || e.after != null);
      const analysisRanges = !analysis || !available ? ''
        : [['lossMin', 'lossMax', 'loss'], ['winMin', 'winMax', 'win']].map(([a, b, cls]) => e[a] == null || e[b] == null ? ''
          : projectionRange(x + 30, g.y(e.before), x + 195, e[a], e[b], g, cls)).join('');
      const shape = !available ? '' : analysis
        ? `${analysisRanges}<path d="${smoothLinePath(x + 30, g.y(e.before), x + 195, g.y(e.after))}" class="live-ticker-statistics-line"/><circle cx="${x + 195}" cy="${g.y(e.after)}" r="5" class="live-ticker-statistics-dot"/>`
        : [['lossMin', 'lossMax', 'loss'], ['winMin', 'winMax', 'win']].map(([a, b, cls]) => e[a] == null || e[b] == null ? ''
          : projectionBand(x + 30, g.y(e.before), x + 195, e[a], e[b], g, cls)).join('');
      const startValue = available ? `<text x="${x + 22}" y="${g.y(e.before) + 24}" text-anchor="end" class="live-ticker-statistics-value live-ticker-statistics-start-value">${number(e.before)}</text>` : '';
      const resultY = analysis && available ? analysisResultY(g, e.before, e.after) : null;
      const resultLabel = analysis && available ? number(e.after) : '';
      const resultDelta = analysis && available
        ? Number.isFinite(Number(e.delta)) ? Number(e.delta) : Number(e.after) - Number(e.before)
        : null;
      const resultDeltaClass = resultDelta > 0 ? 'pos' : resultDelta < 0 ? 'neg' : 'neu';
      const peakReached = analysis && e.peakBefore != null && e.after != null && e.after > e.peakBefore;
      const resultValues = !available ? '' : analysis
        ? `${peakReached ? peakStarIcon(x + 195, resultY, resultLabel, 'achieved') : ''}<text x="${x + 195}" y="${resultY}" text-anchor="end" class="live-ticker-statistics-value live-ticker-statistics-result-value">${resultLabel}</text><text x="${x + 195}" y="${resultY + 15}" text-anchor="end" class="live-ticker-statistics-value live-ticker-statistics-delta-value ${resultDeltaClass}">${signed(resultDelta)}</text>`
        : `${projectionValueLabel(
            x + 195,
            Math.max(g.plotTop + 14, Math.min(g.y(e.winMin), g.y(e.winMax)) - 27),
            e.winMin,
            e.winMax,
            'live-ticker-statistics-win-value',
            e.peakBefore
          )}${projectionValueLabel(
            x + 195,
            Math.min(g.nameY - 51, Math.max(g.y(e.lossMin), g.y(e.lossMax)) + 24),
            e.lossMin,
            e.lossMax,
            'live-ticker-statistics-loss-value',
            e.peakBefore
          )}`;
      return `<g class="live-ticker-statistics-player-graph ${teamClass}${i === 0 ? ' is-selected' : ''}" data-statistics-graph-player="${esc(p.playerId)}" style="--statistics-lane-offset:${-i * 235}px">
        <clipPath id="statistics-lane-${i}"><rect x="${x}" y="${g.plotTop}" width="225" height="${g.plotBottom - g.plotTop + 1}"/></clipPath>
        <g clip-path="url(#statistics-lane-${i})">${shape}${available ? `<circle cx="${x + 30}" cy="${g.y(e.before)}" r="5" class="live-ticker-statistics-dot"/>` : ''}</g>
        ${startValue}${resultValues}
        <text x="${x + 115}" y="${g.nameY}" text-anchor="middle" class="live-ticker-statistics-player-label${viewerClass(p, selectedPlayerId)}">${esc(p.displayName)}</text>
      </g>`;
    });
    const selectedLaneLast = [...lanes.slice(1), lanes[0]].join('');
    const playerSelect = `<div class="live-ticker-statistics-graph-picker match-scope-toggle" role="group" aria-label="Spieler für Elo-Entwicklung auswählen">
      ${data.players.map((player, index) => `<button type="button" class="${index === 0 ? 'active' : ''}" data-statistics-graph-select="${esc(player.playerId)}" aria-pressed="${index === 0 ? 'true' : 'false'}">${esc(player.displayName)}</button>`).join('')}
    </div>`;
    return section('Elo-Entwicklung', `${playerSelect}<div class="live-ticker-statistics-graph" tabindex="0" role="region" aria-label="Elo-Diagramm der vier Spieler">
      <svg viewBox="0 0 1000 590" width="1000" height="590" aria-hidden="true" class="live-ticker-statistics-svg">
        <defs><symbol id="statistics-peak-star-icon" viewBox="0 0 24 24"><path d="M12 2.5 14.94 8.46 21.52 9.42 16.76 14.06 17.88 20.61 12 17.52 6.12 20.61 7.24 14.06 2.48 9.42 9.06 8.46 12 2.5Z"/></symbol></defs>
        ${g.ticks.map(t => `<path d="M60 ${g.y(t)} H995" class="live-ticker-statistics-grid"/>`).join('')}${selectedLaneLast}
      </svg><div class="live-ticker-statistics-axis" aria-hidden="true">${g.ticks.map(t => `<span style="top:${g.y(t)}px">${number(Math.round(t))}</span>`).join('')}</div></div>`);
  }
  function impactText(impact, data) {
    const condition = impact.onWin ? 'bei einem Sieg' : 'bei einer Niederlage';
    if ((impact.kind === 'leaderPossible' || impact.kind === 'qualificationPossible') && !impact.onWin) return '';
    if ((impact.kind === 'leaderLossPossible' || impact.kind === 'qualificationLossPossible') && impact.onWin) return '';
    const texts = {
      leaderPossible: `Kann ${condition} die Tabellenführung übernehmen.`,
      leaderLossPossible: `Kann ${condition} die Tabellenführung verlieren.`,
      qualificationPossible: `Kann ${condition} die Top ${impact.places} erreichen.`,
      qualificationLossPossible: `Kann ${condition} aus den Top ${impact.places} fallen.`,
      leaderGained: 'Übernimmt die Tabellenführung.', leaderLost: 'Verliert die Tabellenführung',
      qualificationGained: `Erreicht die Top ${impact.places}.`, qualificationLost: `Fällt aus den Top ${impact.places}.`,
      streakStarted: impact.outcome === 'win' ? `Beginnt eine Siegesserie: ${impact.length} in Folge.` : `Eine Niederlagenserie beginnt: ${impact.length} in Folge.`,
      streakExtended: impact.outcome === 'win' ? `Verlängert die Siegesserie auf ${impact.length}.` : `Niederlagenserie verlängert sich auf ${impact.length}.`,
      streakEnded: impact.outcome === 'win' ? `Siegesserie nach ${impact.length} Partien beendet.` : `Beendet die Niederlagenserie nach ${impact.length} Partien.`,
      streakPossible: impact.length >= 3
        ? impact.outcome === 'win' ? `Kann die Siegesserie von ${impact.length} Partien ausbauen.` : `Kann die Niederlagenserie von ${impact.length} Partien beenden.`
        : impact.outcome === 'win' ? 'Kann eine Siegesserie von drei Partien erreichen.' : 'Kann eine Niederlagenserie von drei Partien verhindern.',
      eloPeakPossible: 'Kann einen neuen Elo-Höchstwert erreichen.',
      eloPeak: 'Erreicht einen neuen Elo-Höchstwert.'
    };
    return texts[impact.kind] || '';
  }
  function groupImpacts(data) {
    const factsByPlayer = new Map(data.players.map(player => [player.playerId, []]));
    (data.impacts || []).forEach(impact => {
      const text = impactText(impact, data);
      if (!text) return;
      const targets = impact.playerId
        ? [impact.playerId]
        : data.players.filter(player => Number(player.team) === Number(impact.team)).map(player => player.playerId);
      targets.forEach(playerId => {
        const facts = factsByPlayer.get(playerId);
        if (facts && !facts.includes(text)) facts.push(text);
      });
    });
    return data.players.map(player => ({ player, facts: factsByPlayer.get(player.playerId) || [] })).filter(group => group.facts.length);
  }
  function render(data, selectedPlayerId = null) {
    const head = renderHead(data, selectedPlayerId);
    if (data.availability === 'basic') return `${head}<p class="live-ticker-statistics-note">Die ausführliche Vorschau folgt näher am Spieltag.</p>`;
    return head + renderContext(data, selectedPlayerId) + renderPlayersAndImpacts(data, groupImpacts(data), selectedPlayerId) + renderGraph(data, selectedPlayerId)
      + (data.availability === 'preview' ? '<p class="live-ticker-statistics-note">Werte und Prognosen können sich durch weitere bestätigte Partien bis zum Spielbeginn verändern.</p>' : '');
  }
  function skeleton() {
    const card = '<div class="live-ticker-statistics-skeleton-card"><span class="loading-skeleton"></span><span class="loading-skeleton"></span><span class="loading-skeleton"></span></div>';
    return `<p class="sr-only" role="status">Partiestatistik wird geladen …</p><div aria-hidden="true" class="live-ticker-statistics-skeleton">
      <div class="live-ticker-statistics-players">${card.repeat(4)}</div><div class="loading-skeleton live-ticker-statistics-skeleton-meta"></div>
      <div class="loading-skeleton live-ticker-statistics-skeleton-history"></div><div class="live-ticker-statistics-players">${card.repeat(4)}</div>
      <div class="loading-skeleton live-ticker-statistics-skeleton-graph"></div><div class="loading-skeleton live-ticker-statistics-skeleton-history"></div></div>`;
  }
  const api = { availability, entry, icon, render, skeleton, graphGeometry, analysisResultY, headerMeta };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  let request = 0, active = null, returnState = null, profileOnTop = false, currentRoute = null, routeNumber = 0;
  const routeContexts = new Map();
  const dialog = () => document.getElementById('live-ticker-dialog');
  const content = () => document.getElementById('live-ticker-content');
  function restore() {
    ++request; active = null; currentRoute = null;
    if (dialog()?.dataset.mode !== 'statistics') return;
    const profile = document.getElementById('player-profile-dialog');
    if (profile?.open) window.PadelLigaClosePlayerProfile?.({ fromHistory: true });
    profileOnTop = false;
    dialog().close(); delete dialog().dataset.mode;
    document.getElementById('live-match-switcher').hidden = false;
    document.querySelector('[data-live-back]').setAttribute('aria-label', 'Final Four schließen');
    document.getElementById('live-ticker-title').textContent = 'FINAL FOUR';
    if (returnState) {
      window.scrollTo({ top: returnState.scroll, behavior: 'instant' });
      if (returnState.profileOpen) {
        if (!document.getElementById('player-profile-dialog').open || window.PadelLigaCapturePlayerProfile?.().data !== returnState.profileSnapshot?.data) window.PadelLigaRestorePlayerProfile?.(returnState.profileSnapshot);
        document.getElementById('player-profile-dialog').scrollTop = returnState.profileScroll;
      }
      const trigger = returnState.trigger?.isConnected ? returnState.trigger : returnState.triggerMatch
        ? document.querySelector(`#player-profile-dialog [data-match-statistics="${CSS.escape(returnState.triggerMatch)}"]`) : null;
      trigger?.focus({ preventScroll: true });
      returnState = null;
    }
  }
  function close() {
    if (!active) return;
    if (window.history.state?.matchStatistics) window.history.back();
    else { const url = new URL(window.location.href); url.searchParams.delete('partie'); window.history.replaceState(window.history.state, '', url); restore(); }
  }
  function notice(message) {
    let target = document.getElementById('match-statistics-notice');
    if (!target) { target = document.createElement('p'); target.id = 'match-statistics-notice'; target.className = 'live-ticker-statistics-notice'; target.setAttribute('role', 'status'); document.body.append(target); }
    target.textContent = message;
    setTimeout(() => target.remove(), 6000);
  }
  async function open(matchId, { updateUrl = true, direct = false, trigger = null, returnContext = null } = {}) {
    if (!matchId) return;
    window.PadelLiveTicker?.close();
    const fromProfileAbove = profileOnTop && trigger?.closest('#player-profile-dialog');
    if (fromProfileAbove) {
      // Reuse the single statistics route. The existing profile stays underneath
      // and can be reused, but alternating views never grows browser history.
      profileOnTop = false;
      if (dialog().open) dialog().close();
    }
    if (!active) {
      const profile = document.getElementById('player-profile-dialog');
      returnState = returnContext || { trigger: trigger || document.activeElement, triggerMatch: (trigger || document.activeElement)?.dataset.matchStatistics, scroll: window.scrollY, profileOpen: profile?.open, profileScroll: profile?.scrollTop, profileSnapshot: window.PadelLigaCapturePlayerProfile?.() };
      if (returnContext?.profileOpen && (!profile?.open || window.PadelLigaCapturePlayerProfile?.().data !== returnContext.profileSnapshot?.data)) window.PadelLigaRestorePlayerProfile?.(returnContext.profileSnapshot);
    }
    active = matchId;
    const token = ++request;
    dialog().dataset.mode = 'statistics';
    document.querySelector('[data-live-back]').setAttribute('aria-label', 'Partiestatistik schließen');
    document.getElementById('live-ticker-title').textContent = 'PARTIESTATISTIK';
    document.getElementById('live-ticker-season-label').textContent = '';
    document.getElementById('live-match-switcher').hidden = true;
    content().innerHTML = skeleton(); content().setAttribute('aria-busy', 'true');
    if (!dialog().open) dialog().showModal();
    document.querySelector('[data-live-back]').focus({ preventScroll: true });
    dialog().querySelector('.live-ticker-dialog-shell').scrollTop = 0;
    if (updateUrl) {
      const url = new URL(window.location.href);
      const replacing = url.searchParams.has('partie') || Boolean(currentRoute);
      url.searchParams.delete('live'); url.searchParams.delete('liveView'); url.searchParams.set('partie', matchId);
      currentRoute = replacing && currentRoute ? currentRoute : `statistics-${++routeNumber}`;
      routeContexts.set(currentRoute, returnState);
      window.history[replacing ? 'replaceState' : 'pushState']({ ...window.history.state, matchStatistics: matchId, statisticsRoute: currentRoute, statisticsProfile: null, statisticsTop: 'match' }, '', url);
    }
    if (!updateUrl) currentRoute = window.history.state?.statisticsRoute || null;
    try {
      const config = window.PADEL_SUPABASE_CONFIG;
      const client = window.PADEL_SUPABASE_CLIENT || (config && window.supabase?.createClient(config.url, config.publishableKey));
      if (!client) throw new Error('Verbindung nicht verfügbar');
      const { data, error } = await client.rpc('get_public_match_detail', { p_match_id: matchId });
      if (token !== request) return;
      if (error) throw error;
      if (!data) {
        const url = new URL(window.location.href); url.searchParams.delete('partie');
        window.history.replaceState({ ...window.history.state, matchStatistics: null }, '', url);
        restore(); notice('Für diese Partie ist keine Partiestatistik verfügbar.'); return;
      }
      // Direct links get an in-page return destination only after successful validation.
      if (direct) {
        const route = new URL(window.location.href), base = new URL(route); base.searchParams.delete('partie');
        window.history.replaceState({ ...window.history.state, matchStatistics: null }, '', base);
        currentRoute = `statistics-${++routeNumber}`;
        routeContexts.set(currentRoute, returnState);
        window.history.pushState({ ...window.history.state, matchStatistics: matchId, statisticsRoute: currentRoute, statisticsProfile: null, statisticsTop: 'match' }, '', route);
      }
      document.getElementById('live-ticker-title').textContent = data.label;
      document.getElementById('live-ticker-season-label').textContent = headerMeta(data);
      content().innerHTML = render(data, window.PadelLigaGetSelectedViewerId?.()); content().setAttribute('aria-busy', 'false');
    } catch (error) {
      if (token !== request) return;
      content().setAttribute('aria-busy', 'false');
      content().innerHTML = '<div class="empty-state" role="alert">Die Partiestatistik konnte nicht geladen werden.<br><button type="button" class="secondary-button" data-statistics-retry>Erneut laden</button></div>';
    }
  }
  function prepareProfileOpen(trigger, playerId, fromHistory = false) {
    if (!active || (!fromHistory && !trigger?.closest('#live-ticker-dialog'))) return false;
    profileOnTop = true;
    if (!fromHistory) window.history.replaceState({ ...window.history.state, statisticsProfile: playerId, statisticsTop: 'profile' }, '', window.location.href);
    return true;
  }
  function closeProfile() {
    if (!profileOnTop) return false;
    profileOnTop = false;
    window.history.replaceState({ ...window.history.state, statisticsProfile: null, statisticsTop: 'match' }, '', window.location.href);
    return false;
  }
  Object.assign(api, { open, close, restore, prepareProfileOpen, closeProfile });
  Object.defineProperty(api, 'active', { get: () => active });
  window.PadelMatchStatistics = api;
  document.addEventListener('click', event => {
    const retry = event.target.closest('[data-statistics-retry]');
    if (retry && active) { void open(active, { updateUrl: false }); return; }
    const graphPlayerButton = event.target.closest('[data-statistics-graph-select]');
    if (graphPlayerButton) {
      const picker = graphPlayerButton.closest('.live-ticker-statistics-graph-picker');
      const graph = picker?.closest('.live-ticker-statistics-section')?.querySelector('.live-ticker-statistics-svg');
      const players = [...(graph?.querySelectorAll('[data-statistics-graph-player]') || [])];
      const selected = players.find(player => player.dataset.statisticsGraphPlayer === graphPlayerButton.dataset.statisticsGraphSelect);
      picker.querySelectorAll('[data-statistics-graph-select]').forEach(button => {
        const isActive = button === graphPlayerButton;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      });
      players.forEach(player => player.classList.toggle('is-selected', player === selected));
      if (selected) selected.parentElement.append(selected);
      return;
    }
    const button = event.target.closest('[data-match-statistics]');
    if (button && !event.target.closest('[data-player-profile-id]')) { event.preventDefault(); void open(button.dataset.matchStatistics, { trigger: button }); }
  });
  window.addEventListener('popstate', async () => {
    const id = new URL(window.location.href).searchParams.get('partie');
    const route = window.history.state?.statisticsRoute;
    const profileId = window.history.state?.statisticsProfile;
    if (profileOnTop && !profileId) {
      profileOnTop = false;
      window.PadelLigaClosePlayerProfile?.({ fromHistory: true });
    }
    if (!id) { if (active) restore(); return; }
    if (id !== active || route !== currentRoute) {
      if (active) restore();
      await open(id, { updateUrl: false, returnContext: routeContexts.get(route) });
    }
    if (active === id && currentRoute === route && profileId && !profileOnTop) {
      const trigger = dialog().querySelector(`[data-player-profile-id="${CSS.escape(profileId)}"]`);
      void window.PadelLigaOpenPlayerProfile?.(profileId, trigger, { fromHistory: true });
    }
  });
})();
