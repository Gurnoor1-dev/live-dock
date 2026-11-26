import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { adminOperatorCredentials } from "@/lib/db/schema";
import { getIFIdentityFromToken, type IFSession } from "@/lib/infinite-flight/session";
import { requireOrganizationAdmin } from "@/lib/infinite-flight/server";
import { openSecret, sealSecret } from "@/lib/security/secret-box";

const TOKEN_URL = "https://api.infiniteflight.com/auth/v2/connect/token";

/** Load the organisation's explicitly attached operator session from Neon.
 * The caller must already have authenticated and passed the organisation-admin
 * check with their own Infinite Flight session.
 */
export async function getStoredOperatorSession(ifcUserId: string): Promise<IFSession | null> {
  const [row] = await getDb().select().from(adminOperatorCredentials)
    .where(eq(adminOperatorCredentials.ifcUserId, ifcUserId)).limit(1);
  if (!row) return null;

  let session: IFSession;
  try {
    session = JSON.parse(openSecret(row.encryptedSession)) as IFSession;
  } catch {
    throw new Error("The saved administrator connection could not be decrypted. Reconnect the administrator account.");
  }
  if (!session?.accessToken || typeof session.expiresAt !== "number") {
    throw new Error("The saved administrator connection is invalid. Reconnect the administrator account.");
  }

  if (session.expiresAt <= Date.now() + 90_000) {
    if (!session.refreshToken) throw new Error("The saved administrator session has expired. Reconnect the administrator account.");
    const clientId = process.env.IF_OAUTH_CLIENT_ID;
    const clientSecret = process.env.IF_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Infinite Flight OAuth is not configured.");
    const form = new URLSearchParams({
      grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret,
      refresh_token: session.refreshToken
    });
    let response: Response;
    try {
      response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new Error("Administrator session refresh is temporarily unavailable. The saved connection has been retained; retry shortly.");
    }
    const token = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!response.ok || !token.access_token) {
      if (response.status === 400 || response.status === 401) throw new Error("The saved administrator refresh token is no longer valid. Reconnect the administrator account.");
      throw new Error("Administrator session refresh failed (HTTP " + response.status + "). Retry shortly.");
    }
    const identity = getIFIdentityFromToken(token.access_token, clientId);
    if (identity.id !== ifcUserId) throw new Error("The refreshed administrator session belongs to a different Infinite Flight account.");
    session = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || session.refreshToken,
      expiresAt: Date.now() + Math.max(60, Number(token.expires_in || 1800)) * 1000,
      identity
    };
  }

  await requireOrganizationAdmin(session);
  await getDb().update(adminOperatorCredentials)
    .set({ encryptedSession: sealSecret(JSON.stringify(session)), updatedAt: new Date() })
    .where(eq(adminOperatorCredentials.ifcUserId, ifcUserId));
  return session;
}
