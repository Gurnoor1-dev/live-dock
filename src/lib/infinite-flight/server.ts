import "server-only";
import {
  getIFIdentityFromToken,
  type IFIdentity,
  getIFSession,
  type IFSession
} from "@/lib/infinite-flight/session";

export const ORGANIZATION_ID = "d50dcc80-8dac-4608-970c-61d6a4739488";

const rateLimits = new Map<string, { isPro: boolean; remaining: number; updatedAt: number }>();
const ifGetCache = new Map<string, { value: unknown; expiresAt: number }>();
const ifGetInflight = new Map<string, Promise<unknown>>();
const ifRateLimitCooldown = new Map<string, number>();
type IFRequestWindow = { startedAt: number; count: number; isPro: boolean };
const ifRequestWindows = new Map<string, IFRequestWindow>();

export function takeIFRequestSlot(session: IFSession) {
  const now = Date.now();
  const key = session.accessToken;
  const cooldownUntil = ifRateLimitCooldown.get(key) || 0;
  if (cooldownUntil > now) return { allowed: false, retryAfterMs: cooldownUntil - now };
  let window = ifRequestWindows.get(key);
  if (!window || now - window.startedAt >= 60_000) {
    window = { startedAt: now, count: 0, isPro: rateLimits.get(key)?.isPro ?? false };
    ifRequestWindows.set(key, window);
  }
  const limit = window.isPro ? 20 : 5;
  if (window.count >= limit) return { allowed: false, retryAfterMs: Math.max(1_000, 60_000 - (now - window.startedAt)) };
  window.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

export function recordIFRateLimitResponse(session: IFSession, response: Response) {
  const key = session.accessToken;
  const now = Date.now();
  const window = ifRequestWindows.get(key);
  const proHeader = response.headers.get("x-user-pro");
  const isPro = proHeader === null ? (window?.isPro ?? false) : proHeader.toLowerCase() === "true";
  if (window) window.isPro = isPro;
  const remainingHeader = response.headers.get("x-rate-limit-remaining");
  const remaining = remainingHeader === null ? (isPro ? 19 : 4) : Number(remainingHeader);
  rateLimits.set(key, { isPro, remaining: Number.isFinite(remaining) ? remaining : (isPro ? 19 : 4), updatedAt: now });
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    const retryAt = Number.isFinite(seconds) && seconds > 0 ? now + seconds * 1000 : now + 60_000;
    ifRateLimitCooldown.set(key, retryAt);
  }
}
const IF_ERROR_NAMES: Record<number, string> = { 1: "User not found", 2: "Missing request parameters", 3: "Endpoint error", 4: "Not authorized", 5: "Server not found", 6: "Flight not found", 7: "No ATIS available", 8: "Airport not found", 9: "Request exceeds maximum request size", 10: "Schedule already has three crew members", 11: "Crew member is not assigned" };

function ifCacheTtl(path: string) {
  if (path === "/aircraft" || path === "/aircraft/liveries" || /^\/aircraft\/[^/]+\/liveries$/.test(path)) return 60 * 60_000;
  if (path.endsWith("/position")) return 120_000;
  if (path.includes("/members")) return 5 * 60_000;
  if (path.endsWith("/flights")) return 5 * 60_000;
  if (path.includes("/schedules")) return 120_000;
  if (/^\/live\/organizations\/[^/]+$/.test(path)) return 120_000;
  if (path.includes("/aircraft")) return 120_000;
  if (path.startsWith("/airport/") || path === "/airports") return 60 * 60_000;
  return 0;
}

export function getIFRateLimit(session: IFSession) {
  const value = rateLimits.get(session.accessToken);
  if (!value) return { isPro: false, remaining: 4 };
  if (Date.now() - value.updatedAt > 60_000) {
    return { isPro: value.isPro, remaining: value.isPro ? 19 : 4 };
  }
  return value;
}

