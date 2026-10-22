#!/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node

// Kompakte Recherche-Übersicht für Spieltagsartikel nach
// docs/project-decisions/articles.md. Liest ausschließlich über
// tools/supabase-mcp.mjs und schreibt nichts in die Datenbank.
//
// Aufruf: tools/article-research.mjs <saison-id> <spieltag> [--seit JJJJ-MM-TT]

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const sinceIndex = args.indexOf('--seit');
const since = sinceIndex >= 0 ? args.splice(sinceIndex, 2)[1] : null;
const [seasonId, matchdayArgument] = args;
const matchday = Number(matchdayArgument);

if (!/^[a-z0-9-]+$/.test(seasonId || '') || !Number.isInteger(matchday) || (since && !/^\d{4}-\d{2}-\d{2}$/.test(since))) {
  console.error('Aufruf: article-research.mjs <saison-id> <spieltag> [--seit JJJJ-MM-TT]');
  process.exit(1);
}

const STREAK_LENGTH = 3;
const DOMINANCE_GAMES = 12;
const DOMINANCE_MAX_CONCEDED = 3;
const MIN_RELATIONSHIP_MATCHES = 3;
const TEAM_ELO_WEAKER_WEIGHT = 0.7;

// ── Daten ─────────────────────────────────────────────────────────

const query = `
select jsonb_build_object(
  'season', (select to_jsonb(s) from seasons s where s.id = '${seasonId}'),
  'matchdays', (select coalesce(jsonb_agg(to_jsonb(d) order by d.matchday), '[]') from season_matchdays d where d.season_id = '${seasonId}'),
  'seasons', (select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'countsForProfile', counts_for_profile)) from seasons),
  'players', (select jsonb_agg(jsonb_build_object('id', id, 'name', display_name, 'company', company)) from players),
  'seasonPlayers', (select coalesce(jsonb_agg(player_id), '[]') from season_players where season_id = '${seasonId}'),
  'matches', (select jsonb_agg(jsonb_build_object(
      'id', m.id, 'seasonId', m.season_id, 'matchday', m.matchday, 'stage', m.competition_stage,
      'format', m.format, 'label', m.display_label, 'result', m.result_details, 'sets', m.actual_sets,
      'winner', m.winner, 'countsForRanking', m.counts_for_ranking, 'countsForElo', m.counts_for_elo,
      'matchAt', m.match_at,
      'team1', (select jsonb_agg(mp.player_id order by mp.position) from match_players mp where mp.match_id = m.id and mp.team = 1),
      'team2', (select jsonb_agg(mp.player_id order by mp.position) from match_players mp where mp.match_id = m.id and mp.team = 2),
      'eloBefore', (select jsonb_object_agg(e.player_id, e.old_elo) from match_elo_changes e where e.match_id = m.id)))
    from matches m where m.cancelled_at is null),
  'profiles', (select coalesce(jsonb_object_agg(sp.player_id, get_player_profile(sp.player_id)), '{}') from season_players sp where sp.season_id = '${seasonId}')
) as data;`;

