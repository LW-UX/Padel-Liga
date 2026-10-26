const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'tipp', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'js', 'tippspiel.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const decisions = fs.readFileSync(path.join(root, 'docs', 'project-decisions', 'tipping.md'), 'utf8');

test('PadelTipp opens on the start page without adding a start menu item', () => {
  assert.match(page, /data-tip-nav="tippstart" aria-label="Zur PadelTipp-Startseite"/);
  const navigation = page.match(/<nav class="site-nav tip-site-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.match(
    navigation,
    /data-tip-nav="tippuebersicht">Tipprangliste[\s\S]*data-tip-nav="tippen">Tippabgabe[\s\S]*data-tip-nav="tippinfos">Infos/
  );
  assert.doesNotMatch(navigation, /data-tip-nav="tippstart"|>Start<\/button>/);
  assert.match(page, /<section id="tippstart" class="section active">[\s\S]*id="prediction-overview"/);
  const startSection = page.match(/<section id="tippstart"[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(startSection, /ÜBERSICHT|Saison <span data-season-label>/);
  assert.doesNotMatch(page, /<section id="tippuebersicht" class="section active">/);
});

test('the start page stays a summary instead of duplicating match cards', () => {
  const overviewSource = script.match(/function renderOverview\(\)[\s\S]*?(?=\n  function renderMatches\()/)?.[0] || '';
  assert.match(overviewSource, /renderPersonalStand/);
  assert.match(overviewSource, /renderPredictionAction/);
  assert.match(overviewSource, /renderLatestEvaluation/);
  assert.match(overviewSource, /renderSeasonBalance/);
  assert.match(overviewSource, /renderOverviewRankRows/);
  assert.doesNotMatch(overviewSource, /prediction-match-card|renderMatch\(/);
});

test('open-tip call to action counts only missing personal predictions and uses the nearest deadline', () => {
  const summarySource = script.match(/function getOpenPredictionSummary\(\)[\s\S]*?(?=\n  function getMatchdayTitle\()/)?.[0] || '';
  assert.match(summarySource, /getPredictionLocalMatches\(\)\.filter\(isPredictionOpen\)/);
  assert.match(summarySource, /filter\(match => !state\.predictions\.has\(match\.id\)\)/);
  assert.match(summarySource, /\.sort\(\(first, second\) => first - second\)\[0\]/);
  assert.match(script, /Alles getippt ✓/);
  assert.match(script, /Nächster Tippschluss:/);
  assert.match(script, /Du kannst deine Prognosen bis zum Spielbeginn ändern/);
  assert.match(script, /function formatOpenPredictionTitle\(count\)/);
  assert.match(script, /<h2>\$\{formatOpenPredictionTitle\(count\)\}<\/h2>/);
  assert.doesNotMatch(script, /Tipps sind[^']*offen/);
  assert.match(script, /class="widget prediction-overview-block prediction-overview-action/);
  assert.doesNotMatch(style, /\.prediction-overview-block h2/);
});

test('personal and guest dashboard states remain distinct', () => {
  assert.match(script, /function renderPersonalStand\(/);
  assert.match(script, /function renderGuestStand\(/);
  assert.match(script, /function renderGuestCommunity\(/);
  assert.match(script, /Login \/ Konto erstellen/);
  const guestStand = script.match(/function renderGuestStand\(\)[\s\S]*?(?=\n  function renderGuestCommunity\()/)?.[0] || '';
  assert.doesNotMatch(guestStand, /data-auth-open|Login \/ Konto erstellen/);
  assert.match(script, /Deine Saisonbilanz/);
  assert.match(script, /Exaktquote/);
  assert.match(script, /const passivePoints = getPersonalContributions\(\)[\s\S]*?\.filter\(item => item\.automatic\)[\s\S]*?\.reduce\(\(total, item\) => total \+ item\.points, 0\)/);
  assert.match(script, /<div class="stat-copy">Passive Punkte<\/div>/);
  assert.match(script, /class="prediction-overview-stand-copy">[\s\S]*?Dein Stand[\s\S]*?prediction-overview-account[\s\S]*?<p>\$\{escapeHtml\(context\)\}<\/p>/);
  assert.match(style, /\.prediction-overview-personal-stand \{[\s\S]*?grid-template-columns: minmax\(0, 1\.6fr\) repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(style, /\.prediction-overview-personal-stand \.prediction-overview-scoreline \{ display: contents; \}/);
  assert.match(script, /Letzte Auswertung/);
  assert.match(script, /Spitzenfeld/);
  assert.match(script, /if \(ownIndex >= 3\) indexes\.push\(ownIndex\)/);
  assert.match(script, /class="mini-rank-row r\$\{index \+ 1\}/);
  assert.match(script, /class="rank-position"/);
  assert.match(script, /class="mini-rank-name"/);
  assert.match(script, /class="rank-score"/);
  assert.doesNotMatch(style, /\.prediction-overview-rank-row \{/);
});

test('dashboard uses independent left and right columns and keeps the start page in swipe order', () => {
  assert.match(script, /prediction-overview-column prediction-overview-column--left">\$\{stand\}\$\{action\}\$\{balance\}/);
  assert.match(script, /const rightColumn = state\.session\?\.user \? `\$\{leaders\}\$\{latest\}` : `\$\{latest\}\$\{leaders\}`/);
  assert.match(script, /prediction-overview-column prediction-overview-column--right">\$\{rightColumn\}/);
  assert.match(style, /\.prediction-overview-column \{[\s\S]*?display: grid;[\s\S]*?gap: 4rem;/);
  const overviewGridStyle = style.match(/\.prediction-overview-grid \{[^}]*\}/)?.[0] || '';
  assert.doesNotMatch(overviewGridStyle, /grid-template-areas:/);
  assert.match(style, /\.prediction-overview-leaders \{ order: 1; \}[\s\S]*\.prediction-overview-action \{ order: 3; \}/);
  assert.match(style, /\.prediction-overview-grid\.is-guest \.prediction-overview-community \{ order: 1; \}[\s\S]*\.prediction-overview-grid\.is-guest \.prediction-overview-leaders \{ order: 2; \}/);
  const pageScript = fs.readFileSync(path.join(root, 'js', 'tipp-page.js'), 'utf8');
  assert.match(pageScript, /const sections = \[\s*'tippstart',/);
  assert.match(decisions, /Startseite steht als nicht eigens beschrifteter erster Bereich davor/);
  assert.match(decisions, /Tippzentrale ohne Artikel und ohne einzelne Partien/);
});

test('the dashboard follows the containerless four-rem layout', () => {
  const blockStyle = style.match(/\.prediction-overview-block \{[^}]*\}/)?.[0] || '';
  assert.doesNotMatch(blockStyle, /border|background|padding|border-radius/);
  assert.match(style, /\.prediction-overview-grid \{[\s\S]*?gap: 4rem;/);
  assert.match(decisions, /freie Blöcke ohne Kartenhintergründe oder Außenrahmen und mit vier Rem Abstand/);
});
