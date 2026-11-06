type Subject = { bookingId: number; providerId: string; startsAt: string; endsAt: string; courtNumber: string };
type CacheResult = { state: string; code?: string; endsAt?: string; refreshAt?: string; retryAt?: string; subject?: Subject };
type User = { id: string; confirmed: boolean };
export type Dependencies = {
  user: (authorization: string) => Promise<User | null>;
  subject: (matchId: string, userId: string) => Promise<Subject | null>;
  cookie: () => string | undefined;
  readCode: (providerId: string, cookie: string) => Promise<string>;
  claim: (matchId: string, userId: string, claimId: string) => Promise<CacheResult>;
  finish: (matchId: string, userId: string, claimId: string, bookingId: number, code: string | null, failureReason: string | null) => Promise<CacheResult>;
  now?: () => number;
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Authorization" },
});

export function createHandler(deps: Dependencies) {
  return async (request: Request) => {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ state: "unavailable" }, 405);
    const authorization = request.headers.get("authorization") || "";
    if (!/^Bearer \S+$/i.test(authorization)) return json({ state: "unavailable" }, 401);
    try {
      const user = await deps.user(authorization);
      if (!user) return json({ state: "unavailable" }, 401);
      if (!user.confirmed) return json({ state: "unavailable" }, 403);
      const text = await request.text();
      if (text.length > 512) return json({ state: "unavailable" }, 400);
      let body;
      try { body = JSON.parse(text); } catch { return json({ state: "unavailable" }, 400); }
      if (!body || typeof body.matchId !== "string" || !body.matchId.trim()
        || body.matchId.length > 200 || Object.keys(body).some(key => key !== "matchId")) {
        return json({ state: "unavailable" }, 400);
      }
      // Resolve and authorize every time, including when the UI still holds an
      // old booking. Never accept a provider booking ID or user ID from the UI.
      const subject = await deps.subject(body.matchId, user.id);
      const now = deps.now || Date.now;
      if (!subject || !/^H[1-4]$/.test(subject.courtNumber) || !(Date.parse(subject.endsAt) > now())) return json({ state: "none" });
      const publicResult = (result: CacheResult) => {
        if (result?.state === "available" && /^\d{4}#$/.test(result.code || "")
          && Date.parse(result.endsAt || "") > now() && Date.parse(result.refreshAt || "") > now()) {
          return json({ state: "available", code: result.code, endsAt: result.endsAt, refreshAt: result.refreshAt });
        }
        if (result?.state === "none") return json({ state: "none" });
        if (result?.state === "pending") return json({ state: "pending", retryAt: result.retryAt });
        return json({ state: "unavailable", ...(result?.retryAt ? { retryAt: result.retryAt } : {}) });
      };
      const claimId = crypto.randomUUID();
      const claim = await deps.claim(body.matchId, user.id, claimId);
      if (claim.state !== "read") return publicResult(claim);
      const selected = claim.subject;
      if (!selected || !/^H[1-4]$/.test(selected.courtNumber) || !(Date.parse(selected.endsAt) > now())) return json({ state: "none" });
      let code: string | null = null;
      let failureReason: string | null = "configuration";
      try {
        const cookie = deps.cookie();
        if (cookie) {
          failureReason = "code_unavailable";
          const read = await deps.readCode(selected.providerId, cookie);
          if (/^\d{4}#$/.test(read)) { code = read; failureReason = null; }
        }
      } catch (error) {
        // Store only a fixed classification, never transport errors or data.
        const reason = (error as { reason?: string })?.reason;
        failureReason = reason === "invalid_request" ? "configuration"
          : reason === "login_required" || reason === "code_unavailable" ? reason : "unavailable";
      }
      // A cancellation, reassignment or permission change during the external
      // request must not release the code to an obsolete match or account.
      const current = await deps.subject(body.matchId, user.id);
      if (!current || current.providerId !== selected.providerId || current.endsAt !== selected.endsAt
        || current.startsAt !== selected.startsAt || current.bookingId !== selected.bookingId
        || current.courtNumber !== selected.courtNumber
        || !(Date.parse(current.endsAt) > now())) return json({ state: "none" });
      return publicResult(await deps.finish(body.matchId, user.id, claimId, selected.bookingId, code, failureReason));
    } catch {
      // No response body, transport exception, cookie or code in logs/errors.
      return json({ state: "unavailable" });
    }
  };
}
