const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
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

test('public player profile is a separate accessible dialog', () => {
  assert.match(html, /<dialog class="player-profile-dialog" id="player-profile-dialog" aria-labelledby="player-profile-name">/);
  assert.equal((html.match(/<article class="widget player-profile-widget/g) || []).length, 4);
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
  assert.match(html, /data-player-profile-filter="training"/);
  assert.match(html, /<dialog class="auth-dialog" id="auth-dialog"/);
  assert.doesNotMatch(html, /player-profile-cover|player-profile-cover-image/);
  assert.doesNotMatch(app, /cover\.webp|Coverbild von/);
});

test('player names open profiles by stable id and team cards no longer apply presets', () => {
  assert.match(app, /data-player-profile-id="\$\{escapeHtml\(playerId\)\}"/);
  assert.match(app, /function renderTeamPlayers\(players\)/);
  assert.doesNotMatch(app, /class="calculator-match-team" role="button"/);
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

test('Sommer 2026 label and confirmed Final 4 profiles stay explicit', () => {
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
});
