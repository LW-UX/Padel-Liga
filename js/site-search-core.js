(function () {
  'use strict';

  function normalize(value) {
    return String(value ?? '').toLocaleLowerCase('de').normalize('NFD')
      .replace(/\p{M}/gu, '').replace(/ß/g, 'ss').trim().replace(/\s+/g, ' ');
  }

  const monthNames = [
    'januar jan', 'februar feb', 'marz mar maerz mrz', 'april apr', 'mai', 'juni jun',
    'juli jul', 'august aug', 'september sep sept', 'oktober okt', 'november nov', 'dezember dez'
  ];
  const months = new Map(monthNames.flatMap((names, i) => names.split(' ').map(name => [name, i + 1])));
  const berlinDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', dateStyle: 'short' });
  const achievementTerms = new Set(['auszeichnung', 'auszeichnungen', 'emblem', 'embleme', 'medaille', 'medaillen', 'lorbeer', 'lorbeeren']);
  const championTerms = new Set(['gewinner', 'sieger', 'champion', 'champions']);

  function parseDate(query, now) {
    const named = /^(?:(\d{1,2})\.?\s+)?([a-z]+)\.?(?:\s+(\d{2}|\d{4}))?$/.exec(query);
    const numeric = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4})?|\s+(\d{2}|\d{4}))?$/.exec(query);
    if (!numeric && !months.has(named?.[2])) return null;
    const month = numeric ? Number(numeric[2]) : months.get(named[2]);
    const day = numeric ? Number(numeric[1]) : named[1] ? Number(named[1]) : null;
    const specifiedYear = numeric ? numeric[3] || numeric[4] : named[3];
    const [currentYear, currentMonth] = berlinDate.format(now).split('-').map(Number);
    const nextMonth = currentMonth % 12 + 1;
    const year = specifiedYear
      ? Number(specifiedYear) + (specifiedYear.length === 2 ? 2000 : 0)
      : currentYear + (month === nextMonth && currentMonth === 12 ? 1 : month > currentMonth && month !== nextMonth ? -1 : 0);
    if (month < 1 || month > 12 || year < 1000
      || (day !== null && (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()))) return { kind: 'invalid-date' };
    const key = [year, String(month).padStart(2, '0'), ...(day === null ? [] : [String(day).padStart(2, '0')])].join('-');
    const label = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'UTC', month: 'long', year: 'numeric', ...(day === null ? {} : { day: 'numeric' })
    }).format(new Date(Date.UTC(year, month - 1, day ?? 1)));
    return { kind: 'date', key, label };
  }

  function parseQuery(input, now = new Date(), players = typeof window !== 'undefined' ? window.PADEL_PLAYERS || [] : []) {
    const text = String(input ?? '').trim().normalize('NFC');
    const query = normalize(text);
    const shorthand = /^([paf])(\d+)$/.exec(query);
    const initials = query.length >= 2 && players.some(player => nameKey(player.initials) === nameKey(query));
    if (Array.from(text).length < 3 && !shorthand && !initials) return { kind: 'idle' };
    if (shorthand) return { kind: { p: 'partie', a: 'artikel', f: 'final-four' }[shorthand[1]], number: Number(shorthand[2]) };
    const numbered = /^(?:(partie|artikel|final four)\s*|#\s*)?(\d+)$/.exec(query);
    if (numbered) return { kind: numbered[1] === 'final four' ? 'final-four' : numbered[1] || 'partie', number: Number(numbered[2]) };
    if (championTerms.has(query)) return { kind: 'text', query, achievementMode: 'champion' };
    if (achievementTerms.has(query)) return { kind: 'text', query, achievementMode: 'all' };
    return parseDate(query, now) || { kind: 'text', query };
  }

  function groupPlayerAchievements(rows, mode, playerIds, seasonIds) {
    const grouped = new Map();
    for (const row of rows) {
      if (!playerIds.has(row.player_id) || (row.season_id != null && !seasonIds.has(row.season_id))) continue;
      if (mode === 'champion' && row.kind !== 'winner') continue;
      const achievements = grouped.get(row.player_id) || [];
      achievements.push(row);
      grouped.set(row.player_id, achievements);
    }
    return grouped;
  }

  const nameKey = value => normalize(String(value ?? '').replace(/\./g, ''));

  function playerLookup(players, input) {
    const key = nameKey(input);
    if (!key) return [];
    return players.flatMap(player => {
      const name = nameKey(player.name);
      const first = name.split(' ')[0];
      const initial = name.split(' ').at(-1);
      const aliases = (player.searchAliases || []).map(nameKey);
      const exact = [name, first, initial, nameKey(player.initials), ...aliases].includes(key);
      const prefix = key.length >= 2 && [name, ...aliases].some(value => value.startsWith(key));
      return exact || prefix ? [{ player, exact }] : [];
    }).sort((a, b) => Number(b.exact) - Number(a.exact) || a.player.name.localeCompare(b.player.name, 'de'));
  }

  // Prefer a full name such as "Luca W." over splitting it into two separate players.
  function resolveNames(players, text) {
    const words = nameKey(text).split(' ');
    const groups = [];
    for (let start = 0; start < words.length;) {
      const end = words.length;
      let hits = [];
      let cursor = end;
      for (; cursor > start; cursor--) {
        hits = playerLookup(players, words.slice(start, cursor).join(' '));
        if (cursor > start + 1) hits = hits.filter(hit => hit.exact);
        if (hits.length) break;
      }
      if (!hits.length || groups.length === 4) return [];
      groups.push(hits.map(hit => hit.player));
      start = cursor;
    }
    return groups;
  }

  const teamIds = (match, team) => match[team]?.playerIds || [];
  function hasParticipants(participants, groups) {
    const ids = new Set(participants);
    function assign(index) {
      if (index === groups.length) return true;
      return groups[index].some(({ id }) => {
        if (!ids.delete(id)) return false;
        const found = assign(index + 1);
        ids.add(id);
        return found;
      });
    }
    return groups.length > 0 && assign(0);
  }

  function hasPlayers(match, groups) {
    return hasParticipants([...teamIds(match, 'team1'), ...teamIds(match, 'team2')], groups);
  }

  const internalTrainingPlayers = new Set(['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'test_net']);

  function normalizeTraining(row, source, playersById) {
    if (source === 'scheduled' && row.status !== 'scheduled') return null;
    const guests = row.guest_names || {};
    const members = source === 'confirmed' ? row.players || [] : (row.player_ids || []).map(id => ({
      id,
      is_guest: Object.hasOwn(guests, id),
      display_name: Object.hasOwn(guests, id) ? guests[id] : playersById.get(id)?.name
    }));
    if (members.some(({ id, is_guest }) => !is_guest && (internalTrainingPlayers.has(id) || playersById.get(id)?.firma === 'Test'))) return null;
    const participants = members.map((member, index) => {
      const { id, is_guest: guest, display_name: name } = member;
      if (!guest && playersById.has(id)) return playersById.get(id);
      return { id: guest ? `guest:${index}` : id, name };
    }).filter(player => player.id && player.name);
    if (!row.session_id || !row.played_on || !participants.length) return null;
    return {
      id: String(row.session_id), date: row.played_on, time: String(row.display_time || '').slice(0, 5).replace('.', ':'),
      participants, confirmed: source === 'confirmed'
    };
  }

  function trainingMatches(training, query) {
    if (query.kind === 'date') return training.date.startsWith(query.key);
    if (query.kind !== 'text') return false;
    if ('trainings'.startsWith(query.query)) return true;
    const names = query.query.replace(/^trainings?\s+/, '');
    return hasParticipants(training.participants.map(player => player.id), resolveNames(training.participants, names));
  }

  function summarizePair(matches, groups) {
    if (groups.length !== 2 || groups.some(group => group.length !== 1)) return null;
    const [first, second] = groups.map(group => group[0]);
    if (first.id === second.id) return null;
    const duel = [0, 0];
    const team = [0, 0];
    for (const match of matches) {
      if (match.cancelledAt || match.isCancelled || ![1, 2].includes(match.winner) || !hasPlayers(match, groups)) continue;
      const firstTeam = teamIds(match, 'team1').includes(first.id) ? 1 : 2;
      const sameTeam = teamIds(match, `team${firstTeam}`).includes(second.id);
      (sameTeam ? team : duel)[match.winner === firstTeam ? 0 : 1]++;
    }
    return [...duel, ...team].some(Boolean) ? { first, second, duel, team } : null;
  }

  function matchNumber(match, finalFour = false) {
    const pattern = finalFour ? /^(?:final four|final)\s+(\d+)$/ : /^partie\s+(\d+)$/;
    const fromLabel = pattern.exec(normalize(match.displayLabel))?.[1];
    const fromId = finalFour ? /-final-?(\d+)$/.exec(match.id)?.[1] : /(?:^|-)partie-?(\d+)$/.exec(match.id)?.[1];
    return Number(fromLabel || fromId || 0);
  }

  function matchesQuery(match, query, groups) {
    const finalFour = ['final-four', 'final_four'].includes(match.stage);
    if (query.kind === 'partie') return !finalFour && query.number > 0 && matchNumber(match) === query.number;
    if (query.kind === 'final-four') return finalFour && query.number > 0 && matchNumber(match, true) === query.number;
    if (query.kind === 'date') return Boolean(match.matchAt && berlinDate.format(new Date(match.matchAt)).startsWith(query.key));
    return query.kind === 'text' && hasPlayers(match, groups);
  }

  function quoteAuthorQuery(query) {
    if (query.kind !== 'text' || !/(?:^|\s)zitate?(?=\s|$)/.test(query.query.replace(/\+/g, ' '))) return null;
    return query.query.replace(/\+/g, ' ').replace(/(?:^|\s)zitate?(?=\s|$)/g, ' ').trim();
  }

  function articleQuotes(article, query, players = []) {
    const authorQuery = quoteAuthorQuery(query);
    if (authorQuery === null || !article.title) return [];
    const candidates = playerLookup(players, authorQuery);
    return (article.body || []).filter(block => {
      if (block.type !== 'quote' || !block.text) return false;
      if (!authorQuery) return true;
      if (candidates.length) {
        const authors = new Set(playerLookup(players, block.author).map(({ player }) => player.id));
        return candidates.some(({ player }) => authors.has(player.id));
      }
      return nameKey(block.author).includes(nameKey(authorQuery));
    });
  }

  function articleMatches(article, query, { includeText = false } = {}) {
    if (!article.title || !article.body?.length) return false;
    if (query.kind === 'artikel') return query.number > 0 && Number(article.spieltag) === query.number;
    if (query.kind !== 'text') return false;
    if (normalize(article.title).includes(query.query)) return true;
    return includeText && article.body.some(block => normalize(block.text).includes(query.query));
  }

  function playerSummaryStats(summary = {}) {
    const numeric = value => value === null || value === undefined || value === '' ? NaN : Number(value);
    const elo = numeric(summary.currentElo);
    const matches = numeric(summary.matches);
    const wins = numeric(summary.wins);
    return {
      elo: Number.isFinite(elo) ? Math.round(elo).toLocaleString('de-DE') : '—',
      matches: Number.isFinite(matches) ? matches.toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '—',
      winRate: matches > 0 && Number.isFinite(wins) ? `${Math.round(wins / matches * 100)} %` : '—'
    };
  }

  function infoGroupAnchor(sectionTitle, groupTitle) {
    const slug = title => String(title).toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${slug(sectionTitle)}-${slug(groupTitle)}`;
  }

  const api = { normalize, parseQuery, resolveNames, matchesQuery, matchNumber, summarizePair, quoteAuthorQuery, articleQuotes, articleMatches, normalizeTraining, trainingMatches, groupPlayerAchievements, playerSummaryStats, infoGroupAnchor };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.PadelSearchCore = api;
})();
