const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tippIndex = fs.readFileSync(path.join(root, 'tipp', 'index.html'), 'utf8');
const statistics = fs.readFileSync(path.join(root, 'js', 'match-statistics.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const tippPage = fs.readFileSync(path.join(root, 'js', 'tipp-page.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const statisticsStyle = fs.readFileSync(path.join(root, 'match-statistics.css'), 'utf8');
const panelLayout = require(path.join(root, 'js', 'panel-layout.js'));

test('league matches use the approved capped 420/24/600 split and a dedicated detail host', () => {
  assert.match(index, /class="match-statistics-split-layout" id="match-statistics-split-layout"/);
  assert.match(index, /id="match-statistics-panel-host"/);
  assert.match(style, /body\.match-statistics-panel-open \.match-statistics-split-layout \{[\s\S]*?grid-template-columns: 420px minmax\(600px, 1200px\);[\s\S]*?gap: 24px;/);
  assert.equal(panelLayout.PANEL_BREAKPOINT, 1100);
  assert.deepEqual({ ...panelLayout.layouts.matchList }, { listWidth: 420, panelMinWidth: 600 });
  assert.match(statistics, /panelLayout\.hasPanelSpace\(panelLayout\.layouts\.matchList\)/);
  assert.match(statistics, /panelLayout\.applySplitLeft\(panelLayout\.layouts\.matchList, '--match-statistics-split-left'\)/);
});

test('shared panel layout checks breakpoint, split width and list position', () => {
  const { layouts, hasPanelSpace, getSplitLeft } = panelLayout;
  const viewport = width => ({ innerWidth: width, clientWidth: width });
  assert.equal(hasPanelSpace(layouts.matchList, { viewport: viewport(1099) }), false);
  assert.equal(hasPanelSpace(layouts.matchList, { viewport: viewport(1100) }), true);
  assert.equal(hasPanelSpace(layouts.matchList, { viewport: { innerWidth: 1100, clientWidth: 1075 } }), false);
  assert.equal(hasPanelSpace(layouts.matchList, { viewport: { innerWidth: 1100, clientWidth: 1076 } }), true);
  assert.equal(getSplitLeft(layouts.matchList, viewport(1100)), 16);
  assert.equal(getSplitLeft(layouts.matchList, viewport(1500)), 216);
  assert.equal(getSplitLeft(layouts.matchList, viewport(1070)), 10);
  assert.equal(getSplitLeft(layouts.matchList, viewport(1050)), 0);
});

test('all side panels end at the viewport and grow until they reach the sticky navigation', () => {
  assert.match(index, /js\/panel-layout\.js\?v=2026-10-29-shared-panel-layout"><\/script>\s*<script defer src="js\/match-statistics\.js/);
  assert.match(tippIndex, /js\/panel-layout\.js\?v=2026-10-29-shared-panel-layout"><\/script>\s*<script defer src="\.\.\/js\/tipp-page\.js/);
  assert.match(style, /body\.match-statistics-panel-open \.match-statistics-panel-host \{[\s\S]*?height: var\(--panel-host-height, calc\(100dvh - 94px\)\);/);
  assert.match(style, /body\.player-profile-panel-open \.ranking-profile-host,[\s\S]*?height: var\(--panel-host-height, calc\(100dvh - 94px\)\);/);
  assert.equal(panelLayout.getPanelHostHeight(900, 390), 494);
  assert.equal(panelLayout.getPanelHostHeight(900, 178), 706);
  assert.equal(panelLayout.getPanelHostHeight(900, 78), 806);
  assert.equal(panelLayout.getPanelHostHeight(900, 40), 806);
});

test('statistics header switches presentation and hides paging in panel mode', () => {
  assert.match(index, /data-match-statistics-presentation-toggle/);
  assert.doesNotMatch(index, /class="secondary-button detail-view-presentation-toggle"/);
  assert.match(index, /class="detail-view-close"[^>]*data-detail-view-back/);
  assert.doesNotMatch(index, /detail-view-swipe-hint/);
  assert.match(statistics, /function togglePresentation\(\)/);
  assert.match(statistics, /presentationPreference = target;/);
  assert.match(statistics, /pager\.hidden = presentation === 'panel'/);
  assert.match(style, /detail-view-dialog\[data-presentation="panel"\] \.detail-view-pager \{ display: none; \}/);
  assert.match(style, /@media \(max-width: 768px\)[\s\S]*?\.detail-view-pager \{ display: none !important; \}/);
  assert.match(style, /detail-view-dialog\[data-presentation="panel"\] \.detail-view-presentation-icon-modal \{ display: block; \}/);
  assert.match(style, /\.detail-view-presentation-toggle,[\s\S]*?width: 32px;[\s\S]*?border: 1px solid var\(--border\);[\s\S]*?border-radius: var\(--button-radius\);[\s\S]*?background: var\(--bg\);/);
  assert.match(style, /\.detail-view-close svg \{[\s\S]*?stroke-width: 3\.2;/);
});

test('modal is the default while a stored panel choice returns after temporary width loss', () => {
  assert.match(statistics, /function shouldUsePanel\(\) \{\s*return presentationPreference === 'panel' && canUsePanel\(\);/);
  assert.match(statistics, /function reconcilePresentation\(\)[\s\S]*?shouldUsePanel\(\) \? 'panel' : 'modal'/);
  assert.match(statistics, /window\.addEventListener\('resize',[\s\S]*?requestAnimationFrame\(reconcilePresentation\)/);
});

test('panel presentation preferences are stored for 30 days and then expire', () => {
  const values = new Map();
  let now = 1_800_000_000_000;
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const key = 'padel-liga-match-statistics-presentation';
  const preference = panelLayout.createPresentationPreference(key, { storage: () => storage, now: () => now });

  assert.equal(preference.get(), null);
  preference.set('panel');
  assert.equal(preference.get(), 'panel');
  assert.equal(JSON.parse(values.get(key)).expiresAt, now + 30 * 24 * 60 * 60 * 1000);

  now += 30 * 24 * 60 * 60 * 1000 + 1;
  assert.equal(preference.get(), null);
  assert.equal(values.has(key), false);

  values.set(key, '{broken');
  assert.equal(preference.get(), null);
  assert.equal(values.has(key), false);

  preference.set('sidebar');
  assert.equal(values.has(key), false);
  assert.equal(panelLayout.createPresentationPreference(key, { storage: () => { throw new Error('blocked'); } }).get(), null);

  assert.match(statistics, /createPresentationPreference\('padel-liga-match-statistics-presentation'\)/);
  assert.match(statistics, /presentationPreference = standaloneProfileContext\?\.presentationPreference\s*\|\| presentationStore\.get\(\)/);
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

test('a profile replaces a panelled match and keeps the shared presentation controls', () => {
  assert.match(statistics, /let presentation = 'modal',[\s\S]*?sharedDetailFlow = false;/);
  assert.match(statistics, /function prepareProfileOpen[\s\S]*?replacesDetail: profileReplacesDetail[\s\S]*?presentationPreference:/);
  assert.match(statistics, /function syncProfilePresentation\(nextPresentation, \{ persistPreference = false \} = \{\}\)/);
  assert.match(statistics, /Object\.defineProperty\(api, 'profileContext'/);
  assert.match(app, /id: 'match-statistics',[\s\S]*?hostId: 'match-statistics-panel-host'/);
  assert.match(app, /statisticsTransition\?\.replacesDetail/);
  assert.match(app, /persistDetailPreference: true/);
  assert.match(app, /presentation === 'panel' && !isDetailEmbed\) dialog\.show\(\);[\s\S]*?else dialog\.showModal\(\);/);
});

test('profiles opened directly from match lists use the shared panel without replaying its entrance', () => {
  assert.match(app, /playerProfilePanelOrigin = opensFromEmbeddedMatchList[\s\S]*?'embedded-match-list'[\s\S]*?'match-list'/);
  assert.match(app, /id: 'match-list',[\s\S]*?hostId: 'match-statistics-panel-host'/);
  assert.match(app, /const cachedProfile = getCachedPlayerProfile\(playerId\);[\s\S]*?if \(!cachedProfile\) setPlayerProfileState/);
  assert.match(statistics, /const retainedActiveData = fromProfileAbove && active === matchId \? activeData : null;/);
  assert.match(tippPage, /\(detail\.matchId \|\| detail\.playerId\)[\s\S]*?trigger\?\.closest\('#prediction-matches'\)/);
  assert.match(tippPage, /panelAvailable: canUseDetailPanel\(\)/);
  assert.match(app, /dialog\.classList\.toggle\([\s\S]*?'is-detail-panel-swap'[\s\S]*?detail-panel-switching/);
  assert.match(statistics, /targetDialog\.classList\.toggle\([\s\S]*?'is-detail-panel-swap'[\s\S]*?detail-panel-switching/);
  assert.match(style, /\.detail-view-dialog\[data-presentation="panel"\]\.is-detail-panel-swap,[\s\S]*?\.player-profile-dialog\[data-presentation="panel"\]\.is-detail-panel-swap[\s\S]*?animation: detail-panel-swap-in 90ms ease-out;/);
  assert.match(style, /@keyframes detail-panel-swap-in \{\s*from \{ opacity: 0\.72; \}\s*to \{ opacity: 1; \}/);
});

test('the entry sequence stays stable while filters rerender the list', () => {
  const renderMatches = app.match(/function renderPartien\([^]*?(?=\nfunction getOpenMatches)/)?.[0] || '';
  const predictionObserver = tippPage.match(/new MutationObserver\(\(\) => \{[^]*?\}\)\.observe\(predictionMatches/)?.[0] || '';
  assert.doesNotMatch(renderMatches, /setSequence/);
  assert.doesNotMatch(predictionObserver, /detail-sequence/);
});

test('panel content uses compact match, prediction and statistics layouts', () => {
  assert.match(style, /body\.match-statistics-panel-open #match-statistics-list-pane > \.sh-with-control \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(style, /body\.match-statistics-panel-open #match-sort-toggle,[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?grid-row: 2;[\s\S]*?justify-self: center;/);
  assert.match(style, /body\.match-statistics-panel-open #match-scope-toggle \{[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 1;[\s\S]*?justify-self: end;/);
  assert.match(style, /detail-view-dialog\[data-presentation="panel"\] \.detail-view-heading \{[\s\S]*?display: flex;[\s\S]*?align-items: baseline;/);
  assert.match(style, /detail-view-dialog\[data-presentation="panel"\] \.detail-view-header \{[\s\S]*?min-height: 64px;/);
  assert.match(style, /detail-view-dialog\[data-presentation="panel"\] \.detail-view-played-order:not\(\[hidden\]\) \{[\s\S]*?display: inline-flex;/);
  assert.match(style, /body\.match-statistics-panel-open #partien \.mc \{[\s\S]*?grid-template-areas:[\s\S]*?"team1 score team2"/);
  assert.match(style, /body\.match-statistics-panel-open #partien \.mc-players \{[\s\S]*?overflow: visible;/);
  assert.match(style, /body\.match-statistics-panel-open #partien \.mc-player-name \{[\s\S]*?overflow: hidden;[\s\S]*?text-overflow: ellipsis;/);
  assert.match(style, /body\.match-statistics-panel-open \.prediction-statistics-list-pane \.prediction-match-card:not\(\.is-single-set\)/);
  assert.match(style, /body\.match-statistics-panel-open \.prediction-statistics-list-pane \.prediction-team \{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;[\s\S]*?overflow: visible;/);
  assert.match(style, /body\.match-statistics-panel-open \.prediction-statistics-list-pane \.prediction-player \{[\s\S]*?overflow: hidden;[\s\S]*?text-overflow: ellipsis;/);
  assert.match(style, /body\.match-statistics-panel-open \.prediction-statistics-list-pane \.prediction-team \.mc-player-sep \{ display: none; \}/);
  assert.match(statisticsStyle, /#detail-view-dialog\[data-presentation="panel"\] \.match-statistics-ranking-layout \{\s*grid-template-columns: 1fr;/);
  assert.match(style, /detail-view-dialog\[data-presentation="panel"\] \{[\s\S]*?max-width: var\(--match-detail-panel-max-width\);[\s\S]*?container: match-detail-panel \/ inline-size;/);
  assert.match(style, /@container match-detail-panel \(min-width: 1100px\) \{[\s\S]*?detail-view-dialog\[data-presentation="panel"\] \.detail-view-content \{[\s\S]*?width: min\(calc\(100% - 2rem\), 1100px\);/);
  assert.match(statisticsStyle, /@container match-detail-panel \(min-width: 900px\) \{[\s\S]*?#detail-view-dialog\[data-presentation="panel"\] \.match-statistics-ranking-layout \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(statisticsStyle, /\.match-statistics-form-row \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(statisticsStyle, /\.match-statistics-form-team \{[\s\S]*?display: grid;[\s\S]*?gap: 1\.5rem;/);
  assert.match(statisticsStyle, /#detail-view-dialog\[data-presentation="panel"\] \.match-statistics-team-picker \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(statisticsStyle, /#detail-view-dialog\[data-presentation="panel"\] \.match-statistics-player-picker \{ display: none; \}/);
  assert.match(statisticsStyle, /\.match-statistics-graph \{[^}]*container-type: inline-size;/);
  assert.match(statisticsStyle, /\.match-statistics-player-graph\.match-statistics-team-player-2 \{[\s\S]*?50cqw - 500px/);
});
