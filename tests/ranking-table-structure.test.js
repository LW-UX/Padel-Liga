const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

const legacyLayoutClass = /class="[^"]*\b(?:l|rn|sticky-rank|sticky-name|extended-col|mobile-compact-hidden|num-val|punkte-val|elo-val|form-val|placement-factor-val)\b/;

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
  const targetTables = [...page.matchAll(/<table class="rt(?: ranking-table compact| company-ranking-table| final-four-table| calculator-ranking-table(?: final-four-calculator-ranking-table)?)"[^]*?<\/table>/g)]
    .map(match => match[0]);

  assert.equal(targetTables.length, 5);
  targetTables.forEach(tableSource => {
    assert.doesNotMatch(tableSource, /<colgroup>/);
    assert.doesNotMatch(tableSource, legacyLayoutClass);
  });

  assert.deepEqual(getColumnClasses(targetTables[0], 'th'), ['col-rank', 'col-name', 'col-games', 'col-wins', 'col-points', 'col-gv', 'col-diff', 'col-elo', 'col-form', 'col-winrate', 'col-placement-factor']);
  assert.deepEqual(getColumnClasses(targetTables[1], 'th'), ['col-rank', 'col-company', 'col-participants', 'col-games', 'col-wins', 'col-points', 'col-diff', 'col-points-per-player']);
  assert.deepEqual(getColumnClasses(targetTables[2], 'th'), ['col-rank', 'col-name', 'col-games', 'col-wins', 'col-gv', 'col-diff']);
  assert.deepEqual(getColumnClasses(targetTables[3], 'th'), ['col-rank', 'col-name', 'col-games', 'col-points', 'col-diff']);
  assert.deepEqual(getColumnClasses(targetTables[4], 'th'), ['col-rank', 'col-name', 'col-games', 'col-wins', 'col-diff']);
});

test('ranking renderers use the same named column classes as their headers', () => {
  const renderers = [
    getFunctionSource('renderFirmenRanking', 'getFinalFourMatches'),
    getFunctionSource('renderFinalFourRanking', 'getRankingPositionMap'),
    getFunctionSource('renderRanking', 'getRankedPlayers'),
    getFunctionSource('renderCalculatorRanking', 'renderCalculatorMiniRanking'),
    getFunctionSource('renderFinalFourCalculatorRanking', 'getOrCreateFormTooltip')
  ];

  renderers.forEach(renderer => assert.doesNotMatch(renderer, legacyLayoutClass));

  assert.deepEqual(getColumnClasses(renderers[0], 'td'), ['col-rank', 'col-company', 'col-participants', 'col-games', 'col-wins', 'col-points', 'col-diff', 'col-points-per-player']);
  assert.deepEqual(getColumnClasses(renderers[1], 'td'), ['col-rank', 'col-name', 'col-games', 'col-wins', 'col-gv', 'col-diff']);
  assert.deepEqual(getColumnClasses(renderers[2], 'td'), ['col-rank', 'col-name', 'col-games', 'col-wins', 'col-points', 'col-gv', 'col-diff', 'col-elo', 'col-form', 'col-winrate', 'col-placement-factor']);
  assert.deepEqual(getColumnClasses(renderers[3], 'td'), ['col-rank', 'col-name', 'col-games', 'col-points', 'col-diff']);
  assert.deepEqual(getColumnClasses(renderers[4], 'td'), ['col-rank', 'col-name', 'col-games', 'col-wins', 'col-diff']);
  renderers.forEach(renderer => assert.match(renderer, /<td class="col-rank rank-position">/));
  assert.match(renderers[0], /<td class="col-points-per-player rank-score">/);
  assert.match(renderers[1], /<td class="col-wins rank-score">/);
  assert.match(renderers[2], /<td class="col-points rank-score">/);
  assert.match(renderers[3], /<td class="col-points rank-score">/);
  assert.match(renderers[4], /<td class="col-wins rank-score">/);
});

test('ranking layout behavior is expressed through named column selectors', () => {
  assert.match(style, /\.ranking-table\.compact \.col-gv,[^]*\.ranking-table\.compact \.col-placement-factor \{ display: none; \}/);
  assert.match(style, /\.ranking-table\.compact \.col-wins,[^]*\.ranking-table\.compact \.col-elo \{\s*display: none;/);
  assert.match(style, /\.ranking-table\.expanded \.col-rank,[^]*\.ranking-table\.expanded \.col-name \{[^]*position: sticky;/);
  assert.match(style, /\.r1 \.rank-position \{ color: var\(--gold\);/);
  assert.match(style, /\.r2 \.rank-position \{ color: var\(--silver\);/);
  assert.match(style, /\.r3 \.rank-position \{ color: var\(--bronze\);/);
  assert.match(style, /\.rank-score \{[^}]*color: var\(--accent2\);/);
  assert.match(style, /\.ranking-table\.compact \{[^}]*table-layout: fixed;/);
  assert.match(style, /\.ranking-table\.compact th:not\(\.col-rank\):not\(\.col-name\) \{[^}]*padding-left: 4px;/);
  assert.match(style, /table\.ranking-table th \{\s*font-size: 0\.7rem;\s*letter-spacing: 0\.06em;/);
  assert.match(style, /\.ranking-table\.expanded \.col-rank,[^]*\.ranking-table\.expanded \.col-name \{[^}]*position: sticky;/);
  assert.doesNotMatch(style, /\.ranking-table \.col-rank \{[^}]*padding-left: 18px/);
  assert.doesNotMatch(`${app}\n${style}`, /mini-rank-pos|calculator-mini-rank-pos/);
  assert.doesNotMatch(`${app}\n${style}`, /mini-rank-points|punkte-val/);
  assert.doesNotMatch(style, /\.(?:sticky-rank|sticky-name|extended-col|mobile-compact-hidden|ranking-help-header)\b/);
});

test('ranking sort changes reuse the calculator row movement animation', () => {
  const renderer = getFunctionSource('renderRanking', 'getRankedPlayers');

  assert.match(renderer, /getRankingRowPositions\(body, '\.ranking-row'\)/);
  assert.match(renderer, /class="ranking-row [^\"]*" data-ranking-entry="\$\{escapeHtml\(p\.id \|\| p\.name\)\}"/);
  assert.match(renderer, /animateRankingRows\(body, '\.ranking-row', previousPositions\)/);
  assert.match(app, /function animateRankingRows\([^]*prefers-reduced-motion: reduce[^]*translateY\(\$\{deltaY\}px\)[^]*520ms cubic-bezier/);
  assert.match(style, /\.ranking-row,[^]*\.calculator-ranking-row,[^]*will-change: transform;/);
  assert.doesNotMatch(app, /getCalculatorRowPositions|animateCalculatorRows|data-calculator-player/);
});
