const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
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

test('public player profile is a separate accessible dialog', () => {
  assert.match(html, /<dialog class="player-profile-dialog" id="player-profile-dialog" aria-labelledby="player-profile-name">/);
  assert.match(html, /<button class="modal-close-button player-profile-close"[^>]*data-player-profile-close/);
  assert.equal((html.match(/<article class="widget player-profile-widget/g) || []).length, 5);
  assert.match(html, /<article class="widget player-profile-widget player-profile-stats-widget">[\s\S]*id="player-profile-stats"/);
  assert.match(html, /<h2 id="player-profile-name"><\/h2>\s*<span class="player-profile-company firma-badge"/);
  assert.match(app, /profileCompanyElement\.classList\.add\(`firma-\$\{profileCompany\}`\)/);
  assert.match(app, /achievement\.kind === 'winner'/);
  assert.match(app, /achievement\.kind === 'final_four'/);
  assert.match(app, /kind === 'winner'\s*\? 'Gewinner'/);
  assert.match(app, /kind === 'final-four' \? 'Final 4'/);
  assert.match(html, /id="achievement-laurel-left"/);
  assert.match(html, /id="achievement-laurel-right"/);
  assert.match(app, /<use href="#achievement-laurel-left"><\/use>/);
  assert.match(app, /<use href="#achievement-laurel-right"><\/use>/);
  assert.match(html, /id="player-profile-elo-chart"/);
  assert.match(app, /const labels = series\.map\(item => formatProfileDate\(item\.date\)\)/);
  assert.doesNotMatch(app, /const labels = series\.map\(item => item\.label/);
  assert.match(html, /id="player-profile-avatar-placeholder"/);
  assert.match(app, /identity\.profileEmoji \|\| knownPlayer\?\.profileEmoji/);
  assert.match(app, /image\.onload = \(\) => \{\s*image\.hidden = false;\s*placeholder\.hidden = true;/);
  assert.match(players, /id: "chris_m"[^\n]+profileEmoji: "👨"/);
  assert.match(players, /id: "agnes_k"[^\n]+profileEmoji: "👩"/);
  assert.match(html, /class="match-scope-toggle" aria-label="Partien filtern"[\s\S]*data-player-profile-filter="training"/);
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

test('training rounds stay grouped and incomplete scores are visibly unranked', () => {
  assert.match(app, /function groupPlayerProfileMatches\(matches = \[\]\)/);
  assert.match(app, /data-profile-match-group=/);
  assert.match(app, /showDate = index === 0/);
  assert.match(app, /showSeason = index === group\.matches\.length - 1/);
  assert.match(app, /match\.isComplete !== false/);
  assert.match(app, /Abgebrochen, ohne Wertung/);
  assert.match(incompleteTrainingMigration, /add column if not exists is_complete boolean not null default true/);
  assert.match(incompleteTrainingMigration, /set_count in \(1, 2, 3\)/);
  assert.match(incompleteTrainingMigration, /set_count not in \(1, 2, 3\)/);
  assert.match(incompleteTrainingMigration, /when not round\.is_complete then 'unfinished'/);
  assert.match(incompleteTrainingMigration, /scored_career as \([\s\S]*?select \* from career where is_complete/);
  assert.match(incompleteTrainingMigration, /'trainingSessionId', history\.training_session_id/);
  assert.match(incompleteTrainingMigration, /'trainingRoundNumber', history\.training_round_number/);
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
