import { NextRequest,NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";
import { ifFetch,ORGANIZATION_ID,requireIFSession } from "@/lib/infinite-flight/server";
type Crew={userId:string;username?:string|null;role:number};
type Schedule={id:string;callsign:string;aircraftId:string;originIcao:string;destinationIcao:string;status:number;isTimeless:boolean;scheduledDepartureUtc?:string;actualDepartureUtc?:string;actualArrivalUtc?:string;crew?:Crew[]};
type Aircraft={id:string;aircraftId:string;registration:string;status:number;visibility:number;isFleetActiveSlot:boolean};
type UserFlight={id:string;created:string;aircraftId:string;callsign:string;originAirport:string|null;destinationAirport:string|null;totalTime:number;server:string};
type UserFlightsPage={pageIndex:number;totalPages:number;hasNextPage:boolean;data:UserFlight[]};
export const runtime="nodejs";
export async function GET(request:NextRequest){
 try{
  const {session,identity}=await requireIFSession();const page=Math.max(1,Math.min(100,Number(request.nextUrl.searchParams.get("page"))||1));
  const [user]=await getDb().select({onboardingCompletedAt:appUsers.onboardingCompletedAt}).from(appUsers).where(eq(appUsers.ifcUserId,identity.id)).limit(1);
  if(!user?.onboardingCompletedAt)return NextResponse.json({error:"Complete pilot verification to view your logbook."},{status:403});
  const [scheduleRaw,aircraftRaw,history]=await Promise.all([
   ifFetch<Schedule[]|{items?:Schedule[]}>(`/live/organizations/${ORGANIZATION_ID}/schedules?page=1&pageSize=100`,session),
   ifFetch<Aircraft[]>(`/live/organizations/${ORGANIZATION_ID}/aircraft`,session),
   ifFetch<UserFlightsPage>(`/users/${identity.id}/flights?page=${page}`,session)
  ]);
  const schedules=Array.isArray(scheduleRaw)?scheduleRaw:scheduleRaw.items||[];const aircraft=(aircraftRaw||[]).filter(a=>a.status===0&&a.visibility!==2&&a.isFleetActiveSlot);
  const registration=new Map(aircraft.map(a=>[a.id,a.registration]));
  const isCrew=(s:Schedule)=>(s.crew||[]).some(c=>c.userId===identity.id);
  const live=schedules.filter(s=>s.status===6&&isCrew(s)).map(s=>({...s,aircraftRegistration:registration.get(s.aircraftId)}));
  const future=schedules.filter(s=>[1,2,3,4].includes(s.status)&&isCrew(s)&&!live.some(l=>l.id===s.id)).map(s=>({...s,aircraftRegistration:registration.get(s.aircraftId)}));
  const past=(history.data||[]).flatMap(flight=>{
   const candidates=schedules.filter(s=>s.status===11&&isCrew(s)&&s.originIcao===flight.originAirport&&s.destinationIcao===flight.destinationAirport&&aircraft.some(a=>a.aircraftId===flight.aircraftId&&a.id===s.aircraftId)&&s.actualDepartureUtc&&Math.abs(new Date(s.actualDepartureUtc).getTime()-new Date(flight.created).getTime())<=12*60*60*1000);
   const matched=candidates.sort((a,b)=>Math.abs(new Date(a.actualDepartureUtc||0).getTime()-new Date(flight.created).getTime())-Math.abs(new Date(b.actualDepartureUtc||0).getTime()-new Date(flight.created).getTime()))[0];
   if(!matched)return[];
   const fleetAircraft=aircraft.find(a=>a.id===matched.aircraftId);
   return[{id:flight.id,callsign:matched.callsign,aircraftRegistration:fleetAircraft?.registration||"Virtual Blue fleet",originIcao:flight.originAirport,destinationIcao:flight.destinationAirport,actualDepartureUtc:matched.actualDepartureUtc||flight.created,actualArrivalUtc:matched.actualArrivalUtc||flight.created,flightTimeMinutes:flight.totalTime}];
  });
  return NextResponse.json({live,future,past,hasMorePast:Boolean(history.hasNextPage),page},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to load your flights."},{status:Number((error as {status?:number})?.status)||500})}
}
