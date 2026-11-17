const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const dataPromise = import('../supabase/functions/court-availability/data.ts');
const errorsPromise = import('../supabase/functions/court-availability/errors.ts');
const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/court-availability/index.ts'), 'utf8');
const date = '2099-11-18';
const request = () => new Request('https://example.invalid', { method: 'POST', body: JSON.stringify({ date }) });
async function endpoint(upstream) {
  const data = await dataPromise;
  const errors = await errorsPromise;
  const hours = Object.fromEntries(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
    .map(day => [day, { opening_time: '07:00', closing_time: '00:00' }]));
  const tenant = { tenant_id: data.CLUB_ID, address: { timezone: 'Europe/Berlin' }, opening_hours: hours,
    resources: [{ resourceId: 'hall', name: 'Halle', sport: 'PADEL', features: ['Indoor'] }] };
  const html = `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify({ tenant }))}])</script>`;
  let handler;
  const logs = [], calls = [];
  const context = vm.createContext({ ...data, ...errors, Error, Request, Response, AbortSignal, URL, URLSearchParams,
    console: { error: (...args) => logs.push(args) }, Deno: { serve: callback => { handler = callback; } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return url === data.CLUB_URL ? new Response(html) : upstream(url, options);
    } });
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '').replace(/export /g, '')), context);
  return { handler, logs, calls };
}

test('provider status codes identify failures without declaring a 403 to be an expired session', async () => {
  for (const [status, reason] of [[401, 'playtomic_access_denied'], [403, 'playtomic_access_denied'],
    [408, 'playtomic_timeout'], [429, 'playtomic_rate_limited'], [500, 'playtomic_unavailable'],
    [502, 'playtomic_unavailable'], [503, 'playtomic_unavailable'], [504, 'playtomic_timeout'],
    [404, 'playtomic_invalid_response']]) {
    const { handler, logs, calls } = await endpoint(async () => new Response('private response', { status }));
    const response = await handler(request());
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: 'Die freien Plätze konnten gerade nicht geladen werden.', reason, source: 'playtomic',
    });
    assert.doesNotMatch(JSON.stringify(logs), /private response/);
    assert.ok(calls.every(call => call.options.redirect === 'error'));
  }
  const { playtomicHttpError } = await errorsPromise;
  assert.equal(playtomicHttpError(401, true).reason, 'playtomic_login_required');
  assert.equal(playtomicHttpError(403, true).reason, 'playtomic_access_denied');
});

test('provider timeouts and transport failures are classified; malformed data never appears as free courts', async () => {
  for (const [read, reason] of [
    [async () => { throw Object.assign(new Error('secret transport'), { name: 'TimeoutError' }); }, 'playtomic_timeout'],
    [async () => { throw new Error('secret transport'); }, 'playtomic_unavailable'],
    [async () => new Response('Gateway Timeout'), 'playtomic_invalid_response'],
    [async () => Response.json({ error: 'secret upstream' }), 'playtomic_invalid_response'],
  ]) {
    const { handler, logs } = await endpoint(read);
    const response = await handler(request());
    const body = await response.json();
    assert.equal(body.reason, reason);
    assert.equal(body.source, 'playtomic');
    assert.equal(response.status, 502);
    assert.doesNotMatch(JSON.stringify([body, logs]), /secret transport|secret upstream|Gateway Timeout/);
  }
});

test('healthy empty availability remains a success; invalid local requests never blame Playtomic', async () => {
  const { handler, calls } = await endpoint(async () => Response.json([]));
  const bad = await handler(new Request('https://example.invalid', { method: 'POST', body: '{' }));
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await bad.json()).source, undefined);
  const response = await handler(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.slots, []);
  assert.equal(body.reason, undefined);
});
