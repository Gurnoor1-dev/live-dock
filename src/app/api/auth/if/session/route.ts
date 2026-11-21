import { NextResponse } from "next/server";
import { getIFSession } from "@/lib/infinite-flight/session";

export async function GET() {
  try {
    const session = await getIFSession();
    return NextResponse.json({ authenticated: Boolean(session) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
