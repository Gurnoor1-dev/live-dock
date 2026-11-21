import { NextRequest, NextResponse } from "next/server";
import { IF_STATE_COOKIE, IF_VERIFIER_COOKIE } from "@/lib/infinite-flight/session";
import { saveIFSession } from "@/lib/infinite-flight/session";

const TOKEN_URL = "https://api.infiniteflight.com/auth/v2/connect/token";

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) return NextResponse.redirect(new URL("/login?error=denied", url.origin));

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const expectedState = request.cookies.get(IF_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(IF_VERIFIER_COOKIE)?.value;
  if (!code || !returnedState || !expectedState || returnedState !== expectedState || !verifier) {
    return NextResponse.redirect(new URL("/login?error=state", url.origin));
  }

  const clientId = process.env.IF_OAUTH_CLIENT_ID;
  const clientSecret = process.env.IF_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.IF_OAUTH_REDIRECT_URI || new URL("/api/auth/if/callback", url.origin).toString();
  if (!clientId || !clientSecret || !process.env.IF_SESSION_SECRET) {
    return NextResponse.redirect(new URL("/login?error=configuration", url.origin));
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  });
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store"
  });
  const token = await tokenResponse.json().catch(() => ({})) as TokenResponse;
  if (!tokenResponse.ok || !token.access_token) {
    return NextResponse.redirect(new URL("/login?error=token", url.origin));
  }

  const response = NextResponse.redirect(new URL("/", url.origin));
  await saveIFSession({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + Math.max(60, Number(token.expires_in ?? 1800)) * 1000
  }, response);
  response.cookies.set(IF_STATE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  response.cookies.set(IF_VERIFIER_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
