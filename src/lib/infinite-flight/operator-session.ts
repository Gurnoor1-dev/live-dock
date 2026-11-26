import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { adminOperatorCredentials } from "@/lib/db/schema";
import { getIFIdentityFromToken, type IFSession } from "@/lib/infinite-flight/session";
import { requireOrganizationAdmin } from "@/lib/infinite-flight/server";
import { openSecret, sealSecret } from "@/lib/security/secret-box";

const TOKEN_URL = "https://api.infiniteflight.com/auth/v2/connect/token";
const REFRESH_LEASE_MS = 20_000;
const REFRESH_WAIT_MS = 25_000;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function decodeSession(encryptedSession: string): IFSession {
  let session: IFSession;
  try {
    session = JSON.parse(openSecret(encryptedSession)) as IFSession;
  } catch {
    throw new Error("The saved administrator connection could not be decrypted. Reconnect the administrator account.");
  }
  if (!session?.accessToken || typeof session.expiresAt !== "number") {
    throw new Error("The saved administrator connection is invalid. Reconnect the administrator account.");
  }
  return session;
}

async function refreshSession(ifcUserId: string): Promise<IFSession | null> {
  const db = getDb();
  const startedAt = Date.now();

  // updated_at doubles as a short distributed refresh lease. The conditional
  // UPDATE is atomic in Postgres, so parallel Vercel instances cannot all
  // consume the same rotating OAuth refresh token.
  while (Date.now() - startedAt < REFRESH_WAIT_MS) {
    const leaseBefore = new Date(Date.now() - REFRESH_LEASE_MS);
    const [lease] = await db.update(adminOperatorCredentials)
      .set({ updatedAt: new Date() })
      .where(and(
        eq(adminOperatorCredentials.ifcUserId, ifcUserId),
        lt(adminOperatorCredentials.updatedAt, leaseBefore)
      ))
      .returning({ ifcUserId: adminOperatorCredentials.ifcUserId });

    if (lease) {
      const [latest] = await db.select().from(adminOperatorCredentials)
        .where(eq(adminOperatorCredentials.ifcUserId, ifcUserId)).limit(1);
      if (!latest) return null;

      const session = decodeSession(latest.encryptedSession);
      if (session.expiresAt > Date.now() + 90_000) return session;
      if (!session.refreshToken) {
        await db.delete(adminOperatorCredentials).where(eq(adminOperatorCredentials.ifcUserId, ifcUserId));
        return null;
      }

      const clientId = process.env.IF_OAUTH_CLIENT_ID;
      const clientSecret = process.env.IF_OAUTH_CLIENT_SECRET;
      if (!clientId || !clientSecret) throw new Error("Infinite Flight OAuth is not configured.");

      const form = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: session.refreshToken
      });

      let response: Response;
      try {
        response = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
          cache: "no-store",
          signal: AbortSignal.timeout(15_000)
        });
      } catch {
        throw new Error("Administrator session refresh is temporarily unavailable. The saved connection has been retained; retry shortly.");
      }

      const token = await response.json().catch(() => ({})) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };

      if (!response.ok || !token.access_token) {
        if (response.status === 400 || response.status === 401) {
          // The rotating refresh token is no longer usable. Remove only this
          // stale operator record so the signed-in admin can reconnect it.
          await db.delete(adminOperatorCredentials).where(eq(adminOperatorCredentials.ifcUserId, ifcUserId));
          return null;
        }
        throw new Error("Administrator session refresh failed (HTTP " + response.status + "). Retry shortly.");
      }

      const identity = getIFIdentityFromToken(token.access_token, clientId);
      if (identity.id !== ifcUserId) {
        await db.delete(adminOperatorCredentials).where(eq(adminOperatorCredentials.ifcUserId, ifcUserId));
        throw new Error("The refreshed administrator session belongs to a different Infinite Flight account.");
      }

      const refreshed: IFSession = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token || session.refreshToken,
        expiresAt: Date.now() + Math.max(60, Number(token.expires_in || 1800)) * 1000,
        identity
      };

      await db.update(adminOperatorCredentials)
        .set({ encryptedSession: sealSecret(JSON.stringify(refreshed)), updatedAt: new Date() })
        .where(eq(adminOperatorCredentials.ifcUserId, ifcUserId));
      return refreshed;
    }

    // Another server instance owns the lease. Wait briefly, then reload the
    // row; it will contain the rotated token or will have been removed.
    await delay(500);
    const [latest] = await db.select().from(adminOperatorCredentials)
      .where(eq(adminOperatorCredentials.ifcUserId, ifcUserId)).limit(1);
    if (!latest) return null;
    const latestSession = decodeSession(latest.encryptedSession);
    if (latestSession.expiresAt > Date.now() + 90_000) return latestSession;
  }

  throw new Error("The administrator session is being refreshed. Please retry in a few seconds.");
}

/** Load the organisation's explicitly attached operator session from Neon.
 * The caller must already be authenticated. Organisation-admin permissions
 * are checked against the session that will actually be used.
 */
export async function getStoredOperatorSession(ifcUserId: string): Promise<IFSession | null> {
  const [row] = await getDb().select().from(adminOperatorCredentials)
    .where(eq(adminOperatorCredentials.ifcUserId, ifcUserId)).limit(1);
  if (!row) return null;

  let session: IFSession | null = decodeSession(row.encryptedSession);
  if (session.expiresAt <= Date.now() + 90_000) {
    session = await refreshSession(ifcUserId);
    if (!session) return null;
  }

  await requireOrganizationAdmin(session);
  return session;
}
