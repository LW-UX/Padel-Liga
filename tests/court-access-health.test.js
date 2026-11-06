const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

test('Störungen, einmaliger Mailversand, Wiederherstellung und Rollen sind in PostgreSQL abgesichert', {
  skip: !process.env.PADEL_PGLITE_MODULE && 'Requires local PGlite'
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PADEL_PGLITE_MODULE).href);
  const db = new PGlite();
  const admin = '00000000-0000-0000-0000-000000000001';
  const player = '00000000-0000-0000-0000-000000000002';
  const unconfirmed = '00000000-0000-0000-0000-000000000003';
  const claimId = '00000000-0000-0000-0000-000000000010';
  const token = '00000000-0000-0000-0000-000000000020';
  const other = '00000000-0000-0000-0000-000000000021';
  const value = async (query, args = []) => (await db.query(query, args)).rows[0]?.value;
  const health = () => value('select public.get_my_court_access_health() as value');
  const claim = () => value("select public.claim_court_access_code_read('m1', $1, $2) as value", [admin, claimId]);
  const finish = (code, reason, id = claimId) => value("select public.finish_court_access_code_read_with_health('m1', $1, $2, 1, $3, $4) as value", [admin, id, code, reason]);
  const deliveries = async (lease = token) => (await db.query('select * from public.claim_court_access_alerts($1)', [lease])).rows;
  try {
    for (const path of ['./fixtures/court-booking-schema.sql', '../supabase/migrations/20261106190000_court_booking_workflow.sql',
      '../supabase/migrations/20261106230000_court_access_code_subject.sql']) {
      await db.exec(fs.readFileSync(require.resolve(path), 'utf8'));
    }
    await db.exec(`alter table auth.users add column email text, add column email_confirmed_at timestamptz;
      create or replace function private.user_email_is_confirmed(actor uuid) returns boolean language sql stable as $$
        select coalesce((select email_confirmed_at is not null from auth.users where id = actor), false) $$;`);
    await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20261107000000_court_access_health_alerts.sql'), 'utf8'));
    for (const [id, role, confirmed] of [[admin, 'admin', true], [player, 'player', true], [unconfirmed, 'admin', false]]) {
      await db.query('insert into auth.users values ($1, $2, $3)', [id, `${id}@example.invalid`, confirmed ? '2026-11-06T12:00:00Z' : null]);
      await db.query('insert into public.profiles values ($1, $2, $3)', [id, id === player ? 'p1' : null, role]);
    }
    await db.exec(`insert into public.matches(id, match_at) values ('m1', now() + interval '1 day'), ('m2', now() + interval '2 days');
      insert into public.match_players values ('m1', 'p1', 1);
      insert into private.court_bookings(provider_booking_id, court_name, organizer, starts_at, ends_at, match_id, source_occurred_at)
        select id || '-provider', 'Indoor H1', 'Test', match_at, match_at + interval '1 hour', id, now() from public.matches order by id;
      set request.jwt.claim.role = 'service_role';`);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    assert.equal((await health()).active, false);
    await finish(null, 'login_required', other); // forged/obsolete lease
    assert.equal((await health()).active, false);
    assert.equal((await claim()).state, 'read');
    await finish(null, 'login_required');
    assert.equal((await health()).reason, 'login_required');
    assert.equal((await health()).active, true);
    await db.exec('update private.court_access_codes set retry_after = null');
    await claim(); await finish(null, 'configuration');
    const first = await deliveries();
    assert.equal(first.length, 1, 'only confirmed admins; repeated failure stays one incident');
    assert.equal(first[0].reason, 'configuration');
    assert.equal(first[0].user_id, admin);
    assert.equal((await deliveries(other)).length, 0, 'concurrent dispatch cannot send twice');
    await db.query('select public.complete_court_access_alert($1, $2, $3, true)', [first[0].incident_id, admin, other]);
    assert.equal(await value('select sent_at is null as value from private.court_access_alert_deliveries'), true);
    await db.query('select public.complete_court_access_alert($1, $2, $3, false)', [first[0].incident_id, admin, token]);
    await db.exec('update private.court_access_alert_deliveries set retry_at = now()');
    const retried = await deliveries(other);
    assert.equal(retried[0].idempotency_key, first[0].idempotency_key, 'retry keeps provider deduplication key');
    await db.query('select public.complete_court_access_alert($1, $2, $3, true)', [first[0].incident_id, admin, other]);
    assert.equal((await deliveries()).length, 0);

    await db.exec('update private.court_access_codes set retry_after = null');
    await claim(); await finish('1234#', null);
    assert.equal((await health()).active, false);
    // A later incident gets its own mail. A cache hit never resolves it.
    await db.exec('update private.court_access_codes set code = null');
    await claim(); await finish(null, 'unavailable');
    const second = await deliveries();
    assert.equal(second.length, 1);
    assert.notEqual(second[0].idempotency_key, first[0].idempotency_key);
    const stillCurrent = () => value('select public.court_access_alert_is_current($1, $2, $3) as value', [second[0].incident_id, admin, token]);
    assert.equal(await stillCurrent(), true);

    // A request started before the latest failure cannot clear its warning.
    await value("select public.claim_court_access_code_read('m2', $1, $2) as value", [admin, other]);
    await db.exec("update private.court_access_codes set claim_until = now() - interval '1 minute' where booking_id = 2");
    await value("select public.finish_court_access_code_read_with_health('m2', $1, $2, 2, '5678#', null) as value", [admin, other]);
    assert.equal((await health()).active, true);
    await db.exec('update private.court_access_codes set retry_after = null');
    await claim(); await finish('1234#', null);
    assert.equal((await health()).active, false);
    assert.equal(await stillCurrent(), false, 'claimed mail is suppressed after recovery');
    assert.equal((await deliveries()).length, 0, 'recovery cancels queued unsent mail');

    for (const role of ['anon', 'authenticated']) {
      assert.equal(await value("select has_table_privilege($1, 'private.court_access_health', 'select') as value", [role]), false);
      assert.equal(await value("select has_function_privilege($1, 'public.claim_court_access_alerts(uuid,integer)', 'execute') as value", [role]), false);
      assert.equal(await value("select has_function_privilege($1, 'public.finish_court_access_code_read_with_health(text,uuid,uuid,bigint,text,text)', 'execute') as value", [role]), false);
    }
    for (const id of [player, unconfirmed]) {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
      await assert.rejects(health(), /Nur für bestätigte Admin/);
    }
    await db.exec("set request.jwt.claim.role = 'authenticated'");
    assert.deepEqual(await deliveries(), []);
  } finally { await db.close(); }
});

