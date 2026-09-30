const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260928150000_final_four_live_ticker.sql'),
  'utf8'
);
const correctionMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260929100000_consistent_live_ticker_corrections.sql'),
  'utf8'
);
const acceptance = fs.readFileSync(path.join(root, 'tests', 'live-ticker.acceptance.sql'), 'utf8');
const ticker = fs.readFileSync(path.join(root, 'js', 'live-ticker.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const account = fs.readFileSync(path.join(root, 'js', 'account.js'), 'utf8');
const accountStyle = fs.readFileSync(path.join(root, 'account.css'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('live scoring is an append-only audit log with idempotent versioned writes', () => {
  assert.match(migration, /create table public\.live_match_events/);
  assert.match(migration, /unique \(client_action_id\)/);
  assert.match(migration, /session\.version <> p_expected_version/);
  assert.match(migration, /where event\.client_action_id = p_client_action_id/);
  assert.match(migration, /event_type = 'point' and event\.voided_at is null/);
  assert.match(migration, /set voided_at = now\(\), voided_by = \(select auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /delete from public\.live_match_events/);
  assert.match(migration, /create or replace function public\.cancel_live_match/);
  assert.match(migration, /set status = 'cancelled', version = version \+ 1/);
});

test('writer access is match-scoped while admins retain an explicit bypass', () => {
  assert.match(migration, /create table public\.live_match_scorer_assignments/);
  assert.match(migration, /status in \('pending', 'accepted'\)/);
  assert.match(migration, /profile\.app_role = 'admin'[\s\S]*assignment\.status = 'accepted'/);
  assert.match(migration, /Nur Beteiligte dürfen einen Schreiber festlegen/);
  assert.match(migration, /Nach dem Start kann der Schreiber nicht mehr geändert werden/);
  assert.match(migration, /email_confirmed_at is not null/);
});

test('ticker assignment lives inside the scheduled match card and reveals only assigned work', () => {
  assert.match(account, /PadelLiveTicker\?\.renderGameAssignment\(task\.match_id\)/);
  assert.match(ticker, /data-live-assignment-toggle/);
  assert.match(ticker, />Liveticker vergeben</);
  assert.match(ticker, /class="match-schedule-form" data-live-nominate-form/);
  assert.doesNotMatch(ticker, /class="match-schedule-form auth-form"/);
  assert.match(ticker, /class="training-picker" data-training-picker/);
  assert.match(ticker, /class="secondary-button secondary-button--dropdown training-picker-toggle"/);
  assert.match(ticker, /data-training-picker-search role="combobox"/);
  assert.match(ticker, /class="viewer-menu training-picker-menu"/);
  assert.match(ticker, /data-training-picker-search-text/);
  assert.doesNotMatch(ticker, /<select name="scorerProfileId"/);
  assert.match(accountStyle, /\.match-schedule-form :where\(input\)/);
  assert.match(ticker, /task\.assignment && \([\s\S]*task\.isAdmin[\s\S]*assignment\.status === 'accepted'/);
  assert.match(ticker, /section\.hidden = !state\.auth\?\.session \|\| \(!requests\.length && !matches\.length\)/);
  assert.doesNotMatch(ticker, /function renderAssignment\(task\)/);
});

test('self assignment is accepted immediately and server selection stays in the revealed ticker card', () => {
  assert.match(ticker, /profileId === state\.auth\?\.profile\?\.id/);
  assert.match(ticker, /respond_live_scorer_assignment/);
  const writerControls = ticker.match(/function renderWriterControls\(task\) \{[\s\S]*?(?=\n  function renderAccount)/)?.[0] || '';
  const serverPicker = ticker.match(/function renderServerPicker\(task, players[\s\S]*?(?=\n  function renderGameAssignment)/)?.[0] || '';
  assert.match(writerControls, /task\.assignment\?\.status !== 'accepted'/);
  assert.match(writerControls, /renderServerPicker/);
  assert.doesNotMatch(writerControls, /<select name="serverPlayerId"/);
  assert.match(serverPicker, /name: 'serverPlayerId'/);
  assert.match(serverPicker, /searchable: false/);
});

test('writer scoring emphasizes two point buttons, the centered score and compact text actions', () => {
  const writerControls = ticker.match(/function renderWriterControls\(task\) \{[\s\S]*?(?=\n  function renderAccount)/)?.[0] || '';
  assert.match(writerControls, /class="live-point-team-buttons"/);
  assert.equal((writerControls.match(/class="live-point-team-button\$\{/g) || []).length, 2);
  assert.match(writerControls, />Punkt für</);
  assert.match(writerControls, />Punkt eintragen</);
  assert.doesNotMatch(writerControls, /<div class="result-proposal"><span>Aktueller Stand/);
  assert.match(ticker, /class="account-task-live-score"/);
  assert.match(ticker, /class="live-ticker-text-actions"[\s\S]*class="text-link"[\s\S]*>Liveticker verwerfen<[\s\S]*>Aufschläger korrigieren<[\s\S]*>Spielverlauf öffnen</);
  assert.match(accountStyle, /\.live-point-team-button[\s\S]*min-height: 88px/);
  assert.match(accountStyle, /\.live-ticker-text-actions[\s\S]*flex-wrap: wrap/);
});

test('the assigned writer does not see their own redundant name while other viewers retain it', () => {
  assert.match(ticker, /task\.assignment && task\.assignment\.scorerProfileId !== profileId/);
  assert.match(ticker, /Schreiber: \$\{escapeHtml\(task\.assignment\.scorerName\)\}/);
});

test('Golden Point, service rotation, tiebreak rotation and official finish are server controlled', () => {
  const pointFunction = migration.match(
    /create or replace function public\.record_live_point\([\s\S]*?(?=\n\$\$;)/
  )?.[0] || '';
  assert.match(pointFunction, /if one_points = 3 then game_finished := true/);
  assert.match(pointFunction, /if two_points = 3 then game_finished := true/);
  assert.match(pointFunction, /private\.live_rotation_player\(session\.id, one_games \+ two_games\)/);
  assert.match(pointFunction, /1 \+ \(\(total_tiebreak_points - 1\) \/ 2\)/);
  assert.match(migration, /private\.validate_result_for_format\('single-set', details, sets, winning_team\)/);
  assert.match(migration, /update public\.matches set match_at = session\.started_at/);
});

test('normal result entry cannot race an active live ticker', () => {
  assert.match(migration, /create trigger prevent_parallel_live_match_result/);
  assert.match(migration, /create trigger prevent_parallel_live_result_proposal/);
  assert.match(migration, /Für diese Partie wartet bereits ein Ergebnis auf Bestätigung/);
  assert.match(migration, /perform set_config\('app\.live_finish_match_id', p_match_id, true\)/);
  assert.match(account, /PadelLiveTicker\?\.isMatchLive\(task\.match_id\)/);
  assert.match(account, /Diese Partie wird gerade im Liveticker geführt/);
});

test('finishing a live match refreshes the regular account tasks', () => {
  const finishHandler = ticker.match(
    /const finish = event\.target\.closest\('\[data-live-finish\]'\);[\s\S]*?(?=\n      const cancel =)/
  )?.[0] || '';
  assert.match(finishHandler, /await window\.PadelKonto\?\.refresh\?\.\(\)/);
  assert.ok(
    finishHandler.indexOf('await window.PadelKonto?.refresh?.()')
      < finishHandler.indexOf("padel:official-result-changed")
  );
});

test('discarding a live ticker uses the styled page dialog instead of a browser confirmation', () => {
  assert.match(index, /<dialog class="auth-dialog" id="live-cancel-dialog"/);
  assert.match(index, /id="live-cancel-title">Liveticker verwerfen\?<\/h2>/);
  assert.match(index, /class="secondary-button"[^>]*data-live-cancel-close>Abbrechen<\/button>/);
  assert.match(index, /class="primary-button"[^>]*data-live-cancel-confirm>Liveticker verwerfen<\/button>/);
  assert.match(ticker, /function openCancelDialog\(cancelButton\)/);
  assert.match(ticker, /cancelConfirm[\s\S]*cancel_live_match/);
  assert.doesNotMatch(ticker, /window\.confirm\(/);
});

test('the public view links only live or archived result centers and keeps profiles independent', () => {
  assert.match(index, /id="live-ticker-link"[\s\S]*data-live-open-active[\s\S]*hidden/);
  assert.match(index, /<dialog class="live-ticker-dialog" id="live-ticker-dialog"/);
  assert.match(index, /<section class="live-ticker-dialog-content" id="liveticker">/);
  assert.match(app, /class="mc-score" data-live-open-match/);
  assert.match(app, /PadelLiveTicker\?\.hasHistory\(m\.id\)/);
  assert.match(app, /class="player-profile-match-score" data-live-open-match/);
  assert.match(ticker, /data-player-profile-id/);
  assert.match(ticker, /data-live-refresh/);
  assert.match(ticker, /const breakLabel = last\.break \? '<strong>BREAK/);
  assert.match(ticker, /data-live-game-points/);
  assert.match(ticker, /label !== 'Spiel'/);
  assert.match(ticker, /\$\{isLive \? `<strong class="live-ticker-points" data-live-current-points>\$\{escapeHtml\(pointLabel\(session\)\)\}<\/strong>` : ''\}/);
  assert.match(ticker, /class="live-ticker-match"/);
  assert.match(ticker, /class="live-ticker-game-line"/);
  assert.match(ticker, /class="live-ticker-player-photo"/);
  assert.doesNotMatch(ticker, /Aufschlag gehalten/);
});

test('completed tiebreaks do not show one player as server for the whole game', () => {
  const source = ticker.match(/function getHistoryGameServer\(game, playersById\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const getHistoryGameServer = vm.runInNewContext(`(() => { ${source}\nreturn getHistoryGameServer; })()`);
  const playersById = new Map([
    ['player-1', { displayName: 'Spieler 1' }],
    ['player-2', { displayName: 'Spieler 2' }]
  ]);

  assert.equal(getHistoryGameServer({ events: [
    { serverPlayerId: 'player-1' },
    { serverPlayerId: 'player-1' }
  ] }, playersById)?.displayName, 'Spieler 1');
  assert.equal(getHistoryGameServer({ events: [
    { serverPlayerId: 'player-1' },
    { serverPlayerId: 'player-2' }
  ] }, playersById), null);
});

test('the global live entry switches into the season of the active match', () => {
  assert.match(ticker, /PadelLigaOpenLiveTicker\?\.\(state\.activeMatch\.matchId, \{\s*seasonId: state\.activeMatch\.seasonId\s*\}\)/);
  const openTicker = app.match(/async function openLiveTicker\(matchId, options = \{\}\) \{[\s\S]*?(?=\n\}\n\nfunction closeLiveTicker)/)?.[0] || '';
  assert.match(openTicker, /targetSeasonId !== String\(selectedSeason\?\.id \|\| ''\)/);
  assert.match(openTicker, /url\.searchParams\.set\('saison', targetSeasonId\)/);
  assert.match(openTicker, /url\.searchParams\.set\('live', matchId\)/);
  assert.match(openTicker, /window\.location\.assign\(url\)/);
});

test('matches from the hidden test season do not trigger the global live entry', () => {
  const globalLiveFilter = ticker.match(
    /function triggersGlobalLiveButton\(activeMatch\) \{[\s\S]*?(?=\n  \})/
  )?.[0] || '';
  assert.match(globalLiveFilter, /window\.PADEL_SEASONS/);
  assert.match(globalLiveFilter, /String\(option\.id\) === String\(activeMatch\.seasonId\)/);
  assert.match(globalLiveFilter, /return !season\?\.hidden/);
  assert.match(ticker, /liveButton\.hidden = !triggersGlobalLiveButton\(state\.activeMatch\)/);
  assert.match(ticker, /active && triggersGlobalLiveButton\(state\.activeMatch\)/);
});

test('the ticker opens as a full-screen detail dialog and keeps tab changes in one history entry', () => {
  const openTicker = app.match(/async function openLiveTicker\(matchId, options = \{\}\) \{[\s\S]*?(?=\n\}\n\nfunction closeLiveTicker)/)?.[0] || '';
  assert.match(openTicker, /dialog\.showModal\(\)/);
  assert.doesNotMatch(openTicker, /nav\('liveticker'/);
  assert.match(style, /\.live-ticker-dialog \{[\s\S]*width: 100vw;[\s\S]*height: 100dvh/);
  assert.match(ticker, /const replacesExistingLiveRoute = url\.searchParams\.has\('live'\)/);
  assert.match(ticker, /replacesExistingLiveRoute \? 'replaceState' : 'pushState'/);
  assert.match(app, /function closeLiveTicker\(options = \{\}\)[\s\S]*window\.history\.back\(\)/);
  assert.match(app, /liveTickerDialog\?\.addEventListener\('cancel'[\s\S]*closeLiveTicker\(\)/);
  assert.match(ticker, /PadelLigaCloseLiveTicker\?\.\(\{ fromHistory: true \}\)/);
  assert.match(app, /nav\('partien'[\s\S]*replaceState\(\{ liveBase: true \}[\s\S]*pushState\(\{ liveMatchId: requestedLiveMatch \}/);
});

test('the ticker starts with an overview tab for all three matches and the final-four table', () => {
  assert.match(ticker, /data-live-overview>Übersicht<\/button>/);
  assert.match(ticker, /class="live-overview-matches"/);
  assert.match(ticker, /class="rt calculator-ranking-table final-four-calculator-ranking-table live-overview-table"/);
  const overview = ticker.match(/function renderOverview\(\) \{[\s\S]*?(?=\n  function renderPublic)/)?.[0] || '';
  assert.match(overview, /<th class="col-diff">Diff\.<\/th>/);
  assert.doesNotMatch(overview, /class="col-gv"/);
  assert.doesNotMatch(overview, /class="live-ticker-status/);
  assert.match(overview, /class="live-overview-live"/);
  assert.match(overview, /class="live-overview-score-dot"/);
  assert.match(ticker, /score: `\$\{session\.teamOneGames\}:\$\{session\.teamTwoGames\}`/);
  assert.doesNotMatch(overview, /matchState\.detail/);
  assert.match(ticker, /target\.textContent = \[payload\?\.seasonLabel, formatDate\(payload\?\.matchAt\)\]\.filter\(Boolean\)\.join\(' · '\)/);
  assert.match(ticker, /score: '–:–'/);
  assert.match(ticker, /Stand nach abgeschlossenen Partien/);
  assert.match(ticker, /liveView', 'overview'/);
  assert.match(app, /url\.searchParams\.get\('liveView'\) === 'overview'/);
  assert.match(ticker, /if \(matchButton\.dataset\.liveView\) options\.view = matchButton\.dataset\.liveView/);
});

test('the public match list always leads with sets and keeps games and history below', () => {
  const matchRow = app.match(/function renderMatchRow\(m\) \{[\s\S]*?(?=\n\}\n\nfunction renderMatchdayGroup)/)?.[0] || '';
  assert.match(matchRow, /const scoreMain = String\(m\.saetze \|\| '—'\)/);
  assert.match(matchRow, /class="mc-score-detail"[\s\S]*m\.ergebnis[\s\S]*liveHistoryIcon/);
  assert.doesNotMatch(matchRow, /isSingleSetMatch\(m\) \? \(m\.ergebnis/);
  assert.match(matchRow, /class="mc-score-main">0:0<\/div>/);
  assert.match(matchRow, /class="mc-score-detail mc-score-live">\$\{Number\(activeLive\.teamOneGames\)/);
  assert.match(matchRow, /class="mc-score-result-with-details">\$\{m\.ergebnis\}\$\{liveHistoryIcon\}/);
  assert.match(matchRow, /const probability = getHistoricalMatchWinProbability\(m\)/);
  assert.doesNotMatch(matchRow, /countsForRanking\(m\) \? getHistoricalMatchWinProbability/);
});

test('three persistent test ticker matches are excluded from every official calculation', () => {
  for (const number of [1, 2, 3]) {
    assert.match(migration, new RegExp(`'test-2026-live-${number}'`));
  }
  assert.equal((migration.match(/false, false, '[^']+ \/ [^']+', '[^']+ \/ [^']+', false\)/g) || []).length, 3);
  assert.doesNotMatch(migration, /delete from public\.matches[\s\S]*test-2026-live/);
});

test('Realtime publishes only the public session snapshot, not private audit tables', () => {
  assert.match(migration, /alter publication supabase_realtime add table public\.live_match_sessions/);
  assert.doesNotMatch(migration, /alter publication supabase_realtime add table public\.live_match_events/);
  assert.match(migration, /revoke all on public\.live_match_scorer_assignments, public\.live_match_sessions,[\s\S]*public\.live_match_official_corrections from anon, authenticated/);
  assert.match(migration, /grant select on public\.live_match_sessions to anon, authenticated/);
});

test('corrected archives publish only the corrected official result', () => {
  assert.match(correctionMigration, /create or replace function public\.get_public_live_ticker/);
  assert.match(correctionMigration, /jsonb_set\(payload, '\{session,events\}', '\[\]'::jsonb, false\)/);
  assert.match(correctionMigration, /grant execute on function public\.get_public_live_ticker\(text\) to anon, authenticated/);
  assert.match(ticker, /session\?\.status === 'finished'[\s\S]*payload\.result/);
  assert.match(ticker, /Der ursprüngliche Punktverlauf wurde nachträglich korrigiert/);
});

test('outdated ticker loads cannot overwrite a newer match or reopen a closed view', () => {
  assert.match(ticker, /loadRequestId: 0/);
  assert.match(ticker, /const requestId = \+\+state\.loadRequestId/);
  assert.ok((ticker.match(/requestId !== state\.loadRequestId/g) || []).length >= 2);
  assert.match(ticker, /function close\(\) \{[\s\S]*state\.loadRequestId \+= 1;[\s\S]*state\.matchId = null/);
  assert.match(app, /function closeLiveTicker\(options = \{\}\)[\s\S]*window\.PadelLiveTicker\?\.close\(\);/);
});

test('acceptance coverage exercises idempotency, Golden Point, undo, tiebreak rotation and correction', () => {
  assert.match(acceptance, /^-- Run through tools\/supabase-mcp\.mjs only after explicit approval\./);
  assert.match(acceptance, /Idempotent retry changed the live score twice/);
  assert.match(acceptance, /Golden Point did not finish the game/);
  assert.match(acceptance, /Undo did not restore the exact pre-Golden-Point state/);
  assert.match(acceptance, /Tiebreak service rotation is incorrect/);
  assert.match(acceptance, /The public corrected archive is inconsistent/);
  assert.match(acceptance, /rollback;\s*$/);
});
