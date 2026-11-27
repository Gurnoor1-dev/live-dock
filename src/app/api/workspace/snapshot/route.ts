import { NextResponse } from "next/server";
import { list,put } from "@vercel/blob";
import { eq,inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appSettings,appUsers,applicationCodes,adminOperatorCredentials,crewRequests,discordIntegrations,featureSettings,dispatchBriefings } from "@/lib/db/schema";
import { getIFRateLimit,getIFRequestCount,ifFetch,invalidateIFGetCache,ORGANIZATION_ID,requireIFSession } from "@/lib/infinite-flight/server";
import { stickyCrewStatus } from "@/lib/automation/sticky-crew";
import { buildSimBriefFlightPlan,isSimBriefFlightPlanSynced,type SimBriefData,type IFStructuredFlightPlan } from "@/lib/simbrief/server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const CACHE_MS=120_000;
const GALLERY_MANIFEST_PATH="aircraft-gallery/manifest.json";
async function readGallerySnapshot(){try{const result=await list({prefix:GALLERY_MANIFEST_PATH,limit:1});const blob=result.blobs.find(item=>item.pathname===GALLERY_MANIFEST_PATH);if(!blob){const initial={schemaVersion:1,manifestVersion:1,lastUpdatedAt:new Date().toISOString(),organization:{id:ORGANIZATION_ID,name:"Virtual Blue"},settings:{maxPhotosPerAircraft:4,slideshowIntervalMs:2000,transition:"crossfade"},aircraft:{}};await put(GALLERY_MANIFEST_PATH,JSON.stringify(initial,null,2)+"\n",{access:"public",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json",cacheControlMaxAge:60});return initial;}const response=await fetch(blob.url+"?v="+Date.now(),{cache:"no-store"});if(!response.ok)return null;const data=await response.json();return data&&typeof data==="object"&&data.aircraft?data:null;}catch{return null;}}
type Aircraft={id:string;aircraftId:string;registration:string;status:number;visibility:number;isFleetActiveSlot:boolean;[key:string]:unknown};
type Schedule={id:string;aircraftId:string;callsign:string;status:number;crew?:Array<{userId:string;username?:string;role:number}>;[key:string]:unknown};
type Flight={id:string;aircraftId?:string;callsign?:string;originIcao?:string|null;destinationIcao?:string|null;actualDepartureUtc?:string|null;actualArrivalUtc?:string|null;status:number;flightTimeMinutes?:number;crew?:Array<{userId:string;username?:string}>;pilotFlightTimes?:Array<{userId:string;username?:string;flightTimeSeconds?:number}>};
type Position={latitude:number;longitude:number;[key:string]:unknown};
type Airport={icao?:string;icaoCode?:string;code?:string;name?:string;latitude?:number;longitude?:number;location?:{latitude?:number;longitude?:number}};
const unwrap=<T,>(v:T[]|{items?:T[]}|null|undefined):T[]=>Array.isArray(v)?v:(v?.items||[]);
const responseCache=new Map<string,{expiresAt:number;value:unknown}>();
function cacheGet<T>(key:string):T|null{const entry=responseCache.get(key);if(!entry)return null;if(entry.expiresAt<=Date.now()){responseCache.delete(key);return null;}return entry.value as T;}
function cacheSet(key:string,value:unknown){responseCache.set(key,{value,expiresAt:Date.now()+CACHE_MS});}
async function attachDispatch(snapshot:Record<string,unknown>,scheduleId:string,userId:string){
 const schedules=Array.isArray(snapshot.schedules)?snapshot.schedules as Schedule[]:[];
 const schedule=schedules.find(item=>item.id===scheduleId);
 if(!schedule||!(schedule.crew||[]).some(crew=>crew.userId===userId))return {error:"This briefing is only available to pilots assigned to the flight.",status:403};
 const [row]=await getDb().select({data:dispatchBriefings.data,ofpId:dispatchBriefings.ofpId,syncStatus:dispatchBriefings.syncStatus,syncError:dispatchBriefings.syncError,createdAt:dispatchBriefings.createdAt}).from(dispatchBriefings).where(eq(dispatchBriefings.scheduleId,scheduleId)).limit(1);
 if(!row)return {briefing:null};
 let expected:IFStructuredFlightPlan|null=null;
 try{expected=buildSimBriefFlightPlan(row.data as unknown as SimBriefData);}catch{}
 const confirmed=expected!==null&&isSimBriefFlightPlanSynced((schedule as Schedule&{flightPlan?:unknown}).flightPlan,expected);
 const positions=(snapshot.positions||{}) as Record<string,Position>;
 return {briefing:row.data,ofpId:row.ofpId,schedule:{id:schedule.id,aircraftId:schedule.aircraftId||null,callsign:schedule.callsign||"",status:schedule.status??0,originIcao:String(schedule.originIcao||""),destinationIcao:String(schedule.destinationIcao||""),scheduledDepartureUtc:String(schedule.scheduledDepartureUtc||""),scheduledArrivalUtc:String(schedule.scheduledArrivalUtc||"")},livePosition:positions[schedule.aircraftId]||null,syncStatus:confirmed?"synced":row.syncStatus==="failed"?"failed":"pending",syncError:confirmed?"":(row.syncError||"Infinite Flight does not currently show this SimBrief route on the schedule. Please re-sync."),createdAt:row.createdAt};
}
export async function GET(request:Request){
 try{
  const {session,identity}=await requireIFSession();
  const key="workspace:"+identity.id;
  const params=new URL(request.url).searchParams;
  const force=params.get("refresh")==="1";
  if(params.get("invalidate")==="1")invalidateIFGetCache(session);
  let cached=force?null:cacheGet<Record<string,unknown>>(key);
  if(!cached&&!force){const [stored]=await getDb().select({value:appSettings.value}).from(appSettings).where(eq(appSettings.key,"workspace_snapshot:"+identity.id)).limit(1);const saved=stored?.value as {expiresAt?:number;snapshot?:Record<string,unknown>}|undefined;if(saved?.snapshot&&Number(saved.expiresAt)>Date.now())cached=saved.snapshot;}
  if(cached){cacheSet(key,cached);const dispatchId=params.get("dispatchId");if(dispatchId){const dispatch=await attachDispatch(cached,dispatchId,identity.id);if("status" in dispatch)return NextResponse.json({error:dispatch.error},{status:dispatch.status});return NextResponse.json({...cached,dispatch,refreshedAt:Date.now(),cache:"HIT"},{headers:{"Cache-Control":"private, no-store","X-LiveDock-Snapshot-Cache":"HIT"}})}return NextResponse.json({...cached,refreshedAt:Date.now(),cache:"HIT"},{headers:{"Cache-Control":"private, no-store","X-LiveDock-Snapshot-Cache":"HIT"}})}
  const requestCountAtStart=getIFRequestCount(session);
  const requestCountAtStart=getIFRequestCount(session);
  const [aircraftRaw,membersRaw,schedulesRaw]=await Promise.all([
   ifFetch<Aircraft[]>("/live/organizations/"+ORGANIZATION_ID+"/aircraft",session),
   ifFetch<Array<{userId:string;username:string|null;role:number;joinedAt:string;activeLifts:number}>>("/live/organizations/"+ORGANIZATION_ID+"/members",session),
   ifFetch<Schedule[]|{items?:Schedule[]}>("/live/organizations/"+ORGANIZATION_ID+"/schedules?page=1&pageSize=100",session)
  ]);
  const aircraft=Array.isArray(aircraftRaw)?aircraftRaw:[],members=Array.isArray(membersRaw)?membersRaw:[],schedules=unwrap(schedulesRaw);
  const initialQuota=getIFRateLimit(session);
  const organization=initialQuota.isPro
   ? await ifFetch<Record<string,unknown>>("/live/organizations/"+ORGANIZATION_ID,session)
   : {id:ORGANIZATION_ID,name:"Virtual Blue",role:members.find(m=>m.userId===identity.id)?.role??0,description:null,worldType:0,operationType:0};
  const quota=getIFRateLimit(session);
  const baseSlots=initialQuota.isPro?4:3;
  const additionalBudget=quota.isPro?Math.max(0,Math.min(14,quota.remaining-1)):Math.max(0,Math.min(1,quota.remaining-1));
  let used=0;
  const safe=async <T,>(path:string):Promise<T|null>=>{if(used>=additionalBudget)return null;used++;try{return await ifFetch<T>(path,session);}catch{return null;}};
  const flyable=aircraft.filter(a=>a.status===0&&a.visibility!==2&&a.isFleetActiveSlot);
  const positionBudget=Math.min(quota.isPro?6:1,Math.max(0,additionalBudget-used));
  const positionBatch=flyable.slice(0,positionBudget);
  const positionEntries=await Promise.all(positionBatch.map(async a=>{const p=await safe<Position>("/live/aircraft/"+a.id+"/position");return p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)?[a.id,p] as const:null;}));
  const positions=Object.fromEntries(positionEntries.filter((x):x is readonly [string,Position]=>Boolean(x)));
  const historyBudget=Math.min(quota.isPro?6:0,Math.max(0,additionalBudget-used));
  const historyAircraft=flyable.slice(0,historyBudget);
  const historyRows=await Promise.all(historyAircraft.map(async a=>{const page=await safe<Flight[]|{items?:Flight[]}>("/live/aircraft/"+a.id+"/flights?page=1&pageSize=100");return {aircraft:a,flights:unwrap(page)}}));
  const [typesValue,airportsValue]=await Promise.all([safe<unknown[]>("/aircraft"),safe<Airport[]|{items?:Airport[];airports?:Airport[]}>("/airports")]);
  const aircraftTypes=Array.isArray(typesValue)?typesValue:[];
  let airports=unwrap(airportsValue as Airport[]|{items?:Airport[]}|null);
  if(!airports.length&&airportsValue&&typeof airportsValue==="object"&&!Array.isArray(airportsValue))airports=(airportsValue as {airports?:Airport[]}).airports||[];
  const identityId=identity.id;
  const isCrew=(s:Schedule)=>(s.crew||[]).some(c=>c.userId===identityId);
  const live=schedules.filter(s=>s.status===6&&isCrew(s));
  const future=schedules.filter(s=>[1,2,3,4].includes(s.status)&&isCrew(s));
  const registration=new Map(aircraft.map(a=>[a.id,a.registration]));
  const past=historyRows.flatMap(({aircraft:a,flights})=>flights.filter(f=>f.status===1&&((f.pilotFlightTimes||[]).some(p=>p.userId===identityId)||(f.crew||[]).some(p=>p.userId===identityId))).map(f=>({...f,aircraftRegistration:a.registration}))).sort((a,b)=>new Date(b.actualDepartureUtc||0).getTime()-new Date(a.actualDepartureUtc||0).getTime());
  const activity=historyRows.flatMap(({aircraft:a,flights})=>flights.slice(0,5).map(f=>({...f,aircraftRegistration:a.registration}))).sort((a,b)=>new Date(b.actualDepartureUtc||0).getTime()-new Date(a.actualDepartureUtc||0).getTime()).slice(0,12);
  const airportPoints:Record<string,{latitude:number;longitude:number}>={};
  const hubs=[...new Set(schedules.flatMap(s=>[String(s.originIcao||""),String(s.destinationIcao||"")]).filter(Boolean))].slice(0,3);
  for(const code of hubs){const value=airports.find(a=>(a.icao||a.icaoCode||a.code)===code);if(value){const latitude=Number(value.latitude??value.location?.latitude),longitude=Number(value.longitude??value.location?.longitude);if(Number.isFinite(latitude)&&Number.isFinite(longitude))airportPoints[code]={latitude,longitude};}}
  const canManage=Number(organization.role)===1||Number(organization.role)===2;
  const [userRows,requests,codeRows,integrationRows,features,operatorRows,stickyRows,stickyPanel,gallery]=await Promise.all([
   getDb().select().from(appUsers),
   getDb().select({scheduleId:crewRequests.scheduleId,seat:crewRequests.seat,status:crewRequests.status}).from(crewRequests).where(inArray(crewRequests.status,["pending","processing"])),
   getDb().select({id:applicationCodes.id,issuedToIfcUserId:applicationCodes.issuedToIfcUserId,createdAt:applicationCodes.createdAt,expiresAt:applicationCodes.expiresAt,usedAt:applicationCodes.usedAt,usedByIfcUserId:applicationCodes.usedByIfcUserId,revokedAt:applicationCodes.revokedAt}).from(applicationCodes).orderBy(applicationCodes.createdAt),
   getDb().select().from(discordIntegrations).where(eq(discordIntegrations.id,"virtual-blue")).limit(1),
   getDb().select().from(featureSettings),
   getDb().select({ifcUserId:adminOperatorCredentials.ifcUserId,connectedAt:adminOperatorCredentials.connectedAt}).from(adminOperatorCredentials).where(eq(adminOperatorCredentials.ifcUserId,identityId)).limit(1),
   getDb().select().from(appSettings).where(eq(appSettings.key,"sticky_crew_config")).limit(1),
   canManage?stickyCrewStatus().catch(()=>({exists:false,reason:"verification_unavailable"})):Promise.resolve({exists:false,reason:"not_admin"}),
   readGallerySnapshot()
  ]);
  const registry=new Map(userRows.map(u=>[u.ifcUserId,u]));
  const registered=members.filter(m=>Boolean(registry.get(m.userId)?.onboardingCompletedAt)).map(m=>({...m,appUser:registry.get(m.userId)}));
  const pending=members.filter(m=>!registry.get(m.userId)?.onboardingCompletedAt).map(m=>({...m,hasLoggedIn:registry.has(m.userId)}));
  const pilot=userRows.find(u=>u.ifcUserId===identityId);
  const integration=integrationRows[0]||null;
  const sticky=stickyRows[0]?.value as {channelId?:string}|undefined;
  const actualIFRequests=Math.max(0,getIFRequestCount(session)-requestCountAtStart);
  const result={
   authenticated:true,identity:{id:identity.id,username:identity.username||null},
   profile:{ifcUserId:identity.id,username:identity.username||null,role:null,onboardingRequired:!pilot?.onboardingCompletedAt,discordUserId:pilot?.discordUserId??null,discordUsername:pilot?.discordUsername??null},
   organization,aircraft,members,schedules,aircraftTypes,airports,positions,gallery,
   myFlights:{live:live.map(s=>({...s,aircraftRegistration:registration.get(s.aircraftId)})),future:future.map(s=>({...s,aircraftRegistration:registration.get(s.aircraftId)})),past,pastCoverage:{checked:historyRows.length,total:flyable.length,complete:historyRows.length>=flyable.length,limited:historyRows.length<flyable.length}},
   activity,airportPoints,requests,flightHistoryByAircraft:Object.fromEntries(historyRows.map(({aircraft:a,flights})=>[a.id,flights])),
   admin:canManage?{registered,pending,connected:Boolean(operatorRows[0]),codes:codeRows,integrations:{...(integration||{}),stickyCrewChannelId:sticky?.channelId||""},features,stickyPanel}:{registered:[],pending:[],connected:false,codes:[],integrations:{},features:[],stickyPanel},
   requestUsage:{actual:actualIFRequests,plannedSlots:baseSlots+used,limit:quota.isPro?18:4,quota:{isPro:quota.isPro,remaining:quota.remaining}},
   refreshedAt:Date.now(),cache:"MISS"
  };
  cacheSet(key,result);
  await getDb().insert(appSettings).values({key:"workspace_snapshot:"+identity.id,value:{expiresAt:Date.now()+CACHE_MS,snapshot:result},updatedAt:new Date()}).onConflictDoUpdate({target:appSettings.key,set:{value:{expiresAt:Date.now()+CACHE_MS,snapshot:result},updatedAt:new Date()}});
  const dispatchId=params.get("dispatchId");if(dispatchId){const dispatch=await attachDispatch(result,dispatchId,identity.id);if("status" in dispatch)return NextResponse.json({error:dispatch.error},{status:dispatch.status});result.dispatch=dispatch;}
  return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store","X-LiveDock-Snapshot-Cache":"MISS","X-LiveDock-IF-Requests":String(actualIFRequests)}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to load the unified workspace snapshot."},{status:Number((error as {status?:number})?.status)||500,headers:{"Cache-Control":"no-store"}})}
}