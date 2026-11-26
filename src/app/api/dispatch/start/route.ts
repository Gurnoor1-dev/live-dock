import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireIFSession,ifFetch,ORGANIZATION_ID } from "@/lib/infinite-flight/server";
import { simBriefSignature,simBriefOFPId } from "@/lib/simbrief/server";
import { getDb } from "@/lib/db";
import { appUsers,dispatchBriefings } from "@/lib/db/schema";
export const runtime="nodejs";
type Crew={userId:string};type Schedule={id:string;status:number;callsign:string;aircraftId:string;originIcao:string;destinationIcao:string;isTimeless:boolean;scheduledDepartureUtc?:string;crew?:Crew[]};
type FleetAircraft={id:string;aircraftId:string;registration:string};type AircraftType={id:string;name?:string};type AircraftLivery={id:string;aircraftID?:string;aircraftName?:string};
function resolveSimBriefType(name:string):string{
 const n=name.toUpperCase().replace(/[^A-Z0-9]/g,"");
 const rules:Array<[RegExp,string]>=[[/A318/,"a318"],[/A319/,"a319"],[/A320NEO|A20N/,"a20n"],[/A320/,"a320"],[/A321NEO|A21N/,"a21n"],[/A321/,"a321"],[/A330800|A3308|A338/,"a338"],[/A330900|A3309|A339/,"a339"],[/A330200|A332/,"a332"],[/A330300|A333/,"a333"],[/A340300|A343/,"a343"],[/A340600|A346/,"a346"],[/A3501000|A35K/,"a35k"],[/A350900|A359/,"a359"],[/A380|A388/,"a388"],[/A220100|BCS1/,"bcs1"],[/A220300|BCS3/,"bcs3"],[/737MAX8|B38M/,"b38m"],[/737MAX9|B39M/,"b39m"],[/737700|B737/,"b737"],[/737800|B738/,"b738"],[/737900|B739/,"b739"],[/747400|B744/,"b744"],[/7478|B748/,"b748"],[/757200|B752/,"b752"],[/757300|B753/,"b753"],[/767300|B763/,"b763"],[/767400|B764/,"b764"],[/777200LR|B77L/,"b77l"],[/777200|B772/,"b772"],[/777300ER|B77W/,"b77w"],[/777300|B773/,"b773"],[/7878|B788/,"b788"],[/7879|B789/,"b789"],[/78710|B78X/,"b78x"],[/E175|E75L/,"e75l"],[/E190/,"e190"],[/E195/,"e195"],[/ATR72|AT76/,"at76"],[/ATR42|AT45/,"at45"],[/DH8|Q400/,"dh8d"],[/CRJ900|CRJ9/,"crj9"]];
 return rules.find(([pattern])=>pattern.test(n))?.[1]||"";
}
const pad=(n:number)=>String(n).padStart(2,"0");
export async function POST(request:Request){
 try{
  const {session,identity}=await requireIFSession();
  const [user]=await getDb().select({onboardingCompletedAt:appUsers.onboardingCompletedAt}).from(appUsers).where(eq(appUsers.ifcUserId,identity.id)).limit(1);
  if(!user?.onboardingCompletedAt)return NextResponse.json({error:"Complete pilot verification before dispatching."},{status:403});
  const body=await request.json().catch(()=>({})) as {scheduleId?:string};
  if(!body.scheduleId||!/^[0-9a-f-]{36}$/i.test(body.scheduleId))return NextResponse.json({error:"Choose a valid scheduled flight."},{status:400});
  const [saved]=await getDb().select({scheduleId:dispatchBriefings.scheduleId}).from(dispatchBriefings).where(eq(dispatchBriefings.scheduleId,body.scheduleId)).limit(1);
  if(saved)return NextResponse.json({alreadyDispatched:true,scheduleId:body.scheduleId});
  const [schedules,fleet,types]=await Promise.all([
   ifFetch<Schedule[]|{items?:Schedule[]}>("/live/organizations/"+ORGANIZATION_ID+"/schedules?page=1&pageSize=100",session),
   ifFetch<FleetAircraft[]>("/live/organizations/"+ORGANIZATION_ID+"/aircraft",session),
   ifFetch<AircraftType[]>("/aircraft",session)
  ]);
  const list=Array.isArray(schedules)?schedules:schedules.items||[];
  const flight=list.find(s=>s.id===body.scheduleId);
  if(!flight||![1,2,3,4].includes(flight.status)||!(flight.crew||[]).some(c=>c.userId===identity.id))return NextResponse.json({error:"This flight is no longer a future assignment for your account."},{status:404});
  const assigned=fleet.find(a=>a.id===flight.aircraftId);
  if(!assigned)return NextResponse.json({error:"The scheduled aircraft could not be matched to the Virtual Blue fleet. Please refresh the schedule and try again."},{status:422});
  // Organisation aircraft can reference either a model ID or a livery/content ID.
  // Resolve the livery to its aircraft model before selecting a SimBrief type.
  let aircraftName=types.find(t=>t.id===assigned.aircraftId)?.name||"";
  if(!aircraftName){
   const liveries=await ifFetch<AircraftLivery[]>("/aircraft/liveries",session);
   const livery=liveries.find(item=>item.id===assigned.aircraftId);
   aircraftName=types.find(t=>t.id===livery?.aircraftID)?.name||livery?.aircraftName||"";
  }
  const aircraftCode=resolveSimBriefType(aircraftName);
  if(!/^[a-z0-9]{2,5}$/.test(aircraftCode))return NextResponse.json({error:"LiveDock could not resolve the aircraft's SimBrief ICAO type ("+(aircraftName||"unknown Infinite Flight aircraft")+"). Dispatch stopped to avoid filing the wrong aircraft."},{status:422});
  const origin=flight.originIcao.toUpperCase(),dest=flight.destinationIcao.toUpperCase();
  if(!/^[A-Z0-9]{4}$/.test(origin)||!/^[A-Z0-9]{4}$/.test(dest))return NextResponse.json({error:"The scheduled route does not contain valid ICAO airport codes."},{status:422});
  const timestamp=String(Math.floor(Date.now()/1000)),appOrigin=new URL(request.url).origin;
  const outputPage=appOrigin+"/api/dispatch/callback?scheduleId="+encodeURIComponent(flight.id);
  const outputPageCalc=outputPage.replace("http://","");
  const apicode=simBriefSignature(origin,dest,aircraftCode,timestamp,outputPageCalc),ofpId=simBriefOFPId(origin,dest,aircraftCode,timestamp);
  const scheduledDate=flight.scheduledDepartureUtc?new Date(flight.scheduledDepartureUtc):null;
  const date=flight.isTimeless||!scheduledDate||scheduledDate.getUTCFullYear()<2000?new Date():scheduledDate;
  const airline=(flight.callsign.match(/^[A-Z]{2,3}/i)?.[0]||"VBL").toUpperCase();
  const fltnum=flight.callsign.replace(/^[A-Z]{2,3}/i,"").replace(/[^0-9A-Z]/gi,"")||"001";
  return NextResponse.json({workerUrl:"https://www.simbrief.com/ofp/ofp.loader.api.php",apicode,timestamp,ofpId,outputPage:outputPageCalc,fields:{
   orig:origin,dest:dest,type:aircraftCode,airline,fltnum,date:pad(date.getUTCDate())+date.toLocaleString("en-US",{month:"short",timeZone:"UTC"}).toUpperCase()+String(date.getUTCFullYear()).slice(-2),
   deph:pad(date.getUTCHours()),depm:pad(date.getUTCMinutes()),reg:assigned.registration||"",units:"KGS",navlog:"1",notams:"1",maps:"detail",stepclimbs:"1",tlr:"1",etops:"0"
  }});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to start SimBrief dispatch."},{status:Number((error as {status?:number})?.status)||500})}
}