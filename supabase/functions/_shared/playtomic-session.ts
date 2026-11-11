// Server-only renewal of the read-only Playtomic session. It never logs in with
// a password and never sends tokens to the browser, logs or error messages.
// Playtomic rotates the refresh token on every exchange, so each new pair is
// stored immediately in the private session table.
import { AccessCodeReadError, accessTokenExpiresAt, normalizePlaytomicSessionCookie } from "./playtomic-access-code.ts";

export const tokenEndpoint = "https://api.app.playtomic.io/v3/auth/token";
const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const maxBytes = 64_000;

type Claim = { state: "current"; accessToken: string } | { state: "pending" } | { state: "none" }
  | { state: "refresh"; refreshToken: string | null };
type Tokens = { accessToken: string; refreshToken: string; accessExpiresAt: string; refreshExpiresAt: string | null };
export type SessionStore = {
  claim: (seedHash: string, leaseId: string) => Promise<Claim>;
  finish: (seedHash: string, leaseId: string, tokens: Tokens | null) => Promise<boolean>;
};

const cookieToken = (cookie: string, name: string) =>
  new RegExp(`(?:^|; )${name}=([A-Za-z0-9_.-]+)`).exec(cookie)?.[1] ?? null;

function jwtExpiry(token: string): number | null {
  return accessTokenExpiresAt(`pt_auth_access_token=${token}`);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// Only the access token is forwarded to the booking page, so the website
// cannot rotate the stored refresh token on its own.
const accessCookie = (token: string) => `pt_auth_access_token=${token}`;

export async function refreshPlaytomicTokens(refreshToken: string, fetcher: typeof fetch = fetch): Promise<Tokens> {
  let response: Response;
  try {
    response = await fetcher(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken, requested_user_roles: ["ROLE_CUSTOMER"] }),
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AccessCodeReadError("unavailable");
  }
  if ([400, 401, 403].includes(response.status)) {
    await response.body?.cancel();
    // A rejected or already used refresh token needs a new manual session.
    throw new AccessCodeReadError("login_required");
  }
  if (!response.ok || Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new AccessCodeReadError("unavailable");
  }
  let body: Record<string, unknown>;
  try {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error();
    body = JSON.parse(text);
  } catch {
    throw new AccessCodeReadError("unavailable");
  }
  const accessToken = body?.access_token, nextRefresh = body?.refresh_token;
  if (typeof accessToken !== "string" || !jwtPattern.test(accessToken)
    || typeof nextRefresh !== "string" || !jwtPattern.test(nextRefresh)) throw new AccessCodeReadError("unavailable");
  const accessExpiry = jwtExpiry(accessToken);
  if (accessExpiry === null) throw new AccessCodeReadError("unavailable");
  const refreshExpiry = jwtExpiry(nextRefresh);
  return {
    accessToken, refreshToken: nextRefresh, accessExpiresAt: new Date(accessExpiry).toISOString(),
    refreshExpiresAt: refreshExpiry === null ? null : new Date(refreshExpiry).toISOString(),
  };
}

export async function currentPlaytomicCookie(secretCookie: string | undefined, store: SessionStore, options: {
  fetcher?: typeof fetch; now?: () => number; wait?: (ms: number) => Promise<void>; leaseId?: () => string;
} = {}): Promise<string | undefined> {
  if (!secretCookie) return undefined;
  const now = options.now || Date.now;
  const wait = options.wait || (ms => new Promise(done => setTimeout(done, ms)));
  const secret = normalizePlaytomicSessionCookie(secretCookie);
  const secretRefresh = cookieToken(secret, "pt_auth_refresh_token");
  const secretAccess = cookieToken(secret, "pt_auth_access_token")!;
  // Without a refresh token the secret behaves as before: a single session.
  if (!secretRefresh) return secret;
  const seedHash = await sha256(secretRefresh);
  // A parallel renewal takes at most ~15 s; wait for it instead of reporting a fault.
  for (let attempt = 0; attempt < 20; attempt++) {
    const leaseId = options.leaseId ? options.leaseId() : crypto.randomUUID();
    const claim = await store.claim(seedHash, leaseId);
    if (claim.state === "current") return accessCookie(claim.accessToken);
    if (claim.state === "pending") { await wait(1000); continue; }
    if (claim.state !== "refresh") throw new AccessCodeReadError("unavailable");
    if (!claim.refreshToken) {
      // Fresh secret: its own access token is used while it is still valid.
      const expiresAt = accessTokenExpiresAt(secret);
      if (expiresAt !== null && expiresAt > now() + 120_000) {
        await store.finish(seedHash, leaseId, null);
        return accessCookie(secretAccess);
      }
    }
    let tokens: Tokens;
    try {
      tokens = await refreshPlaytomicTokens(claim.refreshToken || secretRefresh, options.fetcher);
    } catch (error) {
      await store.finish(seedHash, leaseId, null);
      throw error;
    }
    if (!await store.finish(seedHash, leaseId, tokens)) throw new AccessCodeReadError("unavailable");
    return accessCookie(tokens.accessToken);
  }
  throw new AccessCodeReadError("unavailable");
}

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

export function playtomicSessionStore(client: RpcClient): SessionStore {
  return {
    async claim(seedHash, leaseId) {
      const { data, error } = await client.rpc("claim_playtomic_session", { p_seed_hash: seedHash, p_lease_id: leaseId });
      if (error) throw new AccessCodeReadError("unavailable");
      return data as Claim;
    },
    async finish(seedHash, leaseId, tokens) {
      const { data, error } = await client.rpc("finish_playtomic_session", {
        p_seed_hash: seedHash, p_lease_id: leaseId, p_access_token: tokens?.accessToken ?? null,
        p_refresh_token: tokens?.refreshToken ?? null, p_access_expires_at: tokens?.accessExpiresAt ?? null,
        p_refresh_expires_at: tokens?.refreshExpiresAt ?? null,
      });
      if (error) throw new AccessCodeReadError("unavailable");
      return data === true;
    },
  };
}
