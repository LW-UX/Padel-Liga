import { createClient } from "npm:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";
import { readHallAccessCode } from "../_shared/playtomic-access-code.ts";

const options = { auth: { persistSession: false, autoRefreshToken: false } };
function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, options);
}
Deno.serve(createHandler({
  async user(authorization) {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      ...options, global: { headers: { Authorization: authorization } },
    });
    const { data, error } = await client.auth.getUser();
    return error || !data.user ? null : { id: data.user.id, confirmed: !!data.user.email_confirmed_at };
  },
  async subject(matchId, userId) {
    const client = admin();
    const { data, error } = await client.rpc("get_court_access_code_subject", { p_match_id: matchId, p_user_id: userId });
    if (error) throw new Error("subject_unavailable");
    return data;
  },
  cookie: () => Deno.env.get("PLAYTOMIC_READ_ONLY_SESSION_COOKIE"),
  readCode: readHallAccessCode,
  async claim(matchId, userId, claimId) {
    const { data, error } = await admin().rpc("claim_court_access_code_read", {
      p_match_id: matchId, p_user_id: userId, p_claim_id: claimId,
    });
    if (error) throw new Error("cache_unavailable");
    return data;
  },
  async finish(matchId, userId, claimId, bookingId, code, failureReason) {
    const { data, error } = await admin().rpc("finish_court_access_code_read_with_health", {
      p_match_id: matchId, p_user_id: userId, p_claim_id: claimId, p_booking_id: bookingId, p_code: code,
      p_failure_reason: failureReason,
    });
    if (error) throw new Error("cache_unavailable");
    return data;
  },
}));
