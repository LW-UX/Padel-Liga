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

function evaluateParticipationOrder(participations, seasons) {
  const functionSource = app.match(
    /function orderPlayerProfileParticipations\(participations = \[\], seasons = getSeasonOptions\(\)\) \{[\s\S]*?\n\}/
  );
  assert.ok(functionSource, 'profile participation ordering helper should be present');
  const context = { participations, seasons, result: null };
  vm.createContext(context);
  vm.runInContext(
    `${functionSource[0]}\nresult = orderPlayerProfileParticipations(participations, seasons);`,
    context
  );
  return JSON.parse(JSON.stringify(context.result));
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
  assert.match(html, /<dialog class="player-profile-dialog" id="player-profile-dialog" aria-labelledby="player-profile-name">/);
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
  assert.match(app, /const labels = series\.map\(item => formatProfileDate\(item\.date\)\)/);
  assert.doesNotMatch(app, /const labels = series\.map\(item => item\.label/);
  assert.match(app, /function renderProfileMatchCount\(value\)[\s\S]*?player-profile-stat-fraction/);
  assert.match(app, /renderProfileMatchCount\(summary\.matches\), 'Partien', '', true/);
  assert.match(app, /renderProfileMatchCount\(summary\.wins\).*renderProfileMatchCount\(summary\.losses\)/);
  assert.match(app, /'Partien G:V'[\s\S]*?'Siegquote'[\s\S]*?'Spiele G:V'[\s\S]*?'Spieldifferenz'[\s\S]*?'Ø Spieldifferenz'/);
  assert.match(app, /'Ø Spieldifferenz', gameDiffPerMatch > 0 \? 'positive' : ''/);
  assert.match(style, /\.player-profile-stat-fraction \{ font-size: 0\.58em; \}/);
  assert.match(style, /\.player-profile-stats \{[\s\S]*?grid-template-columns: repeat\(7, minmax\(0, 1fr\)\);/);
  assert.match(style, /\.player-profile-stat:first-child \{ grid-column: 1 \/ -1; border-right: 0; \}/);
  assert.doesNotMatch(style, /\.player-profile-stat:last-child \{ grid-column: 1 \/ -1;/);
  assert.match(html, /id="player-profile-avatar-placeholder"/);
  assert.match(app, /identity\.profileEmoji \|\| knownPlayer\?\.profileEmoji/);
  assert.match(app, /image\.onload = \(\) => \{\s*image\.hidden = false;\s*placeholder\.hidden = true;/);
  assert.match(players, /id: "chris_m"[^\n]+profileEmoji: "👨"/);
  assert.match(players, /id: "agnes_k"[^\n]+profileEmoji: "👩"/);
  assert.doesNotMatch(html, /data-player-profile-filter|aria-label="Partien filtern"/);
  assert.match(html, /class="secondary-button player-profile-show-all"[^>]*data-player-profile-show-all/);
  assert.match(app, /const PLAYER_PROFILE_MATCH_PREVIEW_LIMIT = 10;/);
  assert.match(app, /startDate: season\.starts_on/);
  assert.match(app, /matches\.slice\(0, PLAYER_PROFILE_MATCH_PREVIEW_LIMIT\)/);
  assert.match(app, /matches\.length <= PLAYER_PROFILE_MATCH_PREVIEW_LIMIT/);
  assert.match(style, /\.player-profile-show-all\[hidden\] \{ display: none; \}/);
  assert.match(app, /function renderPlayerProfileNames\(names = \[\], fallback = '—'\)/);
  assert.match(app, /join\('<span class="mc-player-sep">&amp;<\/span>'\)/);
  assert.match(app, /player-profile-match-team-line"><span>mit<\/span>[\s\S]*?player-profile-match-team-line"><span>vs\.<\/span>/);
  assert.match(style, /@media \(max-width: 1199px\) \{[\s\S]*?\.player-profile-match-teams \{[\s\S]*?flex-direction: column;/);
  assert.match(style, /@media \(max-width: 999px\) \{[\s\S]*?\.player-profile-match \{[\s\S]*?grid-template-columns: 34px minmax\(0, 1fr\) auto;/);
  assert.doesNotMatch(app, /\(match\.partnerNames \|\| \[\]\)\.join\(' \/ '\)/);
  assert.match(html, /class="widget player-profile-widget player-profile-relationships"[\s\S]*id="player-profile-relationships"/);
  assert.match(app, /record\.matches >= 3/);
  assert.match(app, /\['Lieblingspartner', leaders\.favoritePartner/);
  assert.match(app, /\['Lieblingsgegner', leaders\.favoriteOpponent/);
  assert.match(app, /\['Angstgegner', leaders\.fearedOpponent/);
  assert.match(html, /<dialog class="auth-dialog" id="auth-dialog"/);
  assert.doesNotMatch(html, /player-profile-cover|player-profile-cover-image/);
  assert.doesNotMatch(app, /cover\.webp|Coverbild von/);
  assert.match(html, /<\/svg>\s*<button class="modal-close-button player-profile-close"[\s\S]*<div class="player-profile-shell">/);
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

test('profile participations show the newest season first', () => {
  const participations = [
    { seasonId: '2026', seasonLabel: 'Sommer 2026', isActive: true },
    { seasonId: 'winter-2026', seasonLabel: 'Winter 2026', isActive: false }
  ];
  const seasons = [
    { id: '2026', startDate: '2026-05-11' },
    { id: 'winter-2026', startDate: '2026-10-01' }
  ];

  assert.deepEqual(
    evaluateParticipationOrder(participations, seasons).map(participation => participation.seasonId),
    ['winter-2026', '2026']
  );
  assert.deepEqual(participations.map(participation => participation.seasonId), ['2026', 'winter-2026']);
});

test('player names open profiles by stable id and team cards no longer apply presets', () => {
  assert.match(app, /data-player-profile-id="\$\{escapeHtml\(playerId\)\}"/);
  assert.match(app, /function renderTeamPlayers\(players\)/);
  assert.doesNotMatch(app, /class="calculator-match-team" role="button"/);
});

test('profile relationship leaders require three matches and use win rate', () => {
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

  assert.equal(leaders.favoritePartner.name, 'Partner A');
  assert.equal(leaders.favoritePartner.matches, 3);
  assert.equal(leaders.favoritePartner.wins, 2);
  assert.equal(leaders.favoriteOpponent.name, 'Gegner X');
  assert.equal(leaders.fearedOpponent.name, 'Gegner W');
  assert.equal(leaders.fearedOpponent.draws, 1);
  assert.notEqual(leaders.favoritePartner.name, 'Partner C');
  assert.notEqual(leaders.favoriteOpponent.name, 'Gegner Y');

  const neutralLeaders = evaluateRelationshipLeaders([
    { outcome: 'win', partnerNames: ['Partner 50'], opponentNames: ['Gegner 50'] },
    { outcome: 'win', partnerNames: ['Partner 50'], opponentNames: ['Gegner 50'] },
    { outcome: 'loss', partnerNames: ['Partner 50'], opponentNames: ['Gegner 50'] },
    { outcome: 'loss', partnerNames: ['Partner 50'], opponentNames: ['Gegner 50'] }
  ]);

  assert.equal(neutralLeaders.favoritePartner, null);
  assert.equal(neutralLeaders.favoriteOpponent, null);
  assert.equal(neutralLeaders.fearedOpponent, null);
});

test('completed training sets use separate half-weight wins and losses', () => {
  const weightedLeaders = evaluateRelationshipLeaders([
    { outcome: 'win', matchWeight: 1, partnerNames: ['Partner Gewicht'], opponentNames: ['Gegner Gewicht'] },
    { outcome: 'win', matchWeight: 1, partnerNames: ['Partner Gewicht'], opponentNames: ['Gegner Gewicht'] },
    { outcome: 'draw', matchWeight: 1, winWeight: 0.5, lossWeight: 0.5, partnerNames: ['Partner Gewicht'], opponentNames: ['Gegner Gewicht'] }
  ]);

  assert.equal(weightedLeaders.favoritePartner.matches, 3);
  assert.equal(weightedLeaders.favoritePartner.wins, 2.5);
  assert.equal(weightedLeaders.favoritePartner.losses, 0.5);
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
  assert.match(app, /showSeason = group\.kind === 'training'[\s\S]*?\? index === 0[\s\S]*?: index === group\.matches\.length - 1/);
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
  assert.match(style, /\.player-profile-set-tiebreak \{[^}]*font-size: 0\.78em;[^}]*font-style: normal;[^}]*font-weight: 400;/);
});

test('only training result circles use outcome-colored outlines', () => {
  assert.match(style, /\.player-profile-match-group\.training \.player-profile-match-outcome \{[^}]*border: 1px solid currentColor;[^}]*background: transparent;/);
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

test('2026 import matches the current static source dimensions', () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'data/data2026.js'), 'utf8'), context);
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
  vm.runInContext(fs.readFileSync(path.join(root, 'data/data2026.js'), 'utf8'), context);

  assert.equal(context.window.PADEL_SEASON.id, '2026');
  assert.equal(context.window.PADEL_SEASON.label, 'Sommer 2026');
  assert.equal(context.window.PADEL_SEASON.title, 'Padel-Liga Sommer 2026');
  assert.match(importMigration, /'Sommer 2026'/);
  assert.match(achievementMigration, /from \(values \('luca_w'\), \('marco_m'\)\)/);
  assert.match(achievementMigration, /'Final 4 Teilnehmer'/);
  assert.match(achievementMigration, /'Padel-Liga Sommer 2026'/);
  assert.match(winnerAchievementMigration, /'marcel_m'/);
  assert.match(winnerAchievementMigration, /'winner'/);
  assert.match(winnerAchievementMigration, /'Gewinner'/);
  assert.match(winnerAchievementMigration, /'Padel-Liga Sommer 2026'/);
});