test('Mailinhalt unterscheidet Anmeldung und Abrufstörung, Versandfehler bleiben ohne private Details', async () => {
  const { renderCourtAccessAlert, dispatchCourtAccessAlerts } = await import('../supabase/functions/send-match-notifications/court-access-alerts.ts');
  const login = renderCourtAccessAlert('login_required', 'https://example.invalid/');
  assert.match(login.subject, /erneuern/);
  assert.match(login.text, /Cookie/);
  assert.match(login.html, /konto=1/);
  assert.match(renderCourtAccessAlert('unavailable', 'https://example.invalid/').subject, /prüfen/);
  const completed = [];
  const jobs = [1, 2].map(incident_id => ({ incident_id, user_id: 'admin', recipient_email: 'admin@example.invalid', reason: 'unavailable', idempotency_key: `incident-${incident_id}` }));
  const result = await dispatchCourtAccessAlerts({ siteUrl: 'https://example.invalid/', claim: async () => jobs, current: async () => true,
    send: async job => { if (job.incident_id === 1) throw Error('private-provider-response'); return true; },
    complete: async (_job, _token, success) => completed.push(success) });
  assert.deepEqual(result, { claimed: 2, sent: 1, failed: 1 });
  assert.deepEqual(completed, [false, true]);
  assert.doesNotMatch(JSON.stringify(result), /private-provider/);
  const obsolete = await dispatchCourtAccessAlerts({ siteUrl: 'https://example.invalid/', claim: async () => jobs, current: async () => false,
    send: async () => assert.fail('no obsolete incident mail'), complete: async () => assert.fail('nothing sent') });
  assert.equal(obsolete.sent, 0);
});

function ui(role = 'admin') {
  const source = fs.readFileSync(require.resolve('../js/account.js'), 'utf8');
  const target = { hidden: true, textContent: '' };
  const context = { state: { session: { user: { id: 'admin' } }, profile: { app_role: role }, courtAccessHealth: null,
    client: { rpc: async () => ({ data: { active: true, reason: 'login_required' } }) } },
    document: { querySelector: () => target }, courtAccessHealthRun: 0 };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function renderCourtAccessHealth()'), source.indexOf('  function deriveDisplayNameFromEmail(')), context);
  return { context, target };
}

test('Admin-Hinweis verschwindet nach erfolgreichem Abruf und bleibt anderen Rollen verborgen', async () => {
  const { context, target } = ui();
  await context.loadCourtAccessHealth();
  assert.equal(target.hidden, false);
  assert.match(target.textContent, /Cookie ersetzen/);
  context.state.client.rpc = async () => ({ data: { active: false } });
  await context.loadCourtAccessHealth();
  assert.equal(target.hidden, true);
  for (const role of ['player', 'tipper']) {
    const fixture = ui(role);
    fixture.context.state.client.rpc = () => assert.fail('only admins load operational status');
    await fixture.context.loadCourtAccessHealth();
    assert.equal(fixture.target.hidden, true);
  }
});

test('Ein verspäteter Statusabruf kann eine neue Kontositzung nicht überschreiben', async () => {
  const { context, target } = ui();
  let resolve;
  context.state.client.rpc = () => new Promise(done => { resolve = done; });
  const old = context.loadCourtAccessHealth();
  context.state.session = null;
  await context.loadCourtAccessHealth();
  resolve({ data: { active: true, reason: 'login_required' } });
  await old;
  assert.equal(target.hidden, true);
});
