import "server-only";
import {
  getIFIdentityFromToken,
  type IFIdentity,
  getIFSession,
  type IFSession
} from "@/lib/infinite-flight/session";

export const ORGANIZATION_ID = "d50dcc80-8dac-4608-970c-61d6a4739488";

const rateLimits = new Map<string, { isPro: boolean; remaining: number; updatedAt: number }>();\nconst ifGetCache = new Map<string, { value: unknown; expiresAt: number }>();\nconst ifGetInflight = new Map<string, Promise<unknown>>();\nfunction ifCacheTtl(path: string) { if (path.endsWith("/position")) return 90_000; if (path.endsWith("/flights")) return 5 * 60_000; if (path.includes("/members") || path.includes("/aircraft") || path.includes("/schedules")) return path.includes("/schedules") ? 20_000 : 90_000; if (path.startsWith("/airport/") || path === "/aircraft") return 60 * 60_000; return 0; }

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

export async function ifFetch<T = unknown>(path: string, session: IFSession, init: RequestInit = {}): Promise<T> {
  const response = await fetch("https://api.infiniteflight.com/public/v3" + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + session.accessToken,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {})
    },
    cache: "no-store"
  });
  const remainingHeader = response.headers.get("x-rate-limit-remaining");
  const remaining = remainingHeader === null ? 4 : Number(remainingHeader);
  rateLimits.set(session.accessToken, {
    isPro: (response.headers.get("x-user-pro") || "").toLowerCase() === "true",
    remaining: Number.isFinite(remaining) ? remaining : 4,
    updatedAt: Date.now()
  });
  const payload = await response.json().catch(() => ({})) as { errorCode?: number; message?: string; result?: T };
  if (!response.ok || (typeof payload.errorCode === "number" && payload.errorCode !== 0)) {
    throw Object.assign(new Error(payload.message || "Infinite Flight API request failed (" + response.status + ")."), {
      status: response.status
    });
  }
  return payload.result as T;
}

export async function requireOrganizationAdmin(session: IFSession) {
  const org = await ifFetch<{ role: number }>("/live/organizations/" + ORGANIZATION_ID, session);
  if (org.role !== 1 && org.role !== 2) {
    throw Object.assign(new Error("Organisation administrator access is required."), { status: 403 });
  }
  return org;
}
