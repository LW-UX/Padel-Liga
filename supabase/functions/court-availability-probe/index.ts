// Temporarily deployed with a unique key and deleted by tools/supabase-mcp.mjs.
import { createClient } from "npm:@supabase/supabase-js@2";
import { CLUB_ID, CLUB_URL, isDate } from "../court-availability/data.ts";
import { publicRequestHeaders } from "../court-availability/request-headers.ts";
import { currentPlaytomicCookie, playtomicSessionStore } from "../_shared/playtomic-session.ts";
import { AccessCodeReadError } from "../_shared/playtomic-access-code.ts";
import { probeAvailability } from "./read.ts";
import { probeBrowserCookie } from "./browser-cookie.ts";
import { AvailabilityReadError } from "../court-availability/errors.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
Deno.serve(async request => {
  const key = "__AVAILABILITY_PROBE_KEY__";
  if (request.method !== "POST" || key.startsWith("__") || request.headers.get("authorization") !== `Bearer ${key}`) {
    return json({ error: "not_allowed" }, 403);
  }
  try {
    const text = await request.text();
    if (text.length > 50_000) return json({ error: "invalid_input" }, 400);
    const input = JSON.parse(text);
    if (!isDate(input?.date)) return json({ error: "invalid_date" }, 400);
    if (input.publicHeadersOnly === true) {
      const url = new URL("https://playtomic.com/api/clubs/availability");
      url.search = new URLSearchParams({ tenant_id: CLUB_ID, date: input.date, sport_id: "PADEL" }).toString();
      const navigation = { "User-Agent": publicRequestHeaders["User-Agent"],
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none" };
      const routes: { route: string; target: string; headers: Record<string, string> }[] = [
        { route: "club_plain", target: CLUB_URL, headers: {} },
        { route: "club_navigation", target: CLUB_URL, headers: navigation },
        { route: "club_german", target: "https://playtomic.com/de/clubs/lucky-star-padel", headers: navigation },
        { route: "availability", target: url.href, headers: publicRequestHeaders },
      ];
      const results = await Promise.all(routes.map(async ({ route, target, headers }) => {
        const start = Date.now();
        try {
          const response = await fetch(target, { headers, redirect: "error",
            cache: "no-store", signal: AbortSignal.timeout(15000) });
          const status = response.status;
          const type = response.headers.get("content-type");
          await response.body?.cancel();
          return { route, status, type, elapsedMs: Date.now() - start };
        } catch { return { route, error: "transport_or_timeout", elapsedMs: Date.now() - start }; }
      }));
      return json({ configured: true, results });
    }
    if (typeof input.browserCookie === "string") {
      return json(await probeBrowserCookie(input.date, input.browserCookie, input.userAgent || ""));
    }
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    // This command requires operator approval: renewal writes the private session store only.
    const cookie = await currentPlaytomicCookie(Deno.env.get("PLAYTOMIC_READ_ONLY_SESSION_COOKIE"), playtomicSessionStore(client));
    if (!cookie) return json({ configured: false });
    return json({ configured: true, results: await probeAvailability(input.date, cookie) });
  } catch (error) {
    return json({ error: error instanceof AvailabilityReadError || error instanceof AccessCodeReadError ? error.reason : "probe_unavailable" }, 503);
  }
});
