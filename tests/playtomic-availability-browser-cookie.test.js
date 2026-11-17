const test = require('node:test');
const assert = require('node:assert/strict');
const browserModule = import('../supabase/functions/court-availability-probe/browser-cookie.ts');
const setupModule = import('../tools/playtomic-availability-session-setup.mjs');
const date = '2099-11-18';
const session = 'pt_auth_access_token=aaa.bbb.ccc; security_cookie=additional; pt_auth_refresh_token=ddd.eee.fff; _ga=discard; __stripe_mid=discard';

test('browser cookie keeps unfamiliar security values but strips refresh, analytics and payment cookies; injection is rejected', async () => {
  const { normalizeAvailabilityCookie, normalizeBrowserUserAgent } = await browserModule;
  assert.equal(normalizeAvailabilityCookie(`Cookie: ${session}`), 'pt_auth_access_token=aaa.bbb.ccc; security_cookie=additional');
  assert.equal(normalizeAvailabilityCookie('security_cookie="quoted"'), 'security_cookie="quoted"');
  for (const invalid of ['', 'pt_auth_refresh_token=only', 'session=x\r\nAuthorization: bad', 'cookie=a; cookie=b', 'Cookie: broken', 'session=a b', 'session=' + 'a'.repeat(33_000)]) {
    assert.throws(() => normalizeAvailabilityCookie(invalid));
  }
  assert.throws(() => normalizeBrowserUserAgent('Firefox\r\nExtra: header'));
});

test('browser session is tested with fixed GET endpoints and actual slot validation, not merely HTTP 200', async () => {
  const { probeBrowserCookie } = await browserModule;
  const calls = [];
  const data = await import('../supabase/functions/court-availability/data.ts');
  const hours = Object.fromEntries(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
    .map(day => [day, { opening_time: '07:00', closing_time: '00:00' }]));
  const tenant = { tenant_id: data.CLUB_ID, address: { timezone: 'Europe/Berlin' }, opening_hours: hours,
    resources: [{ resourceId: 'hall', name: 'Indoor H1', sport: 'PADEL', features: ['Indoor'] }] };
  const html = `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify({ tenant }))}])</script>`;
  const result = await probeBrowserCookie(date, session, 'Browser Test', async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return Response.json([{ resource_id: 'hall', start_date: date,
      slots: [{ start_time: '12:00:00', duration: 60, price: 'private' }] }]);
    return new Response(html);
  });
  assert.deepEqual(result, { state: 'available', courts: 1, slots: 1 });
  assert.equal(calls.length, 2);
  for (const { url, options } of calls) {
    assert.equal(new URL(url).origin, 'https://playtomic.com');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['User-Agent'], 'Browser Test');
    assert.equal(options.headers.Cookie, 'pt_auth_access_token=aaa.bbb.ccc; security_cookie=additional');
  }
  for (const status of [401, 403, 504]) {
    await assert.rejects(probeBrowserCookie(date, session, '', async () => new Response('private error', { status })),
      error => error.reason === ({ 401: 'playtomic_login_required', 403: 'playtomic_access_denied', 504: 'playtomic_timeout' })[status]);
  }
  await assert.rejects(probeBrowserCookie(date, session, '', async () => new Response('<html>Login</html>')),
    error => error.reason === 'playtomic_invalid_response');
});

async function setup(overrides = {}) {
  const { startAvailabilitySessionSetup } = await setupModule;
  const reads = [], stores = [], logs = [];
  const server = await startAvailabilitySessionSetup({ date,
    probe: async input => { reads.push(input); return { state: 'available', courts: 14, slots: 0 }; },
    storeSession: async input => { stores.push(input); }, onResult: input => logs.push(input), ...overrides });
  const post = fields => fetch(server.url, { method: 'POST', headers: { Origin: new URL(server.url).origin },
    body: new URLSearchParams({ date, session, userAgent: 'Browser Test', ...fields }) });
  return { server, post, reads, stores, logs };
}

test('local form requires same-origin submission, proves server access before saving, and saves an independent session without echoing credentials', async () => {
  const { server, post, reads, stores, logs } = await setup();
  try {
    const page = await fetch(server.url);
    assert.match(await page.text(), /type="password"/);
    assert.equal(reads.length, 0);
    assert.equal(stores.length, 0);
    const rejected = await fetch(server.url, { method: 'POST', headers: { Origin: 'https://foreign.invalid' }, body: new URLSearchParams({ date, session }) });
    assert.equal(rejected.status, 403);
    assert.equal(reads.length, 0);
    const response = await post();
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /aaa.bbb.ccc|ddd.eee.fff|additional/);
    assert.equal(await server.done, 'stored');
    assert.deepEqual(stores, [{ cookie: 'pt_auth_access_token=aaa.bbb.ccc; security_cookie=additional', userAgent: 'Browser Test' }]);
    assert.equal(reads.length, 1);
    assert.doesNotMatch(JSON.stringify(logs), /aaa.bbb.ccc|additional|ddd.eee.fff/);
  } finally { server.close(); }
});

test('a denied or malformed probe saves nothing and permits retry; provider details and arbitrary error strings stay private', async () => {
  for (const result of [{ error: 'playtomic_access_denied' }, { state: 'available', courts: 0, slots: 0 },
    { error: '<script>secret</script>' }]) {
    const { server, post, stores } = await setup({ probe: async () => result });
    try {
      const response = await post();
      assert.equal(response.status, 502);
      assert.doesNotMatch(await response.text(), /<script>secret|aaa.bbb.ccc|additional/);
      assert.equal(stores.length, 0);
      assert.equal((await fetch(server.url)).status, 200);
    } finally { server.close(); }
  }
});

test('temporary server probe refuses unauthenticated callers and tests a supplied browser cookie without accessing the hall session', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const path = require('node:path');
  const { stripTypeScriptTypes } = require('node:module');
  const data = await import('../supabase/functions/court-availability/data.ts');
  const errors = await import('../supabase/functions/court-availability/errors.ts');
  const { AccessCodeReadError } = await import('../supabase/functions/_shared/playtomic-access-code.ts');
  let handler, probes = 0;
  const context = vm.createContext({ ...data, ...errors, AccessCodeReadError, Response,
    Deno: { serve: value => { handler = value; }, env: { get: () => assert.fail('Hall session access is forbidden in browser-cookie mode') } },
    createClient: () => assert.fail('No database access in browser-cookie mode'),
    probeBrowserCookie: async () => { probes++; return { state: 'available', courts: 14, slots: 0 }; } });
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/court-availability-probe/index.ts'), 'utf8');
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '').replace('__AVAILABILITY_PROBE_KEY__', 'test-probe-key')), context);
  const body = JSON.stringify({ date, browserCookie: session });
  const rejected = await handler(new Request('https://example.invalid', { method: 'POST', body }));
  assert.equal(rejected.status, 403);
  assert.equal(probes, 0);
  const response = await handler(new Request('https://example.invalid', {
    method: 'POST', headers: { Authorization: 'Bearer test-probe-key' }, body }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state: 'available', courts: 14, slots: 0 });
  assert.equal(probes, 1);
});
