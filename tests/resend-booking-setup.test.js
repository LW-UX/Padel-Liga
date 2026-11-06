const test = require('node:test');
const assert = require('node:assert/strict');

test('temporary setup helper denies user requests and never returns the Resend API key', async () => {
  const originalDeno = globalThis.Deno;
  const originalFetch = globalThis.fetch;
  let handler, apiCalls = 0;
  const values = { SUPABASE_SERVICE_ROLE_KEY: 'test-service', RESEND_API_KEY: 'test-resend-key', SUPABASE_URL: 'https://project.example.com' };
  globalThis.Deno = { env: { get: name => values[name] }, serve: callback => { handler = callback; } };
  globalThis.fetch = async () => { apiCalls++; return new Response('{}', { status: 401 }); };
  try {
    await import('../supabase/functions/resend-booking-setup/index.ts');
    const request = token => new Request('https://project.example.com/setup', { method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify({ mode: 'inspect', emailIds: ['00000000-0000-0000-0000-000000000001'] }) });
    for (const token of [undefined, 'user-token']) assert.equal((await handler(request(token))).status, 403);
    assert.equal(apiCalls, 0);
    const response = await handler(request('test-service'));
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.ok(body.includes('resend_http_401'));
    assert.equal(body.includes(values.RESEND_API_KEY), false);
  } finally {
    globalThis.Deno = originalDeno;
    globalThis.fetch = originalFetch;
  }
});
