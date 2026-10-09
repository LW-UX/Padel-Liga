const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261008120000_matches_without_rating.sql'),
  'utf8'
);
const dataMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261008130000_cancel_unplayed_summer_2026_matches.sql'),
  'utf8'
);
const sortDateMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261008150000_cancelled_match_sort_dates.sql'),
  'utf8'
);
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const account = fs.readFileSync(path.join(root, 'js/account.js'), 'utf8');
const tipping = fs.readFileSync(path.join(root, 'js/tippspiel.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('only admins can permanently cancel eligible league matches', () => {
  assert.match(migration, /create or replace function public\.cancel_match\(p_match_id text\)/);
  assert.match(migration, /current_profile\.app_role is distinct from 'admin'/);
  assert.match(migration, /selected_match\.competition_stage <> 'league'/);
  assert.match(migration, /selected_match\.cancelled_at is not null/);
  assert.match(migration, /proposal\.status = 'pending'/);
  assert.match(migration, /session\.status in \('live', 'needs_server', 'ready_to_finish'\)/);
  assert.match(migration, /cancelled_at = now\(\)[\s\S]*counts_for_ranking = false[\s\S]*counts_for_elo = false[\s\S]*betting_open = false/);
  assert.match(migration, /matches_protect_cancelled/);
  assert.match(migration, /result_proposals_reject_cancelled_match/);
  assert.match(migration, /live_match_sessions_reject_cancelled_match/);
  assert.match(migration, /revoke execute on function public\.cancel_match\(text\) from public, anon/);
  assert.match(migration, /grant execute on function public\.cancel_match\(text\) to authenticated/);
  assert.match(sortDateMigration, /set[\s\S]*match_at = null,[\s\S]*cancelled_at = now\(\)/);
  assert.match(sortDateMigration, /cancelled_at is null or \([\s\S]*match_at is null/);
});

test('account cards expose cancellation only through the admin branch', () => {
  assert.match(account, /state\.profile\?\.app_role !== 'admin' \|\| task\.competition_stage !== 'league'/);
  assert.match(account, /data-match-cancel=/);
  assert.match(account, /state\.client\.rpc\('cancel_match', \{ p_match_id: matchId \}\)/);
  assert.match(account, /openUnrateDialog\(cancelMatchButton\)/);
});

test('cancelled matches stay visible but settle progress and leave open surfaces', () => {
  assert.match(app, /function isCancelledMatch\(match\)/);
  assert.match(app, /class="mc played unrated/);
  assert.match(app, /<div class="mc-score-main">o\.W\.<\/div>/);
  assert.match(app, /<div class="mc-score-detail">ohne Wertung<\/div>/);
  assert.doesNotMatch(style, /\.mc\.unrated \.mc-score-detail \{ font-style: italic; \}/);
  assert.match(app, /matchScope === 'open'[\s\S]*!isCancelledMatch\(match\)/);
  assert.match(app, /regularMatches\.filter\(isCompletedSeasonMatch\)\.length/);
  assert.match(app, /\.filter\(m => !isCancelledMatch\(m\) && m\.sieger === null/);
  assert.match(migration, /match\.cancelled_at is null[\s\S]*match\.actual_sets is null or match\.winner is null or match\.match_at is null/);
});

test('profiles and rankings show cancellation without counting it', () => {
  assert.match(migration, /jsonb_build_object\('cancelledAt', match\.cancelled_at\)/);
  assert.match(migration, /jsonb_build_object\('isCancelled', match\.cancelled_at is not null\)/);
  assert.match(sortDateMigration, /'date', case[\s\S]*match\.cancelled_at is not null then 'null'::jsonb/);
  assert.match(sortDateMigration, /when match\.cancelled_at is not null then matchday\.starts_on/);
  assert.match(migration, /match\.cancelled_at is not null then 'unfinished'/);
  assert.match(migration, /match\.cancelled_at is null as is_complete/);
  assert.match(migration, /when p_result_details is null then 0::numeric/);
  assert.match(app, /player-profile-unrated-result">ohne Wertung/);
  assert.match(style, /\.player-profile-unrated-result[\s\S]*font-style: italic/);
  assert.match(app, /function getPlayerUnratedMatchCount/);
  assert.match(app, /data-help-tooltip-anchor>\+\$\{unratedCount\}/);
  assert.match(app, /Partie' : 'Partien'\} ohne Wertung/);
  assert.match(style, /\.ranking-unrated-count[\s\S]*color: var\(--dim\)/);
  assert.match(app, /\.help-icon, \[data-help-tooltip-anchor\]/);
  assert.match(app, /closePinnedHelpTooltips\(wrapper\)/);
  assert.match(app, /--ranking-tooltip-left/);
  assert.match(style, /\.ranking-unrated-wrap\.help-tooltip-opens-right \.help-tooltip[\s\S]*position: fixed/);
  assert.match(style, /\.ranking-row \{ transform-origin: center; \}/);
  assert.doesNotMatch(style, /\.ranking-row \{[^}]*will-change: transform/);
});

test('tips remain visible but are excluded from scoring', () => {
  assert.match(tipping, /cancelled_at/);
  assert.match(tipping, /isCancelled \? 'Ohne Wertung'/);
  assert.match(tipping, /Dein Tipp: \$\{selected\} · Nicht gewertet/);
  assert.match(migration, /where match\.season_id = p_season_id and match\.cancelled_at is null/);
});

test('the two agreed Summer matches are guarded by a separate data migration', () => {
  assert.match(dataMigration, /season-2026-partie-10/);
  assert.match(dataMigration, /season-2026-partie-19/);
  assert.match(dataMigration, /eligible_count <> 2/);
  assert.match(dataMigration, /match_at = null,[\s\S]*cancelled_at = now\(\)/);
  assert.match(dataMigration, /perform private\.advance_season_tournament\('2026'\)/);
  assert.match(dataMigration, /perform private\.try_complete_season\('2026'\)/);
});