async function loadData() {
  const directory = await mkdtemp(join(tmpdir(), 'padel-artikel-'));
  const sqlPath = join(directory, 'recherche.sql');
  try {
    await writeFile(sqlPath, query);
    const { stdout } = await promisify(execFile)(
      resolve(toolsDirectory, 'supabase-mcp.mjs'),
      ['execute-sql', sqlPath],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    let text = stdout;
    try { text = JSON.parse(stdout).result ?? stdout; } catch { /* Rohtext */ }
    const payload = text.match(/<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-/);
    if (!payload) throw new Error('Unerwartete Antwort der Datenbank.');
    return JSON.parse(payload[1])[0].data;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// ── Hilfsfunktionen ───────────────────────────────────────────────

const flipResult = result => String(result || '').replace(/(\d+)\s*:\s*(\d+)/g, '$2:$1');

function regularGames(result) {
  // Tiebreak-Punkte in Klammern und der Match-Tie-Break zählen nicht als Spiele.
  const regularPart = String(result || '').replace(/\([^)]*\)/g, '').split(/[–-]/)[0];
  return [...regularPart.matchAll(/(\d+)\s*:\s*(\d+)/g)]
    .map(match => [Number(match[1]), Number(match[2])])
    .filter(([one, two]) => one <= 7 && two <= 7)
    .reduce((sum, [one, two]) => [sum[0] + one, sum[1] + two], [0, 0]);
}

function rankingPoints(sets, team) {
  const [one, two] = String(sets || '').split(':').map(Number);
  const [own, other] = team === 1 ? [one, two] : [two, one];
  if (own === 2 && other === 0) return 3;
  if (own === 2 && other === 1) return 2;
  if (own === 1 && other === 2) return 1;
  return 0;
}

const percent = value => `${Math.round(value * 100)} %`;
const formatDate = value => value ? new Date(value).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }) : 'ohne Datum';
const signed = value => (value > 0 ? `+${value}` : `${value}`);

function expectedScore(playerElo, opponentElo) {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 500));
}

function weightedTeamElo(elos) {
  const [weaker, stronger] = [...elos].sort((a, b) => a - b);
  return weaker * TEAM_ELO_WEAKER_WEIGHT + stronger * (1 - TEAM_ELO_WEAKER_WEIGHT);
}

function eloGain(playerElo, opponentElos, pointFactor) {
  const expected = opponentElos.reduce((sum, elo) => sum + expectedScore(playerElo, elo), 0) / opponentElos.length;
  return Math.round(playerElo + pointFactor * 50 * (1 - expected)) - playerElo;
}

const pointFactor = difference => Math.pow(Math.log10(difference + 1), 3) + 2;

// Wie im Spielerprofil: bestätigte Liga- und Trainingspartien, mindestens drei
// gemeinsame Partien, Führende über beziehungsweise unter 50 Prozent.
function relationshipLeaders(matches) {
  const partners = new Map();
  const opponents = new Map();
  const record = (records, name, match) => {
    const weight = Number.isFinite(Number(match.matchWeight)) && Number(match.matchWeight) >= 0 ? Number(match.matchWeight) : 1;
    if (!name || weight === 0) return;
    const wins = Number.isFinite(Number(match.winWeight)) ? Number(match.winWeight) : (match.outcome === 'win' ? weight : 0);
    const entry = records.get(name) || { name, matches: 0, wins: 0 };
    entry.matches += weight;
    entry.wins += wins;
    records.set(name, entry);
  };
  matches.forEach(match => {
    [...new Set(match.partnerNames || [])].forEach(name => record(partners, name, match));
    [...new Set(match.opponentNames || [])].forEach(name => record(opponents, name, match));
  });
  const eligible = records => [...records.values()]
    .filter(entry => entry.matches >= MIN_RELATIONSHIP_MATCHES)
    .map(entry => ({ ...entry, winRate: entry.wins / entry.matches }));
  const leaders = (entries, qualifies, direction) => {
    const qualified = entries.filter(qualifies).sort((a, b) => direction * (b.winRate - a.winRate) || b.matches - a.matches);
    return qualified.filter(entry => entry.winRate === qualified[0]?.winRate);
  };
  const partnerEntries = eligible(partners);
  const opponentEntries = eligible(opponents);
  return {
    Erfolgspartner: leaders(partnerEntries, entry => entry.winRate > 0.5, 1),
    Angstpartner: leaders(partnerEntries, entry => entry.winRate < 0.5, -1),
    Lieblingsgegner: leaders(opponentEntries, entry => entry.winRate > 0.5, 1),
    Angstgegner: leaders(opponentEntries, entry => entry.winRate < 0.5, -1)
  };
}

// ── Auswertung ────────────────────────────────────────────────────

const data = await loadData();
if (!data.season) {
  console.error(`Saison ${seasonId} nicht gefunden.`);
  process.exit(1);
}

