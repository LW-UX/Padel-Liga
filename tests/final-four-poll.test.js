const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const ticker = fs.readFileSync(path.join(root, 'js', 'live-ticker.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261014230000_final_four_poll.sql'),
  'utf8'
);

test('the poll is rendered once after all Prematch player content, including on mobile', () => {
  const overview = ticker.match(/function renderOverview\(\) \{[\s\S]*?(?=\n  function renderPublic)/)?.[0] || '';
  const prematch = ticker.match(/function renderPrematchFacts\(\) \{[\s\S]*?(?=\n  function renderFinalFourPoll)/)?.[0] || '';

  assert.equal((ticker.match(/\$\{renderFinalFourPoll\(\)\}/g) || []).length, 1);
  assert.ok(overview.indexOf('${renderPrematchFacts()}') < overview.indexOf('${renderFinalFourPoll()}'));
  assert.doesNotMatch(prematch, /renderFinalFourPoll|live-overview-poll-section/);
  assert.match(style, /\.live-overview-poll-section \{[\s\S]*grid-column: 1 \/ -1;/);
  assert.match(style, /@media \(max-width: 768px\)[\s\S]*\.live-overview-prematch-player-4[\s\S]*\.live-overview-poll-section/);
});

test('selection uses the live team-button pattern and is replaced by a proportional result bar', () => {
  const poll = ticker.match(/function renderFinalFourPoll\(\) \{[\s\S]*?(?=\n  function getOverviewStats)/)?.[0] || '';

  assert.match(poll, /live-point-team-button live-overview-poll-choice/);
  assert.match(poll, /data-final-four-poll-vote/);
  assert.match(poll, /option\.votes\) > 0/);
  assert.match(poll, /grid-template-columns: \$\{resultOptions\.map\(option => `minmax\(0, \$\{Number\(option\.percentage\) \|\| 0\}fr\)`\)\.join\(' '\)\}/);
  assert.match(poll, /data-final-four-poll-change>Stimme ändern/);
  assert.doesNotMatch(poll, /totalVotes|voteLabel|Umfrageergebnis mit/);
  assert.match(style, /\.live-overview-poll-segments \{[\s\S]*display: grid;[\s\S]*gap: clamp\(3px, 0\.6vw, 6px\);/);
  assert.match(style, /grid-template-rows: minmax\(1\.5rem, auto\) 30px/);
  assert.match(style, /border: 1px solid var\(--accent\);[\s\S]*border-radius: 0;[\s\S]*background: color-mix\(in srgb, var\(--accent\) 5%, var\(--surface\)\);/);
  assert.match(style, /first-child \.live-overview-poll-bar \{[\s\S]*border-radius: 8px 0 0 8px;/);
  assert.match(style, /last-child \.live-overview-poll-bar \{[\s\S]*border-radius: 0 8px 8px 0;/);
  assert.match(style, /only-child \.live-overview-poll-bar \{[\s\S]*border-radius: 8px;/);
  assert.match(style, /color: #fff;/);
  assert.match(style, /live-overview-poll-slide-in/);
});

test('anonymous votes are isolated from direct table access and close permanently on first live start', () => {
  assert.match(migration, /primary key \(season_id, browser_id\)/);
  assert.match(migration, /alter table public\.final_four_poll_votes enable row level security/);
  assert.match(migration, /revoke all on public\.final_four_poll_votes from public, anon, authenticated/);
  assert.match(migration, /on conflict \(season_id, browser_id\) do update/);
  assert.match(migration, /from public\.live_match_sessions as session/);
  assert.match(migration, /select min\(session\.started_at\) into poll_closed_at/);
  assert.match(migration, /create trigger live_match_sessions_lock_final_four_poll/);
  assert.match(migration, /for update of season/);
  assert.match(migration, /grant execute on function public\.get_public_final_four_poll\(text,uuid\) to anon, authenticated/);
  assert.match(migration, /grant execute on function public\.submit_final_four_vote\(text,text,uuid\) to anon, authenticated/);
  assert.doesNotMatch(migration, /grant select on public\.final_four_poll_votes/);
});

test('the browser identifier is random, persistent and contains no account data', () => {
  assert.match(ticker, /padel-final-four-poll-browser-id/);
  assert.match(ticker, /window\.localStorage\.setItem\(storageKey, state\.pollBrowserId\)/);
  assert.match(ticker, /p_browser_id: getPollBrowserId\(\)/);
  assert.doesNotMatch(migration, /email|user_id|profile_id/);
});
