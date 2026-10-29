const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tippIndex = fs.readFileSync(path.join(root, 'tipp', 'index.html'), 'utf8');
const statistics = fs.readFileSync(path.join(root, 'js', 'match-statistics.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const tippPage = fs.readFileSync(path.join(root, 'js', 'tipp-page.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const statisticsStyle = fs.readFileSync(path.join(root, 'match-statistics.css'), 'utf8');

test('league matches use the approved 420/24/600 split and a dedicated detail host', () => {
  assert.match(index, /class="match-statistics-split-layout" id="match-statistics-split-layout"/);
  assert.match(index, /id="match-statistics-panel-host"/);
  assert.match(style, /body\.match-statistics-panel-open \.match-statistics-split-layout \{[\s\S]*?grid-template-columns: 420px minmax\(600px, 1fr\);[\s\S]*?gap: 24px;/);
  assert.match(statistics, /const PANEL_BREAKPOINT = 1100;/);
  assert.match(statistics, /const PANEL_LIST_WIDTH = 420;/);
  assert.match(statistics, /const PANEL_MIN_WIDTH = 600;/);
});

test('statistics header switches presentation and hides paging in panel mode', () => {
  assert.match(index, /data-match-statistics-presentation-toggle/);
  assert.match(index, /class="detail-view-close"[^>]*data-detail-view-back/);
  assert.doesNotMatch(index, /detail-view-swipe-hint/);
  assert.match(statistics, /function togglePresentation\(\)/);
  assert.match(statistics, /presentationPreference = target;/);
  assert.match(statistics, /pager\.hidden = presentation === 'panel'/);
  assert.match(style, /detail-view-dialog\[data-presentation="panel"\] \.detail-view-pager \{ display: none; \}/);
  assert.match(style, /@media \(max-width: 768px\)[\s\S]*?\.detail-view-pager \{ display: none !important; \}/);
  assert.match(style, /detail-view-dialog\[data-presentation="panel"\] \.detail-view-presentation-icon-modal \{ display: block; \}/);
  assert.match(style, /\.detail-view-close \{[\s\S]*?width: 32px;[\s\S]*?border: 1px solid var\(--border\);[\s\S]*?background: rgba\(7,8,12,0\.86\);/);
  assert.match(style, /\.detail-view-close svg \{[\s\S]*?stroke-width: 3\.2;/);
});

test('modal is the default while a stored panel choice returns after temporary width loss', () => {
  assert.match(statistics, /function shouldUsePanel\(\) \{\s*return presentationPreference === 'panel' && canUsePanel\(\);/);
  assert.match(statistics, /function reconcilePresentation\(\)[\s\S]*?shouldUsePanel\(\) \? 'panel' : 'modal'/);
  assert.match(statistics, /window\.addEventListener\('resize',[\s\S]*?requestAnimationFrame\(reconcilePresentation\)/);
});

test('match presentation preference is stored for 30 days and then expires', () => {
  const constants = statistics.match(
    /const MATCH_STATISTICS_PRESENTATION_STORAGE_KEY[\s\S]*?const MATCH_STATISTICS_PRESENTATION_STORAGE_TTL = 30 \* 24 \* 60 \* 60 \* 1000;/
  )?.[0] || '';
  const helpers = statistics.match(
    /function getStoredMatchStatisticsPresentation[\s\S]*?(?=\n  function shouldUsePanel)/
  )?.[0] || '';
  const values = new Map();
  let now = 1_800_000_000_000;
  const context = {
    Date: { now: () => now },
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    }
  };
  vm.createContext(context);
  vm.runInContext(`${constants}\n${helpers}`, context);

  assert.equal(vm.runInContext('getStoredMatchStatisticsPresentation()', context), null);
  vm.runInContext("storeMatchStatisticsPresentation('panel')", context);
  assert.equal(vm.runInContext('getStoredMatchStatisticsPresentation()', context), 'panel');
  assert.equal(
    JSON.parse(values.get('padel-liga-match-statistics-presentation')).expiresAt,
    now + 30 * 24 * 60 * 60 * 1000
  );

  now += 30 * 24 * 60 * 60 * 1000 + 1;
  assert.equal(vm.runInContext('getStoredMatchStatisticsPresentation()', context), null);
  assert.equal(values.has('padel-liga-match-statistics-presentation'), false);
});

test('PadelTipp moves the existing detail frame into its split host', () => {
  assert.match(tippIndex, /id="prediction-statistics-panel-host"/);
  assert.match(tippPage, /function applyLigaDetailFramePresentation\(nextPresentation\)/);
  assert.match(tippPage, /presentation === 'panel' \? host : document\.body/);
  assert.match(tippPage, /type: 'padel:detail-panel-availability'/);
  assert.match(tippPage, /sequence: detail\.matchId \? getPredictionMatchSequence\(\) : undefined/);
  assert.match(app, /event\.data\?\.type === 'padel:detail-panel-availability'/);
  assert.match(app, /event\.data\?\.type === 'padel:detail-sequence'/);
});

test('the entry sequence stays stable while filters rerender the list', () => {
  const renderMatches = app.match(/function renderPartien\([^]*?(?=\nfunction getOpenMatches)/)?.[0] || '';
  const predictionObserver = tippPage.match(/new MutationObserver\(\(\) => \{[^]*?\}\)\.observe\(predictionMatches/)?.[0] || '';
  assert.doesNotMatch(renderMatches, /setSequence/);
  assert.doesNotMatch(predictionObserver, /detail-sequence/);
});

test('panel content uses compact match, prediction and statistics layouts', () => {
  assert.match(style, /body\.match-statistics-panel-open #match-sort-toggle,[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?grid-row: 2;[\s\S]*?justify-self: center;/);
  assert.match(style, /body\.match-statistics-panel-open #match-scope-toggle \{[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 1;[\s\S]*?justify-self: end;/);
  assert.match(style, /detail-view-dialog\[data-presentation="panel"\] \.detail-view-heading \{[\s\S]*?display: flex;[\s\S]*?align-items: baseline;/);
  assert.match(style, /detail-view-dialog\[data-presentation="panel"\] \.detail-view-header \{[\s\S]*?min-height: 64px;/);
  assert.match(style, /detail-view-dialog\[data-presentation="panel"\] \.detail-view-played-order:not\(\[hidden\]\) \{[\s\S]*?display: inline-flex;/);
  assert.match(style, /body\.match-statistics-panel-open #partien \.mc \{[\s\S]*?grid-template-areas:[\s\S]*?"team1 score team2"/);
  assert.match(style, /body\.match-statistics-panel-open \.prediction-statistics-list-pane \.prediction-match-card:not\(\.is-single-set\)/);
  assert.match(statisticsStyle, /#detail-view-dialog\[data-presentation="panel"\] \.match-statistics-ranking-layout \{\s*grid-template-columns: 1fr;/);
  assert.match(statisticsStyle, /#detail-view-dialog\[data-presentation="panel"\] \.match-statistics-graph-picker \{[\s\S]*?display: grid;/);
});
