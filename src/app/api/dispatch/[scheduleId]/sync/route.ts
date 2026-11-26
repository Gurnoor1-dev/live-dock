import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { dispatchBriefings } from "@/lib/db/schema";
import { requireIFSession,ifFetch,ORGANIZATION_ID } from "@/lib/infinite-flight/server";
import { buildSimBriefFlightPlan,isSimBriefFlightPlanSynced,parseSimBriefXml } from "@/lib/simbrief/server";
import { getScheduleWriterSession } from "@/lib/infinite-flight/operator";
export const runtime="nodejs";
export async function POST(_request:Request,{params}:{params:Promise<{scheduleId:string}>}){
 try{
  const {session,identity}=await requireIFSession(),{scheduleId}=await params;
  const [row]=await getDb().select({rawXml:dispatchBriefings.rawXml,ofpId:dispatchBriefings.ofpId}).from(dispatchBriefings).where(eq(dispatchBriefings.scheduleId,scheduleId)).limit(1);
  if(!row)return NextResponse.json({error:"Briefing not found."},{status:404});
  const schedules=await ifFetch<Array<{id:string;crew?:Array<{userId:string}>}>|{items?:Array<{id:string;crew?:Array<{userId:string}>}>}>("/live/organizations/"+ORGANIZATION_ID+"/schedules?page=1&pageSize=100",session);
  const list=Array.isArray(schedules)?schedules:schedules.items||[],schedule=list.find(s=>s.id===scheduleId);
  if(!schedule||!(schedule.crew||[]).some(c=>c.userId===identity.id))return NextResponse.json({error:"Only assigned flight crew can synchronise this briefing."},{status:403});
  // Re-parse the original OFP on every sync so older saved briefings also gain the current SID/STAR metadata parser.\n  const data=parseSimBriefXml(row.rawXml,row.ofpId);
  const flightPlan=buildSimBriefFlightPlan(data);
  const writer=await getScheduleWriterSession(session);
  if(!writer)throw new Error("Connect a Virtual Blue organisation owner/admin account with live:schedules.write in Admin → Operator Account to enable schedule synchronisation.");
  try{
   await ifFetch<unknown>("/live/schedules/"+scheduleId+"/flightplan",writer,{method:"PUT",body:JSON.stringify({flightPlan})});
   const freshSchedules=await ifFetch<Array<{id:string;flightPlan?:unknown}>|{items?:Array<{id:string;flightPlan?:unknown}>}>("/live/organizations/"+ORGANIZATION_ID+"/schedules?page=1&pageSize=100",writer,{}, {bypassCache:true});
   const freshList=Array.isArray(freshSchedules)?freshSchedules:freshSchedules.items||[];
   const savedSchedule=freshList.find(item=>item.id===scheduleId);
   if(!savedSchedule||!isSimBriefFlightPlanSynced(savedSchedule.flightPlan,flightPlan))throw new Error("Infinite Flight accepted the update request but its freshly retrieved schedule still does not contain the submitted waypoints. The schedule is NOT marked as synced.");
   await getDb().update(dispatchBriefings).set({syncStatus:"synced",syncError:"",updatedAt:new Date()}).where(eq(dispatchBriefings.scheduleId,scheduleId));
   return NextResponse.json({success:true,syncStatus:"synced",flightPlan});
  }catch(error){
   const message=error instanceof Error?error.message:"Infinite Flight rejected the flight-plan update.";
   await getDb().update(dispatchBriefings).set({syncStatus:"failed",syncError:message,updatedAt:new Date()}).where(eq(dispatchBriefings.scheduleId,scheduleId));
   throw error;
  }
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Infinite Flight could not update this schedule."},{status:Number((error as {status?:number})?.status)||500})}
}