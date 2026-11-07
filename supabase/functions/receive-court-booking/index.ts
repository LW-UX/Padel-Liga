import { Webhook } from "npm:svix@2.9.1";
import PostalMime from "npm:postal-mime@4.2.0";
import { convert } from "npm:html-to-text@10.0.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createBookingWebhook } from "./handler.ts";

const config = {
  apiKey: Deno.env.get("RESEND_RECEIVING_API_KEY") || Deno.env.get("RESEND_API_KEY") || "",
  signingSecret: Deno.env.get("RESEND_BOOKING_WEBHOOK_SECRET") || "",
  recipient: Deno.env.get("RESEND_BOOKING_RECIPIENT") || "buchungen@kiroimyon.resend.app",
  forwarders: (Deno.env.get("RESEND_BOOKING_FORWARDERS") || "").split(",").map(value => value.trim()).filter(Boolean),
  originalRecipients: (Deno.env.get("RESEND_BOOKING_ORIGINAL_RECIPIENTS") || "").split(",").map(value => value.trim()).filter(Boolean),
};
const admin = () => createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(createBookingWebhook(config, {
  verify: (body, headers, secret) => {
    new Webhook(secret).verify(body, headers);
    return JSON.parse(body);
  },
  parseMime: async raw => {
    const mail = await PostalMime.parse(raw, {
      forceRfc822Attachments: true, maxNestingDepth: 20, maxPartCount: 100, maxHeadersSize: 128 * 1024,
    });
    return { ...mail, text: mail.text || convert(mail.html || "", {
      wordwrap: false, selectors: [
        { selector: "a", options: { ignoreHref: true } }, { selector: "img", format: "skip" },
        ...["h1", "h2", "h3"].map(selector => ({ selector, options: { uppercase: false } })),
      ],
    }), from: mail.from && "address" in mail.from ? { address: mail.from.address } : undefined };
  },
  fetch,
  hasRegisteredEmail: async emails => {
    const { data, error } = await admin().rpc("has_registered_court_booking_email", { p_emails: emails });
    if (error) throw new Error("sender_lookup_unavailable");
    return data === true;
  },
  record: async params => {
    const { data, error } = await admin().rpc("record_court_booking_with_match", params);
    if (error) throw new Error("booking_storage_unavailable");
    return data;
  },
  syncRacket: async (matchId, actorUserId) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const response = await fetch(`${supabaseUrl}/functions/v1/racket-booking`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync-internal", subjectType: "match", subjectId: matchId, actorUserId }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("racket_sync_unavailable");
    const result = await response.json();
    if (["failed", "unavailable"].includes(String(result?.state || ""))) {
      throw new Error("racket_sync_unavailable");
    }
    return result;
  },
}));
