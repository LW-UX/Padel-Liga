const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

const legacyLayoutClass = /class="[^"]*\b(?:l|rn|sticky-rank|sticky-name|extended-col|mobile-compact-hidden|num-val|punkte-val|elo-val|form-val|draw-factor-val)\b/;

function getFunctionSource(name, nextName) {
  const match = app.match(new RegExp(`function ${name}\\([^]*?(?=\\nfunction ${nextName}\\()`));
  assert.ok(match, `${name} source not found`);
  return match[0];
}

function getColumnClasses(source, cellName) {
  return [...source.matchAll(new RegExp(`<${cellName} class="([^"]+)"`, 'g'))]
    .map(match => match[1].split(/\s+/).find(className => className.startsWith('col-')))
    .filter(Boolean);
}

test('league-page ranking tables use one named class per column without colgroups', () => {
  const targetTables = [...page.matchAll(/<table class="rt(?: ranking-table compact| company-ranking-table| rt--fit| rt--dense(?: rt--fit)?)"[^]*?<\/table>/g)]
    .map(match => match[0]);

  assert.equal(targetTables.length, 6);
  targetTables.forEach(tableSource => {
    assert.doesNotMatch(tableSource, /<colgroup>/);
    assert.doesNotMatch(tableSource, legacyLayoutClass);
  });

  assert.deepEqual(getColumnClasses(targetTables[0], 'th'), ['col-rank', 'col-name', 'col-games', 'col-wins', 'col-points', 'col-gv', 'col-diff', 'col-elo', 'col-form', 'col-winrate', 'col-draw-factor']);
  assert.deepEqual(getColumnClasses(targetTables[1], 'th'), ['col-rank', 'col-company', 'col-participants', 'col-games', 'col-points-per-player', 'col-wins', 'col-points', 'col-diff']);
  assert.deepEqual(getColumnClasses(targetTables[2], 'th'), ['col-rank', 'col-name', 'col-wins', 'col-gv', 'col-diff', 'col-elo']);
  assert.deepEqual(getColumnClasses(targetTables[3], 'th'), ['col-rank', 'col-name', 'col-games', 'col-wins', 'col-points', 'col-average-points', 'col-gv', 'col-diff']);
  assert.deepEqual(getColumnClasses(targetTables[4], 'th'), ['col-rank', 'col-name', 'col-games', 'col-points', 'col-diff']);
  assert.deepEqual(getColumnClasses(targetTables[5], 'th'), ['col-rank', 'col-name', 'col-wins', 'col-gv', 'col-diff']);
});

test('ranking renderers use the same named column classes as their headers', () => {
  const renderers = [
    getFunctionSource('renderFirmenRanking', 'getFinalFourMatches'),
    getFunctionSource('renderFinalFourRanking', 'getRankingPositionMap'),
    getFunctionSource('renderRanking', 'getAllTimeLeagueMatches'),
    getFunctionSource('renderAllTimeRanking', 'getRankedPlayers'),
    getFunctionSource('renderCalculatorRanking', 'renderCalculatorMiniRanking'),
    getFunctionSource('renderFinalFourCalculatorRanking', 'getOrCreateFormTooltip')
  ];

  renderers.forEach(renderer => assert.doesNotMatch(renderer, legacyLayoutClass));

  assert.deepEqual(getColumnClasses(renderers[0], 'td'), ['col-rank', 'col-company', 'col-participants', 'col-games', 'col-points-per-player', 'col-wins', 'col-points', 'col-diff']);
  assert.deepEqual(getColumnClasses(renderers[1], 'td'), ['col-rank', 'col-name', 'col-wins', 'col-gv', 'col-diff', 'col-elo']);
  assert.deepEqual(getColumnClasses(renderers[2], 'td'), ['col-rank', 'col-name', 'col-games', 'col-wins', 'col-points', 'col-gv', 'col-diff', 'col-elo', 'col-form', 'col-winrate', 'col-draw-factor']);
  assert.deepEqual(getColumnClasses(renderers[3], 'td'), ['col-rank', 'col-name', 'col-games', 'col-wins', 'col-points', 'col-average-points', 'col-gv', 'col-diff']);
  assert.deepEqual(getColumnClasses(renderers[4], 'td'), ['col-rank', 'col-name', 'col-games', 'col-points', 'col-diff']);
  assert.deepEqual(getColumnClasses(renderers[5], 'td'), ['col-rank', 'col-name', 'col-wins', 'col-gv', 'col-diff']);
  renderers.forEach(renderer => assert.match(renderer, /<td class="col-rank rank-position">/));
  assert.match(renderers[0], /<td class="col-points-per-player rank-score">/);
  assert.doesNotMatch(renderers[0], /firma-badge/);
  assert.match(renderers[1], /<td class="col-wins rank-score">/);
  assert.match(renderers[2], /<td class="col-points rank-score">/);
  assert.match(renderers[3], /<td class="col-points rank-score">/);
  assert.match(renderers[3], /<td class="col-average-points">/);
  assert.doesNotMatch(renderers[3], /pointsScoreClass|averageScoreClass/);
  assert.match(renderers[4], /<td class="col-points rank-score">/);
  assert.match(renderers[5], /<td class="col-wins rank-score">/);
});

