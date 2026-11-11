const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const modulePromise = import('../supabase/functions/_shared/playtomic-session.ts');

const jwt = (exp, tag = 'a') => `${tag}${tag}${tag}.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.sig`;
const NOW = 1_800_000_000_000;
const secret = (accessExp = NOW / 1000 - 60) => `pt_auth_access_token=${jwt(accessExp)}; pt_auth_refresh_token=${jwt(NOW / 1000 + 86400, 'r')}`;

function memoryStore() {
  const state = { row: null, finishes: [] };
  return {
    state,
    async claim(seedHash, leaseId) {
      if (!state.row || state.row.seedHash !== seedHash) state.row = { seedHash };
      const row = state.row;
      if (row.accessToken && Date.parse(row.accessExpiresAt) > NOW + 120_000) return { state: 'current', accessToken: row.accessToken };
      if (row.leaseUntil > NOW) return { state: 'pending' };
      Object.assign(row, { leaseId, leaseUntil: NOW + 30_000 });
      return { state: 'refresh', refreshToken: row.refreshToken || null };
    },
    async finish(seedHash, leaseId, tokens) {
      state.finishes.push(tokens);
      const row = state.row;
      if (row?.seedHash !== seedHash || row.leaseId !== leaseId) return false;
      row.leaseId = null; row.leaseUntil = 0;
      if (!tokens) return false;
      Object.assign(row, tokens);
      return true;
    },
  };
}

const tokenResponse = (accessExp, refreshTag = 'n') => new Response(JSON.stringify({
  access_token: jwt(accessExp, 'x'), refresh_token: jwt(NOW / 1000 + 5_000_000, refreshTag), user_id: 'ignored',
}), { status: 200, headers: { 'content-type': 'application/json' } });

test('abgelaufene Sitzung wird mit dem Erneuerungstoken verlängert und das neue Paar gespeichert', async () => {
  const { currentPlaytomicCookie, tokenEndpoint } = await modulePromise;
  const store = memoryStore();
  const requests = [];
  const fetcher = async (url, init) => { requests.push({ url, init }); return tokenResponse(NOW / 1000 + 3600); };
  const cookie = await currentPlaytomicCookie(secret(), store, { fetcher, now: () => NOW });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, tokenEndpoint);
  assert.equal(requests[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].init.body), { refresh_token: jwt(NOW / 1000 + 86400, 'r'), requested_user_roles: ['ROLE_CUSTOMER'] });
  assert.equal(cookie, `pt_auth_access_token=${jwt(NOW / 1000 + 3600, 'x')}`, 'nur das Zugriffstoken geht an die Buchungsseite');
  assert.equal(store.state.row.refreshToken, jwt(NOW / 1000 + 5_000_000, 'n'));

  // Weitere Aufrufe verwenden den gespeicherten Pass ohne neue Erneuerung.
  assert.equal(await currentPlaytomicCookie(secret(), store, { fetcher, now: () => NOW }), cookie);
  assert.equal(requests.length, 1);

  // Nach Ablauf wird das zuletzt gespeicherte (rotierte) Erneuerungstoken verwendet.
  store.state.row.accessExpiresAt = new Date(NOW).toISOString();
  await currentPlaytomicCookie(secret(), store, { fetcher, now: () => NOW });
  assert.equal(JSON.parse(requests[1].init.body).refresh_token, jwt(NOW / 1000 + 5_000_000, 'n'));
});

test('ein noch gültiges neues Secret wird ohne Erneuerung verwendet', async () => {
  const { currentPlaytomicCookie } = await modulePromise;
  const store = memoryStore();
  const cookie = await currentPlaytomicCookie(secret(NOW / 1000 + 3000), store, {
    fetcher: async () => assert.fail('keine Erneuerung nötig'), now: () => NOW,
  });
  assert.equal(cookie, `pt_auth_access_token=${jwt(NOW / 1000 + 3000)}`);
  assert.equal(store.state.row.leaseUntil, 0, 'Erneuerungsauftrag wird freigegeben');
});

