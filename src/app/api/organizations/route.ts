import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { name?: string; slug?: string; timezone?: string; description?: string } | null;
  const name = body?.name?.trim();
  const slug = body?.slug?.trim().toLowerCase();
  if (!name || !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return NextResponse.json({ error: "A name and valid URL slug are required." }, { status: 400 });
  }
  const { data, error } = await supabase.from("organizations").insert({
    name, slug, timezone: body?.timezone?.trim() || "UTC",
    description: body?.description?.trim() || null, created_by: user.id
  }).select("id,name,slug,timezone").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ organization: data }, { status: 201 });
}
