import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { activeCrewAssignments,appUsers } from "@/lib/db/schema";
import { ifFetch,ORGANIZATION_ID,requireIFSession } from "@/lib/infinite-flight/server";
type Crew={userId:string;username?:string|null;role:number};
type Schedule={id:string;callsign:string;aircraftId:string;originIcao:string;destinationIcao:string;status:number;isTimeless:boolean;scheduledDepartureUtc?:string;actualDepartureUtc?:string;actualArrivalUtc?:string;crew?:Crew[]};
type Aircraft={id:string;aircraftId:string;registration:string;status:number;visibility:number;isFleetActiveSlot:boolean};
type FlightLog={id:string;aircraftId:string;callsign:string;originIcao:string|null;destinationIcao:string|null;actualDepartureUtc:string|null;actualArrivalUtc:string|null;status:number;flightTimeMinutes:number;crew:Crew[];pilotFlightTimes:Array<{userId:string;username?:string|null;flightTimeSeconds:number;startSeconds:number}>};
export const runtime="nodejs";
export async function GET(){
 try{
  const {session,identity}=await requireIFSession();
  const [user]=await getDb().select({onboardingCompletedAt:appUsers.onboardingCompletedAt}).from(appUsers).where(eq(appUsers.ifcUserId,identity.id)).limit(1);
  if(!user?.onboardingCompletedAt)return NextResponse.json({error:"Complete pilot verification to view your logbook."},{status:403});
  const [scheduleRaw,aircraftRaw,assignments]=await Promise.all([
   ifFetch<Schedule[]|{items?:Schedule[]}>(`/live/organizations/${ORGANIZATION_ID}/schedules?page=1&pageSize=100`,session),
   ifFetch<Aircraft[]>(`/live/organizations/${ORGANIZATION_ID}/aircraft`,session),
   getDb().select().from(activeCrewAssignments).where(eq(activeCrewAssignments.pilotIfcUserId,identity.id))
  ]);
  const schedules=Array.isArray(scheduleRaw)?scheduleRaw:scheduleRaw.items||[];
  const aircraft=(aircraftRaw||[]).filter(a=>a.status===0&&a.visibility!==2&&a.isFleetActiveSlot);
  const isCrew=(schedule:Schedule)=>(schedule.crew||[]).some(member=>member.userId===identity.id);
  const registration=new Map(aircraft.map(item=>[item.aircraftId,item.registration]));
  const live=schedules.filter(s=>s.status===6&&isCrew(s)).map(s=>({...s,aircraftRegistration:registration.get(s.aircraftId)}));
  const future=schedules.filter(s=>[1,2,3,4].includes(s.status)&&isCrew(s)&&assignments.some(a=>a.scheduleId===s.id&&a.status==="assigned")&&!live.some(l=>l.id===s.id)).map(s=>({...s,aircraftRegistration:registration.get(s.aircraftId)}));
  const scanFleet=aircraft.slice(0,10);
  const logs=await Promise.all(scanFleet.map(async item=>{try{const result=await ifFetch<FlightLog[]|{items?:FlightLog[]}>(`/live/aircraft/${item.id}/flights?page=1&pageSize=100`,session);return{aircraft:item,flights:Array.isArray(result)?result:result.items||[],ok:true}}catch{return{aircraft:item,flights:[],ok:false}}}));
  const past=logs.flatMap(({aircraft:item,flights})=>flights.filter(f=>f.status===1&&Boolean(f.actualArrivalUtc)&&(f.crew||[]).some(member=>member.userId===identity.id)).map(f=>{
   const matches=schedules.filter(s=>s.aircraftId===item.aircraftId&&s.originIcao===f.originIcao&&s.destinationIcao===f.destinationIcao&&s.actualDepartureUtc&&f.actualDepartureUtc&&Math.abs(new Date(s.actualDepartureUtc).getTime()-new Date(f.actualDepartureUtc).getTime())<=2*60*60*1000);
   const matched=matches.sort((a,b)=>Math.abs(new Date(a.actualDepartureUtc||0).getTime()-new Date(f.actualDepartureUtc||0).getTime())-Math.abs(new Date(b.actualDepartureUtc||0).getTime()-new Date(f.actualDepartureUtc||0).getTime()))[0];
   return{id:f.id,callsign:matched?.callsign||"Completed flight",aircraftRegistration:item.registration,originIcao:f.originIcao,destinationIcao:f.destinationIcao,actualDepartureUtc:f.actualDepartureUtc,actualArrivalUtc:f.actualArrivalUtc,flightTimeMinutes:f.flightTimeMinutes};
  })).sort((a,b)=>new Date(b.actualDepartureUtc||0).getTime()-new Date(a.actualDepartureUtc||0).getTime());
  return NextResponse.json({live,future,past,historyLimited:aircraft.length>scanFleet.length||logs.some(log=>!log.ok),historyScanned:logs.filter(log=>log.ok).length,historyAircraftTotal:aircraft.length},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to load your flights."},{status:Number((error as {status?:number})?.status)||500})}
}
