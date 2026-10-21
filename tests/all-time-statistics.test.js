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
  assert.match(html, /id="all-time-ranking-body"/);
  assert.match(html, /id="all-time-ranking-view-toggle" aria-label="Ranglistenansicht"/);
  assert.doesNotMatch(
    rankingMarkup,
    /id="ranking-sort-toggle"|data-ranking-sort="(?:elo|draw-factor)"/
  );
  assert.doesNotMatch(rankingMarkup, /col-form|col-winrate|col-draw-factor|Letzte 3|Sieg-%|Losfaktor/);
  const renderer = app.match(/function renderAllTimeRanking\(\)[\s\S]*?(?=\nfunction getRankedPlayers)/)?.[0] || '';
  assert.doesNotMatch(renderer, /col-form|col-winrate|col-draw-factor|getPlayerRankingExtras/);
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
