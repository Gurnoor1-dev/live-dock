import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { IF_STATE_COOKIE, IF_VERIFIER_COOKIE } from "@/lib/infinite-flight/session";

const AUTHORIZE_URL = "https://api.infiniteflight.com/auth/v2/connect/authorize";
const SCOPES = [
  "openid", "profile", "offline_access",
  "live:organizations.read", "live:members.read", "live:aircraft.read",
  "live:schedules.read", "live:schedules.write"
].join(" ");

export async function GET(request: Request) {
  const clientId = process.env.IF_OAUTH_CLIENT_ID;
  const redirectUri = process.env.IF_OAUTH_REDIRECT_URI || new URL("/api/auth/if/callback", request.url).toString();
  if (!clientId || !process.env.IF_OAUTH_CLIENT_SECRET || !process.env.IF_SESSION_SECRET) {
    return NextResponse.redirect(new URL("/login?error=configuration", request.url));
  }

  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL(AUTHORIZE_URL);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  }).toString();

  const response = NextResponse.redirect(authorize);
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(IF_STATE_COOKIE, state, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600 });
  response.cookies.set(IF_VERIFIER_COOKIE, verifier, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600 });
  return response;
}