const playersById = new Map(data.players.map(player => [player.id, player]));
const name = id => playersById.get(id)?.name || id;
const company = id => playersById.get(id)?.company || null;
const profileSeasons = new Set(data.seasons.filter(season => season.countsForProfile).map(season => season.id));
const seasonLabels = new Map(data.seasons.map(season => [season.id, season.label]));
const profiles = data.profiles || {};
const currentElo = id => Number(profiles[id]?.summary?.currentElo);

const allMatches = (data.matches || []).filter(match => match.team1?.length === 2 && match.team2?.length === 2);
const officialCompleted = allMatches
  .filter(match => profileSeasons.has(match.seasonId) && match.winner !== null)
  .sort((a, b) => String(a.matchAt).localeCompare(String(b.matchAt)));
const seasonLeague = allMatches.filter(match => match.seasonId === seasonId && match.stage === 'league');
const matchNumber = match => match.label || `Partie ${String(match.id).match(/(\d+)$/)?.[1] ?? match.id}`;
const teamText = ids => ids.map(name).join(' & ');

// Rangliste der laufenden Saison, optional ohne eine bestimmte Partie.
function buildTable(excludedMatchId = null) {
  const entries = data.seasonPlayers.map(id => {
    const entry = { id, points: 0, played: 0, wins: 0, gameDiff: 0, gamesWon: 0, open: 0 };
    seasonLeague.forEach(match => {
      const team = match.team1.includes(id) ? 1 : match.team2.includes(id) ? 2 : 0;
      if (!team || match.id === excludedMatchId) return;
      if (match.winner === null) {
        if (match.matchday <= matchday) entry.open += 1;
        return;
      }
      if (match.countsForRanking === false) return;
      const [one, two] = regularGames(match.result);
      entry.played += 1;
      entry.wins += match.winner === team ? 1 : 0;
      entry.points += rankingPoints(match.sets, team);
      entry.gameDiff += team === 1 ? one - two : two - one;
      entry.gamesWon += team === 1 ? one : two;
    });
    return entry;
  });
  return rankEntries(entries);
}

function rankEntries(entries) {
  const ranked = [...entries].sort((a, b) => b.points - a.points || b.gameDiff - a.gameDiff || b.gamesWon - a.gamesWon);
  ranked.forEach((entry, index) => { entry.rank = index + 1; });
  return ranked;
}

const table = buildTable();
const tableById = new Map(table.map(entry => [entry.id, entry]));
const places = Number(data.season.qualification_places) || 8;
const hasTable = data.season.tournament_mode !== 'knockout_redraw' && table.length > 0;
// Tabellenlage zählt erst, wenn zehn Spieler (in kleineren Ligen alle) mindestens zwei Partien haben.
const rankingReady = entries => entries.filter(entry => entry.played >= 2).length >= Math.min(10, entries.length);

// Tabellenlage allein durch diese Partie; alle anderen Partien bleiben unverändert.
// Deutlich: 2:0 mit 12:0 Spielen, knapp: 2:1 mit ausgeglichenen Spielen.
const OUTCOMES = {
  clearWin: { own: [3, 12, 12], other: [0, -12, 0] },
  closeWin: { own: [2, 0, 12], other: [1, 0, 12] }
};

function rankAfter(match, winningTeam, outcome, id) {
  const winners = winningTeam === 1 ? match.team1 : match.team2;
  const entries = table.map(entry => {
    const team = match.team1.includes(entry.id) || match.team2.includes(entry.id);
    if (!team) return { ...entry };
    const [points, diff, games] = winners.includes(entry.id) ? OUTCOMES[outcome].own : OUTCOMES[outcome].other;
    return { ...entry, points: entry.points + points, gameDiff: entry.gameDiff + diff, gamesWon: entry.gamesWon + games };
  });
  return rankEntries(entries).find(entry => entry.id === id).rank;
}

