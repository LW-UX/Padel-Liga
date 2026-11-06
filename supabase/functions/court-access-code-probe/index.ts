// Temporary operational probe. Deployed and removed by supabase-mcp.mjs.
// A per-deployment random probe key is required; cookies/codes never leave it.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHandler } from "../court-access-code/handler.ts";
import { readHallAccessCode, AccessCodeReadError } from "../_shared/playtomic-access-code.ts";

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
Deno.serve(async request => {
  const probeKey = "__COURT_PROBE_KEY__";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (request.method !== "POST" || probeKey.startsWith("__") || request.headers.get("authorization") !== `Bearer ${probeKey}`) {
    return respond({ error: "not_allowed" }, 403);
  }
  if (!serviceKey) return respond({ error: "project_access_unavailable" }, 503);
  if (!Deno.env.get("PLAYTOMIC_READ_ONLY_SESSION_COOKIE")) return respond({ configured: false });
  try {
    const input = await request.json();
    if (!Array.isArray(input.matchIds) || !input.matchIds.length || input.matchIds.length > 10
      || input.matchIds.some((id: unknown) => typeof id !== "string" || !id || id.length > 200)
      || typeof input.actorId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.actorId)) {
      return respond({ error: "invalid_input" }, 400);
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // The MCP helper resolves a confirmed admin via a read-only database query.
    // Direct profile-table access is deliberately not granted to Edge Functions.
    const actor = input.actorId;
    let reads = 0, readError: string | null = null;
    const call = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await admin.rpc(name, args);
      if (error) throw new Error("database_unavailable");
      return data;
    };
    const handler = createHandler({
      // The service-authenticated operator exercises the same handler/RPCs as
      // a confirmed admin. This does not create a user session or auth link.
      user: async () => ({ id: actor!, confirmed: true }),
      subject: (matchId, userId) => call("get_court_access_code_subject", { p_match_id: matchId, p_user_id: userId }),
      claim: (matchId, userId, claimId) => call("claim_court_access_code_read", { p_match_id: matchId, p_user_id: userId, p_claim_id: claimId }),
      finish: (matchId, userId, claimId, bookingId, code, failureReason) => call("finish_court_access_code_read_with_health", {
        p_match_id: matchId, p_user_id: userId, p_claim_id: claimId, p_booking_id: bookingId, p_code: code,
        p_failure_reason: failureReason,
      }),
      cookie: () => Deno.env.get("PLAYTOMIC_READ_ONLY_SESSION_COOKIE"),
      readCode: async (id, cookie) => {
        try { return await readHallAccessCode(id, cookie, (url, options) => { reads++; return fetch(url, options); }); }
        catch (error) { readError = error instanceof AccessCodeReadError ? error.reason : "unavailable"; throw error; }
      },
    });
    const results = [];
    for (const matchId of [...new Set(input.matchIds as string[])]) {
      const probe = () => handler(new Request("https://probe.invalid", {
        method: "POST", headers: { Authorization: `Bearer ${serviceKey}` }, body: JSON.stringify({ matchId }),
      })).then(response => response.json());
      const before = reads;
      readError = null;
      const first = await probe();
      const after = reads;
      const second = first.state === "available" ? await probe() : null;
      results.push({ matchId, state: first.state, codePresent: /^\d{4}#$/.test(first.code || ""),
        cacheConfirmed: !!second && second.state === "available" && second.code === first.code && reads === after,
        playtomicReads: reads - before, ...(readError ? { readError } : {}) });
    }
    const configuredCookie = Deno.env.get("PLAYTOMIC_READ_ONLY_SESSION_COOKIE") || "";
    return respond({ configured: true, sessionFormat: {
      hasAccessCookieName: configuredCookie.includes("pt_auth_access_token="),
      hasRefreshCookieName: configuredCookie.includes("pt_auth_refresh_token="),
      hasLineBreaks: /[\r\n]/.test(configuredCookie),
    }, results });
  } catch { return respond({ error: "probe_unavailable" }, 503); }
});
