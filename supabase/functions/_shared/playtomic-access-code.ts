// Server-only reader. Never expose this function or its session cookie directly
// to a browser. The caller must authorize access to the particular booking.
// No login, form submission, booking action, redirect or script execution.
const origin = "https://app.playtomic.com";
const bookingIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const maxBytes = 2_000_000;

export class AccessCodeReadError extends Error {
  readonly reason: "invalid_request" | "login_required" | "unavailable" | "code_unavailable";
  constructor(reason: "invalid_request" | "login_required" | "unavailable" | "code_unavailable") {
    // Do not include response bodies, cookies, access codes or transport errors.
    super(reason);
    this.reason = reason;
    this.name = "AccessCodeReadError";
  }
}

export function parseHallAccessCode(html: string): string {
  if (new TextEncoder().encode(html).byteLength > maxBytes) throw new AccessCodeReadError("unavailable");
  const text = html.replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, value: string) => {
      const code = value[0].toLowerCase() === "x" ? parseInt(value.slice(1), 16) : Number(value);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/&(?:nbsp|ensp|emsp);/gi, " ")
    .replace(/\s+/g, " ").trim();
  // Fail closed on layout or format changes, missing codes and ambiguity.
  // Only the currently verified hall format is supported: four digits + #.
  if ([...text.matchAll(/\bAccess\s+code\b/gi)].length !== 1) throw new AccessCodeReadError("code_unavailable");
  const match = /\bAccess\s+code\s*:?\s*(\d{4}#)(?=\s|$)/i.exec(text);
  if (!match) throw new AccessCodeReadError("code_unavailable");
  return match[1];
}

export function normalizePlaytomicSessionCookie(input: string): string {
  if (typeof input !== "string" || /\0/.test(input) || new TextEncoder().encode(input).byteLength > 65536) {
    throw new AccessCodeReadError("invalid_request");
  }
  const tokens = new Map<string, string>();
  // A copied header may contain a label, unrelated cookies, or line breaks
  // between cookies. Rebuild only named JWT cookies; never forward raw input.
  for (const part of input.trim().replace(/^cookie\s*:\s*/i, "").split(/[;\r\n]+/)) {
    const value = part.trim();
    if (!/^pt_auth_(?:access|refresh)_token\b/.test(value)) continue;
    const match = /^(pt_auth_(?:access|refresh)_token)=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(value);
    if (!match || tokens.has(match[1])) throw new AccessCodeReadError("invalid_request");
    tokens.set(match[1], match[2]);
  }
  if (!tokens.has("pt_auth_access_token")) throw new AccessCodeReadError("invalid_request");
  return [...tokens].map(([name, token]) => `${name}=${token}`).join("; ");
}

export async function readHallAccessCode(bookingId: string, sessionCookie: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (typeof bookingId !== "string" || !bookingIdPattern.test(bookingId)) throw new AccessCodeReadError("invalid_request");
  const cookie = normalizePlaytomicSessionCookie(sessionCookie);
  let response: Response;
  try {
    // The URL and method cannot be supplied by a caller. In particular this
    // reader cannot be redirected to an action endpoint or another host.
    response = await fetcher(`${origin}/app_tabs/profile/activity/bookings/${bookingId.toLowerCase()}`, {
      method: "GET", headers: { Cookie: cookie, Accept: "text/html" },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AccessCodeReadError("unavailable");
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new AccessCodeReadError("login_required");
  }
  if (!response.ok || response.redirected || (response.url && response.url !== `${origin}/app_tabs/profile/activity/bookings/${bookingId.toLowerCase()}`)
    || !/^text\/html\b/i.test(response.headers.get("content-type") || "")
    || Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new AccessCodeReadError("unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new AccessCodeReadError("unavailable");
  const decoder = new TextDecoder();
  let size = 0, html = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AccessCodeReadError("unavailable");
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
  } catch {
    throw new AccessCodeReadError("unavailable");
  } finally {
    reader.releaseLock();
  }
  return parseHallAccessCode(html);
}