function tableOutlook(id, match) {
  const entry = tableById.get(id);
  if (!hasTable || !entry) return [];
  const team = match.team1.includes(id) ? 1 : 2;

  if (match.winner !== null) {
    const tableBefore = buildTable(match.id);
    if (!rankingReady(tableBefore)) return [];
    const before = tableBefore.find(other => other.id === id)?.rank;
    if (!before || before === entry.rank) return [];
    const crossed = before > places && entry.rank <= places ? `, damit in den Top ${places}`
      : before <= places && entry.rank > places ? `, damit aus den Top ${places}` : '';
    const top = entry.rank === 1 ? ', damit Tabellenführer' : before === 1 ? ', damit Tabellenführung verloren' : '';
    return [`durch diese Partie von Platz ${before} auf Platz ${entry.rank}${top}${crossed}`];
  }

  if (!rankingReady(table)) return [];
  const win = { clear: rankAfter(match, team, 'clearWin', id), close: rankAfter(match, team, 'closeWin', id) };
  const loss = { clear: rankAfter(match, 3 - team, 'clearWin', id), close: rankAfter(match, 3 - team, 'closeWin', id) };
  const how = (close, verb) => close ? `mit jedem ${verb}` : `nur mit deutlichem ${verb}`;
  const howLoss = close => close ? 'schon bei knapper Niederlage' : 'nur bei deutlicher Niederlage';
  const notes = [];
  if (entry.rank > 1 && win.clear === 1) notes.push(`kann Platz 1 übernehmen (${how(win.close === 1, 'Sieg')})`);
  if (entry.rank === 1 && loss.clear > 1) notes.push(`kann die Tabellenführung verlieren (${howLoss(loss.close > 1)})`);
  if (entry.rank > places && win.clear <= places) notes.push(`kann in die Top ${places} rutschen (${how(win.close <= places, 'Sieg')})`);
  if (entry.rank <= places && loss.clear > places) notes.push(`kann aus den Top ${places} rutschen (${howLoss(loss.close > places)})`);
  return notes;
}

function officialHistory(id) {
  return (profiles[id]?.matches || [])
    .filter(match => match.kind !== 'training' && match.isComplete && !match.isCancelled && Number(match.matchWeight ?? 1) > 0);
}

function streak(id) {
  const history = officialHistory(id);
  const outcome = history[0]?.outcome;
  if (!['win', 'loss'].includes(outcome)) return null;
  const length = history.findIndex(match => match.outcome !== outcome);
  const count = length === -1 ? history.length : length;
  return count >= STREAK_LENGTH ? `${outcome === 'win' ? 'Gewinnsträhne' : 'Negativlauf'}: ${count} in Folge` : null;
}

function firstSeasonWinAfterDrought(id) {
  const seasonHistory = officialHistory(id).filter(match => match.seasonId === seasonId);
  const wins = seasonHistory.filter(match => match.outcome === 'win');
  const losses = seasonHistory.filter(match => match.outcome === 'loss');
  return seasonHistory[0]?.outcome === 'win' && wins.length === 1 && losses.length >= 2
    ? `erster Saisonsieg nach ${losses.length} Niederlagen (${formatDate(seasonHistory[0].date)})`
    : null;
}

function orientedResult(match) {
  return match.team === 2 ? flipResult(match.resultDetails) : match.resultDetails;
}

function dominance(result, label) {
  const [own, other] = regularGames(result);
  if (own >= DOMINANCE_GAMES && other <= DOMINANCE_MAX_CONCEDED) return `${label}: Dominanz ${own}:${other} Spiele`;
  if (other >= DOMINANCE_GAMES && own <= DOMINANCE_MAX_CONCEDED) return `${label}: Klatsche ${own}:${other} Spiele`;
  return null;
}

function lastMatchText(id) {
  const last = officialHistory(id)[0];
  if (!last) return null;
  const verb = last.outcome === 'win' ? 'Sieg' : last.outcome === 'loss' ? 'Niederlage' : 'Remis';
  return `${verb} ${orientedResult(last)} mit ${last.partnerNames.join(', ')} gegen ${last.opponentNames.join(' & ')} (${formatDate(last.date)})`;
}

