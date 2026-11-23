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
  } catch {
    return NextResponse.json({ authenticated: false }, {
      headers: { "Cache-Control": "no-store" }
    });
  }
}
