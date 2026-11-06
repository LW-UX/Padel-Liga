import { parsePlaytomicBookingMail, type BookingMail } from "../_shared/playtomic-booking-mail.ts";
import { readOutlookForward } from "./outlook-forward.ts";

type MimeMail = {
  subject?: string; text?: string; date?: string; from?: { address?: string };
  attachments?: { filename?: string; mimeType?: string; content: ArrayBuffer | Uint8Array | string }[];
};
type Config = { apiKey: string; signingSecret: string; recipient: string; forwarders: string[] };
type Dependencies = {
  verify: (body: string, headers: Record<string, string>, secret: string) => unknown;
  parseMime: (raw: Uint8Array) => Promise<MimeMail>;
  record: (params: Record<string, unknown>) => Promise<unknown>;
  fetch: typeof fetch;
};
const MAX_BYTES = 2 * 1024 * 1024;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const address = (value: string) => (value.match(/<([^<>]+)>/)?.[1] || value).trim().toLowerCase();
const bytes = (value: ArrayBuffer | Uint8Array | string) => typeof value === "string"
  ? new TextEncoder().encode(value) : new Uint8Array(value);

async function limitedBody(response: Response, limit: number) {
  if (Number(response.headers.get("content-length")) > limit) throw new Error("too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty_body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("too_large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

// Enumerate possible UTC offsets instead of silently choosing a nonexistent or
// repeated clock time at the daylight-saving boundary.
export function bookingInstants(booking: BookingMail) {
  const wall = Date.parse(`${booking.date}T${booking.time}:00Z`);
  const formatter = new Intl.DateTimeFormat("sv-SE", { timeZone: booking.timezone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const candidates = [1, 2].map(offset => wall - offset * 3600000)
    .filter(value => formatter.format(new Date(value)) === `${booking.date} ${booking.time}`);
  if (candidates.length !== 1) throw new Error("ambiguous_booking_time");
  return { start: new Date(candidates[0]).toISOString(),
    end: new Date(candidates[0] + booking.duration * 60000).toISOString() };
}

function originalTimestamp(mail: MimeMail, calendar: string | undefined, direct: boolean) {
  // A forwarded message's outer Date is its forwarding time, not the original
  // booking event time. Never use Resend's received_at as a replacement.
  let value = direct ? mail.date : undefined;
  if (!value && calendar) {
    const stamps = [...calendar.replace(/\r?\n[ \t]/g, "").matchAll(/^DTSTAMP:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\r?$/gm)];
    if (stamps.length === 1) {
      const m = stamps[0];
      value = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
    }
  }
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error("missing_original_date");
  return { occurredAt: new Date(value).toISOString(), precisionSeconds: 1 };
}

export function createBookingWebhook(config: Config, deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!config.apiKey || !config.signingSecret || !config.recipient || !config.forwarders.length) {
      return json({ error: "not_configured" }, 503);
    }
    let event: any;
    try {
      const body = new TextDecoder().decode(await limitedBody(new Response(request.body), 128 * 1024));
      event = deps.verify(body, Object.fromEntries(["svix-id", "svix-timestamp", "svix-signature"]
        .map(key => [key, request.headers.get(key) || ""])), config.signingSecret);
    } catch { return json({ error: "invalid_webhook" }, 400); }
    if (event?.type !== "email.received") return json({ status: "ignored" });
    const id = event?.data?.email_id;
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "invalid_event" }, 400);
    const api = async (path: string) => {
      const response = await deps.fetch(`https://api.resend.com${path}`, {
        headers: { Authorization: `Bearer ${config.apiKey}` }, redirect: "error", signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("resend_unavailable");
      return JSON.parse(new TextDecoder().decode(await limitedBody(response, MAX_BYTES)));
    };
    try {
      const received = await api(`/emails/receiving/${id}`);
      // Metadata is fetched from Resend after signature verification. Neither a
      // spoofed JSON body nor a From line pasted inside a mail authorizes writes.
      const recipients = [...(Array.isArray(received.to) ? received.to : []),
        ...(Array.isArray(received.received_for) ? received.received_for : [])];
      if (!recipients.some((to: string) => typeof to === "string" && address(to) === config.recipient.toLowerCase())) {
        return json({ status: "ignored", reason: "recipient" });
      }
      const sender = address(received.from || "");
      if (!config.forwarders.map(address).includes(sender) || received.authentication?.dmarc !== "pass") {
        return json({ status: "needs_review", reason: "sender_authentication" });
      }
      const url = new URL(received.raw?.download_url);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid_download");
      const response = await deps.fetch(url.toString(), { redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("raw_unavailable");
      let mail = await deps.parseMime(await limitedBody(response, MAX_BYTES));
      const originals = mail.attachments?.filter(file => file.mimeType === "message/rfc822" || /\.eml$/i.test(file.filename || "")) || [];
      if (originals.length > 1) return json({ status: "needs_review", reason: "multiple_originals" });
      if (originals.length === 1) mail = await deps.parseMime(bytes(originals[0].content));
      const direct = address(mail.from?.address || "") === "no-reply@playtomic.io";
      if (originals.length && !direct) return json({ status: "needs_review", reason: "original_sender" });
      const calendars = mail.attachments?.filter(file => /\.ics$/i.test(file.filename || "")
        || /^(text\/calendar|application\/ics)$/i.test(file.mimeType || "")) || [];
      if (calendars.length > 1) return json({ status: "needs_review", reason: "multiple_calendars" });
      const calendar = calendars.length ? new TextDecoder().decode(bytes(calendars[0].content)) : undefined;
      let params: Record<string, unknown>;
      try {
        const forwarded = !direct ? readOutlookForward(mail.text || "") : null;
        const booking = parsePlaytomicBookingMail({ subject: forwarded?.subject || mail.subject || "",
          text: forwarded?.text || mail.text || "", calendar });
        if (![60, 90].includes(booking.duration)) return json({ status: "needs_review", reason: "unsupported_duration" });
        const { start, end } = bookingInstants(booking);
        const source = forwarded || originalTimestamp(mail, calendar, direct);
        if (Date.parse(source.occurredAt) > Date.now() + 5 * 60000) throw new Error("future_original_date");
        params = { p_provider_booking_id: booking.providerId, p_court_resource_id: null,
          p_court_name: booking.court, p_organizer: booking.organizer,
          p_starts_at: start, p_ends_at: end, p_cancelled: booking.state === "cancelled",
          p_source_occurred_at: source.occurredAt, p_source_precision_seconds: source.precisionSeconds };
      } catch { return json({ status: "needs_review", reason: "mail_format_or_original_date" }); }
      const result = await deps.record(params);
      return json({ status: "processed", result });
    } catch {
      // Do not expose/log API errors, signed download URLs, mail bodies or keys.
      // Non-2xx makes Resend retry transient API/database failures.
      return json({ error: "processing_unavailable" }, 503);
    }
  };
}
