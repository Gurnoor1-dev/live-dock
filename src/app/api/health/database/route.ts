import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { ok: false, service: "database", error: "DATABASE_URL is not configured." },
      { status: 503 }
    );
  }

  try {
    await getDb().execute(sql`select 1 as connected`);
    return NextResponse.json({ ok: true, service: "neon-postgres" });
  } catch {
    return NextResponse.json(
      { ok: false, service: "neon-postgres", error: "Database connection failed." },
      { status: 503 }
    );
  }
}
