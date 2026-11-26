import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { dispatchBriefings } from "@/lib/db/schema";
import { requireIFSession,ifFetch } from "@/lib/infinite-flight/server";
import type { SimBriefData } from "@/lib/simbrief/server";
import { getScheduleWriterSession } from "@/lib/infinite-flight/operator";
export const runtime="nodejs";
export async function POST(_request:Request,{params}:{params:Promise<{scheduleId:string}>}){
 try{
  const {session,identity}=await requireIFSession(),{scheduleId}=await params;
  const [row]=await getDb().select().from(dispatchBriefings).where(eq(dispatchBriefings.scheduleId,scheduleId)).limit(1);
  if(!row||row.pilotIfcUserId!==identity.id)return NextResponse.json({error:"Briefing not found for this pilot."},{status:404});
  const data=row.data as unknown as SimBriefData;
  const points=(data.navlog||[]).filter(p=>p.name&&Number.isFinite(p.location?.latitude)&&Number.isFinite(p.location?.longitude)&&!(p.location.latitude===0&&p.location.longitude===0)).slice(0,500);
  if(points.length<2)return NextResponse.json({error:"The saved OFP does not contain enough geocoded route points to update the schedule."},{status:422});
  const writer=await getScheduleWriterSession(session);
  if(!writer)throw new Error("Connect a Virtual Blue organisation owner/admin account with live:schedules.write in Admin → Operator Account to enable schedule synchronisation.");
  await ifFetch("/live/schedules/"+scheduleId+"/flightplan",writer,{method:"PUT",body:JSON.stringify({flightPlan:{flightPlanItems:points.map(p=>({name:p.name,identifier:p.identifier||p.name,location:p.location,altitude:p.altitude??-1}))}})});
  await getDb().update(dispatchBriefings).set({syncStatus:"synced",syncError:"",updatedAt:new Date()}).where(eq(dispatchBriefings.scheduleId,scheduleId));
  return NextResponse.json({success:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Infinite Flight could not update this schedule."},{status:Number((error as {status?:number})?.status)||500})}
}