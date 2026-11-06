const assert = require('node:assert/strict');
const test = require('node:test');
const modulePromise = import('../tools/playtomic-session-setup.mjs');
const bookingId = '00000000-0000-0000-0000-000000000001';

test('Server-Hinterlegung erst nach lokalem Einreichen und erfolgreichem rein lesendem Test', async () => {
  const { startSessionSetup } = await modulePromise;
  const calls = [];
  const setup = await startSessionSetup({ projectRef: 'a'.repeat(20), accessToken: 'fake-management', bookingId,
    readCode: async (...args) => { calls.push(['read', ...args]); return '1234#'; },
    fetcher: async (url, options) => { calls.push(['store', url, options]); return new Response(null, { status: 201 }); },
    onStored: () => {} });
  try {
    const form = await fetch(setup.url);
    assert.match(await form.text(), /dauerhaft/);
    assert.equal(calls.length, 0);
    const rejected = await fetch(setup.url, { method: 'POST', headers: { Origin: 'https://foreign.invalid' }, body: 'session=secret' });
    assert.equal(rejected.status, 403);
    assert.equal(calls.length, 0);
    const response = await fetch(setup.url, { method: 'POST', headers: { Origin: new URL(setup.url).origin },
      body: new URLSearchParams({ session: 'cookie: tracker=discard; pt_auth_access_token=aaa.bbb.ccc; pt_auth_refresh_token=ddd.eee.fff' }) });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(body.includes('aaa.bbb.ccc'), false);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], ['read', bookingId, 'pt_auth_access_token=aaa.bbb.ccc; pt_auth_refresh_token=ddd.eee.fff']);
    assert.equal(calls[1][1], `https://api.supabase.com/v1/projects/${'a'.repeat(20)}/secrets`);
    assert.deepEqual(JSON.parse(calls[1][2].body), [{ name: 'PLAYTOMIC_READ_ONLY_SESSION_COOKIE', value: 'pt_auth_access_token=aaa.bbb.ccc; pt_auth_refresh_token=ddd.eee.fff' }]);
    assert.equal(calls[1][2].redirect, 'error');
  } finally { setup.close(); }
});

test('Ein gescheiterter Lesetest speichert nichts und gibt weder Cookie noch Anbieterfehler aus', async () => {
  const { startSessionSetup } = await modulePromise;
  const setup = await startSessionSetup({ projectRef: 'a'.repeat(20), accessToken: 'fake', bookingId,
    readCode: async () => { throw new Error('secret-provider-body'); },
    fetcher: async () => assert.fail('Kein Speichern ohne erfolgreichen GET-Test') });
  try {
    const response = await fetch(setup.url, { method: 'POST', headers: { Origin: new URL(setup.url).origin },
      body: new URLSearchParams({ session: 'pt_auth_access_token=aaa.bbb.ccc' }) });
    const body = await response.text();
    assert.equal(response.status, 502);
    assert.equal(/secret-cookie|secret-provider-body/.test(body), false);
  } finally { setup.close(); }
});
