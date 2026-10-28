const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261026140000_schedule_training_sessions.sql'),
  'utf8'
);
const participantEditMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261028160000_edit_scheduled_training_participants_on_result.sql'),
  'utf8'
);
const trainingScopeMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261026150000_scope_training_feed_to_test_season.sql'),
  'utf8'
);
const seasonEndScopeMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261026160000_scope_training_feed_to_season_end.sql'),
  'utf8'
);
const account = fs.readFileSync(path.join(root, 'js/account.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('scheduled trainings stay separate from result proposals', () => {
  assert.match(migration, /status in \('scheduled', 'pending', 'confirmed'\)/);
  assert.match(migration, /new\.status = 'scheduled'[\s\S]*Trainingstermin muss in der Zukunft liegen/);
  assert.match(migration, /new\.status in \('pending', 'confirmed'\)[\s\S]*Trainingsergebnis darf nicht in der Zukunft liegen/);
  assert.match(migration, /create function public\.schedule_training_session/);
  assert.match(migration, /create function public\.submit_scheduled_training_result/);
  assert.match(migration, /where session\.status in \('scheduled', 'pending'\)/);
});

test('account workflow switches between scheduling and result entry by time', () => {
  assert.match(account, /function syncTrainingFormMode\(form\)/);
  assert.match(account, /timestamp > Date\.now\(\)/);
  assert.match(account, /'update_scheduled_training' : 'schedule_training_session'/);
  assert.match(account, /'submit_scheduled_training_result'/);
  assert.match(account, /isScheduledTrainingDue\(task\)/);
  assert.match(account, /data-training-scheduled=/);
  assert.match(account, /data-training-result-fields/);
});

