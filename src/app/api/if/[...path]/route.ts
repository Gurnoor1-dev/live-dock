import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getIFDeviceId, getIFSession } from "@/lib/infinite-flight/session";

export const runtime = "nodejs";
const API_BASE = "https://api.infiniteflight.com/public/v3";
type RouteContext = { params: Promise<{ path: string[] }> };
type CacheEntry = { body: string; status: number; headers: Record<string, string>; storedAt: number; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const rateLimitUntil = new Map<string, number>();
const UUID = "[0-9a-fA-F-]{36}";
const SEG = "[A-Za-z0-9._-]+";

function allowed(method: string, path: string) {
  const rules: Array<[string, RegExp]> = [
    ["GET", /^\/sessions$/], ["GET", new RegExp(`^/sessions/${SEG}$`)],
    ["GET", new RegExp(`^/sessions/${SEG}/flights$`)],
    ["GET", new RegExp(`^/sessions/${SEG}/flights/${SEG}$`)],
    ["GET", new RegExp(`^/sessions/${SEG}/flights/${SEG}/(route|flightplan)$`)],
    ["GET", new RegExp(`^/sessions/${SEG}/atc$`)],
    ["POST", /^\/sessions\/[A-Za-z0-9._-]+\/flights\/flightplans$/],
    ["POST", /^\/users$/], ["GET", new RegExp(`^/users/${SEG}$`)],
    ["GET", new RegExp(`^/users/${SEG}/flights$`)],
    ["GET", new RegExp(`^/users/${SEG}/flights/${SEG}$`)],
    ["GET", new RegExp(`^/users/${SEG}/atc$`)],
    ["GET", new RegExp(`^/users/${SEG}/atc/${SEG}$`)],
    ["GET", new RegExp(`^/sessions/${SEG}/airport/${SEG}/(atis|status)$`)],
    ["GET", new RegExp(`^/sessions/${SEG}/world$`)],
    ["GET", /^\/tracks$/], ["GET", new RegExp(`^/sessions/${SEG}/notams$`)],
    ["GET", /^\/aircraft$/], ["GET", new RegExp(`^/aircraft/${SEG}/liveries$`)],
    ["GET", /^\/aircraft\/liveries$/], ["GET", new RegExp(`^/airport/${SEG}$`)], ["GET", /^\/airports$/],
    ["GET", /^\/live\/organizations$/],
    ["GET", new RegExp(`^/live/organizations/${UUID}$`)],
    ["GET", new RegExp(`^/live/organizations/${UUID}/(members|aircraft|schedules)$`)],
    ["GET", new RegExp(`^/live/aircraft/${UUID}$`)],
    ["GET", new RegExp(`^/live/aircraft/${UUID}/(position|flights|schedules)$`)],
    ["POST", new RegExp(`^/live/aircraft/${UUID}/schedules$`)],
    ["PUT", new RegExp(`^/live/schedules/${UUID}$`)],
    ["PUT", new RegExp(`^/live/schedules/${UUID}/flightplan$`)],
    ["PUT", new RegExp(`^/live/schedules/${UUID}/crew/${UUID}$`)],
    ["DELETE", new RegExp(`^/live/schedules/${UUID}/crew/${UUID}$`)],
    ["PUT", new RegExp(`^/live/aircraft/${UUID}/schedules/reorder$`)],
    ["DELETE", new RegExp(`^/live/schedules/${UUID}$`)]
  ];
  return rules.some(([verb, expression]) => verb === method && expression.test(path));
}

function ttlFor(method: string, path: string) {
  if (method === "GET" && (path === "/sessions" || (path.startsWith("/sessions/") && path.split("/").length === 3))) return 10 * 60_000;
  if (path.startsWith("/sessions/") && (path.endsWith("/flights") || path.includes("/flights/") || path.endsWith("/atc") || path.endsWith("/status") || path.endsWith("/atis"))) return 15_000;
  if (path.startsWith("/users/") || path === "/users") return 5 * 60_000;
  if (path === "/aircraft" || path === "/airports" || path === "/aircraft/liveries" || path.startsWith("/aircraft/") || path.startsWith("/airport/")) return 60 * 60_000;
  if (path.startsWith("/live/aircraft/") && path.endsWith("/position")) return 15_000;
  if (path.startsWith("/live/aircraft/") && path.endsWith("/flights")) return 5 * 60_000;
  if (path.startsWith("/live/")) return 60_000;
  return 0;
}

function response(body: string, status: number, headers: Record<string, string> = {}) {
  const output = new Headers(headers);
  output.set("Cache-Control", "no-store");
  output.set("Content-Type", output.get("Content-Type") || "application/json; charset=utf-8");
  return new NextResponse(body || null, { status, headers: output });
}

async function proxy(request: NextRequest, context: RouteContext) {
  const now = Date.now();
  for (const [key, entry] of cache) if (now >= entry.expiresAt) cache.delete(key);
  for (const [key, until] of rateLimitUntil) if (now >= until) rateLimitUntil.delete(key);
  const session = await getIFSession();
  if (!session) return NextResponse.json({ error: "Sign in with Infinite Flight to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const { path: parts } = await context.params;
  if (!parts?.length || parts.some(part => part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part))) return NextResponse.json({ error: "Invalid API path." }, { status: 400 });
  const path = "/" + parts.join("/");
  if (!allowed(request.method, path)) return NextResponse.json({ error: "This Infinite Flight API operation is not enabled in this app." }, { status: 405 });

  // A leading slash in URL() would discard the /public/v3 base path.
  const target = new URL(`${API_BASE}${path}`);
  target.search = request.nextUrl.search;
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.text();
  const tokenKey = createHash("sha256").update(session.accessToken).digest("hex");
  const deviceId = await getIFDeviceId();
  const bodyKey = body ? createHash("sha256").update(body).digest("hex") : "";
  const cacheKey = `${tokenKey}:${deviceId}:${request.method}:${target.toString()}:${bodyKey}`;
  const ttl = ttlFor(request.method, path);
  const canCache = ttl > 0 && (request.method === "GET" || (request.method === "POST" && (path === "/users" || path.endsWith("/flights/flightplans"))));

  if (canCache) {
    const cached = cache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      return response(cached.body, cached.status, cached.headers);
    }
    if (cached) cache.delete(cacheKey);
  }

  const blockedUntil = rateLimitUntil.get(tokenKey);
  if (blockedUntil && now < blockedUntil) {
    const waitSeconds = Math.max(1, Math.ceil((blockedUntil - now) / 1000));
    return NextResponse.json({ error: "Infinite Flight rate limit reached. Wait before retrying." }, { status: 429, headers: { "Retry-After": String(waitSeconds), "Cache-Control": "no-store" } });
  }

  const upstream = await fetch(target, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(body ? { "Content-Type": request.headers.get("content-type") || "application/json" } : {})
    },
    body,
    cache: "no-store"
  });
  const text = await upstream.text();
  if (upstream.status === 429) {
    const retryAfter = upstream.headers.get("retry-after");
    const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
    const retryAt = retryAfter && Number.isFinite(seconds) ? now + Math.max(1, seconds) * 1000 : retryAfter ? Date.parse(retryAfter) : Number.NaN;
    rateLimitUntil.set(tokenKey, Number.isFinite(retryAt) && retryAt > now ? retryAt : now + 60_000);
  }
  const headers: Record<string, string> = {};
  for (const name of ["content-type", "retry-after", "x-rate-limit-remaining", "x-rate-limit-reset", "x-user-pro"]) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }

  if (canCache && upstream.ok) {
    cache.set(cacheKey, { body: text, status: upstream.status, headers, storedAt: now, expiresAt: now + ttl });
    if (cache.size > 500) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  }

  if (["POST", "PUT", "DELETE"].includes(request.method) && path.startsWith("/live/")) {
    for (const key of cache.keys()) if (key.startsWith(tokenKey + ":")) cache.delete(key);
  }
  return response(text, upstream.status, headers);
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
