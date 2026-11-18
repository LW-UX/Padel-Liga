const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const court = require('../js/match-court.js');
const { headerMeta } = require('../js/match-statistics.js');
const root = path.resolve(__dirname, '..');

test('linked courts use full header labels and short card labels, with no placeholder', () => {
  const match = { seasonLabel: 'Winter 2026', matchAt: '2026-11-18T18:00:00Z' };
  assert.equal(headerMeta(match), 'Winter 2026\u00a0 · \u00a018.11.2026');
  for (const [code, label] of [['H1', 'Indoor H1'], ['H4', 'Indoor H4'], ['C1', 'Outdoor C1'], ['C10', 'Outdoor C10']]) {
    assert.equal(court.shortLabel({ courtCode: code }), code);
    assert.equal(headerMeta({ ...match, courtCode: code }), `Winter 2026\u00a0 · \u00a018.11.2026\u00a0 · \u00a0${label}`);
  }
  for (const code of [null, '', 'H5', 'C11', '<img>', 'Outdoor C1']) {
    assert.equal(court.shortLabel({ courtCode: code }), '');
    assert.equal(court.fullLabel({ courtCode: code }), '');
  }
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const formatMeta = vm.runInNewContext(`(${app.match(/function formatMatchMeta\(match, options = \{\}\) \{[\s\S]*?\n\}/)[0]})`, {
    window: { PadelMatchCourt: court },
    getMatchDisplayLabel: () => 'Partie 8',
    formatMatchDate: () => 'Mi, 18.11. 19:00',
    formatRelativeMatchDate: () => 'Heute 19:00'
  });
  assert.equal(formatMeta(match), 'Partie 8\u00a0 · \u00a0Mi, 18.11. 19:00');
  assert.equal(formatMeta({ ...match, courtCode: 'H2' }), 'Partie 8\u00a0 · \u00a0Mi, 18.11. 19:00\u00a0 · \u00a0H2');
  assert.equal(formatMeta({ ...match, courtCode: 'C10' }, { relative: true }), 'Partie 8\u00a0 · \u00a0Heute 19:00\u00a0 · \u00a0C10');
});

test('public court data preserves payloads and hides cancelled bookings and private information', { skip: !process.env.PGLITE_MODULE }, async t => {
  const { PGlite } = require(process.env.PGLITE_MODULE);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table public.matches(id text primary key, cancelled_at timestamptz);
    create table private.court_bookings(match_id text, court_name text, cancelled_at timestamptz, provider_booking_id text);
    revoke all on private.court_bookings from public, anon, authenticated;
    create function public.get_public_season(p_season_id text) returns jsonb language sql as $$
      select case when $1='missing' then null else jsonb_build_object('id',$1,'matches',coalesce((
        select jsonb_agg(jsonb_build_object('id',id,'winner',1) order by id desc) from public.matches), '[]'::jsonb)) end $$;
    create function public.get_public_match_detail(p_match_id text) returns jsonb language sql as $$
      select jsonb_build_object('matchId',id,'historyVersion',3) from public.matches where id=$1 $$;
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261118130000_public_match_court.sql'), 'utf8'));
  await db.exec(`
    insert into matches values ('indoor',null),('outdoor',null),('unbooked',null),('cancelled-booking',null),('cancelled-match',now()),('unknown',null);
    insert into private.court_bookings values
      ('indoor','CUPRA Indoor H2',null,'secret-one'),('outdoor','Outdoor C10',null,'secret-two'),
      ('cancelled-booking','Indoor H3',now(),'secret-three'),('cancelled-match','Indoor H4',null,'secret-four'),
      ('unknown','Unknown court',null,'secret-five');
    set role anon;
  `);
  const season = (await db.query("select public.get_public_season('winter') value")).rows[0].value;
  assert.deepEqual(season.matches.map(match => match.id), ['unknown','unbooked','outdoor','indoor','cancelled-match','cancelled-booking']);
  assert.deepEqual(Object.fromEntries(season.matches.map(match => [match.id, match.courtCode])), {
    unbooked: null, unknown: null, outdoor: 'C10', indoor: 'H2', 'cancelled-match': null, 'cancelled-booking': null
  });
  assert.ok(season.matches.every(match => match.winner === 1));
  for (const match of season.matches) {
    const detail = (await db.query('select public.get_public_match_detail($1) value', [match.id])).rows[0].value;
    assert.deepEqual(detail, { matchId: match.id, historyVersion: 3, courtCode: match.courtCode });
  }
  assert.doesNotMatch(JSON.stringify(season), /secret|"provider[^"]*"\s*:|"booking[^"]*"\s*:/i);
  assert.equal((await db.query("select public.get_public_match_detail('missing') value")).rows[0].value, null);
  assert.equal((await db.query("select public.get_public_season('missing') value")).rows[0].value, null);
  await assert.rejects(db.query("select private.match_court_code('indoor')"), /permission denied/);
  await assert.rejects(db.query("select private.get_public_match_detail_without_court('indoor')"), /permission denied/);
  await assert.rejects(db.query('select * from private.court_bookings'), /permission denied/);
});