test('due training results allow the actual participants to replace scheduled players', () => {
  assert.match(participantEditMigration, /create or replace function public\.submit_scheduled_training_result/);
  assert.doesNotMatch(participantEditMigration, /Teilnehmer eines terminierten Trainings können beim Ergebnis nicht geändert werden/);
  assert.match(participantEditMigration, /select public\.create_training_session\([\s\S]*p_player_ids/);

  const taskRenderer = account.match(/function renderScheduledTrainingTaskCard\(task, groupKey\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(taskRenderer, /\$\{due \? '' : `<div class="result-card-timing">/);
  assert.match(taskRenderer, /\$\{due \? '' : renderTrainingParticipants\(task\)\}/);
  assert.match(account, /scheduled-training-form\$\{due \? ' is-result-entry' : ''\}/);
  assert.match(style, /\.scheduled-training-form\.is-result-entry \{[\s\S]*?border-top: 0;[\s\S]*?padding-top: 0;/);

  const formMode = account.match(/function syncTrainingFormMode\(form\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.doesNotMatch(formMode, /button\.disabled|input\.readOnly/);
});

test('home feed shows one non-detail training card with profile links', () => {
  assert.match(migration, /create function public\.get_public_training_feed/);
  assert.match(migration, /limit 3/);
  assert.match(app, /function renderHomeTrainingCard/);
  assert.match(app, /renderPlayerProfileLink/);
  assert.match(app, /roundCount/);
  assert.match(app, /completedSetCount/);
  assert.match(app, /function isViewerTraining\(training\)/);
  assert.match(app, /isSelectedTrainingParticipant\(participant\) \? 'viewer-player'/);
  assert.match(app, /isViewerTraining\(training\) \? 'viewer-match'/);
  assert.match(style, /\.mini-training-player\.viewer-player[\s\S]*?color: var\(--accent2\)/);
  assert.match(app, /nextMatchEntries, \.\.\.nextTrainingEntries/);
  assert.match(app, /recentMatchEntries, \.\.\.recentTrainingEntries/);
  const trainingCard = app.match(/function renderHomeTrainingCard[\s\S]*?(?=\nfunction getCurrentArticle)/)?.[0] || '';
  assert.doesNotMatch(trainingCard, /data-match-statistics|data-live|data-training-detail/);
});

test('home training feed confines test-account sessions while keeping normal sessions in test season', () => {
  assert.match(trainingScopeMigration, /get_public_training_feed\(p_test_mode boolean\)/);
  assert.match(trainingScopeMigration, /session\.player_ids && array\['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'test_net'\]::text\[\]/);
  assert.match(trainingScopeMigration, /coalesce\(p_test_mode, false\)[\s\S]*or not \(session\.player_ids && array/);
  assert.match(app, /const TEST_TRAINING_PLAYER_IDS = new Set\(\['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'test_net'\]\)/);
  assert.match(app, /function filterPublicTrainingFeedForSeason\(/);
  assert.match(app, /testMode \|\| !isTestTrainingFeedItem\(training\)/);
  assert.match(app, /get_public_training_feed', \{ p_test_mode: testMode \}/);

  const testIds = app.match(/const TEST_TRAINING_PLAYER_IDS = new Set\([^;]+;/)?.[0] || '';
  const itemHelper = app.match(/function isTestTrainingFeedItem\(training\) \{[\s\S]*?\n\}/)?.[0] || '';
  const cutoffHelper = app.match(/function getSeasonTrainingCutoffDate\([^]*?(?=\nfunction filterPublicTrainingFeedForSeason)/)?.[0] || '';
  const filterHelper = app.match(/function filterPublicTrainingFeedForSeason\([^]*?(?=\nasync function loadDatabasePublicTrainingFeed)/)?.[0] || '';
  const filterForSeason = Function('normalizeSeasonId', 'selectedSeason', `
    const PADEL_DATA = null;
    const getBerlinDateTimeParts = value => ({ date: String(value).slice(0, 10) });
    ${testIds}
    ${itemHelper}
    ${cutoffHelper}
    ${filterHelper}
    return filterPublicTrainingFeedForSeason;
  `)(value => value === 'test-2026' ? '2026-test' : value, null);
  const regularTraining = { sessionId: 1, participants: [{ id: 'ludwig_w', isGuest: false }] };
  const testTraining = { sessionId: 2, participants: [{ id: 'test_net', isGuest: false }] };

  assert.deepEqual(filterForSeason([regularTraining, testTraining], '2026-winter'), [regularTraining]);
  assert.deepEqual(filterForSeason([regularTraining, testTraining], '2026-test'), [regularTraining, testTraining]);
});

test('completed seasons stop the home training feed at their Berlin completion date', () => {
  assert.match(seasonEndScopeMigration, /get_public_training_feed\(p_test_mode boolean, p_until date\)/);
  assert.match(seasonEndScopeMigration, /p_until is null or session\.played_on <= p_until/);
  assert.match(app, /getSeasonTrainingCutoffDate\(selectedSeason\?\.completedAt\)/);
  assert.match(app, /get_public_training_feed', \{ p_test_mode: testMode, p_until: cutoffDate \}/);

  const berlinDateHelper = app.match(/function getBerlinDateTimeParts\([^]*?(?=\n\nasync function mergeDatabaseResults)/)?.[0] || '';
  const cutoffHelper = app.match(/function getSeasonTrainingCutoffDate\([^]*?(?=\nfunction filterPublicTrainingFeedForSeason)/)?.[0] || '';
  const filterHelper = app.match(/function filterPublicTrainingFeedForSeason\([^]*?(?=\nasync function loadDatabasePublicTrainingFeed)/)?.[0] || '';
  const filterForSeason = Function(`
    "use strict";
    const PADEL_DATA = null;
    const selectedSeason = null;
    const normalizeSeasonId = id => id;
    const isTestTrainingFeedItem = () => false;
    ${berlinDateHelper}
    ${cutoffHelper}
    ${filterHelper}
    return filterPublicTrainingFeedForSeason;
  `)();
  const items = [
    { playedOn: '2026-10-15' },
    { playedOn: '2026-10-16' },
    { playedOn: '2026-10-17' }
  ];

  assert.deepEqual(filterForSeason(items, '2026-sommer', '2026-10-15T22:30:00Z'), items.slice(0, 2));
  assert.deepEqual(filterForSeason(items, '2026-winter', null), items);
});
