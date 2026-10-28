const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'tipp', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'js', 'tippspiel.js'), 'utf8');
const pageScript = fs.readFileSync(path.join(root, 'js', 'tipp-page.js'), 'utf8');
const ligaPage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ligaScript = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const decisions = fs.readFileSync(path.join(root, 'docs', 'project-decisions', 'tipping.md'), 'utf8');
const accountTypeMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261028170000_prediction_leaderboard_account_type.sql'),
  'utf8'
);
const achievementMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261028180000_prediction_leaderboard_previous_achievements.sql'),
  'utf8'
);
const achievementLaurel = fs.readFileSync(
  path.join(root, 'assets', 'icons', 'achievement-laurel.svg'),
  'utf8'
);

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
  assert.match(overviewSource, /renderOverviewArticle/);
  assert.match(overviewSource, /renderOverviewRankRows/);
  assert.doesNotMatch(overviewSource, /prediction-match-card|renderMatch\(/);
});

test('league home shows a four-entry prediction ranking below recent matches', () => {
  assert.match(ligaPage, /Letzte Partien[\s\S]*Top 4 · Tipprangliste[\s\S]*id="home-prediction-ranking"/);
  assert.match(ligaPage, /id="home-prediction-ranking-link"[^>]*href="tipp\/#tippuebersicht"[^>]*>Zur Tipprangliste<\/a>/);
  assert.match(ligaScript, /get_prediction_leaderboard/);
  assert.match(ligaScript, /homePredictionLeaderboard\.slice\(0, 4\)/);
  assert.match(ligaScript, /entry\.display_name/);
  assert.match(ligaScript, /Number\(entry\.points\) \|\| 0/);
  assert.match(ligaScript, /tipp\/\?saison=\$\{encodeURIComponent\(selectedSeason\.id\)\}#tippuebersicht/);
  assert.match(pageScript, /\['tippstart', 'tippuebersicht', 'tippen', 'tippinfos'\]\.includes\(requestedSection\)/);
  assert.match(decisions, /direkt unter „Letzte Partien“ eine Top-4-Kurzrangliste/);
});

test('prediction rankings show the dim account type icon directly after each name', () => {
  assert.match(accountTypeMigration, /is_player boolean/);
  assert.match(accountTypeMigration, /profile\.player_id is not null/);
  assert.doesNotMatch(accountTypeMigration.match(/returns table \([\s\S]*?\)/)?.[0] || '', /player_id|app_role/);
  assert.match(script, /function renderPredictionAccountTypeIcon\(entry\)/);
  assert.match(script, /entry\.is_player \? 'Spieler' : 'Tipper'/);
  assert.match(script, /rotate\(40 12 12\)/);
  assert.match(script, /M2 9a3 3 0 0 1 0 6/);
  assert.match(script, /prediction-rank-account-name[^\n]*renderPredictionAccountTypeIcon\(entry\)/);
  assert.match(ligaScript, /function renderPredictionAccountTypeIcon\(entry\)/);
  assert.match(ligaScript, /homePredictionLeaderboard\.slice\(0, 4\)[\s\S]*renderPredictionAccountTypeIcon\(entry\)/);
  assert.match(style, /\.prediction-account-type-icon \{[\s\S]*color: var\(--dim\);/);
  assert.match(decisions, /„Was ist neu\?“-Dialog verwendeten Padel-Schläger/);
});

test('prediction rankings show previous league champion and Final Four achievements', () => {
  assert.match(achievementMigration, /previous_league_achievement text/);
  assert.match(achievementMigration, /previous_league_season_label text/);
  assert.match(achievementMigration, /season\.completed_at is not null/);
  assert.match(achievementMigration, /season\.counts_for_profile/);
  assert.match(achievementMigration, /season\.visual_theme <> 'cup'/);
  assert.match(achievementMigration, /bool_or\(achievement\.kind = 'winner'\)[\s\S]*bool_or\(achievement\.kind = 'final_four'\)/);
  assert.match(script, /function renderPredictionAchievementIcon\(entry\)/);
  assert.match(script, /kind === 'winner' \? 'Champion' : 'Final Four'/);
  assert.match(script, /renderPredictionAchievementIcon\(entry\)\}\$\{renderPredictionAccountTypeIcon\(entry\)/);
  assert.match(ligaScript, /function renderPredictionAchievementIcon\(entry, additionalClass = ''\)/);
  assert.match(ligaScript, /renderPredictionAchievementIcon\(entry\)\}\$\{renderPredictionAccountTypeIcon\(entry\)/);
  assert.match(style, /\.prediction-achievement-icon--winner \{ color: var\(--gold\); \}/);
  assert.match(style, /\.prediction-achievement-icon--final-four \{ color: var\(--silver\); \}/);
  assert.match(style, /\.prediction-rank-account \{[\s\S]*gap: 2px;/);
  assert.match(style, /\.prediction-achievement-laurel \{[\s\S]*mask: url\('assets\/icons\/achievement-laurel\.svg'\)/);
  assert.match(achievementLaurel, /viewBox="0 0 1255\.92 1166\.47"/);
  assert.match(achievementLaurel, /M427\.94 1121\.56/);
  assert.match(script, /class="prediction-achievement-laurel"/);
  assert.match(decisions, /goldenen Pokal[\s\S]*silbernen Lorbeer/);
});

test('the current PadelPost article reuses the collapsible league-home structure', () => {
  assert.match(script, /function getCurrentOverviewArticle\(\)/);
  assert.match(script, /Array\.isArray\(state\.season\?\.articles\)/);
  assert.match(script, /class="widget widget-articles prediction-overview-block prediction-overview-article"/);
  assert.match(script, /class="home-article-preview\$\{state\.articleExpanded \? ' expanded' : ''\}"/);
  assert.match(script, /class="article-card article-newspaper"/);
  assert.match(script, /class="text-link article-readmore"[\s\S]*data-expand-prediction-article[\s\S]*>Weiterlesen<\/button>/);
  assert.match(script, /state\.articleExpanded = true;[\s\S]*prediction-home-article-preview[\s\S]*articleControl\.hidden = true/);
  assert.match(style, /\.prediction-overview-article \.home-article-preview \{[\s\S]*max-height: 320px;[\s\S]*overflow: hidden;/);
  assert.match(style, /\.prediction-overview-article \.home-article-preview\.expanded \{ max-height: none; \}/);
  assert.match(style, /\.prediction-overview-article \.article-readmore \{ display: inline-flex; \}/);
  assert.match(page, /match-statistics\.css/);
});

test('open-tip call to action counts missing match and bonus predictions and uses the nearest deadline', () => {
  const summarySource = script.match(/function getOpenPredictionSummary\(\)[\s\S]*?(?=\n  function getMatchdayTitle\()/)?.[0] || '';
  assert.match(summarySource, /getPredictionLocalMatches\(\)\.filter\(isPredictionOpen\)/);
  assert.match(summarySource, /filter\(match => !state\.predictions\.has\(match\.id\)\)/);
  assert.match(summarySource, /state\.bonusQuestions\.filter\(isBonusQuestionOpen\)/);
  assert.match(summarySource, /filter\(question => !isBonusQuestionComplete\(question\)\)/);
  assert.match(summarySource, /\.sort\(\(first, second\) => first - second\)\[0\]/);
  assert.match(script, /Alles getippt ✓/);
  assert.match(script, /Nächster Tippschluss:/);
  assert.match(script, /Du kannst deine Prognosen bis zum Spielbeginn ändern/);
  assert.match(script, /function formatOpenPredictionTitle\(count\)/);
  assert.match(script, /<h2>\$\{formatOpenPredictionTitle\(remainingCount\)\}<\/h2>/);
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
  const seasonBalance = script.match(/function renderSeasonBalance\(entry\)[\s\S]*?(?=\n  function renderGuestStand\()/)?.[0] || '';
  assert.doesNotMatch(guestStand, /data-auth-open|Login \/ Konto erstellen/);
  assert.match(script, /Deine Saisonbilanz/);
  assert.match(script, /Exaktquote/);
  assert.match(seasonBalance, />Tipps<[\s\S]*>Wertungen<[\s\S]*>Ø Punkte<[\s\S]*>Sieger richtig<[\s\S]*>Exakt<[\s\S]*>Exaktquote</);
  assert.match(script, /const passivePoints = getPersonalContributions\(\)[\s\S]*?\.filter\(item => item\.automatic\)[\s\S]*?\.reduce\(\(total, item\) => total \+ item\.points, 0\)/);
  assert.match(script, /<div class="stat-copy">Passive Punkte<\/div>/);
  assert.match(script, /class="stat-main prediction-passive-points-value"[\s\S]*?aria-label="Passive Punkte erklären"[\s\S]*?id="prediction-passive-points-help" role="tooltip"/);
  assert.match(script, /Deine eigenen Partien kannst du nicht tippen\.[\s\S]*?schlechteste tatsächlich abgegebene Tipp der anderen\.[\s\S]*?keine automatische Gutschrift\./);
  assert.match(script, /class="prediction-overview-stand-copy">[\s\S]*?Dein Stand[\s\S]*?prediction-overview-account[\s\S]*?<p>\$\{escapeHtml\(context\)\}<\/p>/);
  assert.match(style, /\.prediction-overview-personal-stand \{[\s\S]*?grid-template-columns: minmax\(0, 1\.6fr\) repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(style, /\.prediction-overview-personal-stand \.prediction-overview-scoreline \{ display: contents; \}/);
  assert.match(style, /\.prediction-passive-points-value \{[\s\S]*?display: flex;[\s\S]*?justify-content: center;/);
  assert.match(script, /Letzte Auswertung/);
  assert.match(script, /class="prediction-overview-stats prediction-overview-latest-stats"/);
  assert.match(script, /details\.push\(\{ value: `\$\{latest\.exact\}×`, label: 'exakt' \}\)/);
  assert.match(script, /<strong>\$\{escapeHtml\(detail\.value\)\}<\/strong><span class="stat-copy">\$\{escapeHtml\(detail\.label\)\}<\/span>/);
  assert.match(script, /Spitzenfeld/);
  assert.match(script, /if \(ownIndex >= 3\) indexes\.push\(ownIndex\)/);
  assert.match(script, /class="mini-rank-row r\$\{index \+ 1\}/);
  assert.match(script, /class="rank-position"/);
  assert.match(script, /class="mini-rank-name"/);
  assert.match(script, /class="rank-score"/);
  assert.doesNotMatch(style, /\.prediction-overview-rank-row \{/);
});

test('dashboard uses independent left and right columns and keeps the start page in swipe order', () => {
  assert.match(script, /const leftColumn = state\.session\?\.user \? `\$\{action\}\$\{stand\}\$\{article\}` : `\$\{stand\}\$\{action\}\$\{article\}`/);
  assert.match(script, /prediction-overview-column prediction-overview-column--left">\$\{leftColumn\}/);
  assert.match(script, /const rightColumn = state\.session\?\.user \? `\$\{latest\}\$\{balance\}\$\{leaders\}` : `\$\{latest\}\$\{leaders\}`/);
  assert.match(script, /prediction-overview-column prediction-overview-column--right">\$\{rightColumn\}/);
  assert.match(style, /\.prediction-overview-column \{[\s\S]*?display: grid;[\s\S]*?gap: 4rem;/);
  const overviewGridStyle = style.match(/\.prediction-overview-grid \{[^}]*\}/)?.[0] || '';
  assert.doesNotMatch(overviewGridStyle, /grid-template-areas:/);
  assert.match(style, /\.prediction-overview-action \{ order: 1; \}[\s\S]*\.prediction-overview-stand \{ order: 2; \}[\s\S]*\.prediction-overview-article \{ order: 3; \}[\s\S]*\.prediction-overview-latest \{ order: 4; \}[\s\S]*\.prediction-overview-balance \{ order: 5; \}[\s\S]*\.prediction-overview-leaders \{ order: 6; \}/);
  assert.match(style, /\.prediction-overview-grid\.is-guest \.prediction-overview-stand \{ order: 1; \}[\s\S]*\.prediction-overview-grid\.is-guest \.prediction-overview-action \{ order: 2; \}[\s\S]*\.prediction-overview-grid\.is-guest \.prediction-overview-community \{ order: 3; \}[\s\S]*\.prediction-overview-grid\.is-guest \.prediction-overview-leaders \{ order: 4; \}[\s\S]*\.prediction-overview-grid\.is-guest \.prediction-overview-article \{ order: 5; \}/);
  assert.match(pageScript, /const sections = \[\s*'tippstart',/);
  assert.match(decisions, /Startseite steht als nicht eigens beschrifteter erster Bereich davor/);
  assert.match(decisions, /aktuelle veröffentlichte PadelPost-Artikel[\s\S]*„Weiterlesen“ klappt ihn direkt auf der Tippseite vollständig aus/);
});

test('the dashboard follows the containerless four-rem layout', () => {
  const blockStyle = style.match(/\.prediction-overview-block \{[^}]*\}/)?.[0] || '';
  assert.doesNotMatch(blockStyle, /border|background|padding|border-radius/);
  assert.match(style, /\.prediction-overview-grid \{[\s\S]*?gap: 4rem;/);
  assert.match(decisions, /freie Blöcke ohne Kartenhintergründe oder Außenrahmen und mit vier Rem Abstand/);
});
