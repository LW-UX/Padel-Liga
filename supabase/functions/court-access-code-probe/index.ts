// Temporary operational probe. Deployed and removed by supabase-mcp.mjs.
// A per-deployment random probe key is required; cookies/codes never leave it.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHandler } from "../court-access-code/handler.ts";
import {
  readHallAccessCode, parseHallAccessCode, AccessCodeReadError, normalizePlaytomicSessionCookie,
} from "../_shared/playtomic-access-code.ts";
import { currentPlaytomicCookie, playtomicSessionStore } from "../_shared/playtomic-session.ts";

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function sessionFormat() {
  const configuredCookie = Deno.env.get("PLAYTOMIC_READ_ONLY_SESSION_COOKIE") || "";
  // Nur Ablaufzeitpunkte der JWTs, niemals Tokenwerte oder sonstige Claims.
  const expiresAt = (name: string) => {
    const payload = new RegExp(`${name}=[A-Za-z0-9_-]+\\.([A-Za-z0-9_-]+)\\.`).exec(configuredCookie)?.[1];
    try {
      const exp = payload ? JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")
        .padEnd(Math.ceil(payload.length / 4) * 4, "="))).exp : null;
      return Number.isFinite(exp) ? new Date(exp * 1000).toISOString() : null;
    } catch { return null; }
  };
  return {
    hasAccessCookieName: configuredCookie.includes("pt_auth_access_token="),
    hasRefreshCookieName: configuredCookie.includes("pt_auth_refresh_token="),
    hasLineBreaks: /[\r\n]/.test(configuredCookie),
    accessTokenExpiresAt: expiresAt("pt_auth_access_token"),
    refreshTokenExpiresAt: expiresAt("pt_auth_refresh_token"),
  };
}

// `training:<ID>` prüft ein Training über denselben öffentlichen Request-Weg.
const requestBody = (id: string) => {
  const trainingId = /^training:([1-9]\d{0,17})$/.exec(id)?.[1];
  return trainingId ? { trainingId: Number(trainingId) } : { matchId: id };
};

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
    const ids = [...new Set(input.matchIds as string[])];
    let reads = 0, readError: string | null = null;
    const call = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await admin.rpc(name, args);
      if (error) throw new Error("database_unavailable");
      return data;
    };

    if (input.diagnoseOnly === true) {
      // Reiner Lesemodus: nur Berechtigungsprüfung und ein GET ohne Weiterleitung,
      // keine Cache-, Claim- oder Störungsschreibvorgänge.
      const diagnoses = [];
      for (const id of ids) {
        const subject = await call("get_court_access_code_subject", { p_match_id: id, p_user_id: actor });
        if (!subject?.providerId) { diagnoses.push({ id, subject: false }); continue; }
        const row: Record<string, unknown> = { id, subject: true, courtNumber: subject.courtNumber };
        try {
          // withSession nutzt die automatische Verlängerung (schreibt nur den privaten Sitzungsspeicher).
          const cookie = input.withSession === true
            ? (await currentPlaytomicCookie(Deno.env.get("PLAYTOMIC_READ_ONLY_SESSION_COOKIE"), playtomicSessionStore(admin)))!
            : normalizePlaytomicSessionCookie(Deno.env.get("PLAYTOMIC_READ_ONLY_SESSION_COOKIE")!);
          const response = await fetch(`https://app.playtomic.com/app_tabs/profile/activity/bookings/${String(subject.providerId).toLowerCase()}`, {
            method: "GET", headers: { Cookie: cookie, Accept: "text/html" },
            redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15000),
          });
          const location = response.headers.get("location");
          Object.assign(row, { status: response.status, contentType: (response.headers.get("content-type") || "").split(";")[0],
            redirectPath: location ? new URL(location, "https://app.playtomic.com").pathname : null });
          if (response.ok) {
            const html = await response.text();
            try { row.codePresent = /^\d{4}#$/.test(parseHallAccessCode(html)); }
            catch (error) {
              row.parseError = error instanceof AccessCodeReadError ? error.reason : "unavailable";
              row.accessCodeMentions = [...html.matchAll(/access\s+code/gi)].length;
            }
          } else await response.body?.cancel();
        } catch (error) { row.fetchError = error instanceof AccessCodeReadError ? error.reason : "transport"; }
        diagnoses.push(row);
      }
      const sessionStatus = input.withSession === true
        ? (await admin.rpc("get_playtomic_session_status", {})).data : undefined;
      return respond({ configured: true, sessionFormat: sessionFormat(), sessionStatus, diagnoses });
    }

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
      cookie: () => currentPlaytomicCookie(Deno.env.get("PLAYTOMIC_READ_ONLY_SESSION_COOKIE"), playtomicSessionStore(admin)),
      readCode: async (id, cookie) => {
        try { return await readHallAccessCode(id, cookie, (url, options) => { reads++; return fetch(url, options); }); }
        catch (error) { readError = error instanceof AccessCodeReadError ? error.reason : "unavailable"; throw error; }
      },
    });
    const results = [];
    for (const matchId of ids) {
      const probe = () => handler(new Request("https://probe.invalid", {
        method: "POST", headers: { Authorization: `Bearer ${serviceKey}` }, body: JSON.stringify(requestBody(matchId)),
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
    const { data: sessionStatus } = await admin.rpc("get_playtomic_session_status", {});
    return respond({ configured: true, sessionFormat: sessionFormat(), sessionStatus, results });
  } catch { return respond({ error: "probe_unavailable" }, 503); }
});