function relationship(id, partnerId, opponentIds) {
  const leaders = relationshipLeaders(profiles[id]?.matches || []);
  const candidates = [];
  for (const [label, entries] of Object.entries(leaders)) {
    const targets = label.endsWith('partner') ? [partnerId] : opponentIds;
    entries.filter(entry => targets.some(target => name(target) === entry.name)).forEach(entry => {
      candidates.push({ label, ...entry });
    });
  }
  candidates.sort((a, b) => Math.abs(b.winRate - 0.5) - Math.abs(a.winRate - 0.5) || b.matches - a.matches);
  return candidates.map(entry => `${entry.label} ${entry.name}: ${entry.wins} von ${entry.matches} gewonnen (${percent(entry.winRate)})`);
}

function peakOutlook(id, opponentIds, format) {
  const summary = profiles[id]?.summary || {};
  const elo = Number(summary.currentElo);
  const peak = Number(summary.peakElo);
  const opponentElos = opponentIds.map(currentElo);
  if (![elo, peak, ...opponentElos].every(Number.isFinite)) return null;
  const [closest, clearest] = format === 'single-set' ? [1, 6] : [0.6, 12];
  const minimum = eloGain(elo, opponentElos, pointFactor(closest));
  const maximum = eloGain(elo, opponentElos, pointFactor(clearest));
  if (elo + maximum <= peak) return null;
  const certainty = elo + minimum > peak ? 'mit jedem Sieg' : `ab einem Sieg mit mehr als ${peak - elo} Elo-Punkten`;
  return `neuer Elo-Höchstwert möglich (${elo}, bisher ${peak}; Sieg ${signed(minimum)} bis ${signed(maximum)}) - ${certainty}`;
}

function rematches(match) {
  const [first, partner] = match.team1;
  const opponents = new Set(match.team2.map(name));
  return (profiles[first]?.matches || [])
    .filter(entry => entry.id !== match.id && entry.isComplete && !entry.isCancelled)
    .filter(entry => entry.partnerNames?.length === 1 && entry.partnerNames[0] === name(partner))
    .filter(entry => entry.opponentNames?.length === 2 && entry.opponentNames.every(opponent => opponents.has(opponent)))
    .map(entry => {
      const context = entry.kind === 'training' ? 'Training' : seasonLabels.get(entry.seasonId) || entry.seasonId;
      const outcome = entry.outcome === 'win' ? 'Sieg Team 1' : entry.outcome === 'loss' ? 'Sieg Team 2' : 'offen';
      return `${context}, ${formatDate(entry.date)}: ${orientedResult(entry)} (${outcome})`;
    });
}

function companyDuel(match) {
  const companies = [match.team1, match.team2].map(team => new Set(team.map(company)));
  if (companies.some(set => set.size !== 1)) return null;
  const [one, two] = companies.map(set => [...set][0]);
  if (one === two) return `Firmeninternes Duell (${one})`;
  const duels = officialCompleted.filter(other => {
    const sides = [other.team1, other.team2].map(team => new Set(team.map(company)));
    return other.id !== match.id && sides.every(set => set.size === 1)
      && new Set([...sides[0], ...sides[1]]).size === 2
      && [...sides[0], ...sides[1]].every(value => value === one || value === two);
  });
  const winsOne = duels.filter(other => company((other.winner === 1 ? other.team1 : other.team2)[0]) === one).length;
  return `Firmenduell ${one} gegen ${two}; bisherige Firmenduelle: ${winsOne}:${duels.length - winsOne}`;
}

function winProbability(match) {
  const eloOf = id => match.winner !== null && match.eloBefore?.[id] != null ? Number(match.eloBefore[id]) : currentElo(id);
  const elos = [match.team1.map(eloOf), match.team2.map(eloOf)];
  if (elos.flat().some(elo => !Number.isFinite(elo))) return null;
  const team1 = Math.round(expectedScore(weightedTeamElo(elos[0]), weightedTeamElo(elos[1])) * 100);
  return `${team1} : ${100 - team1} %`;
}

