import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

async function post(url, form) {
  const response = await fetch(url, { method: 'POST', body: new URLSearchParams(form), redirect: 'error',
    cache: 'no-store', signal: AbortSignal.timeout(10000) });
  return { ok: response.ok, body: await response.json() };
}

async function setup([tenant, client, account]) {
  if (![tenant, client].every(value => /^[a-f\d-]{36}$/i.test(value || ''))
    || !/^[^\s@=]+@[^\s@=]+$/.test(account || '')) {
    throw new Error('Microsoft Mandanten-ID, App-ID und das Firmenkonto werden benötigt.');
  }
  const authority = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  const { ok, body: device } = await post(`${authority}/devicecode`, {
    client_id: client, scope: 'https://graph.microsoft.com/Calendars.ReadBasic offline_access openid profile',
  });
  if (!ok || !device.device_code || !device.user_code || !Number.isFinite(device.expires_in)) {
    throw new Error('Microsoft konnte die Anmeldung nicht starten. Bitte die Entra-App-Freigabe prüfen.');
  }
  const verification = new URL(device.verification_uri);
  if (verification.protocol !== 'https:' || !['www.microsoft.com', 'microsoft.com', 'login.microsoftonline.com'].includes(verification.hostname)) {
    throw new Error('Microsoft hat eine unerwartete Anmeldeadresse geliefert.');
  }
  console.log(`Microsoft-Anmeldung: ${verification.href}\nEinmalcode: ${device.user_code}`);
  const deadline = Date.now() + device.expires_in * 1000;
  let interval = Math.max(device.interval || 5, 5);
  while (Date.now() < deadline) {
    await delay(interval * 1000);
    const { ok, body } = await post(`${authority}/token`, {
      client_id: client, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.device_code,
    });
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') { interval += 5; continue; }
    if (!ok || typeof body.refresh_token !== 'string' || /[\r\n]/.test(body.refresh_token) || !body.id_token) {
      throw new Error('Die Microsoft-Anmeldung konnte nicht abgeschlossen werden.');
    }
    // The ID token is read only from the configured tenant's HTTPS token endpoint.
    const identity = JSON.parse(Buffer.from(body.id_token.split('.')[1], 'base64url').toString('utf8'));
    if (identity.tid?.toLowerCase() !== tenant.toLowerCase()
      || identity.aud?.toLowerCase() !== client.toLowerCase()
      || identity.preferred_username?.toLowerCase() !== account.toLowerCase()) {
      throw new Error('Die Anmeldung gehört nicht zum angegebenen Firmenkonto.');
    }
    const directory = await mkdtemp(join(tmpdir(), 'padel-outlook-'));
    const path = join(directory, 'outlook.env');
    await writeFile(path, [
      `COURT_OUTLOOK_TENANT_ID=${tenant}`, `COURT_OUTLOOK_CLIENT_ID=${client}`,
      `COURT_OUTLOOK_ACCOUNT=${account.toLowerCase()}`, `COURT_OUTLOOK_REFRESH_TOKEN=${body.refresh_token}`, '',
    ].join('\n'), { mode: 0o600, flag: 'wx' });
    console.log(`Die vertrauliche Konfiguration liegt in ${path}`);
    return;
  }
  throw new Error('Die Microsoft-Anmeldung ist abgelaufen.');
}

try {
  await setup(process.argv.slice(2));
} catch (error) {
  // Do not print raw OAuth responses, configuration or token values.
  console.error(error instanceof Error && error.message.startsWith('Microsoft') ? error.message
    : 'Die Outlook-Einrichtung konnte nicht abgeschlossen werden.');
  process.exitCode = 1;
}