test('ranking layout behavior is expressed through named column selectors', () => {
  assert.match(style, /\.ranking-table\.compact \.col-gv,[^]*\.ranking-table\.compact \.col-draw-factor \{ display: none; \}/);
  assert.match(style, /\.ranking-table\.compact \.col-wins,[^]*\.ranking-table\.compact \.col-elo \{\s*display: none;/);
  assert.match(style, /\.ranking-table\.expanded \.col-rank,[^]*\.ranking-table\.expanded \.col-name \{[^]*position: sticky;/);
  assert.match(style, /\.r1 \.rank-position \{ color: var\(--gold\);/);
  assert.match(style, /\.r2 \.rank-position \{ color: var\(--silver\);/);
  assert.match(style, /\.r3 \.rank-position \{ color: var\(--bronze\);/);
  assert.match(style, /\.rank-score \{[^}]*color: var\(--accent2\);/);
  assert.match(style, /\.ranking-table\.compact \{[^}]*table-layout: fixed;/);
  assert.match(style, /\.ranking-table\.compact th:not\(\.col-rank\):not\(\.col-name\) \{[^}]*padding-left: 4px;/);
  assert.match(style, /table\.ranking-table th \{\s*font-size: var\(--text-xs\);\s*letter-spacing: 0\.06em;/);
  assert.match(style, /\.ranking-table\.expanded \.col-rank,[^]*\.ranking-table\.expanded \.col-name \{[^}]*position: sticky;/);
  assert.doesNotMatch(style, /\.ranking-table \.col-rank \{[^}]*padding-left: 18px/);
  assert.doesNotMatch(`${app}\n${style}`, /mini-rank-pos|calculator-mini-rank-pos/);
  assert.doesNotMatch(`${app}\n${style}`, /mini-rank-points|punkte-val/);
  assert.doesNotMatch(style, /\.(?:sticky-rank|sticky-name|extended-col|mobile-compact-hidden|ranking-help-header)\b/);
  assert.match(style, /\.ranking-wrap--fit \{ overflow-x: hidden; \}/);
  assert.match(style, /table\.rt\.rt--fit \{[^}]*min-width: 0;[^}]*table-layout: fixed;/);
});

test('ranking sort changes reuse the calculator row movement animation', () => {
  const renderer = getFunctionSource('renderRanking', 'getAllTimeLeagueMatches');

  assert.match(renderer, /getRankingRowPositions\(body, '\.ranking-row'\)/);
  assert.match(renderer, /class="ranking-row [^\"]*" data-ranking-entry="\$\{escapeHtml\(p\.id \|\| p\.name\)\}"\$\{renderPlayerProfileRowAttributes\(p\)\}>/);
  assert.match(renderer, /animateRankingRows\(body, '\.ranking-row', previousPositions\)/);
  assert.match(fs.readFileSync(path.join(root, 'js', 'table-core.js'), 'utf8'), /function animateRankingRows\([^]*prefers-reduced-motion: reduce[^]*translateY\(\$\{deltaY\}px\)[^]*520ms cubic-bezier/);
  assert.match(style, /\.ranking-row \{ transform-origin: center; \}/);
  assert.doesNotMatch(style, /\.ranking-row \{[^}]*will-change: transform/);
  assert.doesNotMatch(app, /getCalculatorRowPositions|animateCalculatorRows|data-calculator-player/);
});

test('the three main rankings sort once through their column headers', () => {
  const allTimeMarkup = page.match(/<div class="all-time-ranking"[\s\S]*?<tbody id="all-time-ranking-body"><\/tbody>/)?.[0] || '';
  const leagueMarkup = page.match(/<table class="rt ranking-table compact" id="ranking-table">[\s\S]*?<tbody id="rl-body"><\/tbody>/)?.[0] || '';

  assert.doesNotMatch(page, /id="ranking-sort-toggle"|id="all-time-ranking-sort-toggle"/);
  ['games', 'wins', 'points', 'diff', 'elo', 'form', 'winrate', 'draw-factor'].forEach(mode => {
    assert.match(leagueMarkup, new RegExp(`data-ranking-sort="${mode}"`));
  });
  ['games', 'wins', 'points', 'average', 'diff'].forEach(mode => {
    assert.match(allTimeMarkup, new RegExp(`data-all-time-ranking-sort="${mode}"`));
  });
  const fixedHeaders = [...leagueMarkup.matchAll(/<th class="col-(?:rank|name|gv)"[^>]*>[\s\S]*?<\/th>/g)];
  assert.equal(fixedHeaders.length, 3);
  fixedHeaders.forEach(match => assert.doesNotMatch(match[0], /data-ranking-sort/));
  assert.match(page, /class="col-points" aria-sort="descending"/);
  assert.match(style, /th\[aria-sort\] \.sort-chevron \{ display: inline-block; \}/);
  assert.match(app, /event\.target\.closest\('button\[data-ranking-sort\]'\)/);
  assert.match(app, /event\.target\.closest\('button\[data-ranking-view\]'\)/);
  assert.match(app, /if \(nextMode === rankingSortMode\) return;/);
  assert.match(app, /if \(nextMode === allTimeRankingSortMode\) return;/);
});

test('league and final-four notes show the maximum games before sorting', () => {
  const ranking = getFunctionSource('renderRanking', 'getRankedPlayers');
  const finalFour = getFunctionSource('renderFinalFourRanking', 'getRankingPositionMap');

  assert.match(app, /function getMaximumLeagueMatches\(\)/);
  assert.match(ranking, /`Spiele: \$\{maximumLeagueMatches\}`/);
  assert.match(ranking, /Top \$\{getCompetitionConfig\(\)\.qualificationPlaces\}: Qualifikationsplätze`[^]*gamesNote[^]*'Sortierung:/);
  assert.match(finalFour, /`Spiele: \$\{matches\.length\}  \|  Sortierung: Siege/);
  assert.match(finalFour, /eloPlayer\?\.id === 'ludwig_w'/);
  assert.match(finalFour, /renderPlayerProfileRowAttributes\(\{ id: profilePlayerId, name: player\.name \}\)/);
  assert.match(finalFour, /ranking-absence-mark[^]*nachgerückt für Marco M\./);
  assert.match(finalFour, /replacementNote\.textContent = '\*Ludwig W\. ist für Marco M\. nachgerückt\.'/);
  assert.match(page, /id="ff-ranking-note">Spiele: 3  \|  Sortierung: Siege/);
});

test('the regular season ranking shows previous league achievements after company labels', () => {
  const ranking = getFunctionSource('renderRanking', 'getAllTimeLeagueMatches');

  assert.match(app, /function getPreviousCompletedLeagueSeason\(seasonReference = selectedSeason\)/);
  assert.match(app, /\.sort\(\(left, right\) =>[\s\S]*right\.startDate[\s\S]*\)\[0\] \|\| null;/);
  assert.match(app, /\.from\('player_achievements'\)[^]*\.in\('kind', \['winner', 'final_four'\]\)/);
  assert.match(app, /achievement\.kind === 'winner'[^]*achievements\.set\(achievement\.player_id/);
  assert.match(app, /function renderLeagueRankingAchievementIcon\(player\)/);
  assert.match(app, /ranking-player-achievement-laurel-stems/);
  assert.match(app, /ranking-player-achievement-laurel-leaves/);
  assert.match(ranking, /class="ranking-player-name">\$\{renderPlayerProfileLink\(p, 'pname', rankingPlayerLabel\)\}<\/span>\$\{absenceMark\}\$\{renderRankingCompanyBadge\(p\)\}[^]*?\$\{renderLeagueRankingAchievementIcon\(p\)\}/);
  assert.match(app, /class="mini-rank-name"><span class="ranking-player-name">\$\{renderPlayerProfileLink\(p\)\}\$\{renderLeagueRankingAchievementIcon\(p\)\}/);
  assert.match(style, /\.ranking-player-name \{[^}]*gap: 2px;/);
  assert.match(style, /\.ranking-player-achievement \{ margin-left: 6px; \}/);
  assert.match(style, /\.ranking-player-achievement-laurel-leaves \{[^}]*fill: currentColor;[^}]*stroke: none;/);
});
