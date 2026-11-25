import { NextResponse } from "next/server";
import { requireIFSession } from "@/lib/infinite-flight/server";

export async function GET() {
  try {
    const { identity } = await requireIFSession();
    return NextResponse.json({
      authenticated: true,
      profile: {
        userId: identity.id,
        username: identity.username,
        displayName: identity.displayName
      }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error && error.status === 401 ? 401 : 503;
    return NextResponse.json({ authenticated: false, verificationUnavailable: status === 503 }, {
      status,
      headers: { "Cache-Control": "no-store", ...(status === 503 ? { "Retry-After": "15" } : {}) }
    });
  }
}
