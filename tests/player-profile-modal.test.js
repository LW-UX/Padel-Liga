const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const scoreInput = fs.readFileSync(path.join(root, 'js/score-input.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const players = fs.readFileSync(path.join(root, 'data/players.js'), 'utf8');
const profileMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260901130000_public_player_profiles.sql'),
  'utf8'
);
const importMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260901131000_import_2026_profile_history.sql'),
  'utf8'
);
const achievementMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260901132000_sommer_2026_final_four_achievements.sql'),
  'utf8'
);
const winnerAchievementMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260901133000_sommer_2026_marcel_winner_achievement.sql'),
  'utf8'
);
const incompleteTrainingMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260901140000_incomplete_training_rounds.sql'),
  'utf8'
);
const historicalTrainingMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260901141000_import_historical_training_sessions.sql'),
  'utf8'
);
const correctedLotzMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260901142000_correct_lotz_training_player.sql'),
  'utf8'
);
const weightedTrainingMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260903120000_weighted_training_profile_matches.sql'),
  'utf8'
);
const trainingCounterMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260903170000_training_counter_scores.sql'),
  'utf8'
);
const septemberTrainingMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260908183000_import_september_training_sessions.sql'),
  'utf8'
);
const trainingMatchTiebreakMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260908184000_training_match_tiebreak_outcomes.sql'),
  'utf8'
);
const correctedSeptember2025TrainingMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260909140000_correct_september_2025_training_result.sql'),
  'utf8'
);
const finalFourProfileMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260909210000_final_four_profile_groups.sql'),
  'utf8'
);

function evaluateRelationshipLeaders(matches) {
  const functionSource = app.match(
    /function getPlayerProfileRelationshipLeaders\(matches = \[\]\) \{[\s\S]*?\n\}\n\nfunction renderPlayerProfileRelationships/
  );
  assert.ok(functionSource, 'relationship helper source should be present');
  const context = { matches, result: null };
  vm.createContext(context);
  vm.runInContext(
    `${functionSource[0].replace(/\n\nfunction renderPlayerProfileRelationships$/, '')}\nresult = getPlayerProfileRelationshipLeaders(matches);`,
    context
  );
  return context.result;
}

