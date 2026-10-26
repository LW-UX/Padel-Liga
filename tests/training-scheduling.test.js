const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261026140000_schedule_training_sessions.sql'),
  'utf8'
);
const account = fs.readFileSync(path.join(root, 'js/account.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

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

test('home feed shows one non-detail training card with profile links', () => {
  assert.match(migration, /create function public\.get_public_training_feed/);
  assert.match(migration, /limit 3/);
  assert.match(app, /function renderHomeTrainingCard/);
  assert.match(app, /renderPlayerProfileLink/);
  assert.match(app, /roundCount/);
  assert.match(app, /completedSetCount/);
  assert.match(app, /nextMatchEntries, \.\.\.nextTrainingEntries/);
  assert.match(app, /recentMatchEntries, \.\.\.recentTrainingEntries/);
  const trainingCard = app.match(/function renderHomeTrainingCard[\s\S]*?(?=\nfunction getCurrentArticle)/)?.[0] || '';
  assert.doesNotMatch(trainingCard, /data-match-statistics|data-live|data-training-detail/);
});
