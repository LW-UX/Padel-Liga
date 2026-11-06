const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const modulePromise = import('../supabase/functions/court-access-code/handler.ts');
const subject = { bookingId: 1, providerId: '00000000-0000-0000-0000-000000000001', startsAt: '2099-11-13T12:00:00Z', endsAt: '2099-11-13T13:00:00Z', courtNumber: 'H1' };
const refreshAt = '2099-11-13T11:52:00Z';
const request = (body = { matchId: 'm1' }, auth = 'Bearer fake-jwt') => new Request('https://example.invalid', {
  method: 'POST', headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body)
});
const dependencies = overrides => ({
  user: async () => ({ id: 'actor', confirmed: true }), subject: async () => subject,
  cookie: () => 'session=fake', readCode: async () => '1234#',
  claim: async () => ({ state: 'read', subject }),
  finish: async (_match, _user, _claim, _booking, code) => code
    ? { state: 'available', code, endsAt: subject.endsAt, refreshAt } : { state: 'unavailable' },
  ...overrides
});

test('Code nur nach Nutzerprüfung und aktueller Partieberechtigung, ohne private Kennungen in der Antwort', async () => {
  const { createHandler } = await modulePromise;
  const calls = [];
  const handler = createHandler(dependencies({
    subject: async (...args) => { calls.push(args); return subject; },
    readCode: async (...args) => { assert.deepEqual(args, [subject.providerId, 'session=fake']); return '1234#'; }
  }));
  const response = await handler(request());
  assert.deepEqual(await response.json(), { state: 'available', code: '1234#', endsAt: subject.endsAt, refreshAt });
  assert.deepEqual(calls, [['m1', 'actor'], ['m1', 'actor']]);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('ohne Berechtigung, Anmeldung oder gültige Eingabe erfolgt kein Playtomic-Aufruf', async () => {
  const { createHandler } = await modulePromise;
  for (const [overrides, req] of [
    [{ user: async () => null }, request()],
    [{ user: async () => ({ id: 'actor', confirmed: false }) }, request()],
    [{}, request(undefined, null)],
    [{ subject: async () => null }, request()],
    [{ subject: async () => ({ ...subject, courtNumber: '1' }) }, request()],
    [{ subject: async () => ({ ...subject, courtNumber: '10' }) }, request()],
    [{ subject: async () => ({ ...subject, courtNumber: 'H5' }) }, request()],
    [{ subject: async () => ({ ...subject, endsAt: '2000-01-01' }) }, request()],
    [{}, request({ matchId: 'm1', providerId: 'foreign' })],
    [{}, request({ matchId: 'm1', userId: 'admin' })],
    [{}, request(null)],
  ]) {
    let reads = 0;
    const handler = createHandler(dependencies({ ...overrides, readCode: async () => { reads++; return '1234#'; } }));
    const response = await handler(req);
    assert.notEqual((await response.json()).state, 'available');
    assert.equal(reads, 0);
  }
});

test('Stornierung, Neuzuordnung oder Ablauf während des Abrufs verhindern die Codeausgabe', async () => {
  const { createHandler } = await modulePromise;
  for (const current of [null, { ...subject, providerId: 'changed' }, { ...subject, endsAt: '2000-01-01' }]) {
    let calls = 0;
    const handler = createHandler(dependencies({ subject: async () => ++calls === 1 ? subject : current }));
    assert.deepEqual(await (await handler(request())).json(), { state: 'none' });
  }
});

test('fehlende Sitzung und Fehler liefern weder Cookies noch Fehlermeldungen des Anbieters', async () => {
  const { createHandler } = await modulePromise;
  for (const override of [{ cookie: () => undefined }, { readCode: async () => { throw new Error('secret'); } },
    { readCode: async () => '<script>secret</script>' }]) {
    assert.deepEqual(await (await createHandler(dependencies(override))(request())).json(), { state: 'unavailable' });
  }
});

test('Nur echte Leseversuche melden feste Fehlerklassen an die geschützte Störungserfassung', async () => {
  const { createHandler } = await modulePromise;
  for (const [override, expected] of [
    [{ cookie: () => undefined }, 'configuration'],
    [{ readCode: async () => { throw { reason: 'login_required', secret: 'not-stored' }; } }, 'login_required'],
    [{ readCode: async () => { throw { reason: 'invalid_request' }; } }, 'configuration'],
    [{ readCode: async () => { throw Error('not-stored'); } }, 'unavailable'],
    [{}, null],
  ]) {
    let actual;
    const handler = createHandler(dependencies({ ...override,
      finish: async (...args) => { actual = args[5]; return { state: 'unavailable' }; } }));
    await handler(request());
    assert.equal(actual, expected);
  }
});

function ui({ open = true, hidden = false, invoke } = {}) {
  const source = fs.readFileSync(require.resolve('../js/account.js'), 'utf8');
  const target = { textContent: '', hidden: true, isConnected: true,
    dataset: { hallCodeMatch: 'm1', hallCodeUntil: String(Date.parse(subject.endsAt)) } };
  const dialog = { open };
  const context = { Date, state: { session: { user: { id: 'actor' } }, client: {
    functions: { invoke: invoke || (async () => ({ data: { state: 'available', code: '1234#', endsAt: subject.endsAt } })) }
  } }, document: { hidden, getElementById: () => dialog, querySelectorAll: () => [target] },
  window: { clearTimeout: () => {}, setTimeout: () => 1 }, hallCodeRun: 0, hallCodeTimer: null,
  hallCodeCacheUser: null, hallCodeCache: new Map(), hallCodeRequests: new Map() };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function clearHallAccessCodes()'), source.indexOf('  function getProfileDisplayName()')), context);
  return { context, target, dialog };
}

test('Kontoanzeige entfernt Codes beim Schließen, Verbergen und Buchungsende', async () => {
  const { context, target } = ui();
  await context.loadHallAccessCodes();
  assert.equal(target.textContent, 'Hallencode: 1234#');
  context.document.hidden = true;
  await context.loadHallAccessCodes();
  assert.equal(target.textContent, '');
  context.document.hidden = false;
  target.dataset.hallCodeUntil = '1';
  await context.loadHallAccessCodes();
  assert.equal(target.hidden, true);
});

test('Antworten einer vorherigen Kontositzung erscheinen nicht nach einem Kontowechsel', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { context, target } = ui({ invoke: () => pending });
  const load = context.loadHallAccessCodes();
  context.clearHallAccessCodes();
  context.state.session.user.id = 'other';
  resolve({ data: { state: 'available', code: '1234#', endsAt: subject.endsAt } });
  await load;
  assert.equal(target.textContent, '');
});

test('Ein gültiger gemeinsamer Cache vermeidet sämtliche Playtomic-Aufrufe', async () => {
  const { createHandler } = await modulePromise;
  const handler = createHandler(dependencies({
    claim: async () => ({ state: 'available', code: '1234#', endsAt: subject.endsAt, refreshAt }),
    cookie: () => assert.fail('Kein Cookie für einen Cachetreffer nötig'),
    readCode: async () => assert.fail('Kein Playtomic-Aufruf bei Cachetreffer')
  }));
  assert.equal((await (await handler(request())).json()).code, '1234#');
});

test('Wiederholtes Rendern der Ansicht verwendet den gespeicherten Stand bis refreshAt', async () => {
  let calls = 0;
  const { context } = ui({ invoke: async () => {
    calls++;
    return { data: { state: 'available', code: '1234#', endsAt: subject.endsAt, refreshAt } };
  } });
  await context.loadHallAccessCodes();
  await context.loadHallAccessCodes();
  assert.equal(calls, 1);
});

test('PostgreSQL schützt die Zuordnung vor Fremd-, Tipper- und Direktzugriffen', {
  skip: !process.env.PADEL_PGLITE_MODULE && 'Requires local PGlite'
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PADEL_PGLITE_MODULE).href);
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync(require.resolve('./fixtures/court-booking-schema.sql'), 'utf8'));
    await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20261106190000_court_booking_workflow.sql'), 'utf8'));
    await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20261106230000_court_access_code_subject.sql'), 'utf8'));
    const actors = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004'];
    for (const [i, actor] of actors.entries()) {
      await db.query('insert into auth.users values ($1)', [actor]);
      await db.query('insert into public.profiles values ($1, $2, $3)', [actor, i === 3 ? 'p1' : `p${i + 1}`, ['player', 'player', 'admin', 'tipper'][i]]);
    }
    await db.exec(`insert into public.matches (id, match_at) values ('m1', '2099-11-13T11:00:00Z');
      insert into public.match_players values ('m1', 'p1', 1);
      insert into private.court_bookings (provider_booking_id, court_name, organizer, starts_at, ends_at, match_id, source_occurred_at)
      values ('${subject.providerId}', 'CUPRA Indoor H1', 'Testgruppe', '2099-11-13T11:00:00Z', '2099-11-13T12:00:00Z', 'm1', now());
      set request.jwt.claim.role = 'service_role';`);
    const read = async actor => (await db.query("select public.get_court_access_code_subject('m1', $1) as value", [actor])).rows[0].value;
    assert.equal((await read(actors[0])).providerId, subject.providerId);
    assert.equal(await read(actors[1]), null);
    assert.equal((await read(actors[2])).providerId, subject.providerId);
    assert.equal(await read(actors[3]), null);
    const claimId = '00000000-0000-0000-0000-000000000010';
    const otherClaim = '00000000-0000-0000-0000-000000000011';
    const claim = async (actor = actors[0], id = claimId) => (await db.query(
      "select public.claim_court_access_code_read('m1', $1, $2) as value", [actor, id])).rows[0].value;
    const finish = async code => (await db.query(
      "select public.finish_court_access_code_read('m1', $1, $2, 1, $3) as value", [actors[0], claimId, code])).rows[0].value;
    assert.equal((await claim(actors[1])).state, 'none');
    assert.equal((await claim()).state, 'read');
    assert.equal((await claim(actors[0], otherClaim)).state, 'pending', 'paralleler Abruf erhält keine zweite Leseaufgabe');
    assert.equal((await finish('1234#')).state, 'available');
    assert.equal((await claim()).code, '1234#', 'bereits gelesener Code wird gemeinsam verwendet');
    await db.exec("update private.court_bookings set starts_at = now() + interval '6 minutes', ends_at = now() + interval '66 minutes'; update public.matches set match_at = (select starts_at from private.court_bookings limit 1)");
    await db.exec("insert into private.court_access_codes(booking_id, code, phase) values (1, '1234#', 0)");
    assert.equal((await claim()).state, 'read', 'ab acht Minuten wird der erste Code nicht weiterverwendet');
    assert.equal((await finish('0800#')).code, '0800#');
    assert.equal((await claim()).code, '0800#', 'der zweite Code benötigt keinen weiteren Abruf');
    await db.exec("insert into public.result_proposals values ('m1', 'pending')");
    assert.equal((await claim()).state, 'none', 'eingetragenes Ergebnis beendet die Codeanzeige');
    await db.exec("delete from public.result_proposals");
    await db.exec("update private.court_access_codes set code = null, phase = -1");
    assert.equal((await claim()).state, 'read');
    assert.equal((await finish(null)).state, 'unavailable');
    assert.equal((await claim()).state, 'unavailable', 'Fehler führen zu einer Sperrfrist statt vieler Parallelabrufe');
    for (const number of ['H1', 'H2', 'H3', 'H4']) {
      await db.query('update private.court_bookings set court_name = $1', [`Indoor ${number}`]);
      assert.equal((await read(actors[0])).courtNumber, number);
    }
    for (const name of [...Array.from({ length: 10 }, (_, i) => `Court ${i + 1}`), 'Indoor H5', 'H10', 'Unbekannt']) {
      await db.query('update private.court_bookings set court_name = $1', [name]);
      assert.equal(await read(actors[0]), null);
    }
    await db.exec("update private.court_bookings set court_name = 'CUPRA Indoor H1'");
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query("select has_function_privilege($1, 'public.get_court_access_code_subject(text,uuid)', 'execute') as allowed", [role])).rows[0].allowed, false);
    }
    await db.exec("update public.matches set match_at = match_at + interval '1 minute'");
    assert.equal(await read(actors[0]), null);
    await db.exec("update public.matches set match_at = match_at - interval '1 minute'; update private.court_bookings set cancelled_at = now()");
    assert.equal(await read(actors[0]), null);
    await db.exec("update private.court_bookings set cancelled_at = null, match_id = null");
    assert.equal(await read(actors[0]), null);
  } finally { await db.close(); }
});
