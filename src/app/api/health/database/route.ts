import { NextResponse } from "next/server";
import { performance } from "node:perf_hooks";
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

  const startedAt = performance.now();

  try {
    await getDb().execute(sql`select "key" from "app_settings" limit 1`);
    const databaseResponseTimeMs = Number((performance.now() - startedAt).toFixed(2));

    return NextResponse.json(
      {
        ok: true,
        service: "neon-postgres",
        databaseResponseTimeMs,
      },
      {
        headers: {
          "Server-Timing": `db;dur=${databaseResponseTimeMs}`,
        },
      }
    );
  } catch {
    const databaseResponseTimeMs = Number((performance.now() - startedAt).toFixed(2));

    return NextResponse.json(
      {
        ok: false,
        service: "neon-postgres",
        error: "Database connection failed.",
        databaseResponseTimeMs,
      },
      {
        status: 503,
        headers: {
          "Server-Timing": `db;dur=${databaseResponseTimeMs}`,
        },
      }
    );
  }
}
