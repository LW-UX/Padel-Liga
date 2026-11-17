// Temporarily deployed with a unique key and deleted by tools/supabase-mcp.mjs.
import { createClient } from "npm:@supabase/supabase-js@2";
import { isDate } from "../court-availability/data.ts";
import { currentPlaytomicCookie, playtomicSessionStore } from "../_shared/playtomic-session.ts";
import { AccessCodeReadError } from "../_shared/playtomic-access-code.ts";
import { probeAvailability } from "./read.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
Deno.serve(async request => {
  const key = "__AVAILABILITY_PROBE_KEY__";
  if (request.method !== "POST" || key.startsWith("__") || request.headers.get("authorization") !== `Bearer ${key}`) {
    return json({ error: "not_allowed" }, 403);
  }
  try {
    const input = await request.json();
    if (!isDate(input?.date)) return json({ error: "invalid_date" }, 400);
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    // This command requires operator approval: renewal writes the private session store only.
    const cookie = await currentPlaytomicCookie(Deno.env.get("PLAYTOMIC_READ_ONLY_SESSION_COOKIE"), playtomicSessionStore(client));
    if (!cookie) return json({ configured: false });
    return json({ configured: true, results: await probeAvailability(input.date, cookie) });
  } catch (error) {
    return json({ error: error instanceof AccessCodeReadError ? error.reason : "probe_unavailable" }, 503);
  }
});
