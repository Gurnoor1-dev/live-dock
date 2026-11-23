import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

export const IF_SESSION_COOKIE = "vb_if_session";
const SESSION_CHUNK_PREFIX = IF_SESSION_COOKIE + "_";
const SESSION_CHUNKS_COOKIE = IF_SESSION_COOKIE + "_chunks";
const SESSION_CHUNK_SIZE = 3000;
const MAX_SESSION_CHUNKS = 16;
export const IF_STATE_COOKIE = "vb_if_oauth_state";
export const IF_VERIFIER_COOKIE = "vb_if_pkce_verifier";
const AUTH_BASE = "https://api.infiniteflight.com/auth/v2/connect";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type IFIdentity = {
  id: string;
  username: string | null;
  displayName: string | null;
};

export type IFSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  identity?: IFIdentity;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type AccessTokenClaims = {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  iat?: number;
  scope?: string;
  client_id?: string;
  name?: string;
  preferred_username?: string;
  nickname?: string;
  username?: string;
};

function decodeBase64UrlJson<T>(value: string): T {
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Infinite Flight returned malformed token metadata.");
  }
  return parsed;
}

/**
 * Read identity claims only from an access token returned directly by the
 * Infinite Flight token endpoint over HTTPS. LiveDock never accepts a
 * browser-supplied access token for identity creation; the complete session
 * is sealed with AES-256-GCM in an HTTP-only cookie.
 *
 * Infinite Flight's published v3 docs do not publish a JWKS/discovery URL.
 * Do not follow jku/x5u values from an untrusted JWT header or invent a key URL.
 * If Infinite Flight publishes an official JWKS endpoint, add RS256 signature
 * verification here before relying on claims from any externally supplied token.
 */
export function getIFIdentityFromToken(accessToken: string, expectedClientId?: string): IFIdentity {
  const parts = accessToken.split(".");
  if (parts.length !== 3 || parts.some(part => !part)) {
    throw new Error("Infinite Flight returned an access token in an unsupported format.");
  }

  const header = decodeBase64UrlJson<{ alg?: string; typ?: string; kid?: string }>(parts[0]);
  if (header.alg !== "RS256" || (header.typ !== "at+jwt" && header.typ !== "application/at+jwt")) {
    throw new Error("Infinite Flight returned an unsupported access-token format.");
  }

  const claims = decodeBase64UrlJson<AccessTokenClaims>(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== "https://auth.infiniteflight.com/") {
    throw new Error("Infinite Flight returned an unexpected token issuer.");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes("public-api-v3")) {
    throw new Error("Infinite Flight access token is not intended for PublicApi v3.");
  }
  if (typeof claims.exp !== "number" || claims.exp <= now) {
    throw new Error("Infinite Flight access token has expired.");
  }
  if (typeof claims.iat === "number" && claims.iat > now + 120) {
    throw new Error("Infinite Flight access token has an invalid issue time.");
  }
  if (expectedClientId && claims.client_id !== expectedClientId) {
    throw new Error("Infinite Flight access token belongs to a different OAuth client.");
  }
  const scopes = new Set(String(claims.scope || "").split(/\s+/).filter(Boolean));
  if (!scopes.has("openid")) {
    throw new Error("Infinite Flight did not grant the OpenID sign-in scope.");
  }
  if (typeof claims.sub !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub)) {
    throw new Error("Infinite Flight returned an invalid account identifier.");
  }

  const username = claims.preferred_username || claims.nickname || claims.username || null;
  const displayName = claims.name || username || null;
  return { id: claims.sub, username, displayName };
}

function encryptionKey() {
  const secret = process.env.IF_SESSION_SECRET;
  if (!secret) throw new Error("IF_SESSION_SECRET is not configured.");
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) throw new Error("IF_SESSION_SECRET must be a base64-encoded 32-byte key.");
  return key;
}

function encrypt(value: IFSession) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

