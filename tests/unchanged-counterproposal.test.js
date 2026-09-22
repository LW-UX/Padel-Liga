const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const account = fs.readFileSync(path.join(root, 'js', 'account.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260922100000_reject_unchanged_counterproposals.sql'),
  'utf8'
);
const decision = 'Das entspricht dem bestehenden Vorschlag. Bitte bestätige das Ergebnis stattdessen.';

function extractFunction(name, nextName) {
  const end = nextName ? `(?=\\n  function ${nextName})` : '(?=\\n  (?:async )?function )';
  return account.match(new RegExp(`  function ${name}\\([\\s\\S]*?${end}`))?.[0] || '';
}

test('unchanged league counterproposals are rejected in the browser and database', () => {
  assert.match(account, /function isUnchangedResultProposal/);
  assert.match(account, /isUnchangedResultProposal\(task, resultDetails, actualSets, winner, playedOn, playedTime\)/);
  assert.match(account, new RegExp(decision.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(migration, /pending_proposal\.match_at is not distinct from official_match_at/);
  assert.match(migration, /pending_proposal\.result_details[\s\S]*pending_proposal\.actual_sets[\s\S]*pending_proposal\.winner/);
  assert.match(migration, new RegExp(decision.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('league comparison includes score, winner, set result, and Berlin match time', () => {
  const compare = vm.runInNewContext(`(() => {
    ${extractFunction('getBerlinMatchAtParts', 'buildMatchAtValue')}
    ${extractFunction('isUnchangedResultProposal', 'getTaskNumber')}
    return isUnchangedResultProposal;
  })()`, { Intl, Date, Object, Number, String });
  const task = {
    task_type: 'review',
    proposed_result: '6:3, 6:4',
    proposed_sets: '2:0',
    proposed_winner: 1,
    proposed_match_at: '2026-09-22T08:30:00Z'
  };

  assert.equal(compare(task, '6:3, 6:4', '2:0', 1, '2026-09-22', '10:30'), true);
  assert.equal(compare(task, '6:3, 6:3', '2:0', 1, '2026-09-22', '10:30'), false);
  assert.equal(compare(task, '6:3, 6:4', '2:0', 1, '2026-09-22', '10:31'), false);
});

test('unchanged training alternatives are compared canonically before replacement', () => {
  assert.match(account, /function getTrainingProposalSignature/);
  assert.match(account, /getTrainingProposalSignature\(editedTraining\) === getTrainingProposalSignature/);
  assert.match(migration, /select public\.create_training_session[\s\S]*into new_session_id/);
  assert.match(migration, /proposals_are_equal :=[\s\S]*full join[\s\S]*if proposals_are_equal then/);
  assert.match(migration, /delete from public\.training_sessions where id = selected_session\.id;[\s\S]*return new_session_id/);
});

test('training comparison ignores harmless player ordering but detects changed results', () => {
  const signatureSource = extractFunction('getTrainingProposalSignature', 'getTrainingSetData');
  const signature = vm.runInNewContext(`(() => { ${signatureSource}\nreturn getTrainingProposalSignature; })()`, { JSON, String });
  const stored = {
    played_on: '2026-09-22',
    display_time: '10:30:00',
    player_ids: ['a', 'b', 'c', 'd'],
    rounds: [{
      team_one_ids: ['a', 'b'],
      team_two_ids: ['c', 'd'],
      result_format: 'two_sets',
      result_details: '6:3, 6:4'
    }]
  };
  const submitted = {
    playedOn: '2026-09-22',
    displayTime: '10:30',
    playerIds: ['d', 'c', 'b', 'a'],
    rounds: [{
      teamOneIds: ['b', 'a'],
      teamTwoIds: ['d', 'c'],
      resultFormat: 'two_sets',
      resultDetails: '6:3, 6:4'
    }]
  };

  assert.equal(signature(stored), signature(submitted));
  submitted.rounds[0].resultDetails = '6:3, 6:3';
  assert.notEqual(signature(stored), signature(submitted));
});
