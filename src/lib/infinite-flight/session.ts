import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

export const IF_SESSION_COOKIE = "vb_if_session";
const SESSION_CHUNK_PREFIX = `${IF_SESSION_COOKIE}_`;
const SESSION_CHUNKS_COOKIE = `${IF_SESSION_COOKIE}_chunks`;
const SESSION_CHUNK_SIZE = 3000;
const MAX_SESSION_CHUNKS = 16;
export const IF_STATE_COOKIE = "vb_if_oauth_state";
export const IF_VERIFIER_COOKIE = "vb_if_pkce_verifier";
const AUTH_BASE = "https://api.infiniteflight.com/auth/v2/connect";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type IFSession = { accessToken: string; refreshToken?: string; expiresAt: number };
type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

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

type SessionCookieOptions = ReturnType<typeof cookieOptions> & { expires?: Date };\n\nfunction clearSessionCookies(store: Awaited<ReturnType<typeof cookies>>) {
  const expired = { ...cookieOptions(0), expires: new Date(0) };
  store.set(IF_SESSION_COOKIE, "", expired);
  store.set(SESSION_CHUNKS_COOKIE, "", expired);
  for (let index = 0; index < MAX_SESSION_CHUNKS; index++) store.set(`${SESSION_CHUNK_PREFIX}${index}`, "", expired);
}

export async function saveIFSession(session: IFSession, response?: NextResponse) {
  const store = response ? null : await cookies();
  const set = (name: string, value: string, options: SessionCookieOptions) => {
    if (response) response.cookies.set(name, value, options);
    else store!.set(name, value, options);
  };
  const sealed = encrypt(session);
  const chunks = sealed.match(new RegExp(`[\\s\\S]{1,${SESSION_CHUNK_SIZE}}`, "g")) ?? [];
  if (chunks.length > MAX_SESSION_CHUNKS) throw new Error("Encrypted session exceeds the supported cookie size.");
  const remaining = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));
  const options = cookieOptions(Math.min(COOKIE_MAX_AGE, session.refreshToken ? COOKIE_MAX_AGE : remaining));
  set(IF_SESSION_COOKIE, "", { ...cookieOptions(0), expires: new Date(0) });
  set(SESSION_CHUNKS_COOKIE, "", { ...cookieOptions(0), expires: new Date(0) });
  for (let index = 0; index < MAX_SESSION_CHUNKS; index++) {
    set(`${SESSION_CHUNK_PREFIX}${index}`, "", { ...cookieOptions(0), expires: new Date(0) });
  }
  chunks.forEach((chunk, index) => set(`${SESSION_CHUNK_PREFIX}${index}`, chunk, options));
  set(SESSION_CHUNKS_COOKIE, String(chunks.length), options);
}

export async function clearIFSession() {
  clearSessionCookies(await cookies());
}

export async function getIFSession(): Promise<IFSession | null> {
  const store = await cookies();
  const chunkCount = Number(store.get(SESSION_CHUNKS_COOKIE)?.value ?? 0);
  const raw = Number.isInteger(chunkCount) && chunkCount > 0 && chunkCount <= MAX_SESSION_CHUNKS
    ? Array.from({ length: chunkCount }, (_, index) => store.get(`${SESSION_CHUNK_PREFIX}${index}`)?.value ?? "").join("")
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
  const form = new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: session.refreshToken });
  const response = await fetch(`${AUTH_BASE}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    clearSessionCookies(store);
    return null;
  }
  const refreshed: IFSession = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in ?? 1800)) * 1000
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
