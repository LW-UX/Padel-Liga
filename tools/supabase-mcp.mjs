#!/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node

import { readFile, readdir } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRef = 'ufpaeluwcqynzudhmrro';
const resource = `https://mcp.supabase.com/mcp?project_ref=${projectRef}&features=database,functions,debugging`;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = resolve(repositoryRoot, 'supabase/migrations');
const functionsDirectory = resolve(repositoryRoot, 'supabase/functions');
const tokenFile = resolve(repositoryRoot, '.codex-secrets/supabase-access-token');

const [command, argument, originalRecipientsArgument] = process.argv.slice(2);

if (!command) {
  fail('Aufruf: supabase-mcp.mjs <list-tools|list-migrations|apply-migration|execute-sql|list-functions|get-function|deploy-function|delete-function|get-logs|store-notification-service-key|get-auth-email-settings|update-recovery-template|update-account-email-templates> [Datei oder Function]');
}

let accessToken;
try {
  accessToken = (await readFile(tokenFile, 'utf8')).trim();
} catch {
  fail('Der lokale Supabase-Zugriffsschlüssel fehlt.');
}

let requestId = 0;
let sessionId;

async function rpc(method, params, notification = false) {
  const response = await fetch(resource, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {})
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      ...(notification ? {} : { id: ++requestId }),
      method,
      ...(params === undefined ? {} : { params })
    })
  });

  if (!response.ok) {
    fail(`Supabase-Verbindung fehlgeschlagen (HTTP ${response.status}).`);
  }

  sessionId ||= response.headers.get('mcp-session-id');
  if (notification || response.status === 202) return null;

  const body = await response.text();
  const dataLine = body.split(/\r?\n/).find((line) => line.startsWith('data:'));
  const message = JSON.parse(dataLine ? dataLine.slice(5).trim() : body);
  if (message.error) fail(message.error.message || 'Supabase-MCP-Fehler.');
  return message.result;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printToolResult(result) {
  if (result?.isError) {
    const message = (result.content || []).map((item) => item.text || '').join('\n');
    fail(message || 'Die Supabase-Aktion ist fehlgeschlagen.');
  }

  const text = (result?.content || [])
    .map((item) => item.text || '')
    .filter(Boolean)
    .join('\n');
  console.log(text || 'Supabase-Aktion erfolgreich abgeschlossen.');
}

