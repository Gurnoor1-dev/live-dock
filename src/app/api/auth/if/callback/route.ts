import { NextRequest, NextResponse } from "next/server";
import { IF_STATE_COOKIE, IF_VERIFIER_COOKIE, getIFIdentityFromToken, saveIFSession } from "@/lib/infinite-flight/session";

const TOKEN_URL = "https://api.infiniteflight.com/auth/v2/connect/token";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

function loginError(origin: string, code: string) {
  return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent(code), origin));
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error");
  if (oauthError) return loginError(url.origin, "denied");

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const expectedState = request.cookies.get(IF_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(IF_VERIFIER_COOKIE)?.value;
  if (!code || !returnedState || !expectedState || returnedState !== expectedState || !verifier) {
    return loginError(url.origin, "state");
  }

  const clientId = process.env.IF_OAUTH_CLIENT_ID;
  const clientSecret = process.env.IF_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.IF_OAUTH_REDIRECT_URI || new URL("/api/auth/if/callback", url.origin).toString();
  if (!clientId || !clientSecret || !process.env.IF_SESSION_SECRET) {
    return loginError(url.origin, "configuration");
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    return loginError(url.origin, "token-network");
  }

  const token = await tokenResponse.json().catch(() => ({})) as TokenResponse;
  if (!tokenResponse.ok || !token.access_token) {
    return loginError(url.origin, "token");
  }

  let identity;
  try {
    identity = getIFIdentityFromToken(token.access_token, clientId);
  } catch {
    return loginError(url.origin, "identity");
  }

  const expiresIn = Number(token.expires_in ?? 1800);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    return loginError(url.origin, "token");
  }

  const response = NextResponse.redirect(new URL("/", url.origin));
  await saveIFSession({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    identity
  }, response);

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0
  };
  response.cookies.set(IF_STATE_COOKIE, "", cookieOptions);
  response.cookies.set(IF_VERIFIER_COOKIE, "", cookieOptions);
  return response;
}
