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
    if (input.mode === "recent") {
      const list = await api("/emails/receiving?limit=25");
      const mails = (list.data || []).filter((mail: any) =>
        (mail.to || []).some((to: string) => to.toLowerCase() === recipient)
        && /Buchungsbestätigung|Buchung storniert/i.test(mail.subject || ""))
        .map((mail: any) => ({ id: mail.id, from: mail.from, subject: mail.subject, receivedAt: mail.created_at }));
      return respond({ mails, hasMore: !!list.has_more });
    }
    if (input.mode === "normalize" && Array.isArray(input.emailIds) && input.emailIds.length > 0 && input.emailIds.length <= 5) {
      const { readOutlookForward } = await import("../receive-court-booking/outlook-forward.ts");
      const { bookingInstants } = await import("../receive-court-booking/handler.ts");
      const { parsePlaytomicBookingMail } = await import("../_shared/playtomic-booking-mail.ts");
      const allowed = (Deno.env.get("RESEND_BOOKING_ORIGINAL_RECIPIENTS") || "").split(",").map(value => value.trim().toLowerCase());
      const bookings = [];
      for (const id of input.emailIds) {
        if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return respond({ error: "invalid_id" }, 400);
        const mail = await api(`/emails/receiving/${id}`);
        const from = String(mail.from || "").match(/<([^<>]+)>/)?.[1] || String(mail.from || "");
        if (!allowed.includes(from.trim().toLowerCase()) || mail.authentication?.dmarc !== "pass"
          || ![...(mail.to || []), ...(mail.received_for || [])].some((to: string) => to.toLowerCase() === recipient)) {
          return respond({ error: "manual_mail_not_allowed" }, 403);
        }
        const forwarded = readOutlookForward(mail.text || "");
        if (!forwarded) return respond({ error: "original_date_missing" }, 400);
        const calendars = (mail.attachments || []).filter((file: any) => /\.ics$/i.test(file.filename || ""));
        if (calendars.length !== 1) return respond({ error: "calendar_required_for_manual_import" }, 400);
        const attachment = await api(`/emails/receiving/${id}/attachments/${encodeURIComponent(calendars[0].id)}`);
        const url = new URL(attachment.download_url);
        if (url.protocol !== "https:" || url.username || url.password) return respond({ error: "invalid_calendar_url" }, 400);
        const calendarResponse = await fetch(url.toString(), { redirect: "error", signal: AbortSignal.timeout(15000) });
        if (!calendarResponse.ok || Number(calendarResponse.headers.get("content-length")) > 65536) return respond({ error: "calendar_unavailable" }, 503);
        const buffer = await calendarResponse.arrayBuffer();
        if (buffer.byteLength > 65536) return respond({ error: "calendar_too_large" }, 400);
        const booking = parsePlaytomicBookingMail({ ...forwarded, calendar: new TextDecoder().decode(buffer) });
        if (booking.state !== "confirmed" || !booking.providerId || ![60, 90].includes(booking.duration)) return respond({ error: "invalid_manual_booking" }, 400);
        const { start, end } = bookingInstants(booking);
        bookings.push({ emailId: id, providerId: booking.providerId, court: booking.court, organizer: booking.organizer,
          start, end, sourceOccurredAt: forwarded.occurredAt, precisionSeconds: forwarded.precisionSeconds });
      }
      // Read-only normalization. The operator must review and obtain approval
      // before writing these explicitly selected bookings via the project helper.
      return respond({ bookings });
    }
    if (["inspect", "access"].includes(input.mode) && Array.isArray(input.emailIds) && input.emailIds.length <= 5) {
      const mails = [];
      for (const id of input.emailIds) {
        if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return respond({ error: "invalid_id" }, 400);
        const mail = await api(`/emails/receiving/${id}`);
        const addresses = [...(mail.to || []), ...(mail.received_for || [])].map((value: string) => value.toLowerCase());
        if (!addresses.includes(recipient)) return respond({ error: "wrong_recipient" }, 400);
        if (input.mode === "access") {
          const find = (text: string) => [...text.matchAll(/\b(?:Zugang(?:s(?:code|daten))?|Zutritt(?:s(?:code|daten))?|Einlass|Tür(?:code)?|PIN|Code|access|entry|door|QR(?:-Code)?)\b/gi)]
            .slice(0, 30).map(match => text.slice(Math.max(0, match.index - 90), match.index + 180).replace(/\s+/g, " ").trim());
          const calendarMatches = [];
          for (const file of mail.attachments || []) {
            if (!/\.ics$/i.test(file.filename || "")) continue;
            const meta = await api(`/emails/receiving/${id}/attachments/${encodeURIComponent(file.id)}`);
            const url = new URL(meta.download_url);
            if (url.protocol !== "https:" || url.username || url.password) return respond({ error: "invalid_attachment_url" }, 400);
            const response = await fetch(url.toString(), { redirect: "error", signal: AbortSignal.timeout(15000) });
            if (!response.ok || Number(response.headers.get("content-length")) > 65536) return respond({ error: "attachment_unavailable" }, 503);
            const content = await response.text();
            if (content.length > 65536) return respond({ error: "attachment_too_large" }, 400);
            calendarMatches.push({ filename: file.filename, matches: find(content) });
          }
          const htmlText = (mail.html || "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ");
          const imageLabels = [...(mail.html || "").matchAll(/<img\b[^>]*\balt=["']([^"']*)["']/gi)].map(match => match[1]);
          mails.push({ id, textCharacters: (mail.text || "").length, textMatches: find(mail.text || ""),
            htmlMatches: find(htmlText), imageLabels,
            attachments: (mail.attachments || []).map((file: any) => ({ filename: file.filename, type: file.content_type })),
            calendarMatches });
          continue;
        }
        mails.push({ id, from: mail.from, authentication: mail.authentication,
          originalDateLine: mail.text?.match(/^Datum:[^\n]*/m)?.[0]?.trim(),
          bookingDetails: mail.text?.match(/Reservierungsdaten[\s\S]{1,500}?(?=Infos über die Bezahlung)/)?.[0]?.trim(),
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
