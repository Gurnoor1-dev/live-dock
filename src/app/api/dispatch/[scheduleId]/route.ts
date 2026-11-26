import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { dispatchBriefings } from "@/lib/db/schema";
import { requireIFSession } from "@/lib/infinite-flight/server";
export const runtime="nodejs";
export async function GET(_request:Request,{params}:{params:Promise<{scheduleId:string}>}){
 try{
  const {identity}=await requireIFSession(),{scheduleId}=await params;
  const [row]=await getDb().select().from(dispatchBriefings).where(eq(dispatchBriefings.scheduleId,scheduleId)).limit(1);
  if(!row)return NextResponse.json({briefing:null});
  if(row.pilotIfcUserId!==identity.id)return NextResponse.json({error:"This briefing belongs to another pilot."},{status:403});
  return NextResponse.json({briefing:row.data,ofpId:row.ofpId,syncStatus:row.syncStatus,syncError:row.syncError,createdAt:row.createdAt},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to load dispatch briefing."},{status:Number((error as {status?:number})?.status)||500})}
}