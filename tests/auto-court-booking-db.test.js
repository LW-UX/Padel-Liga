const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const migration = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8');

test('automatic league booking assignment, both orders, exclusions and half-hour scheduling', {
  skip: !process.env.PADEL_PGLITE_MODULE && 'Requires local PGlite',
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PADEL_PGLITE_MODULE).href);
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, 'fixtures/court-booking-schema.sql'), 'utf8'));
    await db.exec(`alter table auth.users add column email text, add column email_confirmed_at timestamptz;
      alter table public.seasons add column label text, add column is_active boolean default true, add column tournament_mode text default 'none';
      alter table public.matches add column competition_stage text default 'league';
      create table public.training_sessions (id bigint primary key, played_on date, display_time time,
        status text, created_by uuid, player_ids text[]);
      create function private.training_session_at(date, time) returns timestamptz language sql immutable
        as $$ select ($1 + $2) at time zone 'Europe/Berlin' $$;`);
    await db.exec(migration('20261106190000_court_booking_workflow.sql'));
    await db.exec(migration('20261107120000_booking_mail_match_assignment.sql'));
    await db.exec(migration('20261111140000_training_court_bookings.sql'));
    await db.exec(migration('20261113140000_auto_assign_league_court_bookings.sql'));
    await db.exec(migration('20261117140000_booking_import_ignore_organizer.sql'));
    await db.exec(`set request.jwt.claim.role = 'service_role';
      set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
      insert into auth.users values ('00000000-0000-0000-0000-000000000001', 'p1@example.com', now());
      insert into public.profiles values ('00000000-0000-0000-0000-000000000001', 'p1', 'player');
      insert into public.seasons (id, results_entry_enabled, label) values ('test', true, 'Test');
      insert into public.leagues values ('test', 'liga', 'Liga');`);
    const addMatch = async (number, time, extra = {}) => {
      const id = `test-partie-${number}`;
      await db.query(`insert into public.matches (id, season_id, league_id, display_label, match_at,
          actual_sets, cancelled_at, competition_stage)
        values ($1, 'test', 'liga', $2, $3, $4, $5, $6)`,
      [id, `Partie ${number}`, time, extra.result ?? null, extra.cancelled ?? null, extra.stage || 'league']);
      for (let i = 1; i <= (extra.players ?? 4); i++) {
        await db.query('insert into public.match_players values ($1, $2, $3)', [id, `p${i}`, i % 2 + 1]);
      }
      if (extra.pending) await db.query("insert into public.result_proposals values ($1, 'pending')", [id]);
      return id;
    };
    const record = async (id, start, name = 'Headsquare United', court = 'H1', opts = {}) => {
      const result = await db.query(`select public.record_court_booking_with_match(
        $1, null, $2, $3, $4, $4::timestamptz + interval '90 minutes', $5,
        '2026-10-01T08:00:00Z', 1, $6, $7, $8) as value`,
      [id, court, name, start, opts.cancelled || false, opts.forwarder || null, opts.number ?? null, opts.season ?? null]);
      return result.rows[0].value;
    };
    const linked = async id => (await db.query('select match_id from private.court_bookings where id = $1', [id])).rows[0].match_id;
    const schedule = (id, time, bookingId = null) => db.query('select public.schedule_match($1, $2::timestamp, $3)', [id, time, bookingId]);

    // The exact time wins over a numerically lower match 15 minutes away.
    await addMatch(10, '2099-10-06T10:30:00Z');
    await addMatch(2, '2099-10-06T10:15:00Z');
    const first = await record('first', '2099-10-06T10:30:00Z', ' HEADSQUARE   United ', 'H1', { forwarder: 'unrelated@example.com' });
    assert.equal(first.matchId, 'test-partie-10');
    assert.equal(first.actorUserId, '00000000-0000-0000-0000-000000000001');
    assert.equal((await db.query("select match_at from public.matches where id = 'test-partie-10'")).rows[0].match_at.toISOString(), '2099-10-06T10:30:00.000Z');
    assert.equal((await record('second', '2099-10-06T10:30:00Z', 'Headsquare United', 'H2')).matchId, 'test-partie-2');
    assert.equal((await record('first', '2099-10-06T10:30:00Z', ' HEADSQUARE   United ', 'H1')).assignment, 'already_assigned');
    assert.equal(await linked(first.bookingId), 'test-partie-10', 'duplicate mail keeps its original match');

    // Private names never match, including a name that merely contains the club name.
    await addMatch(3, '2099-10-07T10:30:00Z');
    for (const [index, name] of ['Privat', 'Headsquare United privat'].entries()) {
      const privateBooking = await record(`private-${index}`, '2099-10-07T10:30:00Z', name, `H${index + 1}`);
      assert.equal(await linked(privateBooking.bookingId), null);
    }
    // Booking first: saving the same appointment automatically takes the existing booking.
    await addMatch(4, null);
    const early = await record('early', '2099-10-08T10:30:00Z');
    assert.equal(early.assignment, 'not_requested');
    await schedule('test-partie-4', '2099-10-08 12:30');
    assert.equal(await linked(early.bookingId), 'test-partie-4');
    const third = await record('third', '2099-10-08T10:30:00Z', 'Headsquare United', 'H3');
    assert.equal(await linked(third.bookingId), null, 'existing active assignment is never replaced');
    await schedule('test-partie-4', '2099-10-08 12:30');
    assert.equal(await linked(early.bookingId), 'test-partie-4');
    assert.equal(await linked(third.bookingId), null);

    // Inclusive positive tolerance, but no matching beyond either edge.
    await addMatch(5, '2099-10-09T10:45:00Z');
    assert.equal((await record('plus15', '2099-10-09T10:30:00Z')).matchId, 'test-partie-5');
    await addMatch(6, '2099-10-10T10:46:00Z');
    await addMatch(7, '2099-10-10T10:14:00Z');
    assert.equal((await record('outside', '2099-10-10T10:30:00Z')).assignment, 'not_requested');
    await addMatch(8, '2099-10-11T21:45:00Z'); // 23:45 Berlin, next booking is 00:00.
    assert.equal((await record('midnight', '2099-10-11T22:00:00Z')).assignment, 'not_requested');

    // Training assignments, non-league rounds and non-editable matches are excluded.
    await addMatch(11, '2099-10-12T10:30:00Z', { result: '2:0' });
    await addMatch(12, '2099-10-12T10:30:00Z', { cancelled: '2026-10-01T00:00:00Z' });
    await addMatch(13, '2099-10-12T10:30:00Z', { pending: true });
    await addMatch(14, '2099-10-12T10:30:00Z', { stage: 'final_four' });
    await addMatch(15, '2099-10-12T10:30:00Z', { players: 3 });
    assert.equal((await record('excluded', '2099-10-12T10:30:00Z')).assignment, 'not_requested');
    const training = await record('training', '2099-10-13T10:30:00Z');
    await db.exec("insert into public.training_sessions (id, played_on, display_time, status) values (1, '2099-10-13', '12:30', 'scheduled')");
    await db.query('update private.court_bookings set training_session_id = 1 where id = $1', [training.bookingId]);
    await addMatch(16, '2099-10-13T10:30:00Z');
    assert.equal((await record('training', '2099-10-13T10:30:00Z')).assignment, 'not_requested');
    await schedule('test-partie-16', '2099-10-13 12:30');
    assert.equal(await linked(training.bookingId), null);
    await assert.rejects(schedule('test-partie-16', '2099-10-13 12:30', training.bookingId), /nicht mehr verfügbar/);
    assert.equal((await record('training', '2099-10-13T10:30:00Z', 'Headsquare United', 'H1', { number: 16, forwarder: 'p1@example.com' })).assignment, 'booking_unavailable');

    // Normal manual forwards need no additional match reference. Exercise the
    // real webhook parser and database assignment together, with/without a note.
    const { createBookingWebhook } = await import('../supabase/functions/receive-court-booking/handler.ts');
    for (const [index, note] of ['', 'Hier die Buchung.\n\n'].entries()) {
      const matchId = await addMatch(30 + index, '2099-11-19T11:30:00Z');
      const handler = createBookingWebhook({ apiKey: 'test', signingSecret: 'test',
        recipient: 'booking@example.com', forwarders: ['forwarder@example.com'] }, {
        verify: body => JSON.parse(body),
        fetch: async url => new Response(url.startsWith('https://api.resend.com/')
          ? JSON.stringify({ to: ['booking@example.com'], from: 'forwarder@example.com',
            authentication: { dmarc: 'pass' }, raw: { download_url: 'https://download.example.com/mail' } })
          : 'raw mail'),
        parseMime: async () => ({ from: { address: 'forwarder@example.com' },
          subject: 'WG: Playtomic - Buchungsbestätigung / Ticket',
          text: `${note}Von: Playtomic <no-reply@playtomic.io>\nDatum: Dienstag, 17. November 2026 um 09:56\nAn: Test <forwarder@example.com>\nBetreff: Playtomic - Buchungsbestätigung / Ticket\n\nReservierungsdaten\nName Headsquare United\nDatum 19.11.99\nZeit 12:30-13:30\nClub Lucky Star Padel @ Das Anders , Indoor H${index + 1}\nInfos über die Bezahlung`,
          attachments: [] }),
        record: async params => {
          assert.equal(params.p_match_number, null);
          assert.equal(params.p_season_hint, null);
          return (await db.query(`select public.record_court_booking_with_match(
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as value`, Object.values(params))).rows[0].value;
        },
      });
      const response = await handler(new Request('https://project.example.com/webhook', {
        method: 'POST', body: JSON.stringify({ type: 'email.received',
          data: { email_id: '00000000-0000-0000-0000-000000000001' } }),
      }));
      const result = await response.json();
      assert.equal(result.status, 'processed');
      assert.equal(result.result.assignment, 'assigned');
      assert.equal(result.result.matchId, matchId);
    }

    // A bare "Partie X" targets the active season even if another editable
    // season contains the same number. An explicit season still overrides it.
    await db.exec(`insert into public.seasons (id, results_entry_enabled, label, is_active)
        values ('next', true, 'Next', false);
      insert into public.leagues values ('next', 'liga', 'Liga');`);
    await addMatch(40, '2099-11-20T11:30:00Z');
    await db.exec(`insert into public.matches (id, season_id, league_id, display_label, match_at)
        values ('next-partie-40', 'next', 'liga', 'Partie 40', '2099-11-20T11:30:00Z');
      insert into public.match_players select 'next-partie-40', player_id, team
        from public.match_players where match_id = 'test-partie-40';`);
    assert.equal((await record('active-reference', '2099-11-20T11:30:00Z', 'Headsquare United', 'H1',
      { number: 40, forwarder: 'p1@example.com' })).matchId, 'test-partie-40');
    assert.equal((await record('explicit-season', '2099-11-20T11:30:00Z', 'Headsquare United', 'H2',
      { number: 40, season: 'Next', forwarder: 'p1@example.com' })).matchId, 'next-partie-40');
    await addMatch(41, '2099-11-21T11:30:00Z');
    await db.exec("update public.matches set season_id = 'next' where id = 'test-partie-41'");
    assert.equal((await record('inactive-auto', '2099-11-21T11:30:00Z')).assignment, 'not_requested');
    assert.equal((await record('inactive-reference', '2099-11-21T11:30:00Z', 'Headsquare United', 'H2',
      { number: 41, forwarder: 'p1@example.com' })).assignment, 'match_not_found');

    // An active Cup can run alongside the active league. Their dates decide
    // bare match references; forwards without a reference also support Cup games.
    await db.exec(`insert into public.seasons (id, results_entry_enabled, label, is_active, tournament_mode)
        values ('cup', true, 'Cup', true, 'knockout_redraw');
      insert into public.leagues values ('cup', 'liga', 'Cup');`);
    const addCup = async (number, time) => {
      const source = await addMatch(number, time);
      await db.query(`update public.matches set id = $2, season_id = 'cup',
        competition_stage = 'quarterfinal', display_label = $3 where id = $1`,
        [source, `cup-quarterfinal-${number}`, `Viertelfinale ${number}`]);
      await db.query('update public.match_players set match_id = $2 where match_id = $1',
        [source, `cup-quarterfinal-${number}`]);
      return `cup-quarterfinal-${number}`;
    };
    const cup42 = await addCup(42, '2099-12-02T11:30:00Z');
    await addMatch(42, '2099-12-01T11:30:00Z');
    assert.equal((await record('cup-reference', '2099-12-02T11:30:00Z', 'Headsquare United', 'H1',
      { number: 42, forwarder: 'p1@example.com' })).matchId, cup42);
    assert.equal((await record('league-reference', '2099-12-01T11:30:00Z', 'Headsquare United', 'H1',
      { number: 42, forwarder: 'p1@example.com' })).matchId, 'test-partie-42');
    const cup43 = await addCup(43, '2099-12-03T11:30:00Z');
    assert.equal((await record('cup-no-reference', '2099-12-03T11:30:00Z')).matchId, cup43);
    await addCup(44, '2099-12-04T11:30:00Z');
    await addMatch(44, '2099-12-04T11:30:00Z');
    const ambiguous = await record('competition-conflict', '2099-12-04T11:30:00Z');
    assert.equal(ambiguous.assignment, 'ambiguous_match');
    assert.equal(await linked(ambiguous.bookingId), null);
    assert.equal((await record('reference-conflict', '2099-12-04T11:30:00Z', 'Headsquare United', 'H2',
      { number: 44, forwarder: 'p1@example.com' })).assignment, 'ambiguous_match');
    assert.equal((await record('date-no-hit', '2099-12-05T11:30:00Z', 'Headsquare United', 'H1',
      { number: 44, forwarder: 'p1@example.com' })).assignment, 'ambiguous_match');

    // On the same day, booking time decides across competitions, even
    // inside the tolerance. Duplicate timestamps remain unresolved.
    await addCup(45, '2099-12-06T11:45:00Z');
    await addMatch(45, '2099-12-06T11:30:00Z');
    assert.equal((await record('nearest-auto', '2099-12-06T11:30:00Z')).matchId, 'test-partie-45');
    const cup46 = await addCup(46, '2099-12-07T13:30:00Z');
    await addMatch(46, '2099-12-07T11:30:00Z');
    assert.equal((await record('nearest-reference', '2099-12-07T13:30:00Z', 'Headsquare United', 'H1',
      { number: 46, forwarder: 'p1@example.com' })).matchId, cup46);
    await addCup(47, '2099-12-08T11:45:00Z');
    await addMatch(47, '2099-12-08T11:15:00Z');
    assert.equal((await record('equal-distance', '2099-12-08T11:30:00Z', 'Headsquare United', 'H1',
      { number: 47, forwarder: 'p1@example.com' })).matchId, 'test-partie-47');
    await addCup(48, '2099-12-09T11:45:00Z');
    await addMatch(48, '2099-12-09T11:15:00Z');
    assert.equal((await record('equal-distance-auto', '2099-12-09T11:30:00Z')).matchId, 'test-partie-48');
    await addMatch(49, '2099-12-10T11:30:00Z');
    await addMatch(50, '2099-12-10T11:30:00Z');
    assert.equal((await record('same-league-conflict', '2099-12-10T11:30:00Z')).assignment, 'ambiguous_match');

    // An existing match/booking pair is excluded from subsequent matching,
    // even when the second match and booking have exactly the same start.
    await addMatch(60, '2099-12-11T11:30:00Z');
    const paired = await record('paired-first', '2099-12-11T11:30:00Z');
    assert.equal(paired.matchId, 'test-partie-60');
    await addMatch(61, null);
    await schedule('test-partie-61', '2099-12-11 12:30');
    const pairedSecond = await record('paired-second', '2099-12-11T11:30:00Z', 'Headsquare United', 'H2');
    assert.equal(pairedSecond.matchId, 'test-partie-61');
    assert.equal(await linked(paired.bookingId), 'test-partie-60');
    assert.equal((await record('paired-first', '2099-12-11T11:30:00Z')).matchId, 'test-partie-60');
    assert.equal((await record('paired-second', '2099-12-11T11:30:00Z', 'Headsquare United', 'H2')).matchId, 'test-partie-61');

    // The second booking can arrive before the second appointment. Saving
    // the first appointment again must not consume or replace that booking.
    await addMatch(62, '2099-12-12T11:30:00Z');
    const bookingFirst = await record('booking-first-paired', '2099-12-12T11:30:00Z');
    const waiting = await record('booking-first-waiting', '2099-12-12T11:30:00Z', 'Headsquare United', 'H2');
    assert.equal(waiting.assignment, 'not_requested');
    await schedule('test-partie-62', '2099-12-12 12:30');
    assert.equal(await linked(bookingFirst.bookingId), 'test-partie-62');
    assert.equal(await linked(waiting.bookingId), null);
    await addMatch(63, null);
    await schedule('test-partie-63', '2099-12-12 12:30');
    assert.equal(await linked(waiting.bookingId), 'test-partie-63');
    assert.equal(await linked(bookingFirst.bookingId), 'test-partie-62');

    // A cancelled booking, a past booking and invalid mail instructions cannot auto-link.
    await addMatch(17, '2099-10-14T10:30:00Z');
    assert.equal((await record('cancelled', '2099-10-14T10:30:00Z', 'Headsquare United', 'H1', { cancelled: true })).assignment, 'not_requested');
    assert.equal((await record('invalid', '2099-10-14T10:30:00Z', 'Headsquare United', 'H2', { number: -1 })).assignment, 'invalid_reference');
    await addMatch(18, '2020-10-14T10:30:00Z');
    assert.equal((await record('past', '2020-10-14T10:30:00Z')).assignment, 'not_requested');
    for (const minute of ['15', '45', '30:01']) {
      await assert.rejects(schedule('test-partie-16', `2099-10-13 12:${minute}`), /volle oder halbe Stunde/);
    }
    await assert.rejects(db.exec("update public.training_sessions set display_time = '12:15' where id = 1"), /volle oder halbe Stunde/);
    await db.exec("update public.training_sessions set status = 'pending', display_time = '12:17' where id = 1");
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query(`select has_function_privilege($1,
        'private.auto_assign_league_court_booking(bigint,text)', 'execute') as allowed`, [role])).rows[0].allowed, false);
    }
    await db.exec("set request.jwt.claim.role = 'authenticated'");
    await assert.rejects(record('forbidden', '2099-10-15T10:30:00Z'), /Nicht erlaubt/);
  } finally { await db.close(); }
});
