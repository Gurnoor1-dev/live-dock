import { timingSafeEqual } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { refreshStickyCrewPanel } from "@/lib/automation/worker";

export const runtime="nodejs";
export const maxDuration=60;

function authorized(request:NextRequest){
 const secrets=[process.env.CRON_SECRET,process.env.NEON_CRON_SECRET].filter((value):value is string=>Boolean(value));
 const value=(request.headers.get("authorization")||"").replace(/^Bearer\\s+/i,"");
 return Boolean(value&&secrets.some(secret=>secret.length===value.length&&timingSafeEqual(Buffer.from(secret),Buffer.from(value))));
}

export async function GET(request:NextRequest){
 if(!authorized(request))return NextResponse.json({error:"Unauthorized"},{status:401});
 try{return NextResponse.json(await refreshStickyCrewPanel(),{headers:{"Cache-Control":"no-store"}})}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Sticky Crew refresh failed."},{status:Number((error as {status?:number})?.status)||500,headers:{"Cache-Control":"no-store"}})}
}
