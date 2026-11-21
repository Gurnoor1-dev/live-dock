import { NextResponse } from "next/server";
import { clearIFSession } from "@/lib/infinite-flight/session";

export async function POST() {
  await clearIFSession();
  return NextResponse.json({ ok: true });
}
