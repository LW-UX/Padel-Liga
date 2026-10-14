const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const account = fs.readFileSync(path.join(root, 'js/account.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'account.css'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261014170000_training_guests.sql'),
  'utf8'
);

test('training player pickers turn a guest choice into a required name field', () => {
  assert.match(account, /\{ value: TRAINING_GUEST_OPTION, label: '\+ Gast hinzufügen'/);
  assert.match(account, /data-training-guest-name=/);
  assert.match(account, /placeholder="Name des Gastes"/);
  assert.match(account, /minlength="2"/);
  assert.match(account, /maxlength="40"/);
  assert.match(account, /form\.querySelector\(`\[data-training-guest-name=.*`\)\?\.focus\(\)/);
  assert.match(account, /p_guest_names: guestNames/);
  assert.match(style, /\.training-guest-control/);
  assert.match(style, /\.training-guest-badge/);
});

test('equal guest names are numbered only inside the same training', () => {
  const helpers = account.match(
    /function isTrainingGuestKey\(value\) \{[\s\S]*?(?=\n  function getPlayerName)/
  )?.[0] || '';
  const getDisplayName = vm.runInNewContext(
    `(() => { const TRAINING_GUEST_KEY_PATTERN = /^guest:([1-4])$/; ${helpers}\nreturn getTrainingGuestDisplayName; })()`,
    { String, Object }
  );
  const names = { 'guest:2': 'Max M.', 'guest:4': 'Max M.' };
  const participants = ['anna', 'guest:2', 'ben', 'guest:4'];

  assert.equal(getDisplayName('guest:2', names, participants), 'Max M. · Gast 1');
  assert.equal(getDisplayName('guest:4', names, participants), 'Max M. · Gast 2');
  assert.equal(getDisplayName('guest:2', { 'guest:2': 'Max M.' }, ['anna', 'guest:2']), 'Max M. · Gast');
});

test('guest names never become profile relationship candidates', () => {
  const relationshipSource = app.match(
    /function getPlayerProfileRelationshipLeaders\(matches = \[\]\) \{[\s\S]*?(?=\nfunction renderPlayerProfileRelationships)/
  )?.[0] || '';
  const getLeaders = vm.runInNewContext(
    `(() => { ${relationshipSource}\nreturn getPlayerProfileRelationshipLeaders; })()`
  );
  const matches = Array.from({ length: 3 }, () => ({
    outcome: 'win',
    partnerNames: ['Max M. · Gast'],
    opponentNames: ['Erika E. · Gast 1']
  }));

  assert.deepEqual(JSON.parse(JSON.stringify(getLeaders(matches))), {
    favoritePartners: [],
    fearedPartners: [],
    favoriteOpponents: [],
    fearedOpponents: []
  });
});

test('guest migration keeps identities scoped to one training session', () => {
  assert.match(migration, /add column if not exists guest_names jsonb not null default '\{\}'::jsonb/);
  assert.match(migration, /guest_entry\.key !~ '\^guest:\[1-4\]\$'/);
  assert.match(migration, /char_length\(guest_entry\.value\) not between 2 and 40/);
  assert.match(migration, /insert into public\.training_sessions \(played_on, display_time, player_ids, guest_names, created_by\)/);
  assert.match(migration, /join public\.players as profile_player on profile_player\.id = participant\.player_id/);
  assert.match(migration, /private\.training_participant_display_name\(member\.player_id, session\.guest_names\)/);
  assert.match(migration, /selected_session\.guest_names = candidate_session\.guest_names/);
  assert.doesNotMatch(migration, /insert into public\.players/);
});