function decrypt(value: string): IFSession | null {
  try {
    const packed = Buffer.from(value, "base64url");
    if (packed.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    const parsed = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8")) as IFSession;
    return parsed.accessToken && typeof parsed.expiresAt === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}

type SessionCookieOptions = ReturnType<typeof cookieOptions> & { expires?: Date };

function clearSessionCookies(store: Awaited<ReturnType<typeof cookies>>) {
  const expired = { ...cookieOptions(0), expires: new Date(0) };
  store.set(IF_SESSION_COOKIE, "", expired);
  store.set(SESSION_CHUNKS_COOKIE, "", expired);
  for (let index = 0; index < MAX_SESSION_CHUNKS; index++) store.set(SESSION_CHUNK_PREFIX + index, "", expired);
}

export async function saveIFSession(session: IFSession, response?: NextResponse) {
  const store = response ? null : await cookies();
  const set = (name: string, value: string, options: SessionCookieOptions) => {
    if (response) response.cookies.set(name, value, options);
    else store!.set(name, value, options);
  };
  const sealed = encrypt(session);
  const chunks = sealed.match(new RegExp("[\\s\\S]{1," + SESSION_CHUNK_SIZE + "}", "g")) ?? [];
  if (chunks.length > MAX_SESSION_CHUNKS) throw new Error("Encrypted session exceeds the supported cookie size.");
  const remaining = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));
  const options = cookieOptions(Math.min(COOKIE_MAX_AGE, session.refreshToken ? COOKIE_MAX_AGE : remaining));
  set(IF_SESSION_COOKIE, "", { ...cookieOptions(0), expires: new Date(0) });
  set(SESSION_CHUNKS_COOKIE, "", { ...cookieOptions(0), expires: new Date(0) });
  for (let index = 0; index < MAX_SESSION_CHUNKS; index++) {
    set(SESSION_CHUNK_PREFIX + index, "", { ...cookieOptions(0), expires: new Date(0) });
  }
  chunks.forEach((chunk, index) => set(SESSION_CHUNK_PREFIX + index, chunk, options));
  set(SESSION_CHUNKS_COOKIE, String(chunks.length), options);
}

export async function clearIFSession() {
  clearSessionCookies(await cookies());
}

export async function getIFSession(): Promise<IFSession | null> {
  const store = await cookies();
  const chunkCount = Number(store.get(SESSION_CHUNKS_COOKIE)?.value ?? 0);
  const raw = Number.isInteger(chunkCount) && chunkCount > 0 && chunkCount <= MAX_SESSION_CHUNKS
    ? Array.from({ length: chunkCount }, (_, index) => store.get(SESSION_CHUNK_PREFIX + index)?.value ?? "").join("")
    : store.get(IF_SESSION_COOKIE)?.value;
  if (!raw) return null;
  const session = decrypt(raw);
  if (!session) {
    clearSessionCookies(store);
    return null;
  }
  if (session.expiresAt > Date.now() + 90_000) return session;
  if (!session.refreshToken) {
    clearSessionCookies(store);
    return null;
  }

  const clientId = process.env.IF_OAUTH_CLIENT_ID;
  const clientSecret = process.env.IF_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: session.refreshToken
  });
  const response = await fetch(AUTH_BASE + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    clearSessionCookies(store);
    return null;
  }

  let identity: IFIdentity;
  try {
    identity = getIFIdentityFromToken(payload.access_token, clientId);
  } catch {
    clearSessionCookies(store);
    return null;
  }

  const refreshed: IFSession = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in ?? 1800)) * 1000,
    identity
  };
  await saveIFSession(refreshed);
  return refreshed;
}

export async function getIFDeviceId() {
  const store = await cookies();
  const existing = store.get("vb_if_device")?.value;
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = randomUUID();
  store.set("vb_if_device", id, cookieOptions(60 * 60 * 24 * 365));
  return id;
}
