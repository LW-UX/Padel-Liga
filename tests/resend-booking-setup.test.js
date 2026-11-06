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

    values.RESEND_BOOKING_ORIGINAL_RECIPIENTS = 'booker@example.com';
    const normalizeRequest = () => new Request('https://project.example.com/setup', { method: 'POST',
      headers: { authorization: 'Bearer test-service' }, body: JSON.stringify({ mode: 'normalize',
        emailIds: ['00000000-0000-0000-0000-000000000001'] }) });
    const metadata = { from: 'attacker@example.com', to: ['buchungen@kiroimyon.resend.app'],
      authentication: { dmarc: 'pass' }, attachments: [{ id: 'calendar', filename: 'calendar.ics' }],
      text: 'Von: Playtomic <no-reply@playtomic.io>\nDatum: Mittwoch, 28. Oktober 2026 um 14:39\nAn: Test <booker@example.com>\nBetreff: Playtomic - Buchungsbestätigung / Ticket\n\nReservierungsdaten\nName Testgruppe\nDatum 11.11.26\nZeit 12:00-13:00\nClub Lucky Star Padel @ Das Anders , Indoor H2\nInfos über die Bezahlung' };
    const urls = [];
    globalThis.fetch = async url => {
      urls.push(String(url));
      if (String(url).endsWith('/attachments/calendar')) return new Response(JSON.stringify({ download_url: 'https://download.example.com/calendar.ics' }));
      if (String(url).startsWith('https://download.example.com/')) return new Response('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:00000000-0000-0000-0000-000000000002@playtomic.io\r\nDTSTART:20261111T110000Z\r\nDTEND:20261111T120000Z\r\nLOCATION:Lucky Star Padel @ Das Anders\r\nEND:VEVENT\r\nEND:VCALENDAR');
      return new Response(JSON.stringify(metadata));
    };
    assert.equal((await handler(normalizeRequest())).status, 403, 'unapproved forwarder cannot be normalized');
    metadata.from = 'Booker@example.com';
    const normalized = await handler(normalizeRequest());
    assert.equal(normalized.status, 200);
    const data = await normalized.json();
    assert.equal(data.bookings[0].start, '2026-11-11T11:00:00.000Z');
    assert.equal(data.bookings[0].sourceOccurredAt, '2026-10-28T13:39:00.000Z');
    assert.equal(urls.some(url => url.includes('supabase') || url.includes('/rpc/')), false, 'normalization performs no database access');
  } finally {
    globalThis.Deno = originalDeno;
    globalThis.fetch = originalFetch;
  }
});
