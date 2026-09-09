import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Methode nicht erlaubt." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = request.headers.get("Authorization");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
      return jsonResponse({ error: "Einladungsdienst ist nicht vollständig konfiguriert." }, 500);
    }

    const body = await request.json();
    const playerId = String(body?.playerId || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();
    if (!playerId || !email) return jsonResponse({ error: "Spieler und Arbeits-E-Mail sind erforderlich." }, 400);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: preparation, error: preparationError } = await userClient.rpc(
      "save_player_email_assignment",
      { p_player_id: playerId, p_email: email },
    );
    if (preparationError) return jsonResponse({ error: preparationError.message }, 403);
    if (preparation?.status === "linked") return jsonResponse({ status: "linked" });

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const siteUrl = Deno.env.get("PUBLIC_SITE_URL") || "https://lw-ux.github.io/Padel-Liga/";
    const redirectUrl = new URL(siteUrl);
    redirectUrl.searchParams.set("auth", "invite");

    const { error: invitationError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirectUrl.href,
    });
    if (invitationError) return jsonResponse({ error: invitationError.message }, 400);

    return jsonResponse({ status: "invited" });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : "Die Einladung konnte nicht gesendet werden.",
    }, 500);
  }
});
