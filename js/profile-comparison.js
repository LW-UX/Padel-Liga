'use strict';

// Gemeinsame gewichtete Vergleichswerte und Balkengrafiken für Profil und Suche.

function getProfileRegularGameTotals(resultDetails) {
  const resultWithoutSetTiebreaks = String(resultDetails || '').replace(/\([^)]*\)/g, '');
  return [...resultWithoutSetTiebreaks.matchAll(/(\d+)\s*:\s*(\d+)/g)]
    .map(score => [Number(score[1]), Number(score[2])])
    .filter(([teamOne, teamTwo]) => teamOne <= 7 && teamTwo <= 7)
    .reduce((totals, [teamOne, teamTwo]) => [totals[0] + teamOne, totals[1] + teamTwo], [0, 0]);
}

function formatProfileMatchCount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('de-DE', {
    minimumFractionDigits: Number.isInteger(number) ? 0 : 1,
    maximumFractionDigits: 1
  });
}

function getPlayerProfileMatchWeight(match) {
  const weight = Number(match?.matchWeight ?? 1);
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

function getProfileCompletedSets(resultDetails) {
  const withoutSetTiebreaks = String(resultDetails || '').replace(/\([^)]*\)/g, '');
  return [...withoutSetTiebreaks.matchAll(/(\d+)\s*:\s*(\d+)/g)]
    .map(score => [Number(score[1]), Number(score[2])])
    .map(([teamOne, teamTwo]) => {
      const isMatchTiebreak = Math.max(teamOne, teamTwo) > 7;
      const classification = isMatchTiebreak
        ? window.PadelScoreInput.classifyTiebreak(teamOne, teamTwo, 10)
        : window.PadelScoreInput.classifyRegularSet(teamOne, teamTwo);
      return { teamOne, teamTwo, isMatchTiebreak, complete: classification.state === 'complete' };
    })
    .filter(set => set.complete);
}

function getProfileSetTotals(resultDetails) {
  return getProfileCompletedSets(resultDetails)
    .reduce((totals, { teamOne, teamTwo }) =>
      teamOne > teamTwo ? [totals[0] + 1, totals[1]] : [totals[0], totals[1] + 1], [0, 0]);
}

function getProfileSetFeatureTotals(resultDetails) {
  const totals = { tiebreaks: [0, 0], bagels: [0, 0] };
  getProfileCompletedSets(resultDetails).forEach(({ teamOne, teamTwo, isMatchTiebreak }) => {
    const winnerIndex = teamOne > teamTwo ? 0 : 1;
    const isSetTiebreak = Math.max(teamOne, teamTwo) === 7 && Math.min(teamOne, teamTwo) === 6;
    if (isMatchTiebreak || isSetTiebreak) totals.tiebreaks[winnerIndex] += 1;
    if (!isMatchTiebreak && Math.max(teamOne, teamTwo) === 6 && Math.min(teamOne, teamTwo) === 0) {
      totals.bagels[winnerIndex] += 1;
    }
  });
  return totals;
}

function getPlayerProfileComparison(matches, otherName) {
  const createSide = () => ({ wins: [0, 0], sets: [0, 0], games: [0, 0], tiebreaks: [0, 0], bagels: [0, 0] });
  const comparison = { together: 0, against: 0, duel: createSide(), team: createSide() };
  const orient = (totals, team) => Number(team) === 2 ? [totals[1], totals[0]] : totals;
  const add = (side, key, values) => {
    side[key] = [side[key][0] + values[0], side[key][1] + values[1]];
  };
  matches.forEach(match => {
    const weight = getPlayerProfileMatchWeight(match);
    if (!weight) return;
    let side;
    if ((match.partnerNames || []).includes(otherName)) {
      comparison.together += weight;
      side = comparison.team;
    } else if ((match.opponentNames || []).includes(otherName)) {
      comparison.against += weight;
      side = comparison.duel;
    } else {
      return;
    }
    add(side, 'wins', [
      Number.isFinite(Number(match.winWeight)) ? Number(match.winWeight) : match.outcome === 'win' ? weight : 0,
      Number.isFinite(Number(match.lossWeight)) ? Number(match.lossWeight) : match.outcome === 'loss' ? weight : 0
    ]);
    const features = getProfileSetFeatureTotals(match.resultDetails);
    add(side, 'sets', orient(getProfileSetTotals(match.resultDetails), match.team));
    add(side, 'games', orient(getProfileRegularGameTotals(match.resultDetails), match.team));
    add(side, 'tiebreaks', orient(features.tiebreaks, match.team));
    add(side, 'bagels', orient(features.bagels, match.team));
  });
  return comparison;
}

