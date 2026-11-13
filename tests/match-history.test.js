const test = require('node:test');
const assert = require('node:assert/strict');
const history = require('../js/match-history.js');
const { render } = require('../js/match-statistics.js');
const fixture = require('./fixtures/match-statistics.cjs');
const sequence = (a, b) => [...Array(b).fill(2), ...Array(a).fill(1)];
const part = winners => ({ winners, servers: winners.map(() => null), points: [] });
const straight = () => [part([1,2,1,2,1,2,1,1,1]), part([1,2,1,2,1,2,1,2,1,1])];
test('sets and match tiebreak are parsed including regular set tiebreaks', () => {
 assert.deepEqual(history.sections('7:6 (9:7), 4:6 – 12:10').map(s => [s.title,s.score,s.tiebreak,s.target]), [
  ['Satz 1',[7,6],[9,7],null], ['Satz 2',[4,6],null,null], ['Match-Tiebreak',[12,10],null,10]
 ]);
 assert.throws(() => history.sections('not a result'));
});
test('valid game sequences must reproduce every confirmed set', () => {
 const parts = straight();
 assert.equal(history.validate('6:3, 6:4', parts), parts);
 assert.throws(() => history.validate('6:4, 6:4', parts), /Endstand/);
 assert.throws(() => history.validate('6:3, 6:4', [parts[0]]), /alle Sätze/);
 assert.throws(() => history.validateSequence([1,1,1,1,1,1,2], [6,1], null), /ungültigen/);
 assert.throws(() => history.validateSequence(['1'], [1,0], null));
 assert.throws(() => history.validateSequence([3], [0,0], null));
});
test('match tiebreak requires points, two point margin and no play after completion', () => {
 const winners = [1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,1];
 assert.deepEqual(history.validateSequence(winners, [11,9], 10), [11,9]);
 assert.throws(() => history.validateSequence([...winners,2,1], [12,10], 10));
 assert.throws(() => history.validateSequence(winners.slice(0,-1), [11,9], 10), /Endstand/);
});
test('set tiebreak point history is optional but must be complete when provided', () => {
 const first = part([1,2,1,2,1,2,1,2,1,2,1,2,1]);
 const second = straight()[1];
 assert.ok(history.validate('7:6 (7:5), 6:4', [first,second]));
 first.points = [1,2,1,2,1,2,1,2,1,2,1,1];
 assert.ok(history.validate('7:6 (7:5), 6:4', [first,second]));
 first.points.pop();
 assert.throws(() => history.validate('7:6 (7:5), 6:4', [first,second]));
});
test('only known players can serve; no single server for a tiebreak', () => {
 const parts = straight();parts[0].servers[0] = 'a';
 assert.throws(() => history.validate('6:3, 6:4', parts));
 assert.ok(history.validate('6:3, 6:4', parts, [{playerId:'a'}]));
 const tb = part([1,2,1,2,1,2,1,2,1,2,1,2,1]); tb.servers[12]='a';
 assert.throws(() => history.validate('7:6 (7:5), 6:4', [tb,parts[1]], [{playerId:'a'}]));
});
test('history is below the poll and grouped chronologically without extra set navigation', () => {
 const d=fixture('analysis');d.result='6:3, 4:6 – 10:0';
 d.matchHistory={sections:[straight()[0],part([2,1,2,1,2,1,2,1,2,2]),part(Array(10).fill(1))],version:1};d.historyVersion=1;
 const html=render(d,null,{detailTab:'history',forecast:{error:true}});
 assert.ok(html.indexOf('data-match-forecast')<html.indexOf('data-statistics-tab'));
 assert.match(html,/id="match-statistics-tab-content"[^>]*hidden/);
 assert.ok(html.indexOf('Satz 1 · 6:3')<html.indexOf('Satz 2 · 4:6'));
 assert.ok(html.indexOf('Satz 2 · 4:6')<html.indexOf('Match-Tiebreak · 10:0'));
 assert.doesNotMatch(html,/data-history-edit/);
 assert.doesNotMatch(render(fixture()),/data-statistics-tab/);
});
test('editor is limited to confirmed admins and available database support', () => {
 const d=fixture('analysis');const opts={profile:{app_role:'admin'},session:{user:{email_confirmed_at:'yes'}}};
 assert.doesNotMatch(render(d,null,opts),/data-history-edit/);
 d.historyVersion=0;
 assert.match(render(d,null,opts),/data-history-edit/);
 assert.doesNotMatch(render(d,null,{...opts,profile:{app_role:'player'}}),/data-history-edit/);
 assert.doesNotMatch(render(d,null,{...opts,session:{user:{}}}),/data-history-edit/);
});
test('history escapes names and labels breaks only with a known opposing server', () => {
 const d=fixture('analysis');d.matchHistory={sections:straight()};
 d.players[2].displayName='<script>bad</script>';
 d.matchHistory.sections[0].servers[0]=d.players[2].playerId;
 const html=history.render(d);
 assert.match(html,/BREAK/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 d.matchHistory.sections[0].servers[0]=null;
 assert.doesNotMatch(history.render(d),/BREAK/);
});

test('detail navigation only appears with a saved history, including for admins', () => {
 const d=fixture('analysis');d.historyVersion=0;
 assert.doesNotMatch(render(d),/data-statistics-tab|Für diese Partie wurde noch kein Spielverlauf/);
 const opts={profile:{app_role:'admin'},session:{user:{email_confirmed_at:'yes'}}};
 assert.doesNotMatch(render(d,null,opts),/data-statistics-tab/);
 assert.match(render(d,null,opts),/data-history-edit/);
 assert.doesNotMatch(render(d,null,{...opts,historyDraft:history.empty(d.result)}),/data-statistics-tab/);
 d.matchHistory={sections:straight()};
 assert.match(render(d),/data-statistics-tab="history"/);
});
