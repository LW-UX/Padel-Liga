const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261020160000_all_time_league_ranking.sql'),
  'utf8'
);

function evaluateSetDominance(player, matches) {
  const source = app.match(
    /function parseRegularSetScore\(rawSet\) \{[\s\S]*?(?=\nfunction getNormalizedWinnerSetAverages)/
  );
  assert.ok(source, 'set-dominance helpers should be present');
  const context = {
    player,
    matches,
    result: null,
    isSingleSetMatch: match => match.format === 'single-set'
  };
  vm.createContext(context);
  vm.runInContext(`${source[0]}\nresult = getPlayerSetDominance(player, matches);`, context);
  return JSON.parse(JSON.stringify(context.result));
}

function evaluateFavoriteCheck(matches) {
  const source = app.match(
    /const FAVORITE_CHECK_MIN_PROBABILITY = 55;[\s\S]*?(?=\nfunction renderFavoriteCheck)/
  );
  assert.ok(source, 'favorite-check helper should be present');
  const context = { matches, result: null };
  vm.createContext(context);
  vm.runInContext(`${source[0]}\nresult = getFavoriteCheckStats(matches);`, context);
  return JSON.parse(JSON.stringify(context.result));
}

function evaluateAllTimeLeagueRanking(player, matches) {
  const helperSources = [
    app.match(/function countsForRanking\(match\) \{[\s\S]*?(?=\nfunction isCancelledMatch)/)?.[0],
    app.match(/function getMatchStage\(match\) \{[\s\S]*?(?=\nfunction isCupSeason)/)?.[0],
    app.match(/function getPlayerStats\(player, matches = PADEL_DATA\.matches\) \{[\s\S]*?(?=\nfunction getLatestPlayerElo)/)?.[0],
    app.match(/function getAllTimeLeagueMatches\(\) \{[\s\S]*?(?=\nfunction getAllTimeRankingPlayers)/)?.[0]
  ];
  helperSources.forEach(source => assert.ok(source, 'all-time league ranking helper should be present'));
  const context = { allTimeStatisticsData: { matches }, player, result: null };
  vm.createContext(context);
  vm.runInContext(
    `${helperSources.join('\n')}\nconst leagueMatches = getAllTimeLeagueMatches(); result = { ids: leagueMatches.map(match => match.id), stats: getPlayerStats(player, leagueMatches) };`,
    context
  );
  return JSON.parse(JSON.stringify(context.result));
}

test('statistics page exposes an accessible season and all-time switch', () => {
  assert.match(html, /id="statistics-mode-toggle" aria-label="Statistikzeitraum auswählen"/);
  assert.match(html, /aria-pressed="true" data-statistics-mode="season">Saison<\/button>/);
  assert.match(html, /aria-pressed="false" data-statistics-mode="all-time">All-Time<\/button>/);
  assert.equal((html.match(/data-season-only-statistic/g) || []).length, 2);
  assert.match(html, /id="statistics-load-error" role="status" hidden/);
  assert.match(style, /\[data-season-only-statistic\]\[hidden\]\s*\{ display: none; \}/);
});

test('all-time data is loaded lazily, cached, and keeps a separate player filter', () => {
  assert.match(app, /client\.rpc\('get_public_all_time_statistics'\)/);
  assert.match(app, /if \(allTimeStatisticsData\) return allTimeStatisticsData;/);
  assert.match(app, /statisticsPlayerFilters\.set\('all-time', new Set\(data\.players\.map/);
  assert.match(app, /statisticsPlayerFilters\.set\('season', new Set\(PADEL_DATA\.players\.map/);
  assert.match(app, /statisticsLoadError = 'Die All-Time-Statistik konnte nicht geladen werden\./);
  assert.match(app, /element\.hidden = isAllTimeStatistics\(\)/);
});

test('all-time view ends with the points ranking and only counts regular league matches', () => {
  const rankingMarkup = html.match(/<div class="all-time-ranking"[\s\S]*?<\/div>\s*<\/section>/)?.[0] || '';
  assert.match(html, /data-all-time-statistic hidden[\s\S]*id="all-time-ranking-table" data-ranking-sort="points"/);
  assert.match(html, /class="all-time-ranking-profile-layout" id="all-time-ranking-profile-layout" data-all-time-statistic hidden/);
  assert.match(html, /class="all-time-ranking-profile-main" id="all-time-ranking-profile-main"/);
  assert.match(html, /id="all-time-ranking-profile-host" aria-label="Geöffnetes Spielerprofil"/);
  assert.match(html, /id="all-time-ranking-body"/);
  assert.match(html, /id="all-time-ranking-view-toggle" aria-label="Ranglistenansicht"/);
  assert.doesNotMatch(
    rankingMarkup,
    /id="ranking-sort-toggle"|id="all-time-ranking-sort-toggle"/
  );
  assert.match(rankingMarkup, /class="col-points" aria-sort="descending">[\s\S]*?data-all-time-ranking-sort="points"/);
  assert.match(rankingMarkup, /data-all-time-ranking-sort="average"[\s\S]*?Ø-Pkt\./);
  assert.match(rankingMarkup, /class="col-points"[\s\S]*?<\/th>\s*<th class="col-average-points">/);
  assert.doesNotMatch(rankingMarkup, /col-elo|col-form|col-winrate|col-draw-factor|Letzte 3|Sieg-%|Losfaktor/);
  const renderer = app.match(/function renderAllTimeRanking\(\)[\s\S]*?(?=\nfunction getRankedPlayers)/)?.[0] || '';
  assert.doesNotMatch(renderer, /col-elo|col-form|col-winrate|col-draw-factor|getPlayerRankingExtras/);
  assert.match(renderer, /animateRankingRows\(body, '\.ranking-row', previousPositions\)/);
  assert.match(renderer, /data-profile-player-id="\$\{escapeHtml\(player\.id \|\| ''\)\}" data-player-profile-id="\$\{escapeHtml\(player\.id \|\| ''\)\}" tabindex="0" role="link"/);
  assert.match(renderer, /updatePlayerProfileRankingHighlights\(\)/);
  assert.match(style, /@media \(min-width: 769px\) \{\s*#all-time-ranking-view-toggle \{ display: none; \}\s*#all-time-ranking-table\.compact \.col-gv \{ display: table-cell; \}/);
  assert.match(app, /function getAllTimeLeagueMatches\(\)[\s\S]*countsForRanking\(match\)[\s\S]*getMatchStage\(match\) === 'league'/);
  assert.match(app, /right\.stats\.punkte - left\.stats\.punkte[\s\S]*right\.stats\.spielDiff - left\.stats\.spielDiff[\s\S]*right\.stats\.gewonneneSpiele - left\.stats\.gewonneneSpiele/);
  assert.match(migration, /ranking_players as \([\s\S]*season\.tournament_mode in \('none', 'direct_final_four', 'top8_semifinals'\)/);
  assert.match(migration, /'rankingPlayers'/);
});

test('all-time ranking excludes Final Four, Cup and open matches from every value', () => {
  const team1 = { spieler: ['Spieler A', 'Partner'] };
  const team2 = { spieler: ['Gegner 1', 'Gegner 2'] };
  const result = evaluateAllTimeLeagueRanking({ name: 'Spieler A' }, [
    { id: 'league', stage: 'league', countsForRanking: true, sieger: 1, saetze: '2:0', ergebnis: '6:2, 6:3', team1, team2 },
    { id: 'final-four', stage: 'final-four', countsForRanking: true, sieger: 1, saetze: '1:0', ergebnis: '6:0', team1, team2 },
    { id: 'cup', stage: 'quarterfinal', countsForRanking: false, sieger: 1, saetze: '2:0', ergebnis: '6:0, 6:0', team1, team2 },
    { id: 'open', stage: 'league', countsForRanking: true, sieger: null, saetze: null, ergebnis: null, team1, team2 }
  ]);

  assert.deepEqual(result.ids, ['league']);
  assert.deepEqual(result.stats, {
    partien: 1,
    siege: 1,
    punkte: 3,
    spielDiff: 7,
    gewonneneSpiele: 12,
    saetzeDiff: 2,
    spieleGV: '12:5'
  });
});

test('all-time ranking scopes weight Final Four and training sets as half matches', () => {
  const source = app.match(
    /function countsForRanking\(match\) \{[\s\S]*?(?=\nfunction isCancelledMatch)/
  )?.[0];
  const stageSource = app.match(/function getMatchStage\(match\) \{[\s\S]*?(?=\nfunction isCupSeason)/)?.[0];
  const scopeSource = app.match(
    /const ALL_TIME_RANKING_SCOPES = [\s\S]*?(?=\nfunction formatAllTimeRankingValue)/
  )?.[0];
  [source, stageSource, scopeSource].forEach(item => assert.ok(item, 'all-time scope helpers should be present'));
  const team1 = { playerIds: ['a', 'b'] };
  const team2 = { playerIds: ['c', 'd'] };
  const context = {
    allTimeStatisticsData: {
      rankingPlayers: [{ id: 'a' }, { id: 'e' }],
      players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      trainingPlayers: [{ id: 'a' }, { id: 'f' }],
      matches: [
        { id: 'league', stage: 'league', countsForRanking: true, countsForElo: true, sieger: 1, saetze: '2:1', ergebnis: '6:2, 3:6 - 10:8', team1, team2 },
        { id: 'final-four', stage: 'final-four', countsForRanking: false, countsForElo: true, sieger: 1, saetze: '1:0', ergebnis: '6:4', team1, team2 },
        { id: 'cup', stage: 'quarterfinal', countsForRanking: false, countsForElo: true, sieger: 2, saetze: '0:2', ergebnis: '2:6, 3:6', team1, team2 },
        { id: 'unrated', stage: 'league', countsForRanking: false, countsForElo: false, sieger: 1, saetze: '2:0', ergebnis: '6:0, 6:0', team1, team2 }
      ],
      trainingRounds: [{
        team1: { playerIds: ['a'] },
        team2: { playerIds: ['f'] },
        matchWeight: 0.5,
        team1Wins: 0.5,
        team2Wins: 0,
        team1Points: 1.5,
        team2Points: 0,
        team1Games: 6,
        team2Games: 3
      }]
    },
    result: null
  };
  vm.createContext(context);
  vm.runInContext(`${source}\n${stageSource}\n${scopeSource}
    const summarize = scope => Object.fromEntries(getAllTimeScopedRankingPlayers(scope).map(player => [player.id, player.stats]));
    result = { official: summarize('official'), training: summarize('training') };`, context);
  const result = JSON.parse(JSON.stringify(context.result));

  assert.deepEqual(result.official.a, {
    partien: 2.5,
    siege: 1.5,
    punkte: 3.5,
    spielDiff: -4,
    gewonneneSpiele: 20,
    spieleGV: '20:24'
  });
  assert.equal(result.official.e.partien, 0);
  assert.equal(result.official.f, undefined);
  assert.deepEqual(result.training.a, {
    partien: 3,
    siege: 2,
    punkte: 5,
    spielDiff: -1,
    gewonneneSpiele: 26,
    spieleGV: '26:27'
  });
  assert.equal(result.training.f.partien, 0.5);
  assert.match(html, /class="active" data-all-time-ranking-scope="league"[^>]*>Ligaphase<\/button>/);
});

test('all-time average-points sort ranks by unrounded points per match and puts players without matches last', () => {
  const source = app.match(
    /function getAllTimeAveragePoints\(stats\) \{[\s\S]*?(?=\nfunction renderAllTimePointsRankReference)/
  )?.[0];
  assert.ok(source, 'average-points helpers should be present');
  const context = {
    players: [
      { id: 'many', stats: { partien: 16.5, punkte: 38.5, spielDiff: 63, gewonneneSpiele: 176 } },
      { id: 'none', stats: { partien: 0, punkte: 0, spielDiff: 0, gewonneneSpiele: 0 } },
      { id: 'single', stats: { partien: 1, punkte: 3, spielDiff: 7, gewonneneSpiele: 12 } },
      { id: 'few', stats: { partien: 7, punkte: 16, spielDiff: 38, gewonneneSpiele: 73 } }
    ],
    result: null
  };
  vm.createContext(context);
  vm.runInContext(`${source}
    result = {
      average: [...players].sort(compareAllTimeRankingByAveragePoints).map(player => player.id),
      points: [...players].sort(compareAllTimeRankingByPoints).map(player => player.id),
      labels: players.map(player => formatAllTimeAveragePoints(player.stats))
    };`, context);
  const result = JSON.parse(JSON.stringify(context.result));

  assert.deepEqual(result.average, ['single', 'many', 'few', 'none']);
  assert.deepEqual(result.points, ['many', 'few', 'single', 'none']);
  assert.deepEqual(result.labels, ['2,3', '—', '3,0', '2,3']);
});

test('all-time set dominance compares players per regular set', () => {
  const player = { name: 'Spieler A' };
  const matches = [
    {
      sieger: 1,
      ergebnis: '6:2, 4:6 - 10:8',
      format: 'best-of-three',
      team1: { spieler: ['Spieler A', 'Partner'] },
      team2: { spieler: ['Gegner 1', 'Gegner 2'] }
    },
    {
      sieger: 2,
      ergebnis: '1:6',
      format: 'single-set',
      team1: { spieler: ['Gegner 1', 'Partner'] },
      team2: { spieler: ['Spieler A', 'Gegner 2'] }
    }
  ];

  assert.deepEqual(evaluateSetDominance(player, matches), { spielDiff: 7, setCount: 3 });
  assert.match(app, /stats\.spielDiff \/ stats\.setCount/);
  assert.match(app, /Spiele pro \$\{isAllTimeStatistics\(\) \? 'Satz' : 'Partie'\}/);
});

test('average set score counts each set from the set winner perspective', () => {
  const source = app.match(
    /function parseRegularSetScore\(rawSet\) \{[\s\S]*?\nfunction getNormalizedWinnerSetAverages\(\) \{[\s\S]*?\n\}\n/
  );
  assert.ok(source, 'set-average helpers should be present');
  const context = {
    matches: [
      { sieger: 1, ergebnis: '6:2, 3:6 - 10:7', format: 'best-of-three' },
      { sieger: 2, ergebnis: '4:6, 6:4 - 8:10', format: 'best-of-three' }
    ],
    result: null,
    isSingleSetMatch: match => match.format === 'single-set',
    getStatisticsMatches: () => context.matches,
    getMatchGameStats: () => ({ diff: 0 }),
    average: values => values.reduce((sum, value) => sum + value, 0) / values.length
  };
  vm.createContext(context);
  vm.runInContext(`${source[0]}\nresult = getNormalizedWinnerSetAverages();`, context);

  const [firstSet, secondSet] = context.result.sets;
  assert.equal(firstSet.normalizedLoser, 3);
  assert.equal(secondSet.normalizedLoser, 3.5);
});

test('favorite check only counts teams with at least 55 percent win probability', () => {
  const stats = evaluateFavoriteCheck([
    { match: { sieger: 1 }, probability: { team1: 54, team2: 46 } },
    { match: { sieger: 1 }, probability: { team1: 55, team2: 45 } },
    { match: { sieger: 2 }, probability: { team1: 56, team2: 44 } },
    { match: { sieger: 2 }, probability: { team1: 45, team2: 55 } }
  ]);

  assert.deepEqual(stats, { matches: 3, wins: 2, rate: 67 });
  assert.match(html, /class="widget favorite-check-widget"/);
  assert.match(html, /class="widget-label">[\s\S]*class="sh-title-with-help">Favoriten-Check[\s\S]*data-help-tooltip-anchor>\?<\/span>[\s\S]*Als Favorit zählt ein Team ab 55 % Siegchance\./);
  assert.doesNotMatch(app, /favorite-check-note|Als Favorit zählt ein Team ab/);
  assert.doesNotMatch(style, /\.favorite-check-note/);
  assert.match(style, /@media \(max-width: 768px\)[\s\S]*?\.sh-title-with-help \.help-tooltip \{[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\);/);
});

test('public all-time RPC returns only completed official competition data', () => {
  assert.match(migration, /create function public\.get_public_all_time_statistics\(\)/);
  assert.match(migration, /season\.counts_for_profile/);
  assert.match(migration, /match\.actual_sets is not null[\s\S]*match\.winner is not null/);
  assert.match(migration, /match\.match_type in \('season', 'final'\)/);
  assert.match(migration, /where exists \([\s\S]*completed_matches[\s\S]*member\.player_id = player\.id/);
  assert.match(migration, /'eventType', 'initial'/);
  assert.match(migration, /'eventType', 'match'/);
  assert.match(migration, /join completed_matches as match on match\.id = change\.match_id/);
  assert.match(migration, /'seasonLabel', match\.season_label/);
  assert.match(migration, /grant execute on function public\.get_public_all_time_statistics\(\) to anon, authenticated/);
});

test('all-time Elo chart stays continuous and identifies each competition', () => {
  assert.match(app, /const data = getStatisticsData\(\);[\s\S]*const chartEvents = getChartEvents\(data\)/);
  assert.match(app, /spanGaps: true/);
  assert.match(app, /isAllTimeStatistics\(\) && event\.match\?\.seasonLabel/);
  assert.match(app, /isAllTimeStatistics\(\) \? \{ year: '2-digit' \} : \{\}/);
  assert.match(app, /chart\.\$players = players/);
});

test('draw factor ranks season players by smoothed all-time average points', () => {
  const sources = [
    app.match(/function countsForRanking\(match\) \{[\s\S]*?(?=\nfunction isCancelledMatch)/)?.[0],
    app.match(/function getMatchStage\(match\) \{[\s\S]*?(?=\nfunction isCupSeason)/)?.[0],
    app.match(/const ALL_TIME_RANKING_SCOPES = [\s\S]*?(?=\nfunction formatAllTimeRankingValue)/)?.[0],
    app.match(/function compareAllTimeRankingByPoints\(left, right\) \{[\s\S]*?(?=\nfunction compareAllTimeRankingByAveragePoints)/)?.[0],
    app.match(/const DRAW_FACTOR_PRIOR_MATCHES = [\s\S]*?(?=\nfunction getPlayerDrawFactor)/)?.[0]
  ];
  sources.forEach(source => assert.ok(source, 'draw-factor reference helpers should be present'));
  const win = (id, winners, losers, matchAt) => ({
    id, stage: 'league', countsForRanking: true, countsForElo: true, sieger: 1, saetze: '2:0', ergebnis: '6:2, 6:2',
    matchAt, team1: { playerIds: winners }, team2: { playerIds: losers }
  });
  const matches = [
    win('m1', ['a', 'x'], ['b', 'y'], '2026-05-01T18:00:00Z'),
    ...[2, 3, 4, 5, 6].map(day => win(`m${day}`, ['b', 'x'], ['y', 'z'], `2026-05-0${day}T18:00:00Z`)),
    win('after-completion', ['e', 'x'], ['y', 'z'], '2026-10-01T18:00:00Z')
  ];
  const players = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, name: id.toUpperCase() }));
  const context = { allTimeStatisticsData: { matches }, data: { players, completedAt: '2026-09-01T00:00:00Z' }, result: null };
  vm.createContext(context);
  vm.runInContext(`${sources.join('\n')}\nresult = [...getDrawFactorReferenceRankMap(data)];`, context);

  // A: 3 Punkte aus 1 Partie, B: 15 aus 6. Ohne Dämpfung läge A vorn.
  // E hat nur nach Saisonabschluss gespielt und zählt wie C und D als Neuling.
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), [['B', 1], ['A', 2], ['C', 4], ['D', 4], ['E', 4]]);
});

test('draw factor compares the whole own team including the player with the opponent team', () => {
  const sources = [
    app.match(/function average\(values\) \{[\s\S]*?(?=\nfunction formatDecimal)/)?.[0],
    app.match(/function getPlayerDrawFactor\(player, rankMap[\s\S]*?(?=\nfunction formatDrawFactor)/)?.[0]
  ];
  sources.forEach(source => assert.ok(source, 'draw-factor helpers should be present'));
  const match = { team1: { spieler: ['Stark', 'Schwach'] }, team2: { spieler: ['Mitte 1', 'Mitte 2'] } };
  const context = {
    PADEL_DATA: { matches: [match] },
    countsForRanking: () => true,
    getPlayerMatches: () => [match],
    getPlayerMatchTeamIndex: () => 1,
    rankMap: new Map([['Stark', 1], ['Schwach', 20], ['Mitte 1', 10], ['Mitte 2', 11]]),
    result: null
  };
  vm.createContext(context);
  vm.runInContext(`${sources.join('\n')}\nresult = getPlayerDrawFactor({ name: 'Stark' }, rankMap);`, context);

  // Ein ausgeglichenes Los darf für den stärksten Spieler kein Pech ergeben.
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), { teamAverage: 10.5, opponentAverage: 10.5, diff: 0 });
});