function evaluateProfileResultDetails(match) {
  const functionSource = app.match(
    /function orientProfileResult\(resultDetails, team\) \{[\s\S]*?(?=\nfunction getPlayerProfileTrainingSessionId)/
  );
  assert.ok(functionSource, 'profile result rendering helpers should be present');
  const context = {
    match,
    result: null,
    window: {},
    escapeHtml: value => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  };
  vm.createContext(context);
  vm.runInContext(scoreInput, context);
  vm.runInContext(`${functionSource[0]}\nresult = renderProfileResultDetails(match);`, context);
  return context.result;
}

function evaluateProfileSummaryFormats(wins, matches, gameDiff) {
  const functionSource = app.match(
    /function formatProfileSignedValue\(value\) \{[\s\S]*?(?=\nfunction renderPlayerProfileAchievements)/
  );
  assert.ok(functionSource, 'profile summary formatting helpers should be present');
  const context = {
    wins,
    matches,
    gameDiff,
    result: null,
    escapeHtml: value => String(value ?? '')
  };
  vm.createContext(context);
  vm.runInContext(
    `${functionSource[0]}\nresult = { winRate: formatProfileWinRate(wins, matches), gameDiffPerMatch: formatProfileGameDiffPerMatch(gameDiff, matches) };`,
    context
  );
  return JSON.parse(JSON.stringify(context.result));
}

function evaluateLongestProfileWinStreak(matches) {
  const functionSource = app.match(
    /function getLongestPlayerProfileWinStreak\(matches = \[\]\) \{[\s\S]*?(?=\nfunction getPlayerProfileAchievementHighlights)/
  );
  assert.ok(functionSource, 'profile winning streak helpers should be present');
  const context = { matches, result: null };
  vm.createContext(context);
  vm.runInContext(
    `${functionSource[0]}\nresult = { length: getLongestPlayerProfileWinStreak(matches), label: renderPlayerProfileWinStreak(matches) };`,
    context
  );
  return JSON.parse(JSON.stringify(context.result));
}

function evaluateParticipationOrder(participations, seasons) {
  const legacyIds = app.match(/const LEGACY_SEASON_IDS = Object\.freeze\(\{[\s\S]*?\}\);/);
  const normalizeId = app.match(/function normalizeSeasonId\(id\) \{[\s\S]*?\n\}/);
  const functionSource = app.match(
    /function orderPlayerProfileParticipations\(participations = \[\], seasons = getSeasonOptions\(\)\) \{[\s\S]*?\n\}/
  );
  assert.ok(legacyIds && normalizeId && functionSource, 'profile participation ordering helper should be present');
  const context = { participations, seasons, result: null };
  vm.createContext(context);
  vm.runInContext(
    `${legacyIds[0]}\n${normalizeId[0]}\n${functionSource[0]}\nresult = orderPlayerProfileParticipations(participations, seasons);`,
    context
  );
  return JSON.parse(JSON.stringify(context.result));
}

function evaluateTrainingParticipation(matches) {
  const functionSource = app.match(
    /function getPlayerProfileTrainingParticipation\(matches = \[\]\) \{[\s\S]*?\n\}/
  );
  assert.ok(functionSource, 'profile training participation helper should be present');
  const classifyRegularSet = (left, right) => {
    const first = Number(left);
    const second = Number(right);
    const isComplete = (Math.max(first, second) === 6 && Math.min(first, second) <= 4)
      || (Math.max(first, second) === 7 && Math.min(first, second) >= 5 && Math.min(first, second) <= 6);
    return { state: isComplete ? 'complete' : 'partial' };
  };
  const context = {
    matches,
    result: null,
    window: { PadelScoreInput: { classifyRegularSet } }
  };
  vm.createContext(context);
  vm.runInContext(
    `${functionSource[0]}\nresult = getPlayerProfileTrainingParticipation(matches);`,
    context
  );
  return JSON.parse(JSON.stringify(context.result));
}

function evaluateFinalRoundOverview(matches, playerId) {
  const functionSource = app.match(
    /function getPlayerProfileSeasonMatchTeam\(match, playerId\) \{[\s\S]*?(?=\nasync function enrichPlayerProfileSeasonPhases)/
  );
  assert.ok(functionSource, 'profile season phase helpers should be present');
  const context = {
    matches,
    playerId,
    result: null,
    getMatchStage: match => match.stage,
    getProfileRegularGameTotals: resultDetails => {
      const regularResult = String(resultDetails || '').replace(/\([^)]*\)/g, '');
      return [...regularResult.matchAll(/(\d+)\s*:\s*(\d+)/g)]
        .map(score => [Number(score[1]), Number(score[2])])
        .filter(([left, right]) => left <= 7 && right <= 7)
        .reduce((totals, [left, right]) => [totals[0] + left, totals[1] + right], [0, 0]);
    }
  };
  vm.createContext(context);
  vm.runInContext(
    `${functionSource[0]}\nresult = getPlayerProfileFinalRoundOverview({ matches }, playerId);`,
    context
  );
  return JSON.parse(JSON.stringify(context.result));
}

function evaluateParticipationActive(participation, seasonPayload) {
  const functionSource = app.match(
    /function isPlayerProfileParticipationActive\(participation, seasonPayload\) \{[\s\S]*?\n\}/
  );
  assert.ok(functionSource, 'profile participation status helper should be present');
  const context = { participation, seasonPayload, result: null };
  vm.createContext(context);
  vm.runInContext(
    `${functionSource[0]}\nresult = isPlayerProfileParticipationActive(participation, seasonPayload);`,
    context
  );
  return context.result;
}

function evaluateAchievementHighlights(achievements) {
  const limitSource = app.match(/const PLAYER_PROFILE_ACHIEVEMENT_LIMIT = 4;/);
  const functionSource = app.match(
    /function getPlayerProfileAchievementHighlights\(achievements = \[\]\) \{[\s\S]*?\n\}/
  );
  assert.ok(limitSource, 'profile achievement limit should be present');
  assert.ok(functionSource, 'profile achievement selection helper should be present');
  const context = { achievements, result: null };
  vm.createContext(context);
  vm.runInContext(
    `${limitSource[0]}\n${functionSource[0]}\nresult = getPlayerProfileAchievementHighlights(achievements);`,
    context
  );
  return JSON.parse(JSON.stringify(context.result));
}

test('public player profile is a separate accessible dialog', () => {
  assert.match(html, /<dialog class="player-profile-dialog" id="player-profile-dialog" aria-labelledby="player-profile-name" data-presentation="modal">/);
  assert.match(html, /<button class="modal-close-button player-profile-presentation-toggle"[^>]*data-player-profile-presentation-toggle[^>]*hidden>/);
  assert.match(html, /<button class="modal-close-button player-profile-close"[^>]*data-player-profile-close/);
  assert.equal((html.match(/<article class="widget player-profile-widget/g) || []).length, 5);
  assert.match(html, /<article class="widget player-profile-widget player-profile-stats-widget">[\s\S]*id="player-profile-stats"/);
  assert.match(html, /<h2 id="player-profile-name"><\/h2>\s*<span class="player-profile-company firma-badge"/);
  assert.match(app, /profileCompanyElement\.classList\.add\(`firma-\$\{profileCompany\}`\)/);
  assert.match(app, /achievement\.kind === 'winner'/);
  assert.match(app, /achievement\.kind === 'final_four'/);
  assert.match(app, /achievement\.kind === 'finalist'/);
  assert.match(app, /kind === 'winner'\s*\? 'Champion'/);
  assert.match(app, /kind === 'final-four' \? 'Final 4'/);
  assert.match(app, /kind === 'finalist' \? 'Finale'/);
  assert.match(app, /getPlayerProfileAchievementHighlights\(achievements\)/);
  assert.match(html, /id="achievement-laurel-left"/);
  assert.match(html, /id="achievement-laurel-right"/);
  assert.match(app, /<use href="#achievement-laurel-left"><\/use>/);
  assert.match(app, /<use href="#achievement-laurel-right"><\/use>/);
  assert.match(html, /id="player-profile-elo-chart"/);
  assert.match(app, /const labels = series\.map\(item => formatProfileDate\(item\.matchAt \|\| item\.date\)\)/);
  assert.doesNotMatch(app, /const labels = series\.map\(item => item\.label/);
  assert.match(app, /function renderProfileMatchCount\(value\)[\s\S]*?player-profile-stat-fraction/);
  assert.match(app, /renderPlayerProfileStats\(profile\.summary \|\| \{\}, profile\.matches \|\| \[\]\)/);
  assert.match(app, /renderProfileMatchCount\(summary\.matches\), 'Partien', '', true/);
  assert.match(app, /renderProfileMatchCount\(summary\.wins\).*renderProfileMatchCount\(summary\.losses\)/);
  assert.match(app, /'Siegquote'[\s\S]*?'Partien'[\s\S]*?'Partien G:V'[\s\S]*?'Spiele G:V'[\s\S]*?'Spieldifferenz'[\s\S]*? Ø<\/span>`, 'Spieldifferenz'[\s\S]*?'Längste Serie'/);
  assert.match(app, /renderPlayerProfileWinStreak\(matches\), 'Längste Serie', '', true/);
  assert.match(app, /'Spieldifferenz', getPlayerProfileSignedValueClass\(summary\.gameDiff\)/);
  assert.match(app, / Ø<\/span>`, 'Spieldifferenz', getPlayerProfileSignedValueClass\(gameDiffPerMatch\)/);
  assert.match(style, /\.player-profile-stat-value\.negative \{ color: var\(--negativ\); \}/);
  assert.match(style, /\.player-profile-stat-fraction \{ font-size: var\(--text-base\); \}/);
  assert.match(style, /\.player-profile-stats \{[\s\S]*?grid-template-columns: repeat\(8, minmax\(0, 1fr\)\);/);
  assert.match(style, /\.player-profile-stat:nth-child\(even\) \{ border-right: 0; \}/);
  assert.doesNotMatch(style, /\.player-profile-stat:first-child \{ grid-column: 1 \/ -1;/);
  assert.doesNotMatch(style, /\.player-profile-stat:last-child \{ grid-column: 1 \/ -1;/);
  assert.match(html, /id="player-profile-avatar-placeholder"/);
  assert.match(app, /identity\.profileEmoji \|\| knownPlayer\?\.profileEmoji/);
  assert.match(app, /image\.onload = \(\) => \{\s*image\.hidden = false;\s*placeholder\.hidden = true;/);
  assert.match(players, /id: "chris_m"[^\n]+profileEmoji: "👨"/);
  assert.match(players, /id: "agnes_k"[^\n]+profileEmoji: "👩"/);
  assert.doesNotMatch(html, /data-player-profile-filter/);
  assert.match(html, /class="match-scope-toggle" aria-label="Partien filtern">[\s\S]*?data-player-profile-match-scope="past" aria-pressed="true">Vergangene<[\s\S]*?data-player-profile-match-scope="upcoming" aria-pressed="false">Kommende</);
  assert.match(html, /class="secondary-button player-profile-show-all"[^>]*data-player-profile-show-all/);
  assert.match(app, /const PLAYER_PROFILE_MATCH_PREVIEW_LIMIT = 10;/);
  assert.match(app, /startDate: season\.starts_on/);
  assert.match(app, /const groups = groupPlayerProfileMatches\(matches\)/);
  assert.match(app, /visibleMatchCount >= PLAYER_PROFILE_MATCH_PREVIEW_LIMIT/);
  assert.match(style, /\.player-profile-show-all\[hidden\] \{ display: none; \}/);
  assert.match(app, /function renderPlayerProfileNames\(names = \[\], fallback = '—'\)/);
  assert.match(app, /join\('<span class="mc-player-sep">&amp;<\/span>'\)/);
  assert.match(app, /player-profile-match-team-line"><span>mit<\/span>[\s\S]*?player-profile-match-team-line"><span>vs\.<\/span>/);
  assert.match(style, /@media \(max-width: 1199px\) \{[\s\S]*?\.player-profile-match-teams \{[\s\S]*?flex-direction: column;/);
  assert.match(style, /@media \(max-width: 999px\) \{[\s\S]*?\.player-profile-match \{[\s\S]*?grid-template-columns: 30px minmax\(0, 1fr\) auto;/);
  assert.doesNotMatch(app, /\(match\.partnerNames \|\| \[\]\)\.join\(' \/ '\)/);
  assert.match(html, /class="widget player-profile-widget player-profile-relationships"[\s\S]*id="player-profile-relationships"/);
  assert.match(html, /id="player-profile-relationships-heading"[\s\S]*Mitspieler &amp; Gegner/);
  assert.match(app, /const eligible = \(records, minimumMatches = 3\)/);
  assert.match(app, /record\.matches >= minimumMatches/);
  assert.match(app, /heading\.hidden = relationships\.length > 0/);
  assert.match(app, /Noch keine Wertung – sie zählt ab 3 gemeinsamen Partien/);
  assert.match(style, /#player-profile-relationships\.has-results \{ margin-top: 0; \}/);
  assert.match(app, /\['Erfolgspartner', leaders\.favoritePartners/);
  assert.match(app, /\['Lieblingsgegner', leaders\.favoriteOpponents/);
  assert.match(app, /\['Angstgegner', leaders\.fearedOpponents/);
  assert.match(app, /relationships\.map\(\(\[label, records, valueClass, helpText\], index\)[\s\S]*data-help-tooltip-anchor>[?]<\/span>[\s\S]*escapeHtml\(helpText\)/);
  assert.equal((app.match(/Trainings werden mitgezählt\./g) || []).length, 4);
  assert.match(app, /records\.map\(record =>/);
  assert.match(html, /<dialog class="auth-dialog" id="auth-dialog"/);
  assert.doesNotMatch(html, /player-profile-cover|player-profile-cover-image/);
  assert.doesNotMatch(app, /cover\.webp|Coverbild von/);
  assert.match(html, /<button class="modal-close-button player-profile-presentation-toggle"[\s\S]*<button class="modal-close-button player-profile-close"[\s\S]*<div class="player-profile-shell">/);
});

test('wide ranking views host the same player profile as a non-modal side panel', () => {
  assert.match(html, /class="ranking-profile-layout" id="ranking-profile-layout"/);
  assert.match(html, /class="ranking-profile-main" id="ranking-profile-main"/);
  assert.match(html, /class="ranking-profile-host" id="ranking-profile-host"/);
  assert.match(html, /class="all-time-ranking-profile-layout" id="all-time-ranking-profile-layout" data-all-time-statistic hidden/);
  assert.match(html, /class="all-time-ranking-profile-main" id="all-time-ranking-profile-main"/);
  assert.match(html, /class="ranking-profile-host" id="all-time-ranking-profile-host"/);
  assert.match(html, /id="player-profile-modal-host"/);
  assert.match(html, /id="player-profile-panel-status" role="status" aria-live="polite"/);
  assert.match(app, /const PLAYER_PROFILE_PANEL_BREAKPOINT = 1100;/);
  assert.match(app, /const PLAYER_PROFILE_PANEL_RANKING_WIDTH = 540;/);
  assert.match(app, /const PLAYER_PROFILE_PANEL_MIN_WIDTH = 460;/);
  assert.doesNotMatch(app, /PLAYER_PROFILE_PANEL_MAX_WIDTH|player-profile-panel-width/);
  assert.match(app, /function hasPlayerProfilePanelSpace\(\)[\s\S]*?layoutViewportWidth - PLAYER_PROFILE_PANEL_OUTER_GUTTER >= requiredWidth/);
  assert.match(app, /const splitLeft = Math\.max\(\s*0,\s*Math\.min\(standardContentLeft, latestPossibleLeft\)/);
  assert.match(app, /dialog\.show\(\)/);
  assert.match(app, /dialog\.showModal\(\)/);
  assert.match(app, /let playerProfilePresentationPreference = null;/);
  assert.match(app, /const PLAYER_PROFILE_PRESENTATION_STORAGE_TTL = 30 \* 24 \* 60 \* 60 \* 1000;/);
  assert.match(app, /function shouldUsePlayerProfilePanel\(\)[\s\S]*?playerProfilePresentationPreference === 'panel'/);
  assert.match(app, /if \(!profileWasOpen\) playerProfilePresentationPreference = getStoredPlayerProfilePresentation\(\);/);
  assert.match(app, /function updatePlayerProfilePresentationToggle\(\)[\s\S]*?Profil als Seitenpanel öffnen[\s\S]*?Profil als Modal öffnen[\s\S]*?toggle\.hidden = !canToggle;/);
  assert.match(app, /function togglePlayerProfilePresentation\(\)[\s\S]*?playerProfilePresentation === 'panel' \? 'modal' : 'panel'[\s\S]*?playerProfilePresentationPreference = nextPresentation;[\s\S]*?storePlayerProfilePresentation\(nextPresentation\);[\s\S]*?movePlayerProfileDialog\(nextPresentation/);
  assert.match(app, /presentationPreference: playerProfilePresentationPreference/);
  assert.match(app, /playerProfilePresentationPreference = \['panel', 'modal'\]\.includes\(snapshot\.presentationPreference\)/);
  assert.match(app, /presentation === 'panel'[\s\S]*?'\.player-profile-elo-panel'[\s\S]*?'\.player-profile-participations-panel'[\s\S]*?'\.player-profile-history'[\s\S]*?'\.player-profile-relationships'/);
  assert.match(app, /scrollTop: getPlayerProfileShellScrollTop\(\)/);
  assert.match(app, /function cancelPlayerProfileCloseTransition[\s\S]*?document\.body\.classList\.add\('player-profile-panel-open'\)/);
  assert.match(app, /const PLAYER_PROFILE_ROW_SELECTOR = '#rangliste tr\[data-player-profile-id\], #all-time-ranking-table tr\[data-player-profile-id\]';/);
  assert.match(app, /playerProfileOpenControl\.matches\(PLAYER_PROFILE_ROW_SELECTOR\)[\s\S]*?!playerProfileRow \|\| !rowClickHitsControl[\s\S]*?openPlayerProfile\(playerProfileOpenControl\.dataset\.playerProfileId, playerProfileOpenControl\)/);
  assert.match(app, /data-profile-player-id="\$\{escapeHtml\(p\.id \|\| ''\)\}" data-player-profile-id="\$\{escapeHtml\(p\.id \|\| ''\)\}" tabindex="0" role="link" aria-label="Profil von \$\{escapeHtml\(p\.name\)\} öffnen"/);
  assert.match(app, /data-profile-player-id="\$\{escapeHtml\(player\.id \|\| ''\)\}" data-player-profile-id="\$\{escapeHtml\(player\.id \|\| ''\)\}" tabindex="0" role="link" aria-label="Profil von \$\{escapeHtml\(player\.name\)\} öffnen"/);
  assert.match(app, /event\.target === playerProfileRow && \(event\.key === 'Enter' \|\| event\.key === ' '\)[\s\S]*?openPlayerProfile\(playerProfileRow\.dataset\.playerProfileId, playerProfileRow\)/);
  assert.match(app, /function getPlayerProfilePanelContext\(\)[\s\S]*?hostId: 'ranking-profile-host'[\s\S]*?hostId: 'all-time-ranking-profile-host'/);
  assert.match(app, /panelContext\?\.id === 'all-time-ranking' && !profileWasOpen && !opensFromAllTimeRanking/);
  assert.match(app, /const keepsPanelContext = \(panelContext === 'ranking' && id === 'rangliste'\)[\s\S]*?panelContext === 'all-time-ranking' && id === 'verlauf'/);
  assert.match(app, /nextMode !== statisticsMode && playerProfilePresentation === 'panel'[\s\S]*?closePlayerProfile\(\{ immediate: true, restoreFocus: false \}\)/);
  assert.match(app, /closePlayerProfile\(\{ immediate: true, restoreFocus: false \}\)/);
  assert.match(style, /body\.player-profile-panel-open\[data-player-profile-panel-context="ranking"\] main \{[\s\S]*?margin-right: 16px;/);
  assert.match(style, /body\.player-profile-panel-open\[data-player-profile-panel-context="ranking"\] \.ranking-profile-layout \{[\s\S]*?grid-template-columns: 540px minmax\(460px, 1fr\);[\s\S]*?gap: 24px;/);
  assert.match(style, /body\.player-profile-panel-open\[data-player-profile-panel-context="all-time-ranking"\] \.all-time-ranking-profile-layout \{[\s\S]*?width: calc\(100vw - var\(--ranking-profile-split-left, 16px\) - 16px\);[\s\S]*?grid-template-columns: 540px minmax\(460px, 1fr\)/);
  assert.match(style, /body\.player-profile-panel-open :is\(#ranking-profile-main, #all-time-ranking-profile-main\) table\.rt th,[\s\S]*?padding-left: 8px;[\s\S]*?padding-right: 8px;/);
  assert.match(style, /body\.player-profile-panel-open :is\(#ranking-profile-main, #all-time-ranking-profile-main\) \.ranking-table \.col-name \{[\s\S]*?width: 178px;/);
  assert.match(style, /body\.player-profile-panel-open :is\(#ranking-profile-main, #all-time-ranking-profile-main\) table\.rt th\.col-rank,[\s\S]*?padding-left: 12px;[\s\S]*?padding-right: 4px;/);
  assert.match(style, /\.player-profile-dialog\[data-presentation="panel"\] \.player-profile-stats \{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(style, /\.player-profile-dialog\[data-presentation="panel"\] \.player-profile-match \{[\s\S]*?grid-template-columns: 30px minmax\(0, 1fr\) auto;/);
  assert.match(style, /\.player-profile-dialog \{[\s\S]*?--player-profile-max-width: 1200px;[\s\S]*?width: min\(calc\(100vw - 28px\), var\(--player-profile-max-width\)\);/);
  assert.match(style, /\.player-profile-dialog\[data-presentation="panel"\] \{[\s\S]*?max-width: var\(--player-profile-max-width\);[\s\S]*?container: player-profile-panel \/ inline-size;/);
  assert.match(style, /@container player-profile-panel \(min-width: 600px\) \{[\s\S]*?\.player-profile-match-teams \{[\s\S]*?flex-direction: row;[\s\S]*?\.player-profile-match-score \{[\s\S]*?min-height: 0;/);
  assert.match(style, /@container player-profile-panel \(min-width: 760px\) \{[\s\S]*?grid-template-columns: 64px 32px minmax\(0, 1fr\) 132px 84px;[\s\S]*?flex-direction: row;/);
  assert.match(style, /@container player-profile-panel \(min-width: 1100px\) \{[\s\S]*?\.player-profile-content \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(style, /@container player-profile-panel \(min-width: 1100px\) \{[\s\S]*?\.player-profile-relationships \{[\s\S]*?grid-column: 1;[\s\S]*?\.player-profile-history \{[\s\S]*?grid-column: 2 \/ 4;/);
  assert.match(style, /@container player-profile-panel \(min-width: 1100px\) \{[\s\S]*?\.player-profile-stats \{[\s\S]*?grid-template-columns: repeat\(8, minmax\(0, 1fr\)\);/);
  assert.match(style, /tr\.profile-open-highlight td \{[\s\S]*?var\(--accent\)/);
  assert.match(style, /#rangliste table\.rt tbody tr\[data-profile-player-id\],[\s\S]*?#all-time-ranking-table tbody tr\[data-profile-player-id\] \{ cursor: pointer; \}/);
  assert.match(style, /\.player-profile-presentation-toggle \{ right: 68px; \}/);
  assert.match(style, /\.player-profile-dialog\[data-presentation="panel"\] \.player-profile-presentation-toggle \{ right: 60px; \}/);
  assert.match(style, /html\.is-detail-embed body > :not\(dialog\):not\(#player-profile-modal-host\)/);
});

test('player profile panel requires both the desktop breakpoint and the real split width', () => {
  const constants = app.match(/const PLAYER_PROFILE_PANEL_BREAKPOINT = 1100;[\s\S]*?const PLAYER_PROFILE_PANEL_OUTER_GUTTER = 16;/)?.[0] || '';
  const spaceFunction = app.match(/function hasPlayerProfilePanelSpace[\s\S]*?(?=\nfunction shouldUsePlayerProfilePanel)/)?.[0] || '';
  const context = {
    window: { innerWidth: 1099 },
    document: { documentElement: { clientWidth: 1099 } },
    result: null
  };
  vm.createContext(context);
  vm.runInContext(`${constants}\n${spaceFunction}`, context);

  context.result = vm.runInContext('hasPlayerProfilePanelSpace()', context);
  assert.equal(context.result, false);
  context.window.innerWidth = 1100;
  context.document.documentElement.clientWidth = 1100;
  assert.equal(vm.runInContext('hasPlayerProfilePanelSpace()', context), true);
  context.document.documentElement.clientWidth = 1039;
  assert.equal(vm.runInContext('hasPlayerProfilePanelSpace()', context), false);
});

test('player profile presentation preference is stored for 30 days and then expires', () => {
  const constants = app.match(
    /const PLAYER_PROFILE_PRESENTATION_STORAGE_KEY[\s\S]*?const PLAYER_PROFILE_PRESENTATION_STORAGE_TTL = 30 \* 24 \* 60 \* 60 \* 1000;/
  )?.[0] || '';
  const helpers = app.match(
    /function getStoredPlayerProfilePresentation[\s\S]*?(?=\nfunction shouldUsePlayerProfilePanel)/
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

  assert.equal(vm.runInContext('getStoredPlayerProfilePresentation()', context), null);
  vm.runInContext("storePlayerProfilePresentation('panel')", context);
  assert.equal(vm.runInContext('getStoredPlayerProfilePresentation()', context), 'panel');
  assert.equal(
    JSON.parse(values.get('padel-liga-player-profile-presentation')).expiresAt,
    now + 30 * 24 * 60 * 60 * 1000
  );

  now += 30 * 24 * 60 * 60 * 1000 + 1;
  assert.equal(vm.runInContext('getStoredPlayerProfilePresentation()', context), null);
  assert.equal(values.has('padel-liga-player-profile-presentation'), false);

  values.set('padel-liga-player-profile-presentation', '{broken');
  assert.equal(vm.runInContext('getStoredPlayerProfilePresentation()', context), null);
  assert.equal(values.has('padel-liga-player-profile-presentation'), false);
});

test('player profiles sort achievements by value and recency and show at most four badges', () => {
  const achievements = [
    { id: 1, kind: 'final_four', achievedOn: '2026-06-01' },
    { id: 2, kind: 'winner', achievedOn: '2025-12-01' },
    { id: 3, kind: 'custom', achievedOn: '2028-01-01' },
    { id: 4, kind: 'winner', achievedOn: '2026-08-01' },
    { id: 5, kind: 'finalist', achievedOn: '2027-07-01' },
    { id: 6, kind: 'final_four', achievedOn: '2027-06-01' }
  ];

  assert.deepEqual(evaluateAchievementHighlights([]), []);
  assert.deepEqual(evaluateAchievementHighlights(achievements).map(item => item.id), [4, 2, 5, 6]);
  assert.deepEqual(achievements.map(item => item.id), [1, 2, 3, 4, 5, 6]);
});

test('profile summary derives win rate and game difference per weighted match', () => {
  assert.deepEqual(evaluateProfileSummaryFormats(6, 10, 24), {
    winRate: '60 %',
    gameDiffPerMatch: '+2,4'
  });
  assert.deepEqual(evaluateProfileSummaryFormats(2.5, 4, -10), {
    winRate: '63 %',
    gameDiffPerMatch: '-2,5'
  });
  assert.deepEqual(evaluateProfileSummaryFormats(0, 2, 0), {
    winRate: '0 %',
    gameDiffPerMatch: '0,0'
  });
  assert.deepEqual(evaluateProfileSummaryFormats(0, 0, 0), {
    winRate: '—',
    gameDiffPerMatch: '—'
  });
});

test('profile summary shows the longest cross-league winning streak without training', () => {
  assert.deepEqual(evaluateLongestProfileWinStreak([
    { id: 'new-3', kind: 'league', outcome: 'win', isComplete: true },
    { id: 'training', kind: 'training', outcome: 'loss', isComplete: true },
    { id: 'new-2', kind: 'final-four', outcome: 'win', isComplete: true },
    { id: 'new-1', kind: 'league', outcome: 'win', isComplete: true },
    { id: 'break', kind: 'league', outcome: 'loss', isComplete: true },
    { id: 'old-2', kind: 'league', outcome: 'win', isComplete: true },
    { id: 'old-1', kind: 'league', outcome: 'win', isComplete: true }
  ]), { length: 3, label: '3<span class="player-profile-stat-fraction"> Siege</span>' });
  assert.deepEqual(evaluateLongestProfileWinStreak([
    { id: 'cancelled', kind: 'league', outcome: 'unfinished', isCancelled: true },
    { id: 'win-2', kind: 'league', outcome: 'win', isComplete: true },
    { id: 'win-1', kind: 'league', outcome: 'win', isComplete: true }
  ]), { length: 2, label: '2<span class="player-profile-stat-fraction"> Siege</span>' });
  assert.deepEqual(evaluateLongestProfileWinStreak([
    { id: 'only-win', kind: 'league', outcome: 'win', isComplete: true }
  ]), { length: 1, label: '1<span class="player-profile-stat-fraction"> Sieg</span>' });
  assert.deepEqual(evaluateLongestProfileWinStreak([
    { id: 'only-loss', kind: 'league', outcome: 'loss', isComplete: true }
  ]), { length: 0, label: '—' });
});

test('profile participations show the newest season first', () => {
  const participations = [
    { seasonId: '2026-sommer', seasonLabel: 'Sommer 2026', isActive: true },
    { seasonId: '2026-winter', seasonLabel: 'Winter 2026', isActive: false }
  ];
  const seasons = [
    { id: '2026-sommer', startDate: '2026-05-11' },
    { id: '2026-winter', startDate: '2026-10-01' }
  ];

  assert.deepEqual(
    evaluateParticipationOrder(participations, seasons).map(participation => participation.seasonId),
    ['2026-winter', '2026-sommer']
  );
  assert.deepEqual(participations.map(participation => participation.seasonId), ['2026-sommer', '2026-winter']);
});

test('profile only marks an active and unfinished season as ongoing', () => {
  assert.equal(evaluateParticipationActive({ isActive: true }, { completedAt: null }), true);
  assert.equal(evaluateParticipationActive({ isActive: true }, { completedAt: '2026-10-15T20:00:00Z' }), false);
  assert.equal(evaluateParticipationActive({ isActive: false }, { completedAt: null }), false);
});

test('profile participation overview ends with weighted training statistics', () => {
  const participationStatsRenderer = app.match(/function renderPlayerProfileParticipationStats[\s\S]*?(?=\nfunction renderPlayerProfileParticipations)/)?.[0] || '';
  assert.match(participationStatsRenderer, /const matches = escapeHtml\(formatProfileMatchCount\(participation\.matches\)\)/);
  assert.match(participationStatsRenderer, /const middle = escapeHtml\(formatProfileMatchCount\(middleValue\)\)/);
  assert.doesNotMatch(participationStatsRenderer, /renderProfileMatchCount/);
  assert.match(app, /renderPlayerProfileParticipationStats\(participation, 'Punkte', participation\.points\)/);
  assert.match(app, /const trainingRow = training\.matches > 0 \? `[\s\S]*?Trainings[\s\S]*?renderPlayerProfileParticipationStats\(training, 'Siege', training\.wins\)[\s\S]*?` : ''/);
  assert.match(app, /target\.innerHTML = seasonRows \+ trainingRow/);
  assert.match(style, /\.player-profile-training-participation \{ --profile-season-color: var\(--dim\); \}/);
  assert.match(style, /\.player-profile-training-participation \.stat-meta-line \{ grid-column: 1 \/ -1; \}/);
  assert.deepEqual(evaluateTrainingParticipation([
    {
      kind: 'training', matchWeight: 1, winWeight: 1, team: 1,
      resultDetails: '6:4, 4:6 – 10:7'
    },
    {
      kind: 'training', matchWeight: 0.5, winWeight: 0, team: 2,
      resultDetails: '6:2, 4:3'
    },
    { kind: 'league', matchWeight: 1, winWeight: 1, team: 1, resultDetails: '6:0, 6:0' }
  ]), { matches: 1.5, wins: 1, gameDiff: -4 });
});

test('profile season overview separates league and qualified final-round results', () => {
  assert.match(app, /const leagueRank = participation\.rank \? `\$\{participation\.rank\}\.` : '—'/);
  assert.match(app, /player-profile-participation-phase-content">[\s\S]*?player-profile-participation-phase-heading">Ligaphase<\/div>[\s\S]*?renderPlayerProfileParticipationStats\(participation, 'Punkte', participation\.points\)[\s\S]*?player-profile-participation-phase-result player-profile-participation-placement \$\{leagueRankClass\}">\$\{leagueRank\}/);
  assert.match(app, /const finalRoundLabel = finalRound\?\.placement \? `\$\{finalRound\.label\}\.` : finalRound\?\.label/);
  assert.match(app, /player-profile-participation-phase-heading">Finalrunde<\/div>[\s\S]*?renderPlayerProfileParticipationStats\(finalRound, 'Siege', finalRound\.wins\)[\s\S]*?player-profile-participation-phase-result[\s\S]*?\$\{escapeHtml\(finalRoundLabel\)\}/);
  assert.match(app, /participation\.isActive \? '<em class="player-profile-participation-status">Laufend<\/em>' : ''/);
  assert.match(style, /\.player-profile-participation-status \{[\s\S]*?color: var\(--dim\);[\s\S]*?font-size: var\(--text-sm\);[\s\S]*?font-style: italic;/);
  assert.match(style, /\.player-profile-participation-phase \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*?align-items: center;/);
  assert.match(style, /\.player-profile-participation-phase-result\.player-profile-participation-placement \{[\s\S]*?font-family: var\(--font-heading\);[\s\S]*?font-size: var\(--text-heading\);[\s\S]*?line-height: 1;/);
  assert.match(app, /renderPlayerProfileParticipationStats\(participation, 'Punkte', participation\.points\)/);
  assert.match(app, /renderPlayerProfileParticipationStats\(finalRound, 'Siege', finalRound\.wins\)/);
  assert.match(app, /getPlayerProfileSeasonPayload\(participation\.seasonId\)/);
  assert.match(app, /isActive: isPlayerProfileParticipationActive\(participation, payloads\[index\]\)/);

  const team = (teamOne, teamTwo) => ({
    team1: { playerIds: teamOne },
    team2: { playerIds: teamTwo }
  });
  const matches = [
    { id: 'semi-1', stage: 'semifinal', winner: 1, result: '6:0, 6:0', ...team(['p1', 'p2'], ['p5', 'p6']) },
    { id: 'semi-2', stage: 'semifinal', winner: 1, result: '6:2, 6:2', ...team(['p3', 'p4'], ['p7', 'p8']) },
    { id: 'final-1', stage: 'final-four', matchday: 2, winner: 1, result: '6:3', ...team(['p1', 'p2'], ['p3', 'p4']) },
    { id: 'final-2', stage: 'final-four', matchday: 2, winner: 1, result: '6:4', ...team(['p1', 'p4'], ['p2', 'p3']) },
    { id: 'final-3', stage: 'final-four', matchday: 2, winner: 2, result: '2:6', ...team(['p1', 'p3'], ['p2', 'p4']) }
  ];

  assert.deepEqual(evaluateFinalRoundOverview(matches, 'p1'), {
    matches: 2.5,
    wins: 2,
    gameDiff: 13,
    label: '3',
    placement: 3,
    stage: 'final-four'
  });
  assert.deepEqual(evaluateFinalRoundOverview([
    { id: 'semi-open', stage: 'semifinal', winner: null, result: null, ...team(['p7', 'p8'], ['p1', 'p2']) }
  ], 'p1'), {
    matches: 0,
    wins: 0,
    gameDiff: 0,
    label: 'HF',
    placement: null,
    stage: 'semifinal'
  });
  assert.deepEqual(evaluateFinalRoundOverview([
    { id: 'final-open', stage: 'final-four', winner: null, result: null, ...team(['p1', 'p2'], ['p3', 'p4']) }
  ], 'p1'), {
    matches: 0,
    wins: 0,
    gameDiff: 0,
    label: 'F4',
    placement: null,
    stage: 'final-four'
  });
  assert.equal(evaluateFinalRoundOverview(matches, 'p9'), null);
});

test('player names open profiles by stable id and team cards no longer apply presets', () => {
  assert.match(app, /data-player-profile-id="\$\{escapeHtml\(playerId\)\}"/);
  assert.match(app, /player\?\.id \|\| getPlayerIdByName\(playerName\)/);
  assert.match(app, /function renderTeamPlayers\(players\)/);
  assert.doesNotMatch(app, /class="calculator-match-team" role="button"/);
});

test('all player names in statistic facts open the public profile', () => {
  const rankingDeviation = app.match(/function renderRankingDeviationFact[\s\S]*?(?=\nfunction getMatchLeaguePoints)/)?.[0] || '';
  const finalFourForecast = app.match(/function renderFinalFourForecast[\s\S]*?(?=\nfunction formatAverageMatchTime)/)?.[0] || '';
  const timePerformance = app.match(/function renderTimePerformance[\s\S]*?(?=\nfunction renderSetDominance)/)?.[0] || '';
  const setDominance = app.match(/function renderSetDominance[\s\S]*?(?=\nfunction renderDominantMatches)/)?.[0] || '';
  const dominantMatches = app.match(/function renderDominantMatches[\s\S]*?(?=\nfunction renderBiggestUpsets)/)?.[0] || '';
  const biggestUpsets = app.match(/function renderBiggestUpsets[\s\S]*?(?=\nfunction renderStatistik)/)?.[0] || '';
  const statTeamPlayers = app.match(/function renderStatTeamPlayers[\s\S]*?(?=\nfunction getWinnerTeam)/)?.[0] || '';

  assert.match(rankingDeviation, /renderPlayerProfileLink\(item\.player/);
  assert.match(finalFourForecast, /renderPlayerProfileLink\(item\.player/);
  assert.equal((timePerformance.match(/renderPlayerProfileLink\(/g) || []).length, 2);
  assert.match(setDominance, /renderPlayerProfileLink\(item\.player/);
  assert.match(dominantMatches, /renderStatTeamPlayers\(getWinnerTeam\(item\.match\)\)/);
  assert.match(biggestUpsets, /renderStatTeamPlayers\(getWinnerTeam\(item\.match\)\)/);
  assert.match(statTeamPlayers, /renderTeamPlayers\(players\)/);
});

test('profile relationship leaders require three matches and use win rate', () => {
  assert.match(app, /const parts = \[\s*`\$\{formatProfileMatchCount\(record\.matches\)\} Partien`,\s*`\$\{formatProfileMatchCount\(record\.wins\)\}/);
  assert.match(app, /\['Angstpartner', leaders\.fearedPartners, 'neg'/);
  const leaders = evaluateRelationshipLeaders([
    { outcome: 'win', partnerNames: ['Partner A', 'Partner A'], opponentNames: ['Gegner X'] },
    { outcome: 'win', partnerNames: ['Partner A'], opponentNames: ['Gegner X'] },
    { outcome: 'loss', partnerNames: ['Partner A'], opponentNames: ['Gegner X'] },
    { outcome: 'loss', partnerNames: ['Partner B'], opponentNames: ['Gegner W'] },
    { outcome: 'loss', partnerNames: ['Partner B'], opponentNames: ['Gegner W'] },
    { outcome: 'draw', partnerNames: ['Partner B'], opponentNames: ['Gegner W'] },
    { outcome: 'win', partnerNames: ['Partner C'], opponentNames: ['Gegner Y'] },
    { outcome: 'win', partnerNames: ['Partner C'], opponentNames: ['Gegner Y'] }
  ]);

  assert.equal(leaders.favoritePartners[0].name, 'Partner A');
  assert.equal(leaders.favoritePartners[0].matches, 3);
  assert.equal(leaders.favoritePartners[0].wins, 2);
  assert.equal(leaders.favoriteOpponents[0].name, 'Gegner X');
  assert.equal(leaders.fearedOpponents[0].name, 'Gegner W');
  assert.equal(leaders.fearedOpponents[0].draws, 1);
  assert.notEqual(leaders.favoritePartners[0].name, 'Partner C');
  assert.notEqual(leaders.favoriteOpponents[0].name, 'Gegner Y');

  const neutralLeaders = evaluateRelationshipLeaders([
    { outcome: 'win', partnerNames: ['Partner 50'], opponentNames: ['Gegner 50'] },
    { outcome: 'win', partnerNames: ['Partner 50'], opponentNames: ['Gegner 50'] },
    { outcome: 'loss', partnerNames: ['Partner 50'], opponentNames: ['Gegner 50'] },
    { outcome: 'loss', partnerNames: ['Partner 50'], opponentNames: ['Gegner 50'] }
  ]);

  assert.equal(neutralLeaders.favoritePartners.length, 0);
  assert.equal(neutralLeaders.favoriteOpponents.length, 0);
  assert.equal(neutralLeaders.fearedOpponents.length, 0);
});

test('feared partners require three matches and a win rate below 50 percent', () => {
  const belowThreshold = evaluateRelationshipLeaders(Array.from({ length: 2 }, () => ({
    outcome: 'loss',
    partnerNames: ['Partner A'],
    opponentNames: []
  })));
  assert.equal(belowThreshold.fearedPartners.length, 0);

  const fearedPartner = evaluateRelationshipLeaders(Array.from({ length: 3 }, (_, index) => ({
    outcome: index < 1 ? 'win' : 'loss',
    partnerNames: ['Partner A'],
    opponentNames: []
  })));
  assert.equal(fearedPartner.fearedPartners[0].name, 'Partner A');
  assert.equal(fearedPartner.fearedPartners[0].matches, 3);

  const neutralPartner = evaluateRelationshipLeaders(Array.from({ length: 4 }, (_, index) => ({
    outcome: index < 2 ? 'win' : 'loss',
    partnerNames: ['Partner 50'],
    opponentNames: []
  })));
  assert.equal(neutralPartner.fearedPartners.length, 0);
});

test('profile relationship leaders include every player tied on the leading win rate', () => {
  const leaders = evaluateRelationshipLeaders([
    { outcome: 'win', partnerNames: ['Partner A', 'Partner B'], opponentNames: ['Gegner X', 'Gegner Y'] },
    { outcome: 'win', partnerNames: ['Partner A', 'Partner B'], opponentNames: ['Gegner X', 'Gegner Y'] },
    { outcome: 'loss', partnerNames: ['Partner A', 'Partner B'], opponentNames: ['Gegner X', 'Gegner Y'] },
    { outcome: 'loss', partnerNames: ['Partner C', 'Partner D'], opponentNames: ['Gegner W', 'Gegner V'] },
    { outcome: 'loss', partnerNames: ['Partner C', 'Partner D'], opponentNames: ['Gegner W', 'Gegner V'] },
    { outcome: 'win', partnerNames: ['Partner C', 'Partner D'], opponentNames: ['Gegner W', 'Gegner V'] }
  ]);

  assert.equal(leaders.favoritePartners.map(record => record.name).join(','), 'Partner A,Partner B');
  assert.equal(leaders.favoriteOpponents.map(record => record.name).join(','), 'Gegner X,Gegner Y');
  assert.equal(leaders.fearedOpponents.map(record => record.name).join(','), 'Gegner V,Gegner W');
});

test('completed training sets use separate half-weight wins and losses', () => {
  const weightedLeaders = evaluateRelationshipLeaders([
    { outcome: 'win', matchWeight: 1, partnerNames: ['Partner Gewicht'], opponentNames: ['Gegner Gewicht'] },
    { outcome: 'win', matchWeight: 1, partnerNames: ['Partner Gewicht'], opponentNames: ['Gegner Gewicht'] },
    { outcome: 'draw', matchWeight: 1, winWeight: 0.5, lossWeight: 0.5, partnerNames: ['Partner Gewicht'], opponentNames: ['Gegner Gewicht'] }
  ]);

  assert.equal(weightedLeaders.favoritePartners[0].matches, 3);
  assert.equal(weightedLeaders.favoritePartners[0].wins, 2.5);
  assert.equal(weightedLeaders.favoritePartners[0].losses, 0.5);
  assert.match(trainingCounterMigration, /training_regular_set_state\(team_one, team_two\) = 'complete'/);
  assert.match(trainingCounterMigration, /then \(private\.profile_training_metrics\(p_result_details\)\)\[1\] \* 0\.5::numeric/);
  assert.match(trainingCounterMigration, /'wins', coalesce\(\(select sum\(win_weight\) from scored_career\), 0\)/);
  assert.match(trainingCounterMigration, /'losses', coalesce\(\(select sum\(loss_weight\) from scored_career\), 0\)/);
  assert.match(trainingCounterMigration, /'matchWeight', history\.match_weight/);
  assert.match(trainingCounterMigration, /'winWeight', history\.win_weight/);
  assert.match(trainingCounterMigration, /'lossWeight', history\.loss_weight/);
  assert.match(app, /toLocaleString\('de-DE'/);
});

test('training rounds stay grouped and only incomplete score parts are dimmed', () => {
  assert.match(app, /function groupPlayerProfileMatches\(matches = \[\]\)/);
  assert.match(app, /data-profile-match-group=/);
  assert.match(app, /showDate = index === 0/);
  assert.match(app, /showGroupLabelFirst = group\.kind === 'training' \|\| group\.kind === 'final-four'/);
  assert.match(app, /showSeason = showGroupLabelFirst[\s\S]*?\? index === 0[\s\S]*?: index === group\.matches\.length - 1/);
  assert.match(app, /Number\(match\.matchWeight\) > 0/);
  assert.match(app, /player-profile-score-partial/);
  assert.match(app, /renderProfileResultDetails\(match\)/);
  assert.match(incompleteTrainingMigration, /add column if not exists is_complete boolean not null default true/);
  assert.match(incompleteTrainingMigration, /set_count in \(1, 2, 3\)/);
  assert.match(incompleteTrainingMigration, /set_count not in \(1, 2, 3\)/);
  assert.match(trainingCounterMigration, /scored_career as \([\s\S]*?select \* from career where match_weight > 0/);
  assert.match(incompleteTrainingMigration, /'trainingSessionId', history\.training_session_id/);
  assert.match(incompleteTrainingMigration, /'trainingRoundNumber', history\.training_round_number/);
});

test('Final4 profile matches form one half-weight league-styled group', () => {
  assert.match(app, /function getPlayerProfileFinalFourId\(match\)/);
  assert.match(app, /finalFourGroups = new Map\(\)/);
  assert.match(app, /group\.kind === 'final-four'/);
  assert.match(app, /return seasonCode \? `FINAL4 \$\{seasonCode\}` : 'FINAL4'/);
  assert.match(app, /kind === 'final-four' \? 0\.5 : 1/);
  assert.match(app, /showDate = index === 0/);
  assert.match(app, /showGroupLabelFirst = group\.kind === 'training' \|\| group\.kind === 'final-four'/);
  assert.doesNotMatch(style, /player-profile-match-group\.final-four \.player-profile-match-outcome/);
  assert.match(finalFourProfileMigration, /match\.competition_stage = 'final_four' then 'final-four'/);
  assert.match(finalFourProfileMigration, /when p_kind = 'final-four' then 0\.5::numeric/);
  assert.match(finalFourProfileMigration, /source\.kind = 'final-four' and source\.outcome = 'win' then 0\.5::numeric/);
  assert.match(finalFourProfileMigration, /source\.kind = 'final-four' and source\.outcome = 'loss' then 0\.5::numeric/);
});

test('profile results use consistent separators and de-emphasize set tiebreaks', () => {
  const leagueResult = evaluateProfileResultDetails({
    kind: 'league',
    resultDetails: '7:6 (7:4), 6:7 (8:10) – 10:6',
    team: 1
  });
  const trainingResult = evaluateProfileResultDetails({
    kind: 'training',
    resultDetails: '6:4, 6:3, 4:2',
    team: 1
  });
  const oneSetResult = evaluateProfileResultDetails({
    kind: 'training',
    resultDetails: '6:2',
    team: 1
  });

  assert.equal(
    leagueResult,
    '<span class="player-profile-result"><span class="player-profile-score-set">7:6 <span class="player-profile-set-tiebreak">(7:4)</span></span><span class="player-profile-score-divider">,</span> <span class="player-profile-score-set">6:7 <span class="player-profile-set-tiebreak">(8:10)</span></span> <span class="player-profile-score-divider">–</span> <span class="player-profile-match-tiebreak">10:6</span></span>'
  );
  assert.equal(
    trainingResult,
    '<span class="player-profile-result"><span class="player-profile-score-set">6:4</span><span class="player-profile-score-divider">,</span> <span class="player-profile-score-set">6:3</span><span class="player-profile-score-divider">,</span> <span class="player-profile-score-set player-profile-score-partial">4:2</span></span>'
  );
  assert.equal(
    oneSetResult,
    '<span class="player-profile-result"><span class="player-profile-score-set">6:2</span></span>'
  );
  assert.match(style, /\.player-profile-set-tiebreak \{ font-size: var\(--text-xs\); \}/);
});

test('only training result circles use outcome-colored outlines', () => {
  assert.match(style, /\.player-profile-match-group\.training \.player-profile-match-outcome \{[^}]*border: 2px solid currentColor;[^}]*background: transparent;/);
  assert.match(style, /\.player-profile-match-group\.training \.player-profile-match-outcome\.win \{ color: var\(--positiv\); \}/);
  assert.match(style, /\.player-profile-match-group\.training \.player-profile-match-outcome\.loss \{ color: var\(--negativ\); \}/);
  assert.match(style, /\.player-profile-match-group\.training \.player-profile-match-outcome\.draw,[\s\S]*\.player-profile-match-group\.training \.player-profile-match-outcome\.unfinished \{ color: var\(--dim\); \}/);
  assert.match(style, /\.player-profile-match-outcome \{[\s\S]*background: var\(--positiv\);[\s\S]*color: #07100d;/);
});

test('historical trainings preserve sessions, match tiebreaks, and the unfinished round', () => {
  assert.equal((historicalTrainingMigration.match(/insert into public\.training_sessions/g) || []).length, 5);
  assert.match(historicalTrainingMigration, /date '2025-09-19', time '07:00'/);
  assert.match(historicalTrainingMigration, /date '2026-04-23', time '12:30'/);
  assert.equal((historicalTrainingMigration.match(/date '2026-07-02', time '12:30'/g) || []).length, 2);
  assert.match(historicalTrainingMigration, /date '2026-08-13', time '08:00'/);
  assert.match(historicalTrainingMigration, /'6:3, 4:6 – 10:5', 3, true/);
  assert.match(historicalTrainingMigration, /'3:1', 1, false/);
  assert.match(historicalTrainingMigration, /array\['andreas_l', 'luca_w'\], array\['niklas_k', 'chris_m'\]/);
  assert.match(correctedLotzMigration, /array_replace\(player_ids, 'andreas_l', 'christoph_l'\)/);
  assert.match(correctedLotzMigration, /array_replace\(team_one_ids, 'andreas_l', 'christoph_l'\)/);
});

test('the September 2025 training correction mirrors all three set results', () => {
  assert.match(correctedSeptember2025TrainingMigration, /date '2025-09-19'/);
  assert.match(correctedSeptember2025TrainingMigration, /time '07:00'/);
  assert.match(correctedSeptember2025TrainingMigration, /round\.team_one_ids = array\['raphael_h', 'marco_m'\]::text\[\]/);
  assert.match(correctedSeptember2025TrainingMigration, /round\.team_two_ids = array\['ludwig_w', 'luca_w'\]::text\[\]/);
  assert.match(correctedSeptember2025TrainingMigration, /set result_details = '0:6, 4:6, 4:6'/);
  assert.match(correctedSeptember2025TrainingMigration, /round\.result_details = '6:0, 6:4, 6:4'/);
});

test('September trainings preserve completed and partial set weighting', () => {
  assert.match(septemberTrainingMigration, /date '2026-09-02', time '17:00'/);
  assert.match(septemberTrainingMigration, /array\['marco_m', 'andreas_l'\], array\['greta_p', 'niklas_k'\],[\s\S]*?'6:1', 1, true, 'one_set'/);
  assert.match(septemberTrainingMigration, /array\['greta_p', 'andreas_l'\], array\['niklas_k', 'marco_m'\],[\s\S]*?'6:1', 1, true, 'one_set'/);
  assert.match(septemberTrainingMigration, /array\['niklas_k', 'andreas_l'\], array\['greta_p', 'marco_m'\],[\s\S]*?'4:3', 1, false, 'one_set'/);
  assert.match(septemberTrainingMigration, /date '2026-09-08', time '12:15'/);
  assert.match(septemberTrainingMigration, /array\['marco_m', 'ludwig_w'\], array\['marcel_m', 'jonas_l'\],[\s\S]*?'6:4, 6:3, 4:2', 3, false, 'three_sets'/);
});

test('a completed training match tiebreak resolves the full match outcome', () => {
  assert.match(trainingMatchTiebreakMigration, /set_summary\.completed_count = 2/);
  assert.match(trainingMatchTiebreakMigration, /set_summary\.team_one_wins = 1/);
  assert.match(trainingMatchTiebreakMigration, /set_summary\.team_two_wins = 1/);
  assert.match(trainingMatchTiebreakMigration, /private\.training_tiebreak_state\([\s\S]*?10[\s\S]*?\) = 'complete'/);
  assert.match(trainingMatchTiebreakMigration, /match_tiebreak_team_one > match_tiebreak_team_two then 2 else 0/);
  assert.match(trainingMatchTiebreakMigration, /match_tiebreak_team_two > match_tiebreak_team_one then 2 else 0/);
  assert.match(trainingMatchTiebreakMigration, /team_one_games,[\s\S]*?team_two_games/);
});

test('calculator presets are rendered on both probability buttons', () => {
  assert.match(app, /function renderCalculatorProbabilityButton\(match, teamIndex, probability\)/);
  assert.match(app, /data-calculator-preset-team="\$\{teamIndex\}"/);
  assert.match(app, /renderCalculatorProbabilityButton\(match, 0, probability\.team1\)/);
  assert.match(app, /renderCalculatorProbabilityButton\(match, 1, probability\.team2\)/);
  assert.match(app, /entry\.tb = \['', ''\]/);
});

test('profile data excludes the test season and includes confirmed training rounds', () => {
  assert.match(profileMigration, /set counts_for_profile = false\s+where id = 'test-2026'/);
  assert.match(profileMigration, /where session\.status = 'confirmed'/);
  assert.match(profileMigration, /'training'::text as kind/);
  assert.match(profileMigration, /when .* = .* then 'draw'/s);
});

test('Sommer 2026 import matches the current static source dimensions', () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'data/data-2026-sommer.js'), 'utf8'), context);
  const season = context.window.PADEL_SEASON;

  assert.equal(season.players.length, 18);
  assert.equal(season.matches.length, 30);
  assert.equal(season.matches.filter(match => match.sieger !== null).length, 22);
  assert.equal(
    season.players.reduce((total, player) => total + Math.max(0, player.history.length - 1), 0),
    88
  );
  assert.match(importMigration, /<> 18/);
  assert.match(importMigration, /<> 30/);
  assert.match(importMigration, /<> 22/);
  assert.match(importMigration, /<> 108/);
  assert.match(importMigration, /<> 88/);
});

test('Sommer 2026 label and confirmed profile achievements stay explicit', () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'data/data-2026-sommer.js'), 'utf8'), context);

  assert.equal(context.window.PADEL_SEASON.id, '2026-sommer');
  assert.equal(context.window.PADEL_SEASON.label, 'Sommer 2026');
  assert.equal(context.window.PADEL_SEASON.title, 'PadelLiga Sommer 2026');
  assert.match(importMigration, /'Sommer 2026'/);
  assert.match(achievementMigration, /from \(values \('luca_w'\), \('marco_m'\)\)/);
  assert.match(achievementMigration, /'Final 4 Teilnehmer'/);
  assert.match(achievementMigration, /'Padel-Liga Sommer 2026'/);
  assert.match(winnerAchievementMigration, /'marcel_m'/);
  assert.match(winnerAchievementMigration, /'winner'/);
  assert.match(winnerAchievementMigration, /'Gewinner'/);
  assert.match(winnerAchievementMigration, /'Padel-Liga Sommer 2026'/);
});
