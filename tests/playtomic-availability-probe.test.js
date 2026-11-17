const test = require('node:test');
const assert = require('node:assert/strict');
const probe = import('../supabase/functions/court-availability-probe/read.ts');
const cookie = 'pt_auth_access_token=aaa.bbb.ccc; pt_auth_refresh_token=ddd.eee.fff';
test('availability probe sends only the access token on fixed read endpoints and returns sanitized diagnostics', async () => {
  const { probeAvailability } = await probe;
  const calls = [];
  const result = await probeAvailability('2026-11-18', cookie, async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? Response.json([{ resource_id: 'court', slots: [{ secret: 'private' }] }])
      : Response.json({ status: 'APP_ATTESTATION_REQUIRED', localized_message: 'private' }, { status: 403 });
  });
  assert.deepEqual(result, [{ route: 'web_cookie', status: 200, array: true, resources: 1, slots: 1 },
    { route: 'app_bearer', status: 403, array: false, reason: 'app_attestation_required' }]);
  assert.equal(calls[0].options.headers.Cookie, 'pt_auth_access_token=aaa.bbb.ccc');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer aaa.bbb.ccc');
  for (const call of calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'error');
    assert.equal(JSON.stringify(call).includes('ddd.eee.fff'), false);
  }
  assert.equal(new URL(calls[0].url).hostname, 'playtomic.com');
  assert.equal(new URL(calls[1].url).hostname, 'api.app.playtomic.io');
  assert.doesNotMatch(JSON.stringify(result), /private|aaa|bbb|ccc|ddd|eee|fff/);
});
test('invalid inputs never fetch; malformed responses and transport errors reveal no details', async () => {
  const { probeAvailability } = await probe;
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error('sensitive error'); };
  await assert.rejects(probeAvailability('invalid', cookie, fetcher));
  await assert.rejects(probeAvailability('2026-11-18', 'invalid', fetcher));
  assert.equal(calls, 0);
  const result = await probeAvailability('2026-11-18', cookie, fetcher);
  assert.deepEqual(result, [{ route: 'web_cookie', reason: 'unavailable' }, { route: 'app_bearer', reason: 'unavailable' }]);
});
