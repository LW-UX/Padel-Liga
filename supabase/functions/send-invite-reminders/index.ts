// Einmalige Erinnerung an eingeladene, noch unbestätigte Spielerkonten.
// Nur mit dem Service-Schlüssel aufrufbar (zeitgesteuerter Auftrag bzw. Betriebshelfer).
// Jeder Empfänger erhält einen frischen persönlichen Einladungslink, der erst
// über die neutrale Liga-Zwischenseite eingelöst wird.
import { createClient } from "npm:@supabase/supabase-js@2";
import { renderInviteReminder } from "./mail.ts";

type Recipient = { userId: string; name: string };

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async request => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const sender = Deno.env.get("NOTIFICATION_FROM") || "PadelLiga <noreply@padelliga.envidual.com>";
  const siteUrl = new URL(Deno.env.get("PUBLIC_SITE_URL") || "https://padelliga.envidual.com/");
  if (!siteUrl.pathname.endsWith("/")) siteUrl.pathname += "/";
  if (request.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  if (!supabaseUrl || !serviceKey || !resendApiKey) return respond({ error: "not_configured" }, 500);
  if (request.headers.get("authorization") !== `Bearer ${serviceKey}`) return respond({ error: "not_allowed" }, 401);

  let input: { test?: unknown; campaign?: unknown; recipients?: unknown };
  try { input = await request.json(); } catch { return respond({ error: "invalid_input" }, 400); }
  const test = input.test === true;
  const campaign = String(input.campaign || "");
  const recipients = input.recipients as Recipient[];
  if (!/^[a-z0-9-]{1,60}$/.test(campaign) || !Array.isArray(recipients) || !recipients.length || recipients.length > 20
    || recipients.some(r => !/^[0-9a-f-]{36}$/i.test(String(r?.userId)) || typeof r?.name !== "string" || r.name.length > 60)) {
    return respond({ error: "invalid_input" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const redirectUrl = new URL(siteUrl);
  redirectUrl.searchParams.set("auth", "invite");
  const results = [];
  for (const recipient of recipients) {
    const row: Record<string, unknown> = { userId: recipient.userId };
    try {
      const { data: userData, error: userError } = await admin.auth.admin.getUserById(recipient.userId);
      const user = userData?.user;
      if (userError || !user?.email) { row.status = "unknown_user"; results.push(row); continue; }
      const confirmed = !!user.email_confirmed_at;
      // Echte Erinnerungen nur an weiterhin unbestätigte Konten; die Testmail
      // geht ausschließlich an ein bereits bestätigtes (eigenes) Konto.
      if (!test && confirmed) { row.status = "already_confirmed"; results.push(row); continue; }
      if (test && !confirmed) { row.status = "test_requires_confirmed_account"; results.push(row); continue; }
      // Wie die Wiedereinladung in `invite-player`: Für ein bestehendes Konto
      // bestätigt der Magic-Link die Adresse, `?auth=invite` öffnet die Passwortmaske.
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: "magiclink", email: user.email, options: { redirectTo: redirectUrl.href },
      });
      const actionLink = linkData?.properties?.action_link;
      if (linkError || !actionLink) { row.status = "link_failed"; results.push(row); continue; }
      // Firmenfilter können URL-Fragmente entfernen, daher als Query-Parameter.
      const confirmationPage = new URL(siteUrl);
      confirmationPage.searchParams.set("auth", "confirm");
      confirmationPage.searchParams.set("purpose", "invite");
      confirmationPage.searchParams.set("confirmation_url", actionLink);
      const mail = renderInviteReminder(recipient.name, confirmationPage.href, test);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}`,
          "Idempotency-Key": test ? crypto.randomUUID() : `invite-reminder-${campaign}-${recipient.userId}`,
        },
        body: JSON.stringify({ from: sender, to: [user.email], subject: mail.subject, html: mail.html, text: mail.text }),
      });
      await response.body?.cancel();
      row.status = response.ok ? "sent" : `send_failed_${response.status}`;
    } catch {
      // Keine Adressen, Links oder Anbieterantworten in Ergebnis oder Protokoll.
      row.status = "failed";
    }
    results.push(row);
  }
  console.log(JSON.stringify({ campaign, test, results }));
  return respond({ campaign, test, results });
});
