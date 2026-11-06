// Operational helper: deployed only during setup and removed immediately by
// tools/supabase-mcp.mjs. No user session can call it; no mail body or API key
// is returned. The signing secret is relayed only to the management helper,
// which stores it directly as a Function Secret without printing it.
const recipient = "buchungen@kiroimyon.resend.app";
const endpoint = `${Deno.env.get("SUPABASE_URL")}/functions/v1/receive-court-booking`;
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async request => {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (request.method !== "POST" || !key || request.headers.get("authorization") !== `Bearer ${key}`) {
    return respond({ error: "not_allowed" }, 403);
  }
  const apiKey = Deno.env.get("RESEND_RECEIVING_API_KEY") || Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return respond({ error: "resend_key_missing" }, 503);
  const api = async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`https://api.resend.com${path}`, { ...options,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`resend_http_${response.status}`);
    return await response.json();
  };
  try {
    const input = await request.json();
    if (input.mode === "inspect" && Array.isArray(input.emailIds) && input.emailIds.length <= 5) {
      const mails = [];
      for (const id of input.emailIds) {
        if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return respond({ error: "invalid_id" }, 400);
        const mail = await api(`/emails/receiving/${id}`);
        const addresses = [...(mail.to || []), ...(mail.received_for || [])].map((value: string) => value.toLowerCase());
        if (!addresses.includes(recipient)) return respond({ error: "wrong_recipient" }, 400);
        mails.push({ id, from: mail.from, authentication: mail.authentication,
          hasText: !!mail.text, hasHtml: !!mail.html, hasRaw: !!mail.raw?.download_url,
          hasCalendar: mail.attachments?.some((file: any) => /\.ics$/i.test(file.filename || "")) || false });
      }
      return respond({ mails });
    }
    if (input.mode === "configure") {
      const list = await api("/webhooks");
      const matches = (list.data || []).filter((hook: any) => hook.endpoint === endpoint);
      if (matches.length > 1 || list.has_more) return respond({ error: "webhook_list_needs_review" }, 409);
      let webhook;
      if (matches.length) {
        webhook = await api(`/webhooks/${encodeURIComponent(matches[0].id)}`);
        if (webhook.status === "disabled" || !webhook.events?.includes("email.received")) {
          return respond({ error: "existing_webhook_needs_review" }, 409);
        }
      } else {
        webhook = await api("/webhooks", { method: "POST", body: JSON.stringify({ endpoint, events: ["email.received"] }) });
      }
      if (!/^whsec_/.test(webhook.signing_secret || "")) return respond({ error: "signing_secret_unavailable" }, 503);
      return respond({ webhookId: webhook.id, signingSecret: webhook.signing_secret });
    }
    return respond({ error: "invalid_action" }, 400);
  } catch (error) {
    const reason = error instanceof Error && /^resend_http_\d+$/.test(error.message) ? error.message : "setup_unavailable";
    return respond({ error: reason }, 503);
  }
});