async function managementRequest(path, options = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    fail(`Supabase-Management-API fehlgeschlagen (HTTP ${response.status}): ${detail}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function requireFilePath(path, { migration = false } = {}) {
  if (!path) fail('Eine Datei muss angegeben werden.');
  const absolutePath = resolve(repositoryRoot, path);

  if (migration) {
    const pathWithinMigrations = relative(migrationsDirectory, absolutePath);
    if (
      pathWithinMigrations.startsWith('..') ||
      pathWithinMigrations === '' ||
      !absolutePath.endsWith('.sql')
    ) {
      fail('Migrationen müssen aus supabase/migrations stammen.');
    }
  }

  return absolutePath;
}

function requireFunctionPath(slug) {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) fail('Eine gültige Function muss angegeben werden.');
  return resolve(functionsDirectory, slug);
}

async function readFunctionFiles(directory, current = directory) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolutePath = resolve(current, entry.name);
    if (entry.isDirectory()) files.push(...await readFunctionFiles(directory, absolutePath));
    else if (entry.isFile()) {
      files.push({
        name: relative(directory, absolutePath),
        content: await readFile(absolutePath, 'utf8')
      });
    }
  }
  return files;
}

await rpc('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'Codex Padel-Liga', version: '1.0' }
});
await rpc('notifications/initialized', undefined, true);

if (command === 'list-tools') {
  console.log(JSON.stringify(await rpc('tools/list', {}), null, 2));
} else if (command === 'list-migrations') {
  printToolResult(await rpc('tools/call', { name: 'list_migrations', arguments: {} }));
} else if (command === 'apply-migration') {
  const migrationPath = requireFilePath(argument, { migration: true });
  const query = await readFile(migrationPath, 'utf8');
  const name = basename(migrationPath).replace(/^\d+_/, '').replace(/\.sql$/, '');
  printToolResult(await rpc('tools/call', {
    name: 'apply_migration',
    arguments: { name, query }
  }));
} else if (command === 'execute-sql') {
  const sqlPath = requireFilePath(argument);
  const query = await readFile(sqlPath, 'utf8');
  printToolResult(await rpc('tools/call', {
    name: 'execute_sql',
    arguments: { query }
  }));
} else if (command === 'list-functions') {
  printToolResult(await rpc('tools/call', { name: 'list_edge_functions', arguments: {} }));
} else if (command === 'get-function') {
  if (!argument) fail('Eine Function muss angegeben werden.');
  printToolResult(await rpc('tools/call', {
    name: 'get_edge_function',
    arguments: { function_slug: argument }
  }));
} else if (command === 'get-logs') {
  printToolResult(await rpc('tools/call', {
    name: 'get_logs',
    arguments: { service: argument || 'edge-function' }
  }));
} else if (command === 'deploy-function') {
  const functionPath = requireFunctionPath(argument);
  let files = await readFunctionFiles(functionPath);
  if (!files.some((file) => file.name === 'index.ts')) fail('Der Function-Einstieg index.ts fehlt.');
  let entrypointPath = 'index.ts';
  if (argument === 'receive-court-booking') {
    files = files.map(file => ({ ...file, name: `${argument}/${file.name}` }));
    files.push({ name: '_shared/playtomic-booking-mail.ts',
      content: await readFile(resolve(functionsDirectory, '_shared/playtomic-booking-mail.ts'), 'utf8') });
    entrypointPath = `${argument}/index.ts`;
  }
  printToolResult(await rpc('tools/call', {
    name: 'deploy_edge_function',
    arguments: {
      name: argument,
      entrypoint_path: entrypointPath,
      // Verfügbarkeit ist öffentlich; der Empfangs-Webhook prüft stattdessen
      // zwingend seine Resend-/Svix-Signatur vor jedem Zugriff.
      verify_jwt: !['court-availability', 'receive-court-booking'].includes(argument),
      files
    }
  }));
} else if (['list-booking-mail', 'inspect-booking-mail', 'inspect-booking-access', 'normalize-booking-mail', 'configure-booking-mail', 'replay-booking-mail'].includes(command)) {
  const slug = 'resend-booking-setup';
  const files = (await readFunctionFiles(requireFunctionPath(slug))).map(file => ({ ...file, name: `${slug}/${file.name}` }));
  for (const name of ['_shared/playtomic-booking-mail.ts', 'receive-court-booking/handler.ts', 'receive-court-booking/outlook-forward.ts']) {
    files.push({ name, content: await readFile(resolve(functionsDirectory, name), 'utf8') });
  }
  const deployed = await rpc('tools/call', { name: 'deploy_edge_function', arguments: {
    name: slug, entrypoint_path: `${slug}/index.ts`, verify_jwt: false, files
  } });
  if (deployed?.isError) fail('Der geschützte Resend-Einrichtungshelfer konnte nicht bereitgestellt werden.');
  try {
    const keys = await managementRequest('/api-keys?reveal=true');
    const serviceKey = keys.find(key => key.type === 'secret')?.api_key;
    if (!serviceKey) throw new Error('Der Projektzugang ist nicht verfügbar.');
    const inspect = ['inspect-booking-mail', 'inspect-booking-access', 'list-booking-mail', 'normalize-booking-mail'].includes(command);
    const body = command === 'list-booking-mail' ? { mode: 'recent' }
      : command === 'inspect-booking-access' ? { mode: 'access', emailIds: (argument || '').split(',').filter(Boolean) }
      : command === 'normalize-booking-mail' ? { mode: 'normalize', emailIds: (argument || '').split(',').filter(Boolean) }
      : inspect ? { mode: 'inspect', emailIds: (argument || '').split(',').filter(Boolean) }
      : { mode: 'configure' };
    const response = await fetch(`https://${projectRef}.supabase.co/functions/v1/${slug}`, {
      method: 'POST', headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`Resend-Einrichtung: ${/^[a-z_0-9]+$/.test(result.error || '') ? result.error : 'nicht_verfügbar'}`);
    if (inspect) console.log(JSON.stringify(result));
    else if (command === 'replay-booking-mail') {
      if (!/^whsec_[A-Za-z0-9+/=]+$/.test(result.signingSecret || '')) throw new Error('Ungültiger Signing-Schlüssel.');
      const ids = (argument || '').split(',').filter(Boolean);
      if (!ids.length || ids.length > 5 || ids.some(id => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('Ungültige Mail-IDs.');
      const signatureKey = Buffer.from(result.signingSecret.slice(6), 'base64');
      for (const emailId of ids) {
        const messageId = `msg_manual_${randomUUID()}`;
        const timestamp = String(Math.floor(Date.now() / 1000));
        const payload = JSON.stringify({ type: 'email.received', data: { email_id: emailId } });
        const signature = createHmac('sha256', signatureKey).update(`${messageId}.${timestamp}.${payload}`).digest('base64');
        const replay = await fetch(`https://${projectRef}.supabase.co/functions/v1/receive-court-booking`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'svix-id': messageId,
            'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` },
          body: payload, signal: AbortSignal.timeout(60000)
        });
        const outcome = await replay.json();
        console.log(JSON.stringify({ emailId, http: replay.status, status: outcome.status,
          bookingStatus: outcome.result?.status, bookingId: outcome.result?.bookingId, reason: outcome.reason }));
        if (!replay.ok || outcome.status !== 'processed') process.exitCode = 1;
      }
    } else {
      if (!/^whsec_[A-Za-z0-9+/=]+$/.test(result.signingSecret || '')) throw new Error('Ungültiger Signing-Schlüssel.');
      const forwarders = (argument || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      if (!forwarders.length || forwarders.some(value => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value))) throw new Error('Freigegebene Weiterleitungsabsender fehlen.');
      const originalRecipients = (originalRecipientsArgument || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      if (originalRecipients.some(value => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value))
        || forwarders.includes('no-reply@playtomic.io') && !originalRecipients.length) throw new Error('Ursprüngliche Empfänger für die Umleitung fehlen.');
      await managementRequest('/secrets', { method: 'POST', body: JSON.stringify([
        { name: 'RESEND_BOOKING_WEBHOOK_SECRET', value: result.signingSecret },
        { name: 'RESEND_BOOKING_RECIPIENT', value: 'buchungen@kiroimyon.resend.app' },
        { name: 'RESEND_BOOKING_FORWARDERS', value: forwarders.join(',') },
        { name: 'RESEND_BOOKING_ORIGINAL_RECIPIENTS', value: originalRecipients.join(',') }
      ]) });
      console.log(JSON.stringify({ configured: true, webhookId: result.webhookId, recipient: 'buchungen@kiroimyon.resend.app', forwarders, originalRecipients }));
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(/^Resend-Einrichtung: [a-z_0-9]+$/.test(error.message || '')
      ? error.message : 'Die Resend-Einrichtung konnte nicht abgeschlossen werden.');
  } finally {
    await managementRequest(`/functions/${slug}`, { method: 'DELETE' });
  }
} else if (command === 'delete-function') {
  requireFunctionPath(argument);
  await managementRequest(`/functions/${argument}`, { method: 'DELETE' });
  console.log(`Function ${argument} wurde gelöscht.`);
} else if (command === 'store-notification-service-key') {
  // Die Function vergleicht mit SUPABASE_SERVICE_ROLE_KEY, und das ist in diesem Projekt der neue Secret Key.
  // Der Schlüssel wird nie ausgegeben; auch Fehlermeldungen geben die Abfrage nicht wieder.
  const keys = await managementRequest('/api-keys?reveal=true');
  const serviceKey = keys.find((key) => key.type === 'secret')?.api_key;
  if (!/^[A-Za-z0-9_.-]+$/.test(serviceKey || '')) fail('Der Service-Role-Schlüssel konnte nicht gelesen werden.');
  const result = await rpc('tools/call', {
    name: 'execute_sql',
    arguments: {
      query: `do $do$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = 'send_match_notifications_service_key';
  if existing is null then
    perform vault.create_secret('${serviceKey}', 'send_match_notifications_service_key', 'Aufruf der Function send-match-notifications');
  else
    perform vault.update_secret(existing, '${serviceKey}');
  end if;
end
$do$;`
    }
  });
  if (result?.isError) fail('Der Schlüssel konnte nicht gespeichert werden.');
  console.log('Schlüssel gespeichert.');
} else if (command === 'get-auth-email-settings') {
  const config = await managementRequest('/config/auth');
  console.log(JSON.stringify({
    site_url: config.site_url,
    uri_allow_list: config.uri_allow_list,
    smtp_admin_email: config.smtp_admin_email,
    smtp_sender_name: config.smtp_sender_name,
    mailer_subjects_recovery: config.mailer_subjects_recovery,
    mailer_templates_recovery_content: config.mailer_templates_recovery_content,
    mailer_otp_exp: config.mailer_otp_exp,
    mailer_secure_email_change_enabled: config.mailer_secure_email_change_enabled,
    mailer_notifications_password_changed_enabled: config.mailer_notifications_password_changed_enabled,
    mailer_subjects_confirmation: config.mailer_subjects_confirmation,
    mailer_templates_confirmation_content: config.mailer_templates_confirmation_content,
    mailer_subjects_email_change: config.mailer_subjects_email_change,
    mailer_templates_email_change_content: config.mailer_templates_email_change_content,
    mailer_subjects_password_changed_notification: config.mailer_subjects_password_changed_notification,
    mailer_templates_password_changed_notification_content: config.mailer_templates_password_changed_notification_content,
  }, null, 2));
} else if (command === 'update-recovery-template') {
  const templatePath = requireFilePath(argument || 'supabase/templates/reset-password.html');
  if (relative(resolve(repositoryRoot, 'supabase/templates'), templatePath).startsWith('..')) {
    fail('Die Recovery-Vorlage muss aus supabase/templates stammen.');
  }
  const content = await readFile(templatePath, 'utf8');
  const config = await managementRequest('/config/auth', {
    method: 'PATCH',
    body: JSON.stringify({
      mailer_subjects_recovery: 'PadelLiga: Neues Passwort festlegen',
      mailer_templates_recovery_content: content,
    }),
  });
  console.log(JSON.stringify({
    mailer_subjects_recovery: config.mailer_subjects_recovery,
    template_updated: config.mailer_templates_recovery_content === content,
  }, null, 2));
} else if (command === 'update-account-email-templates') {
  const confirmation = await readFile(resolve(repositoryRoot, 'supabase/templates/confirm-signup.html'), 'utf8');
  const emailChange = await readFile(resolve(repositoryRoot, 'supabase/templates/change-email.html'), 'utf8');
  const passwordChanged = await readFile(resolve(repositoryRoot, 'supabase/templates/password-changed.html'), 'utf8');
  const config = await managementRequest('/config/auth', {
    method: 'PATCH',
    body: JSON.stringify({
      mailer_subjects_confirmation: 'PadelLiga: E-Mail-Adresse bestätigen',
      mailer_templates_confirmation_content: confirmation,
      mailer_subjects_email_change: 'PadelLiga: Änderung der E-Mail-Adresse bestätigen',
      mailer_templates_email_change_content: emailChange,
      mailer_subjects_password_changed_notification: 'PadelLiga: Dein Passwort wurde geändert',
      mailer_templates_password_changed_notification_content: passwordChanged,
    }),
  });
  console.log(JSON.stringify({
    mailer_subjects_confirmation: config.mailer_subjects_confirmation,
    confirmation_updated: config.mailer_templates_confirmation_content === confirmation,
    mailer_subjects_email_change: config.mailer_subjects_email_change,
    email_change_updated: config.mailer_templates_email_change_content === emailChange,
    mailer_subjects_password_changed_notification: config.mailer_subjects_password_changed_notification,
    password_changed_updated: config.mailer_templates_password_changed_notification_content === passwordChanged,
  }, null, 2));
} else {
  fail(`Unbekannter Befehl: ${command}`);
}