// Früher Vogel und Langschläfer wie in der All-Time-Statistik: durchschnittliche
// Anstoßzeit aller abgeschlossenen offiziellen Partien mit Uhrzeit.
const berlinMinutes = value => {
  const parts = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(value));
  return Number(parts.find(part => part.type === 'hour').value) * 60 + Number(parts.find(part => part.type === 'minute').value);
};
const formatMinutes = minutes => `${String(Math.floor(Math.round(minutes) / 60)).padStart(2, '0')}:${String(Math.round(minutes) % 60).padStart(2, '0')}`;

function timeExtremes(until = null) {
  const times = new Map();
  officialCompleted
    .filter(match => match.matchAt && (!until || String(match.matchAt) < until))
    .forEach(match => [...match.team1, ...match.team2].forEach(id => {
      times.set(id, [...(times.get(id) || []), berlinMinutes(match.matchAt)]);
    }));
  const averages = [...times.entries()]
    .map(([id, values]) => ({ id, count: values.length, average: values.reduce((sum, value) => sum + value, 0) / values.length }))
    .sort((a, b) => a.average - b.average || b.count - a.count || name(a.id).localeCompare(name(b.id), 'de'));
  return averages.length ? { early: averages[0], late: averages[averages.length - 1] } : null;
}

const extremesNow = timeExtremes();
const extremesBefore = since ? timeExtremes(since) : null;

function timeTitles(id) {
  if (!extremesNow) return [];
  return [['early', 'Früher Vogel'], ['late', 'Langschläfer']]
    .filter(([key]) => extremesNow[key].id === id)
    .map(([key, label]) => {
      const holder = extremesNow[key];
      const previous = extremesBefore?.[key];
      const change = previous && previous.id !== id ? `, neu seit ${formatDate(since)} (vorher ${name(previous.id)})` : '';
      return `All-Time-${label}: Ø ${formatMinutes(holder.average)} Uhr aus ${holder.count} Partien${change}`;
    });
}

function achievements(id) {
  return (profiles[id]?.achievements || [])
    .map(entry => `${entry.title}${entry.subtitle ? ` (${entry.subtitle})` : ''}${entry.seasonId ? ` · ${seasonLabels.get(entry.seasonId) || entry.seasonId}` : ''}`);
}

// ── Ausgabe ───────────────────────────────────────────────────────

const lines = [];
const day = data.matchdays.find(entry => entry.matchday === matchday);
lines.push(`# ${data.season.label} · Spieltag ${matchday}${day?.starts_on ? ` (${formatDate(day.starts_on)} - ${formatDate(day.ends_on)})` : ''}`);
lines.push('Stand: Datenbank jetzt. Elo und Profile sind global, die Rangliste betrifft nur diese Saison.');

if (hasTable) {
  lines.push('', `## Rangliste (Top ${places} qualifiziert)`);
  table.forEach(entry => {
    lines.push(`${entry.rank}. ${name(entry.id)} (${company(entry.id)}) · ${entry.points} P · ${entry.wins}/${entry.played} Siege · Diff ${signed(entry.gameDiff)} · offen bis ST ${matchday}: ${entry.open} · Elo ${currentElo(entry.id) || '—'}`);
  });
}

if (extremesNow) {
  lines.push('', '## All-Time-Anstoßzeiten');
  [['early', 'Früher Vogel'], ['late', 'Langschläfer']].forEach(([key, label]) => {
    const holder = extremesNow[key];
    const previous = extremesBefore?.[key];
    const change = previous && previous.id !== holder.id ? ` · neu seit ${formatDate(since)}, vorher ${name(previous.id)}` : '';
    lines.push(`${label}: ${name(holder.id)} (Ø ${formatMinutes(holder.average)} Uhr aus ${holder.count} Partien)${change}`);
  });
}