test('abgewiesene Erneuerung meldet login_required, Störungen unavailable, ohne Tokens zu speichern', async () => {
  const { currentPlaytomicCookie } = await modulePromise;
  for (const [fetcher, reason] of [
    [async () => new Response('{"secret":"x"}', { status: 401 }), 'login_required'],
    [async () => new Response('nope', { status: 400 }), 'login_required'],
    [async () => new Response('down', { status: 503 }), 'unavailable'],
    [async () => { throw new Error('secret transport'); }, 'unavailable'],
    [async () => new Response('{"access_token":"kein-jwt","refresh_token":"x"}', { status: 200 }), 'unavailable'],
  ]) {
    const store = memoryStore();
    await assert.rejects(currentPlaytomicCookie(secret(), store, { fetcher, now: () => NOW }), { reason });
    assert.equal(store.state.row.accessToken, undefined);
    assert.deepEqual(store.state.finishes, [null]);
  }
});

test('parallele Aufrufe warten auf die laufende Erneuerung statt selbst zu erneuern', async () => {
  const { currentPlaytomicCookie } = await modulePromise;
  const store = memoryStore();
  store.state.row = null;
  await store.claim(await sha(secret()), 'other');
  let waits = 0;
  const cookie = await currentPlaytomicCookie(secret(), store, {
    fetcher: async () => assert.fail('kein zweiter Erneuerungsaufruf'), now: () => NOW,
    wait: async () => { waits++; Object.assign(store.state.row, { accessToken: jwt(NOW / 1000 + 3600, 'p'), accessExpiresAt: new Date(NOW + 3_600_000).toISOString(), leaseUntil: 0 }); },
  });
  assert.equal(waits, 1);
  assert.equal(cookie, `pt_auth_access_token=${jwt(NOW / 1000 + 3600, 'p')}`);
});

async function sha(cookie) {
  const refresh = /pt_auth_refresh_token=([^;]+)/.exec(cookie)[1];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(refresh));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

test('PostgreSQL vergibt genau einen Erneuerungsauftrag und verwirft den Stand bei neuem Secret', {
  skip: !process.env.PADEL_PGLITE_MODULE && 'Requires local PGlite'
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PADEL_PGLITE_MODULE).href);
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync(require.resolve('./fixtures/court-booking-schema.sql'), 'utf8'));
    await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20261111160000_playtomic_session_refresh.sql'), 'utf8'));
    const seed = 'a'.repeat(64), other = 'b'.repeat(64);
    const lease1 = '00000000-0000-0000-0000-000000000001', lease2 = '00000000-0000-0000-0000-000000000002';
    const claim = async (hash, lease) => (await db.query('select public.claim_playtomic_session($1, $2) as v', [hash, lease])).rows[0].v;
    const finish = async (hash, lease, access, refresh, exp) => (await db.query(
      'select public.finish_playtomic_session($1, $2, $3, $4, $5, null) as v', [hash, lease, access, refresh, exp])).rows[0].v;
    assert.equal((await claim(seed, lease1)).state, 'none', 'nur service_role');
    await db.exec("set request.jwt.claim.role = 'service_role'");
    assert.deepEqual(await claim(seed, lease1), { state: 'refresh', refreshToken: null });
    assert.deepEqual(await claim(seed, lease2), { state: 'pending' });
    assert.equal(await finish(seed, lease2, 'a.b.c', 'd.e.f', '2099-01-01'), false, 'fremder Auftrag darf nicht schreiben');
    assert.equal(await finish(seed, lease1, 'a.b.c', 'd.e.f', '2099-01-01'), true);
    assert.deepEqual(await claim(seed, lease2), { state: 'current', accessToken: 'a.b.c' });
    await db.exec("update private.playtomic_session set access_expires_at = now() + interval '1 minute'");
    assert.deepEqual(await claim(seed, lease2), { state: 'refresh', refreshToken: 'd.e.f' }, 'kurz vor Ablauf wird erneuert');
    assert.deepEqual(await claim(other, lease1), { state: 'refresh', refreshToken: null }, 'neues Secret verwirft alten Stand');
    assert.equal((await db.query('select access_token from private.playtomic_session')).rows[0].access_token, null);
    await assert.rejects(finish(other, lease1, 'kein-jwt', 'd.e.f', '2099-01-01'));
    for (const role of ['anon', 'authenticated']) {
      for (const fn of ['public.claim_playtomic_session(text,uuid)', 'public.get_playtomic_session_status()']) {
        assert.equal((await db.query("select has_function_privilege($1, $2, 'execute') as v", [role, fn])).rows[0].v, false);
      }
      assert.equal((await db.query("select has_table_privilege($1, 'private.playtomic_session', 'select') as v", [role])).rows[0].v, false);
    }
  } finally { await db.close(); }
});
