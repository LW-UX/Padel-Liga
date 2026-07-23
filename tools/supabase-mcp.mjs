#!/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node

import { readFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRef = 'ufpaeluwcqynzudhmrro';
const resource = `https://mcp.supabase.com/mcp?project_ref=${projectRef}&features=database`;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = resolve(repositoryRoot, 'supabase/migrations');
const tokenFile = resolve(repositoryRoot, '.codex-secrets/supabase-access-token');

const [command, argument] = process.argv.slice(2);

if (!command) {
  fail('Aufruf: supabase-mcp.mjs <list-migrations|apply-migration|execute-sql> [Datei]');
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

await rpc('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'Codex Padel-Liga', version: '1.0' }
});
await rpc('notifications/initialized', undefined, true);

if (command === 'list-migrations') {
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
} else {
  fail(`Unbekannter Befehl: ${command}`);
}
