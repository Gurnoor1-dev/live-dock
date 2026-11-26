import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { dispatchBriefings } from "@/lib/db/schema";
import { requireIFSession,ifFetch,ORGANIZATION_ID } from "@/lib/infinite-flight/server";
import { buildSimBriefFlightPlan,isSimBriefFlightPlanSynced,type SimBriefData } from "@/lib/simbrief/server";
export const runtime="nodejs";
export async function GET(_request:Request,{params}:{params:Promise<{scheduleId:string}>}){
 try{
  const {session,identity}=await requireIFSession(),{scheduleId}=await params;
  const [row]=await getDb().select({data:dispatchBriefings.data,ofpId:dispatchBriefings.ofpId,syncStatus:dispatchBriefings.syncStatus,syncError:dispatchBriefings.syncError,createdAt:dispatchBriefings.createdAt}).from(dispatchBriefings).where(eq(dispatchBriefings.scheduleId,scheduleId)).limit(1);
  if(!row)return NextResponse.json({briefing:null});
  const schedules=await ifFetch<Array<{id:string;flightPlan?:string|null;crew?:Array<{userId:string}>}>|{items?:Array<{id:string;flightPlan?:string|null;crew?:Array<{userId:string}>}>}>("/live/organizations/"+ORGANIZATION_ID+"/schedules?page=1&pageSize=100",session);
  const list=Array.isArray(schedules)?schedules:schedules.items||[],schedule=list.find(s=>s.id===scheduleId);
  if(!schedule||!(schedule.crew||[]).some(c=>c.userId===identity.id))return NextResponse.json({error:"This briefing is only available to pilots assigned to the flight."},{status:403});
  let expected="";
  try{expected=buildSimBriefFlightPlan(row.data as unknown as SimBriefData);}catch{}
  const confirmed=Boolean(expected)&&isSimBriefFlightPlanSynced(schedule.flightPlan,expected);
  const syncError=confirmed?"":(row.syncError||"Infinite Flight does not currently show this SimBrief route on the schedule. Please re-sync.");
  return NextResponse.json({briefing:row.data,ofpId:row.ofpId,syncStatus:confirmed?"synced":row.syncStatus==="failed"?"failed":"pending",syncError,createdAt:row.createdAt},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to load dispatch briefing."},{status:Number((error as {status?:number})?.status)||500})}
}