if (since) {
  lines.push('', `## Seit ${formatDate(since)} gespielt`);
  officialCompleted
    .filter(match => match.seasonId === seasonId && String(match.matchAt) >= since)
    .forEach(match => {
      const notes = [dominance(match.result, 'Team 1')].filter(Boolean);
      lines.push(`- ${matchNumber(match)} (ST ${match.matchday ?? '—'}, ${formatDate(match.matchAt)}): ${teamText(match.team1)} vs. ${teamText(match.team2)} · ${match.result} · Sieger Team ${match.winner} · Prognose vorher ${winProbability(match) || '—'}${notes.length ? ` · ${notes.join(' · ')}` : ''}`);
    });
}

const matchdayMatches = seasonLeague
  .filter(match => match.matchday === matchday)
  .sort((a, b) => Number(String(a.id).match(/(\d+)$/)?.[1]) - Number(String(b.id).match(/(\d+)$/)?.[1]));

for (const match of matchdayMatches) {
  const played = match.winner !== null;
  lines.push('', `## ${matchNumber(match)}${played ? ' - bereits gespielt' : ''}`);
  lines.push(`${teamText(match.team1)} vs. ${teamText(match.team2)} · ${played ? `Ergebnis ${match.result}` : 'offen'} · Gewinnwahrscheinlichkeit ${winProbability(match) || '—'}`);

  const required = [];
  const duel = companyDuel(match);
  if (duel) required.push(duel);
  rematches(match).forEach(entry => required.push(`Rematch: ${entry}`));
  if (played) {
    const own = dominance(match.result, 'Diese Partie aus Sicht Team 1');
    if (own) required.push(own);
  }

  const players = [
    ...match.team1.map(id => ({ id, partner: match.team1.find(other => other !== id), opponents: match.team2 })),
    ...match.team2.map(id => ({ id, partner: match.team2.find(other => other !== id), opponents: match.team1 }))
  ];
  const perPlayer = players.map(({ id, partner, opponents }) => {
    const firstWin = firstSeasonWinAfterDrought(id);
    const last = officialHistory(id)[0];
    // Bei vorgespielten Partien ist das letzte Spiel meist diese Partie selbst.
    const lastIsThisMatch = last?.id === match.id;
    const summary = profiles[id]?.summary || {};
    const reachedPeak = lastIsThisMatch && last.outcome === 'win' && Number(summary.currentElo) >= Number(summary.peakElo)
      ? `neuer Elo-Höchstwert mit dieser Partie erreicht (${summary.currentElo})` : null;
    const facts = [
      firstWin && `PFLICHT ${firstWin}`,
      ...relationship(id, partner, opponents),
      played ? reachedPeak : peakOutlook(id, opponents, match.format),
      last && !lastIsThisMatch && dominance(orientedResult(last), 'Letztes Spiel'),
      streak(id) && `${streak(id)}${lastIsThisMatch ? ' (inklusive dieser Partie)' : ''}`,
      ...tableOutlook(id, match),
      ...timeTitles(id),
      ...achievements(id).map(entry => `Auszeichnung: ${entry}`),
      !lastIsThisMatch && lastMatchText(id) && `Letztes Spiel: ${lastMatchText(id)}`
    ].filter(Boolean);
    const entry = tableById.get(id);
    const tableText = entry ? `Platz ${entry.rank}, ${entry.points} P aus ${entry.played}` : 'nicht in der Rangliste';
    return [`- ${name(id)} (${company(id)}, ${tableText}, Elo ${currentElo(id) || '—'})`, ...facts.map(fact => `  - ${fact}`)];
  });

  lines.push(required.length ? `Pflicht: ${required.join(' | ')}` : 'Pflicht: keine aus der Datenbank');
  lines.push(...perPlayer.flat());
}

if (!matchdayMatches.length) lines.push('', `Keine Ligapartien für Spieltag ${matchday} gefunden.`);
console.log(lines.join('\n'));
