import { parsePlaytomicBookingMail, type BookingMail } from "../_shared/playtomic-booking-mail.ts";
import { readOutlookForward } from "./outlook-forward.ts";

type MimeMail = {
  subject?: string; text?: string; date?: string; from?: { address?: string }; to?: unknown;
  attachments?: { filename?: string; mimeType?: string; content: ArrayBuffer | Uint8Array | string }[];
};
type Config = { apiKey: string; signingSecret: string; recipient: string; forwarders: string[]; originalRecipients?: string[] };
type Dependencies = {
  verify: (body: string, headers: Record<string, string>, secret: string) => unknown;
  parseMime: (raw: Uint8Array) => Promise<MimeMail>;
  record: (params: Record<string, unknown>) => Promise<unknown>;
  syncRacket?: (matchId: string, actorUserId: string) => Promise<unknown>;
  hasRegisteredEmail?: (emails: string[]) => Promise<boolean>;
  fetch: typeof fetch;
};
const MAX_BYTES = 2 * 1024 * 1024;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const address = (value: string) => (value.match(/<([^<>]+)>/)?.[1] || value).trim().toLowerCase();
const bytes = (value: ArrayBuffer | Uint8Array | string) => typeof value === "string"
  ? new TextEncoder().encode(value) : new Uint8Array(value);

export type MatchAssignmentReference = { matchNumber: number; seasonHint: string | null };

// Only the outer subject and the note above an Outlook forward are commands.
// The quoted Playtomic mail remains booking evidence and can never instruct an
// assignment by mentioning an unrelated match in its original content.
export function readMatchAssignmentReference(subject = "", text = ""): MatchAssignmentReference | null {
  const normalizedText = text.normalize("NFC").replace(/\r\n?/g, "\n");
  const firstForwardHeader = normalizedText.search(/^Von:[ \t]*/m);
  const outerNote = firstForwardHeader < 0 ? normalizedText : normalizedText.slice(0, firstForwardHeader);
  const input = `${subject.normalize("NFC")}\n${outerNote}`;
  const pattern = /\bPartie\s*(?:Nr\.?\s*)?#?(\d{1,3})\b(?:\s*(?:[|·;,]\s*|\s+)(?:Saison\s*:?\s*)?((?:Winter|Sommer|Test)\s+20\d{2}|20\d{2}-(?:winter|sommer|test)|Cup\s+20\d{2}|20\d{2}-cup))?/giu;
  const references = [...input.matchAll(pattern)].map(match => ({
    matchNumber: Number(match[1]),
    seasonHint: match[2]?.trim() || null,
  })).filter(reference => reference.matchNumber > 0);
  if (!references.length) return null;
  const numbers = new Set(references.map(reference => reference.matchNumber));
  const seasonHints = new Map(references.filter(reference => reference.seasonHint).map(reference => [
    reference.seasonHint!.toLocaleLowerCase("de-DE"), reference.seasonHint!,
  ]));
  if (numbers.size !== 1 || seasonHints.size > 1) throw new Error("ambiguous_match_reference");
  return { matchNumber: references[0].matchNumber, seasonHint: [...seasonHints.values()][0] || null };
}

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
    if (!config.apiKey || !config.signingSecret || !config.recipient || (!config.forwarders.length && !deps.hasRegisteredEmail)) {
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
      if (received.authentication?.dmarc !== "pass") {
        return json({ status: "needs_review", reason: "sender_authentication" });
      }
      const explicitlyAllowed = config.forwarders.map(address).includes(sender);
      const registeredSender = !explicitlyAllowed && sender !== "no-reply@playtomic.io" && sender
        && deps.hasRegisteredEmail ? await deps.hasRegisteredEmail([sender]) : false;
      if (!explicitlyAllowed && !registeredSender) {
        return json({ status: "needs_review", reason: "sender_authentication" });
      }
      const url = new URL(received.raw?.download_url);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid_download");
      const response = await deps.fetch(url.toString(), { redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("raw_unavailable");
      let mail = await deps.parseMime(await limitedBody(response, MAX_BYTES));
      let assignmentReference: MatchAssignmentReference | null = null;
      let invalidAssignmentReference = false;
      if (sender !== "no-reply@playtomic.io") {
        try {
          assignmentReference = readMatchAssignmentReference(mail.subject, mail.text);
        } catch {
          invalidAssignmentReference = true;
        }
      }
      if (sender === "no-reply@playtomic.io") {
        // Redirects retain the original recipient. Accept only Playtomic mail
        // originally addressed to an approved/registered recipient, not mail
        // sent directly to the publicly known Resend address.
        const to = Array.isArray(mail.to) ? mail.to.flatMap(item => item?.group || [item]) : [];
        const allowed = (config.originalRecipients || []).map(address);
        const originals = [...new Set(to.filter(item => typeof item?.address === "string")
          .map(item => address(item.address)))].filter(email => email !== config.recipient.toLowerCase());
        if (address(mail.from?.address || "") !== sender || !originals.length || originals.length > 50) {
          return json({ status: "needs_review", reason: "original_recipient" });
        }
        const allowedOriginal = originals.some(email => allowed.includes(email))
          || (deps.hasRegisteredEmail ? await deps.hasRegisteredEmail(originals) : false);
        if (!allowedOriginal) {
          return json({ status: "needs_review", reason: "original_recipient" });
        }
      }
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
          p_source_occurred_at: source.occurredAt, p_source_precision_seconds: source.precisionSeconds,
          p_forwarder_email: sender === "no-reply@playtomic.io" ? null : sender,
          // An invalid explicit instruction must not fall back to time matching.
          p_match_number: invalidAssignmentReference ? -1 : assignmentReference?.matchNumber ?? null,
          p_season_hint: assignmentReference?.seasonHint ?? null };
      } catch { return json({ status: "needs_review", reason: "mail_format_or_original_date" }); }
      const result = await deps.record(params) as Record<string, unknown> | null;
      const actorUserId = typeof result?.actorUserId === "string" ? result.actorUserId : null;
      const matchId = typeof result?.matchId === "string" ? result.matchId : null;
      let racket: unknown;
      if (deps.syncRacket && actorUserId && matchId
        && ["assigned", "already_assigned"].includes(String(result?.assignment || ""))) {
        racket = await deps.syncRacket(matchId, actorUserId);
      }
      const publicResult = result ? { ...result } : result;
      if (publicResult) {
        delete publicResult.actorUserId;
        if (invalidAssignmentReference) publicResult.assignment = "invalid_reference";
      }
      return json({ status: "processed", result: publicResult, ...(racket === undefined ? {} : { racket }) });
    } catch {
      // Do not expose/log API errors, signed download URLs, mail bodies or keys.
      // Non-2xx makes Resend retry transient API/database failures.
      return json({ error: "processing_unavailable" }, 503);
    }
  };
}
