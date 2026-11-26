import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireIFSession,ifFetch,ORGANIZATION_ID } from "@/lib/infinite-flight/server";
import { simBriefSignature } from "@/lib/simbrief/server";
import { getDb } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";
export const runtime="nodejs";
type Crew={userId:string};type Schedule={id:string;status:number;callsign:string;aircraftId:string;originIcao:string;destinationIcao:string;isTimeless:boolean;scheduledDepartureUtc?:string;crew?:Crew[]};
type FleetAircraft={id:string;aircraftId:string;registration:string};type AircraftType={id:string;icao?:string;icaoCode?:string;name?:string};
const pad=(n:number)=>String(n).padStart(2,"0");
export async function POST(request:Request){
 try{
  const {session,identity}=await requireIFSession();
  const [user]=await getDb().select({onboardingCompletedAt:appUsers.onboardingCompletedAt}).from(appUsers).where(eq(appUsers.ifcUserId,identity.id)).limit(1);
  if(!user?.onboardingCompletedAt)return NextResponse.json({error:"Complete pilot verification before dispatching."},{status:403});
  const body=await request.json().catch(()=>({})) as {scheduleId?:string};
  if(!body.scheduleId||!/^[0-9a-f-]{36}$/i.test(body.scheduleId))return NextResponse.json({error:"Choose a valid scheduled flight."},{status:400});
  const [schedules,fleet,types]=await Promise.all([
   ifFetch<Schedule[]|{items?:Schedule[]}>("/live/organizations/"+ORGANIZATION_ID+"/schedules?page=1&pageSize=100",session),
   ifFetch<FleetAircraft[]>("/live/organizations/"+ORGANIZATION_ID+"/aircraft",session),
   ifFetch<AircraftType[]>("/aircraft",session)
  ]);
  const list=Array.isArray(schedules)?schedules:schedules.items||[];
  const flight=list.find(s=>s.id===body.scheduleId);
  if(!flight||![1,2,3,4].includes(flight.status)||!(flight.crew||[]).some(c=>c.userId===identity.id))return NextResponse.json({error:"This flight is no longer a future assignment for your account."},{status:404});
  const assigned=fleet.find(a=>a.id===flight.aircraftId),type=types.find(t=>t.id===assigned?.aircraftId);
  const aircraftCode=(type?.icao||type?.icaoCode||"").toLowerCase();
  if(!/^[a-z0-9]{2,5}$/.test(aircraftCode))return NextResponse.json({error:"LiveDock could not resolve the aircraft's SimBrief ICAO type. Dispatch stopped to avoid filing the wrong aircraft."},{status:422});
  const origin=flight.originIcao.toUpperCase(),dest=flight.destinationIcao.toUpperCase();
  if(!/^[A-Z0-9]{4}$/.test(origin)||!/^[A-Z0-9]{4}$/.test(dest))return NextResponse.json({error:"The scheduled route does not contain valid ICAO airport codes."},{status:422});
  const timestamp=String(Math.floor(Date.now()/1000)),appOrigin=new URL(request.url).origin;
  const outputPage=appOrigin+"/api/dispatch/callback?scheduleId="+encodeURIComponent(flight.id);
  const outputPageCalc=outputPage.replace("http://","");
  const apicode=simBriefSignature(origin,dest,aircraftCode,timestamp,outputPageCalc);
  const date=flight.scheduledDepartureUtc?new Date(flight.scheduledDepartureUtc):new Date();
  const airline=(flight.callsign.match(/^[A-Z]{2,3}/i)?.[0]||"VBL").toUpperCase();
  const fltnum=flight.callsign.replace(/^[A-Z]{2,3}/i,"").replace(/[^0-9A-Z]/gi,"")||"001";
  return NextResponse.json({workerUrl:"https://www.simbrief.com/ofp/ofp.loader.api.php",apicode,timestamp,outputPage:outputPageCalc,fields:{
   orig:origin,dest,type:aircraftCode,airline,fltnum,date:pad(date.getUTCDate())+date.toLocaleString("en-US",{month:"short",timeZone:"UTC"}).toUpperCase()+String(date.getUTCFullYear()).slice(-2),
   deph:pad(date.getUTCHours()),depm:pad(date.getUTCMinutes()),reg:assigned?.registration||"",units:"KGS",navlog:"1",notams:"1",maps:"detail",stepclimbs:"1",tlr:"1",etops:"0"
  }});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to start SimBrief dispatch."},{status:Number((error as {status?:number})?.status)||500})}
}