import { timingSafeEqual } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { runAutoCrew } from "@/lib/automation/worker";
export const runtime="nodejs";
function authorized(request:NextRequest){const secret=process.env.CRON_SECRET||"",value=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");return Boolean(secret&&value&&secret.length===value.length&&timingSafeEqual(Buffer.from(secret),Buffer.from(value)))}
export async function GET(request:NextRequest){if(!authorized(request))return NextResponse.json({error:"Unauthorized"},{status:401});try{return NextResponse.json(await runAutoCrew())}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Auto-Crew failed."},{status:500})}}
