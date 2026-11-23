import { timingSafeEqual } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { runNotifier } from "@/lib/automation/worker";
export const runtime="nodejs";
function authorized(request:NextRequest){const secrets=[process.env.CRON_SECRET,process.env.NEON_CRON_SECRET].filter((value):value is string=>Boolean(value));const value=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");return Boolean(value&&secrets.some(secret=>secret.length===value.length&&timingSafeEqual(Buffer.from(secret),Buffer.from(value))))}
export async function GET(request:NextRequest){if(!authorized(request))return NextResponse.json({error:"Unauthorized"},{status:401});try{return NextResponse.json(await runNotifier())}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Notifier failed."},{status:500})}}
