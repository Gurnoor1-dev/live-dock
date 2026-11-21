import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { legId?: string; seat?: string; message?: string } | null;
  if (!body?.legId || !["captain", "first_officer"].includes(body.seat ?? "first_officer")) {
    return NextResponse.json({ error: "A valid leg and seat are required." }, { status: 400 });
  }
  const { data, error } = await supabase.from("crew_requests").insert({
    leg_id: body.legId, user_id: user.id, requested_seat: body.seat ?? "first_officer",
    message: body.message?.trim() || null
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ request: data }, { status: 201 });
}
