const assert = require('node:assert/strict');
const test = require('node:test');
const modulePromise = import('../supabase/functions/_shared/playtomic-access-code.ts');
const id = '00000000-0000-0000-0000-000000000001';
const html = '<p>Access code</p><p>1234#</p><button>Cancel booking</button>';
const cookie = 'pt_auth_access_token=aaa.bbb.ccc';

test('liest nur den eindeutigen Hallencode, ohne Seitencode oder Aktionen auszuführen', async () => {
  const { parseHallAccessCode: parse } = await modulePromise;
  assert.equal(parse(html), '1234#');
  assert.equal(parse('<p>Access&nbsp;code:</p><p>&#49;234&#x23;</p>'), '1234#');
  assert.equal(parse(`<script>Access code 9999#</script><!-- Access code 9999# -->${html}`), '1234#');
  for (const source of ['<p>Log in</p>', '<script>Access code 1234#</script>',
    '<p>Access code</p><p>missing</p><p>Booking 1234#</p>',
    '<p>Access code</p><p>12345#</p>', html + html, '<p>Access code 1234#unexpected</p>']) {
    assert.throws(() => parse(source), { message: 'code_unavailable' });
  }
});

test('erzwingt GET auf die feste Buchungsadresse, ohne Request-Body, Weiterleitung oder Folgeaufruf', async () => {
  const { readHallAccessCode: read } = await modulePromise;
  const calls = [];
  const result = await read(id, cookie, async (url, options) => {
    calls.push({ url, options });
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  });
  assert.equal(result, '1234#');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://app.playtomic.com/app_tabs/profile/activity/bookings/${id}`);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.headers.Cookie, cookie);
});

test('ungültige Ziele und manipulierte Cookie-Header lösen keinerlei Netzwerkaufruf aus', async () => {
  const { readHallAccessCode: read } = await modulePromise;
  const forbidden = async () => { assert.fail('Kein Netzwerkaufruf erlaubt'); };
  for (const target of ['https://other.invalid', id + '/cancel', id + '?action=cancel', '', null]) {
    await assert.rejects(read(target, cookie, forbidden), { message: 'invalid_request' });
  }
  for (const cookie of ['', ' ', null, 'key=value\r\nNext-Action: cancel', 'x'.repeat(65537)]) {
    await assert.rejects(read(id, cookie, forbidden), { message: 'invalid_request' });
  }
});

test('abgelaufene Anmeldung, Weiterleitungen und Fehler bleiben ohne Wiederholung und ohne Geheimnisse', async () => {
  const { readHallAccessCode: read } = await modulePromise;
  for (const status of [401, 403, 302, 500]) {
    let calls = 0;
    await assert.rejects(read(id, cookie, async () => {
      calls++;
      return new Response('private response', { status, headers: { 'Content-Type': 'text/html' } });
    }), { message: status === 401 || status === 403 ? 'login_required' : 'unavailable' });
    assert.equal(calls, 1);
  }
  await assert.rejects(read(id, cookie, async () => { throw new Error('secret-cookie-value'); }), { message: 'unavailable' });
  await assert.rejects(read(id, cookie, async () => new Response(html, { headers: { 'Content-Type': 'application/json' } })), { message: 'unavailable' });
});

test('übermäßig große Antworten werden auch ohne verlässlichen Content-Length verworfen', async () => {
  const { readHallAccessCode: read } = await modulePromise;
  await assert.rejects(read(id, cookie, async () => new Response('x'.repeat(2_000_001) + html,
    { headers: { 'Content-Type': 'text/html' } })), { message: 'unavailable' });
});

test('Cookie-Header werden aus benannten JWTs aufgebaut, Fremdcookies und Zeilenumbrüche nicht weitergegeben', async () => {
  const { normalizePlaytomicSessionCookie: normalize } = await modulePromise;
  assert.equal(normalize('Cookie:\ntracker=discard; pt_auth_access_token=aaa.bbb.ccc;\npt_auth_refresh_token=ddd.eee.fff'),
    'pt_auth_access_token=aaa.bbb.ccc; pt_auth_refresh_token=ddd.eee.fff');
  assert.equal(normalize(cookie + '\nInjected: discarded'), cookie);
  for (const value of [cookie + '; ' + cookie, 'pt_auth_access_token=aaa.bbb.\nccc', 'pt_auth_access_token=not-a-jwt', 'aaa.bbb.ccc']) {
    assert.throws(() => normalize(value), { message: 'invalid_request' });
  }
});