export async function getIFIdentity(session: IFSession): Promise<IFIdentity> {
  if (session.identity) return session.identity;
  return getIFIdentityFromToken(session.accessToken, process.env.IF_OAUTH_CLIENT_ID);
}

export async function requireIFSession() {
  const session = await getIFSession();
  if (!session) {
    throw Object.assign(new Error("Sign in with Infinite Flight to continue."), { status: 401 });
  }
  const identity = await getIFIdentity(session);
  return { session, identity };
}

export async function ifFetch<T = unknown>(path: string, session: IFSession, init: RequestInit = {}, options: { bypassCache?: boolean } = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const cacheKey = method === "GET" ? session.accessToken + ":" + path : "";
  const ttl = method === "GET" && !options.bypassCache ? ifCacheTtl(path) : 0;

  if (ttl > 0) {
    const cached = ifGetCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;
    if (cached) ifGetCache.delete(cacheKey);
    const pending = ifGetInflight.get(cacheKey);
    if (pending) return pending as Promise<T>;
  }

  const request = (async () => {
    const cooldownUntil = ifRateLimitCooldown.get(session.accessToken) || 0;
    if (cooldownUntil > Date.now()) {
      throw Object.assign(new Error("Infinite Flight rate limit reached (HTTP 429). Requests are paused until the quota window resets."), { status: 429, retryAfterMs: cooldownUntil - Date.now() });
    }
    const slot = takeIFRequestSlot(session);
    if (!slot.allowed) {
      throw Object.assign(new Error("Infinite Flight request limit reached. LiveDock is pacing requests until the quota window resets."), { status: 429, retryAfterMs: slot.retryAfterMs });
    }
    const response = await fetch("https://api.infiniteflight.com/public/v3" + path, {
      ...init,
      headers: {
        Authorization: "Bearer " + session.accessToken,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {})
      },
      cache: "no-store"
    });
    recordIFRateLimitResponse(session, response);
    const payload = await response.json().catch(() => ({})) as { errorCode?: number; message?: string; error?: string; details?: unknown; errors?: unknown; result?: T };
    if (!response.ok || (typeof payload.errorCode === "number" && payload.errorCode !== 0)) {
      const diagnostic = payload.message || payload.error || (payload.details ? JSON.stringify(payload.details) : payload.errors ? JSON.stringify(payload.errors) : "");
      const suffix = typeof payload.errorCode === "number" ? " [Infinite Flight error " + payload.errorCode + (IF_ERROR_NAMES[payload.errorCode] ? ": " + IF_ERROR_NAMES[payload.errorCode] : "") + "]." : "";
      const detail = diagnostic ? " Details: " + String(diagnostic).slice(0, 700) : "";
      throw Object.assign(new Error(method + " " + path + ": " + (diagnostic || "Infinite Flight API request failed (" + response.status + ").") + suffix + detail), {
        status: response.status,
        errorCode: payload.errorCode,
        apiDetails: payload.details ?? payload.errors ?? payload.error ?? null
      });
    }
    return payload.result as T;
  })();

  if (ttl > 0) {
    ifGetInflight.set(cacheKey, request);
    try {
      const value = await request;
      if (ifGetCache.size > 600) ifGetCache.clear();
      ifGetCache.set(cacheKey, { value, expiresAt: Date.now() + ttl });
      return value;
    } finally {
      ifGetInflight.delete(cacheKey);
    }
  }

  const value = await request;
  if (method !== "GET") {
    for (const key of ifGetCache.keys()) {
      if (key.startsWith(session.accessToken + ":")) ifGetCache.delete(key);
    }
  }
  return value;
}

export async function requireOrganizationAdmin(session: IFSession) {
  const org = await ifFetch<{ role: number }>("/live/organizations/" + ORGANIZATION_ID, session);
  if (org.role !== 1 && org.role !== 2) {
    throw Object.assign(new Error("Organisation administrator access is required."), { status: 403 });
  }
  return org;
}