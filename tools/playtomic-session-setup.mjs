import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readHallAccessCode, normalizePlaytomicSessionCookie } from '../supabase/functions/_shared/playtomic-access-code.ts';

// Called only by supabase-mcp.mjs, with the existing project management access.
// Merely starting this helper does not store anything. The user explicitly
// submits a local form authorizing durable storage, after a read-only test.
export async function startSessionSetup({ projectRef, accessToken, bookingId,
  readCode = readHallAccessCode, fetcher = fetch, onStored = () => console.log('Playtomic-Lesezugang: GET geprüft und Sitzung als Server-Secret hinterlegt.') }) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(bookingId || '')) throw new Error('Eine gültige Test-Buchungs-ID fehlt.');
  if (!/^[a-z]{20}$/.test(projectRef)) throw new Error('Ungültiges Projekt.');
  const path = `/${randomUUID()}`;
  let completed = false, busy = false;
  const server = createServer(async (request, response) => {
    const respond = (status, text, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'" });
      response.end(text);
    };
    if (request.url !== path || completed) return respond(404, 'Nicht verfügbar.');
    if (request.method === 'GET') return respond(200,
      '<!doctype html><meta charset="utf-8"><title>Playtomic-Lesezugang einrichten</title><h1>Playtomic-Lesezugang einrichten</h1><p>Diese Aktion hinterlegt die Sitzung dauerhaft als geschütztes Secret in unserem Supabase-Projekt. Die Liga verwendet sie ausschließlich zum Lesen der Hallencodes. Keine Buchungen, Stornierungen oder Änderungen in Playtomic.</p><p>Zuerst wird ein einzelner lesender Abruf geprüft. Kein Passwort erforderlich. Den Cookie nicht in den Chat kopieren.</p><form method="post"><label>Cookie-Header <input type="password" name="session" autocomplete="off" required size="60"></label><button>Lesend prüfen und Sitzung auf dem Server hinterlegen</button></form>',
      'text/html; charset=utf-8');
    if (request.method !== 'POST' || request.headers.origin !== `http://127.0.0.1:${server.address().port}`) return respond(403, 'Nicht erlaubt.');
    if (busy) return respond(409, 'Einrichtung läuft bereits.');
    busy = true;
    let cookie = '', raw = '';
    try {
      for await (const chunk of request) {
        raw += chunk.toString('utf8');
        if (Buffer.byteLength(raw) > 100000) return respond(413, 'Eingabe zu groß.');
      }
      cookie = new URLSearchParams(raw).get('session')?.trim().replace(/^cookie\s*:\s*/i, '') || '';
      raw = '';
      // Retain only Playtomic's authentication cookies, not tracking/payment
      // cookies that may be included when copying an entire request header.
      cookie = normalizePlaytomicSessionCookie(cookie);
      await readCode(bookingId, cookie);
      const result = await fetcher(`https://api.supabase.com/v1/projects/${projectRef}/secrets`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ name: 'PLAYTOMIC_READ_ONLY_SESSION_COOKIE', value: cookie }]),
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      cookie = '';
      await result.body?.cancel().catch(() => {});
      if (!result.ok) return respond(502, 'Lesetest erfolgreich. Server-Hinterlegung fehlgeschlagen.');
      completed = true;
      onStored();
      respond(200, 'Lesetest erfolgreich. Die Sitzung ist für den ausschließlich lesenden Hallencode-Abruf auf dem Server hinterlegt.');
      clearTimeout(expiry);
      server.close();
    } catch {
      respond(502, 'Lesetest oder Server-Hinterlegung fehlgeschlagen. Keine Zugangsdaten werden ausgegeben.');
    } finally { cookie = ''; raw = ''; busy = false; }
  });
  const expiry = setTimeout(() => { completed = true; server.close(); }, 15 * 60 * 1000);
  await new Promise((resolve, reject) => {
    server.once('error', error => { clearTimeout(expiry); reject(error); });
    server.listen(0, '127.0.0.1', resolve);
  });
  return { url: `http://127.0.0.1:${server.address().port}${path}`,
    close: () => { completed = true; clearTimeout(expiry); server.close(); server.closeAllConnections(); } };
}
