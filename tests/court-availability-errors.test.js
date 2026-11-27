const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const dataPromise = import('../supabase/functions/court-availability/data.ts');
const errorsPromise = import('../supabase/functions/court-availability/errors.ts');
const source = ['reader.ts', 'index.ts'].map(file =>
  fs.readFileSync(path.join(__dirname, '../supabase/functions/court-availability', file), 'utf8')).join('\n');
const date = '2099-11-18';
const request = () => new Request('https://example.invalid', { method: 'POST', body: JSON.stringify({ date }) });
async function endpoint(upstream, clubOverride) {
  const data = await dataPromise;
  const errors = await errorsPromise;
  const { publicRequestHeaders } = await import('../supabase/functions/court-availability/request-headers.ts');
  const { fallbackClub } = await import('../supabase/functions/court-availability/club-metadata.ts');
  const hours = Object.fromEntries(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
    .map(day => [day, { opening_time: '07:00', closing_time: '00:00' }]));
  const tenant = { tenant_id: data.CLUB_ID, address: { timezone: 'Europe/Berlin' }, opening_hours: hours,
    resources: [{ resourceId: 'hall', name: 'Halle', sport: 'PADEL', features: ['Indoor'] }] };
  const html = `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify({ tenant }))}])</script>`;
  let handler;
  const logs = [], calls = [];
  const context = vm.createContext({ ...data, ...errors, publicRequestHeaders, fallbackClub, Error, Request, Response, AbortSignal, URL, URLSearchParams,
    console: { error: (...args) => logs.push(args) }, Deno: { serve: callback => { handler = callback; } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return url === data.CLUB_URL ? (clubOverride ? clubOverride() : new Response(html)) : upstream(url, options);
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

test('the public reader uses browser request metadata without account credentials to avoid a false access failure', async () => {
  const { handler, calls } = await endpoint(async (_url, { headers }) => {
    const browserRequest = /Mozilla\//.test(headers?.['User-Agent'] || '')
      && headers?.['Sec-Fetch-Dest'] === 'empty' && headers?.['Sec-Fetch-Mode'] === 'cors'
      && headers?.['Sec-Fetch-Site'] === 'same-origin';
    return browserRequest ? Response.json([]) : new Response('blocked', { status: 403 });
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).slots, []);
  for (const call of calls) {
    const headers = new Headers(call.options.headers);
    assert.equal(headers.has('Cookie'), false);
    assert.equal(headers.has('Authorization'), false);
    assert.ok(call.url.startsWith('https://playtomic.com/'));
  }
});

test('slow club HTML uses verified court metadata while every offered hour still comes from the current JSON response', async () => {
  const { fallbackClub } = await import('../supabase/functions/court-availability/club-metadata.ts');
  const court = fallbackClub.courts.find(court => court.location === 'indoor');
  let reads = 0;
  const { handler } = await endpoint(async () => {
    reads++;
    return Response.json(reads === 1 ? [
      { resource_id: court.id, start_date: date, slots: [{ start_time: '12:00:00', duration: 60 }] },
      { resource_id: 'unmapped', start_date: date, slots: [{ start_time: '12:00:00', duration: 60 }] },
    ] : []);
  }, async () => { throw Object.assign(new Error('slow HTML'), { name: 'TimeoutError' }); });
  const first = await handler(request());
  assert.equal(first.status, 200);
  const data = await first.json();
  assert.equal(data.slots.length, 1);
  assert.equal(data.slots[0].courtId, court.id);
  const second = await handler(request());
  assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).slots, []);
  assert.equal(reads, 2, 'fresh availability is fetched even when fallback metadata is cached');
});
