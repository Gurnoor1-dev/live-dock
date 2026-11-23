import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";
import { getIFRateLimit,ifFetch,ORGANIZATION_ID,requireIFSession } from "@/lib/infinite-flight/server";

type Crew={userId:string;username?:string|null;role:number};
type Schedule={id:string;callsign:string;aircraftId:string;originIcao:string;destinationIcao:string;status:number;isTimeless:boolean;scheduledDepartureUtc?:string;actualDepartureUtc?:string;actualArrivalUtc?:string;crew?:Crew[]};
type Aircraft={id:string;aircraftId:string;registration:string;status:number;visibility:number;isFleetActiveSlot:boolean};
type AircraftFlight={id:string;aircraftId:string;callsign:string;originIcao:string|null;destinationIcao:string|null;actualDepartureUtc:string|null;actualArrivalUtc:string|null;status:number;flightTimeMinutes:number;crew?:Crew[];pilotFlightTimes?:Array<{userId:string;username?:string;flightTimeSeconds:number}>};
type Page<T>={items:T[];page:number;pageSize:number;totalCount:number;totalPages:number};

export const runtime="nodejs";
const responseCache=new Map<string,{value:unknown;fetchedAt:number}>();
const ORG_CACHE_TTL=90_000;
const FLIGHT_LOG_CACHE_TTL=5*60_000;
function readCache<T>(key:string,ttl:number):T|null{const entry=responseCache.get(key);if(!entry)return null;if(Date.now()-entry.fetchedAt>=ttl){responseCache.delete(key);return null;}return entry.value as T;}
function writeCache<T>(key:string,value:T){const now=Date.now();for(const [cacheKey,entry] of responseCache)if(now-entry.fetchedAt>60*60_000)responseCache.delete(cacheKey);responseCache.set(key,{value,fetchedAt:now});}
export async function GET(){
 try{
  const {session,identity}=await requireIFSession();
  const [user]=await getDb().select({onboardingCompletedAt:appUsers.onboardingCompletedAt}).from(appUsers).where(eq(appUsers.ifcUserId,identity.id)).limit(1);
  if(!user?.onboardingCompletedAt)return NextResponse.json({error:"Complete pilot verification to view your logbook."},{status:403});

  // Run the two base Live requests sequentially so the remaining quota header is current.
  const aircraftKey=`org-aircraft:${ORGANIZATION_ID}`;
  let aircraftRaw=readCache<Aircraft[]>(aircraftKey,ORG_CACHE_TTL);
  if(!aircraftRaw){aircraftRaw=await ifFetch<Aircraft[]>(`/live/organizations/${ORGANIZATION_ID}/aircraft`,session);writeCache(aircraftKey,aircraftRaw);}
  const aircraft=(aircraftRaw||[]).filter(a=>a.status===0&&a.visibility!==2&&a.isFleetActiveSlot);
  const schedulesKey=`org-schedules:${ORGANIZATION_ID}`;
  let scheduleRaw=readCache<Schedule[]|{items?:Schedule[]}>(schedulesKey,ORG_CACHE_TTL);
  if(!scheduleRaw){scheduleRaw=await ifFetch<Schedule[]|{items?:Schedule[]}>(`/live/organizations/${ORGANIZATION_ID}/schedules?page=1&pageSize=100`,session);writeCache(schedulesKey,scheduleRaw);}
  const schedules=Array.isArray(scheduleRaw)?scheduleRaw:scheduleRaw.items||[];
  const registration=new Map(aircraft.map(a=>[a.id,a.registration]));
  const isCrew=(s:Schedule)=>(s.crew||[]).some(c=>c.userId===identity.id);
  const live=schedules.filter(s=>s.status===6&&isCrew(s)).map(s=>({...s,aircraftRegistration:registration.get(s.aircraftId)}));
  const future=schedules.filter(s=>[1,2,3,4].includes(s.status)&&isCrew(s)).map(s=>({...s,aircraftRegistration:registration.get(s.aircraftId)}));

  // Aircraft flight logs are the authoritative source for completed organisation legs
  // and identify the pilots who actually flew each aircraft.
  const quota=getIFRateLimit(session);
  const requestBudget=Math.max(0,Math.min(quota.remaining-1,quota.isPro?15:2));
  const past: Array<{id:string;callsign:string;aircraftRegistration:string;originIcao:string|null;destinationIcao:string|null;actualDepartureUtc:string|null;actualArrivalUtc:string|null;flightTimeMinutes:number}>=[];
  let checked=0,limited=false;
  let usedRequests=0;
  for(const aircraftItem of aircraft){
   const logKey=`aircraft-flight-log:${aircraftItem.id}:page:1:size:100`;
   let page=readCache<Page<AircraftFlight>>(logKey,FLIGHT_LOG_CACHE_TTL);
   if(!page&&usedRequests>=requestBudget){limited=true;break;}
   try{
    if(!page){page=await ifFetch<Page<AircraftFlight>>(`/live/aircraft/${aircraftItem.id}/flights?page=1&pageSize=100`,session);usedRequests++;writeCache(logKey,page);}
    checked++;
    for(const flight of page.items||[]){
     const flew=(flight.pilotFlightTimes||[]).some(p=>p.userId===identity.id)||(flight.crew||[]).some(p=>p.userId===identity.id);
     if(flight.status!==1||!flew)continue;
     past.push({id:flight.id,callsign:flight.callsign||aircraftItem.registration,aircraftRegistration:aircraftItem.registration,originIcao:flight.originIcao,destinationIcao:flight.destinationIcao,actualDepartureUtc:flight.actualDepartureUtc,actualArrivalUtc:flight.actualArrivalUtc,flightTimeMinutes:flight.flightTimeMinutes});
    }
   }catch(error){
    if(Number((error as {status?:number})?.status)===429){limited=true;break;}
   }
  }
  past.sort((a,b)=>new Date(b.actualDepartureUtc||0).getTime()-new Date(a.actualDepartureUtc||0).getTime());
  const uniquePast=[...new Map(past.map(f=>[f.id,f])).values()];
  return NextResponse.json({live,future,past:uniquePast,pastCoverage:{checked,total:aircraft.length,complete:checked>=aircraft.length,limited}},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to load your flights."},{status:Number((error as {status?:number})?.status)||500})}
}
