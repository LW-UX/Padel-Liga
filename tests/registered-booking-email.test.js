const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

test('Mailfreigabe prüft aktuelle bestätigte Konten aller Rollen ausschließlich serverseitig', {
  skip: !process.env.PADEL_PGLITE_MODULE && 'Requires local PGlite'
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PADEL_PGLITE_MODULE).href);
  const db = new PGlite();
  const allowed = async emails => (await db.query('select public.has_registered_court_booking_email($1) as allowed', [emails])).rows[0].allowed;
  try {
    await db.exec(fs.readFileSync(require.resolve('./fixtures/court-booking-schema.sql'), 'utf8'));
    await db.exec('alter table auth.users add column email text, add column email_confirmed_at timestamptz');
    await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20261107010000_registered_booking_email_forwarders.sql'), 'utf8'));
    await db.exec("set request.jwt.claim.role = 'service_role'");
    for (const [i, role] of ['player', 'tipper', 'admin', 'unconfirmed', 'unlinked'].entries()) {
      const id = `00000000-0000-0000-0000-00000000000${i + 1}`;
      await db.query('insert into auth.users values ($1, $2, $3)', [id, `${role}@example.com`, role === 'unconfirmed' ? null : '2026-11-06T12:00:00Z']);
      if (role !== 'unlinked') await db.query('insert into public.profiles values ($1, null, $2)', [id, role === 'unconfirmed' ? 'player' : role]);
    }
    for (const role of ['player', 'tipper', 'admin']) assert.equal(await allowed([` ${role.toUpperCase()}@EXAMPLE.COM `]), true);
    for (const email of ['unconfirmed@example.com', 'unlinked@example.com', 'stranger@example.com', 'player+alias@example.com', '']) {
      assert.equal(await allowed([email]), false);
    }
    assert.equal(await allowed(['stranger@example.com', 'player@example.com']), true);
    assert.equal(await allowed([]), false);
    assert.equal(await allowed(null), false);
    assert.equal(await allowed(Array(51).fill('player@example.com')), false);
    await db.exec("update auth.users set email = 'new@example.com' where email = 'player@example.com'");
    assert.equal(await allowed(['player@example.com']), false);
    assert.equal(await allowed(['new@example.com']), true);
    await db.exec("delete from public.profiles where app_role = 'tipper'");
    assert.equal(await allowed(['tipper@example.com']), false);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query("select has_function_privilege($1, 'public.has_registered_court_booking_email(text[])', 'execute') as allowed", [role])).rows[0].allowed, false);
    }
    await db.exec("set request.jwt.claim.role = 'authenticated'");
    assert.equal(await allowed(['new@example.com']), false);
  } finally { await db.close(); }
});
