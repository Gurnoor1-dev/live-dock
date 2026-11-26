import { NextRequest,NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { dispatchBriefings } from "@/lib/db/schema";
import { requireIFSession,ifFetch,ORGANIZATION_ID } from "@/lib/infinite-flight/server";
import { fetchSimBriefOFP,parseSimBriefXml } from "@/lib/simbrief/server";
import { getScheduleWriterSession } from "@/lib/infinite-flight/operator";
export const runtime="nodejs";
type Schedule={id:string;status:number;originIcao:string;destinationIcao:string;crew?:Array<{userId:string}>};
export async function GET(request:NextRequest){
 const scheduleId=request.nextUrl.searchParams.get("scheduleId")||"",ofpId=request.nextUrl.searchParams.get("ofp_id")||"";
 try{
  const {session,identity}=await requireIFSession();
  if(!/^[0-9a-f-]{36}$/i.test(scheduleId)||!/^\d{10}_[A-Za-z0-9]{10}$/.test(ofpId))throw Object.assign(new Error("The SimBrief return link is invalid. Please dispatch again."),{status:400});
  const [existing]=await getDb().select({scheduleId:dispatchBriefings.scheduleId}).from(dispatchBriefings).where(eq(dispatchBriefings.scheduleId,scheduleId)).limit(1);
  if(existing)return NextResponse.redirect(new URL("/dispatch/"+scheduleId,request.url));
  const schedules=await ifFetch<Schedule[]|{items?:Schedule[]}>("/live/organizations/"+ORGANIZATION_ID+"/schedules?page=1&pageSize=100",session);
  const list=Array.isArray(schedules)?schedules:schedules.items||[],schedule=list.find(s=>s.id===scheduleId);
  if(!schedule||![1,2,3,4,6].includes(schedule.status)||!(schedule.crew||[]).some(c=>c.userId===identity.id))throw Object.assign(new Error("This schedule is no longer assigned to your account."),{status:403});
  const xml=await fetchSimBriefOFP(ofpId),data=parseSimBriefXml(xml,ofpId);
  if(!data.origin||!data.destination)throw new Error("The SimBrief OFP is missing airport information.");
  if(data.origin.toUpperCase()!==schedule.originIcao.toUpperCase()||data.destination.toUpperCase()!==schedule.destinationIcao.toUpperCase())throw new Error("The generated OFP airports do not match this Infinite Flight schedule. The briefing was not saved.");
  const [inserted]=await getDb().insert(dispatchBriefings).values({scheduleId,pilotIfcUserId:identity.id,ofpId,rawXml:xml,data:data as unknown as Record<string,unknown>,syncStatus:"pending"}).onConflictDoNothing().returning({scheduleId:dispatchBriefings.scheduleId});
  if(!inserted)return NextResponse.redirect(new URL("/dispatch/"+scheduleId,request.url));
  let syncStatus="pending",syncError="";
  if(data.navlog.length>=2){
   try{
    const writer=await getScheduleWriterSession(session);
    if(!writer)throw new Error("Connect a Virtual Blue organisation owner/admin account with live:schedules.write in Admin → Operator Account to enable automatic schedule synchronisation.");
    await ifFetch("/live/schedules/"+scheduleId+"/flightplan",writer,{method:"PUT",body:JSON.stringify({flightPlan:{flightPlanItems:data.navlog.slice(0,500).map(p=>({name:p.name,identifier:p.identifier,location:p.location,altitude:p.altitude??-1}))}})});
    syncStatus="synced";
   }catch(error){syncError=error instanceof Error?error.message:"Infinite Flight rejected the flight-plan update.";syncStatus="permission_required";}
  }else syncError="SimBrief did not return enough geocoded navlog points to safely update the Infinite Flight schedule.";
  await getDb().update(dispatchBriefings).set({syncStatus,syncError,updatedAt:new Date()}).where(eq(dispatchBriefings.scheduleId,scheduleId));
  return NextResponse.redirect(new URL("/dispatch/"+scheduleId,request.url));
 }catch(error){
  const url=new URL("/dispatch/"+(scheduleId||""),request.url);url.searchParams.set("dispatchError",error instanceof Error?error.message:"Unable to save the SimBrief briefing.");
  return NextResponse.redirect(url);
 }
}