function getProfileEloBeforeMatch(eloSeries, match) {
  const series = (eloSeries || []).filter(item => Number.isFinite(Number(item.elo)));
  const matchEntry = series.find(item => item.matchId && item.matchId === match.id && Number.isFinite(Number(item.oldElo)));
  if (matchEntry) return Number(matchEntry.oldElo);
  const previous = series.filter(item => item.date && item.date < match.date).at(-1);
  if (previous) return Number(previous.elo);
  const first = series[0];
  if (!first) return null;
  return Number.isFinite(Number(first.oldElo ?? NaN)) ? Number(first.oldElo) : Number(first.elo);
}

function getPlayerProfileTeamEloAverages(profile, togetherMatches, partnerId, playersByName, profiles) {
  const weightedElo = values => 0.7 * Math.min(...values) + 0.3 * Math.max(...values);
  const ownId = profile.identity?.id;
  const seriesFor = playerId => playerId === ownId
    ? profile.eloSeries
    : profiles.get(playerId)?.eloSeries;
  const sums = [0, 0];
  let weightTotal = 0;
  for (const match of togetherMatches) {
    const opponentIds = (match.opponentNames || []).map(name => playersByName.get(name)?.id);
    if (opponentIds.length !== 2 || opponentIds.some(playerId => !playerId)) continue;
    const playerIds = [ownId, partnerId, ...opponentIds];
    // Solange noch Profile laden, bleibt der Wert offen statt kurz einen Teilschnitt zu zeigen.
    if (playerIds.some(playerId => playerId !== ownId && profiles.get(playerId) === undefined)) return [null, null];
    const elos = playerIds.map(playerId => getProfileEloBeforeMatch(seriesFor(playerId), match));
    if (elos.some(elo => elo === null || !Number.isFinite(elo))) continue;
    const weight = getPlayerProfileMatchWeight(match);
    sums[0] += weightedElo(elos.slice(0, 2)) * weight;
    sums[1] += weightedElo(elos.slice(2)) * weight;
    weightTotal += weight;
  }
  return weightTotal ? sums.map(sum => sum / weightTotal) : [null, null];
}

function renderPlayerProfileCompareLoadingRow(label, leftValue = null, format = formatProfileMatchCount) {
  const skeletonValue = '<span class="loading-skeleton player-profile-compare-skeleton-value"><span class="skeleton-pill"></span></span>';
  const leftCell = leftValue === null || leftValue === undefined ? skeletonValue : escapeProfileComparisonHtml(format(leftValue));
  return `<div class="match-forecast-result player-profile-compare-row is-loading" aria-label="${escapeProfileComparisonHtml(`${label}: wird geladen`)}" aria-busy="true">
    <div class="match-forecast-percentages"><span>${leftCell}</span><span class="player-profile-compare-label">${escapeProfileComparisonHtml(label)}</span><span>${skeletonValue}</span></div>
    <div class="match-forecast-bar loading-skeleton player-profile-compare-skeleton-bar"><span></span></div>
  </div>`;
}

function renderPlayerProfileCompareRow(label, leftValue, rightValue, format = formatProfileMatchCount) {
  const left = Math.max(0, Number(leftValue) || 0);
  const right = Math.max(0, Number(rightValue) || 0);
  const total = left + right;
  const formatValue = value => value === null || value === undefined ? '—' : format(value);
  return `<div class="match-forecast-result player-profile-compare-row" aria-label="${escapeProfileComparisonHtml(`${label}: ${formatValue(leftValue)} zu ${formatValue(rightValue)}`)}">
    <div class="match-forecast-percentages"><span>${formatValue(leftValue)}</span><span class="player-profile-compare-label">${escapeProfileComparisonHtml(label)}</span><span>${formatValue(rightValue)}</span></div>
    <div class="match-forecast-bar${total ? ' has-votes' : ''}${left && right ? ' has-both-team-colors' : ''}">
      <span class="match-forecast-team-one" style="width:${total ? left / total * 50 : 0}%"></span>
      <span class="match-forecast-team-two" style="width:${total ? right / total * 50 : 0}%"></span>
    </div>
  </div>`;
}

function escapeProfileComparisonHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function renderPlayerProfileComparisonTables({
  profile, other, profiles, togetherMatches, comparePlayerIds, playersByName,
  renderTitle = (list, title) => `<span class="player-profile-compare-label">${escapeProfileComparisonHtml(title)}</span>`,
  renderList = () => ''
}) {
  const isLoading = ids => ids.some(id => profiles.has(id) && profiles.get(id) === undefined);
  const comparison = getPlayerProfileComparison(profile.matches || [], other.name);
  const ownElo = profile.summary?.currentElo ?? null;
  const otherElo = profiles.get(other.id)?.summary?.currentElo ?? null;
  const teamElos = getPlayerProfileTeamEloAverages(profile, togetherMatches, other.id, playersByName, profiles);
  const formatElo = value => String(Math.round(Number(value)));
  const sharedMatches = comparison.together + comparison.against;
  const renderSideRows = side => [
    renderPlayerProfileCompareRow('Siege', side.wins[0], side.wins[1]),
    renderPlayerProfileCompareRow('Sätze', side.sets[0], side.sets[1]),
    renderPlayerProfileCompareRow('Spiele', side.games[0], side.games[1]),
    renderPlayerProfileCompareRow('Tiebreaks', side.tiebreaks[0], side.tiebreaks[1]),
    renderPlayerProfileCompareRow('Zu-Null', side.bagels[0], side.bagels[1])
  ].join('');
  const duelMatches = (profile.matches || []).filter(match => getPlayerProfileMatchWeight(match) && !(match.partnerNames || []).includes(other.name) && (match.opponentNames || []).includes(other.name));
  // Das Elo und die Namenszeile bleiben auch ohne gemeinsame Partien sichtbar.
  // Die Blockbezeichnung steht wie die Wertebezeichnungen mittig zwischen beiden Seiten.
  const renderTable = (list, title, matches, matchCount, names, rows, emptyText, extraRows = '') => `<div class="player-profile-compare-table">
    <div class="match-forecast-percentages player-profile-compare-names"><span>${escapeProfileComparisonHtml(names[0])}</span>${renderTitle(list, title, matches)}<span>${escapeProfileComparisonHtml(names[1])}</span></div>
    ${renderList(list, matches)}
    ${matchCount ? rows : `<div class="hint player-profile-compare-empty">${escapeProfileComparisonHtml(emptyText)}</div>`}
    ${extraRows}
  </div>`;
  return `<div class="hint stat-meta-line">${escapeProfileComparisonHtml(`${formatProfileMatchCount(sharedMatches)} gemeinsame Partien`)}</div>
    <div class="player-profile-compare-tables">
      ${renderTable(
        'duel',
        `Im Duell (${formatProfileMatchCount(comparison.against)})`,
        duelMatches,
        comparison.against,
        [profile.identity?.displayName || '', other.name],
        renderSideRows(comparison.duel),
        'Noch nie gegeneinander gespielt.',
        isLoading([other.id])
          ? renderPlayerProfileCompareLoadingRow('Akt. Elo', ownElo, formatElo)
          : renderPlayerProfileCompareRow('Akt. Elo', ownElo, otherElo, formatElo)
      )}
      ${renderTable(
        'team',
        `Im Team (${formatProfileMatchCount(comparison.together)})`,
        togetherMatches,
        comparison.together,
        ['Zusammen', 'Gegner'],
        renderSideRows(comparison.team) + (isLoading(comparePlayerIds)
          ? renderPlayerProfileCompareLoadingRow('Ø Elo')
          : renderPlayerProfileCompareRow('Ø Elo', teamElos[0], teamElos[1], formatElo)),
        'Noch nie zusammen gespielt.'
      )}
    </div>`;
}

async function loadPlayerProfileCompareElo(playerIds, client = getSupabaseClient()) {
  if (!client) {
    const profiles = await Promise.all(playerIds.map(playerId => fetchPlayerProfile(playerId).catch(() => null)));
    return new Map(playerIds.map((playerId, index) => [playerId, profiles[index] || null]));
  }
  const [changes, players, seasons] = await Promise.all([
    client.from('match_elo_changes')
      .select('match_id,player_id,old_elo,new_elo,match:matches!inner(match_at,season_id,counts_for_elo)')
      .in('player_id', playerIds)
      .eq('match.counts_for_elo', true),
    client.from('players').select('id,initial_elo').in('id', playerIds),
    client.from('seasons').select('id,counts_for_profile')
  ]);
  const error = changes.error || players.error || seasons.error;
  if (error) throw error;
  const profileSeasons = new Set((seasons.data || []).filter(season => season.counts_for_profile).map(season => season.id));
  const toBerlinDate = value => new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const result = new Map();
  (players.data || []).forEach(player => {
    const eloSeries = (changes.data || [])
      .filter(change => change.player_id === player.id && change.match?.match_at && profileSeasons.has(change.match.season_id))
      .sort((left, right) => String(left.match.match_at).localeCompare(String(right.match.match_at))
        || String(left.match_id).localeCompare(String(right.match_id)))
      .map(change => ({
        matchId: change.match_id,
        date: toBerlinDate(change.match.match_at),
        oldElo: change.old_elo,
        elo: change.new_elo
      }));
    const initialElo = Number.isFinite(Number(player.initial_elo)) ? Number(player.initial_elo) : null;
    result.set(player.id, {
      summary: { currentElo: eloSeries.at(-1)?.elo ?? initialElo },
      eloSeries: eloSeries.length || initialElo === null ? eloSeries : [{ elo: initialElo }]
    });
  });
  playerIds.forEach(playerId => {
    if (!result.has(playerId)) result.set(playerId, null);
  });
  return result;
}
