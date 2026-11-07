const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('PostgreSQL: booking order, rebooking, precision, permissions and shared cancellation', {
  skip: !process.env.PADEL_PGLITE_MODULE && 'Set PADEL_PGLITE_MODULE to the installed @electric-sql/pglite module',
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PADEL_PGLITE_MODULE).href);
  const db = new PGlite();
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/court-booking-schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261106190000_court_booking_workflow.sql'), 'utf8');
  const assignmentMigration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261107120000_booking_mail_match_assignment.sql'), 'utf8');
  try {
    await db.exec(fixture);
    await db.exec(migration);
    await db.exec(`alter table auth.users add column email text, add column email_confirmed_at timestamptz;
      alter table public.seasons add column label text;`);
    await db.exec(assignmentMigration);
    await db.exec("set request.jwt.claim.role = 'service_role'");
    const record = async (id, cancelled, occurred, precision = 1, duration = 60, court = 'Indoor H2') => {
      const result = await db.query(`select public.record_court_booking($1, null, $2, 'Testgruppe',
        '2099-10-06T10:30:00Z', '2099-10-06T10:30:00Z'::timestamptz + $3 * interval '1 minute', $4, $5, $6) as value`,
      [id, court, duration, cancelled, occurred, precision]);
      return result.rows[0].value;
    };
    // A cancellation arriving first must survive an older confirmation.
    assert.equal((await record(null, true, '2099-10-05T09:21:00Z', 60)).status, 'cancelled');
    assert.equal((await record('old', false, '2099-10-01T08:56:00Z', 60)).status, 'cancelled');
    assert.equal((await db.query('select count(*)::int as n from private.court_bookings where cancelled_at is null')).rows[0].n, 0);
    // A clearly later rebooking with its own ID stays active despite old mail.
    const active = await record('new', false, '2099-10-05T10:00:00Z', 60);
    assert.equal(active.status, 'active');
    assert.equal((await record(null, true, '2099-10-05T09:21:00Z', 60)).status, 'active');
    assert.equal((await record('different', false, '2099-10-05T11:00:00Z', 60)).status, 'needs_review');
    assert.equal((await record(null, true, '2099-10-05T10:00:10Z')).status, 'needs_review');
    assert.equal((await record(null, true, '2099-10-05T11:00:00Z', 60)).status, 'cancelled');
    assert.equal((await record('new', false, '2099-10-05T12:00:00Z')).status, 'cancelled');
    const ninety = await record('ninety', false, '2099-10-05T10:00:00Z', 1, 90, 'Indoor H1');
    assert.equal(ninety.status, 'active');
    assert.equal((await record(null, true, '2099-10-05T11:00:00Z', 1, 90, 'Indoor H1')).status, 'cancelled');
    await assert.rejects(record('bad-duration', false, '2099-10-05T12:00:00Z', 1, 120));
    await db.exec("set request.jwt.claim.role = 'authenticated'");
    await assert.rejects(record('unauthorized', false, '2099-10-05T12:00:00Z'));
    await db.exec("set request.jwt.claim.role = 'service_role'");
    assert.equal((await db.query(`select has_function_privilege('anon',
      'public.record_court_booking(text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,integer)', 'execute') as allowed`)).rows[0].allowed, false);
    // An assigned booking creates one shared task, resolved by any participant.
    await db.exec(`insert into auth.users (id, email, email_confirmed_at) values
        ('00000000-0000-0000-0000-000000000001', 'p1@example.com', now()),
        ('00000000-0000-0000-0000-000000000002', 'p2@example.com', now());
      insert into public.profiles values ('00000000-0000-0000-0000-000000000001', 'p1', 'player'),
        ('00000000-0000-0000-0000-000000000002', 'p2', 'player');
      insert into public.seasons (id, label, results_entry_enabled) values ('test', 'Test', true);
      insert into public.leagues values ('test', 'liga', 'Testliga');
      insert into public.matches (id, season_id, league_id, display_label) values ('test-partie-1', 'test', 'liga', 'Partie 1');
      insert into public.match_players values ('test-partie-1', 'p1', 1), ('test-partie-1', 'p2', 2),
        ('test-partie-1', 'p3', 1), ('test-partie-1', 'p4', 2);`);
    const assigned = await record('assigned', false, '2099-10-05T13:00:00Z', 1, 90, 'Indoor H3');
    await db.exec("set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'");
    await db.query("select public.schedule_match('test-partie-1', '2099-10-06 12:30'::timestamp, $1)", [assigned.bookingId]);
    await record(null, true, '2099-10-05T14:00:00Z', 1, 90, 'Indoor H3');
    assert.equal((await db.query('select * from public.get_my_court_booking_cancellation_tasks()')).rows.length, 1);
    await db.exec("set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002'");
    assert.equal((await db.query('select * from public.get_my_court_booking_cancellation_tasks()')).rows.length, 1);
    assert.equal((await db.query('select public.confirm_court_booking_cancellation($1) as result', [assigned.bookingId])).rows[0].result.status, 'unscheduled');
    assert.equal((await db.query('select match_at from public.matches where id = $1', ['test-partie-1'])).rows[0].match_at, null);
    await db.exec("set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'");
    assert.equal((await db.query('select * from public.get_my_court_booking_cancellation_tasks()')).rows.length, 0);
    assert.equal((await db.query('select public.confirm_court_booking_cancellation($1) as result', [assigned.bookingId])).rows[0].result.status, 'already_resolved');

    // A repeated authenticated forward assigns atomically, while unrelated and
    // ambiguous references leave the imported booking in the shared inbox.
    const autoAssign = async (id, email, number, season = null, court = 'Indoor H4') => (await db.query(`
      select public.record_court_booking_with_match(
        $1, null, $2, 'Testgruppe', '2099-11-06T10:30:00Z', '2099-11-06T11:30:00Z', false,
        '2099-11-01T08:00:00Z', 1, $3, $4, $5
      ) as result`, [id, court, email, number, season])).rows[0].result;
    const automaticallyAssigned = await autoAssign('auto', 'P1@example.com', 1, 'Test');
    assert.equal(automaticallyAssigned.assignment, 'assigned');
    assert.equal(automaticallyAssigned.matchId, 'test-partie-1');
    assert.equal((await db.query("select match_at from public.matches where id = 'test-partie-1'")).rows[0].match_at.toISOString(), '2099-11-06T10:30:00.000Z');
    assert.equal((await db.query("select match_id from private.court_bookings where provider_booking_id = 'auto'")).rows[0].match_id, 'test-partie-1');
    assert.equal((await autoAssign('auto', 'p1@example.com', 1, 'test')).assignment, 'already_assigned');
    const unauthorized = await autoAssign('foreign', 'p2@example.com', 2, 'Test', 'Indoor H1');
    assert.equal(unauthorized.assignment, 'match_not_found');
    assert.equal((await db.query("select match_id from private.court_bookings where provider_booking_id = 'foreign'")).rows[0].match_id, null);
    await db.exec(`insert into public.matches (id, season_id, league_id, display_label) values
        ('test-partie-2a', 'test', 'liga', 'Partie 2'), ('test-partie-2b', 'test', 'liga', 'Partie 2');
      insert into public.match_players values
        ('test-partie-2a', 'p1', 1), ('test-partie-2a', 'p2', 2), ('test-partie-2a', 'p3', 1), ('test-partie-2a', 'p4', 2),
        ('test-partie-2b', 'p1', 1), ('test-partie-2b', 'p2', 2), ('test-partie-2b', 'p3', 1), ('test-partie-2b', 'p4', 2);`);
    assert.equal((await autoAssign('ambiguous', 'p1@example.com', 2, null, 'Indoor H2')).assignment, 'ambiguous_match');
  } finally { await db.close(); }
});
