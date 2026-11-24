import "server-only";
import { and,eq,inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { appSettings,appUsers,crewRequests,discordIntegrations } from "@/lib/db/schema";
import { ifFetch,ORGANIZATION_ID } from "@/lib/infinite-flight/server";
import type { IFSession } from "@/lib/infinite-flight/session";
import { sendDiscordMessage,editDiscordMessage } from "@/lib/discord/components";

type Aircraft={id:string;registration:string;aircraftId:string};
type Crew={userId:string;username?:string|null;role:number};
type Schedule={id:string;aircraftId:string;callsign:string;flightType:number;originIcao:string;destinationIcao:string;status:number;sequence:number;isTimeless:boolean;scheduledDepartureUtc?:string;crew:Crew[]};
const PANEL_KEY="sticky_crew_panel";
const CONFIG_KEY="sticky_crew_config";
const REQUESTABLE=[1,2,3,4];
export type StickyPanelResult={exists:boolean;created?:boolean;updated?:boolean;messageId?:string;aircraftCount?:number;scheduleCount?:number;reason?:string};
export function stickyPanelPayload(aircraft:Aircraft[],schedules:Schedule[]){
 const grouped=aircraft.map(a=>({aircraft:a,legs:schedules.filter(s=>s.aircraftId===a.id&&REQUESTABLE.includes(s.status)).sort((x,y)=>x.sequence-y.sequence)})).filter(x=>x.legs.length);
 const options=grouped.slice(0,25).map(({aircraft:a,legs})=>({label:a.registration.slice(0,100),value:a.id,description:(legs.length+" available schedule"+(legs.length===1?"":"s")).slice(0,100)}));
 const total=grouped.reduce((n,x)=>n+x.legs.length,0);
 const lines=grouped.slice(0,12).map(({aircraft:a,legs})=>`• **${a.registration}** — ${legs.length} live schedule${legs.length===1?"":"s"}`);
 const text=grouped.length?lines.join("\n")+(grouped.length>12?"\n…and more aircraft available in the selector.":""):"No aircraft currently have requestable live schedules.";
 return {flags:32768,allowed_mentions:{parse:[]},components:[
  {type:10,content:"# ✈️ STICKY CREW\n**Virtual Blue · Crew booking desk**\nSelect one or more aircraft below to explore their published Infinite Flight schedules and request an open crew seat."},
  {type:14,divider:true,spacing:1},
  {type:10,content:`**${grouped.length} aircraft** · **${total} live schedules**\n${text}`},
  {type:14,divider:true,spacing:1},
  {type:1,components:[{type:3,custom_id:"sticky:aircraft",placeholder:"Select aircraft to view schedules…",min_values:1,max_values:Math.max(1,Math.min(25,options.length)),options:options.length?options:[{label:"No scheduled aircraft available",value:"none",description:"Publish a live schedule in Infinite Flight first"}],disabled:!options.length}]},
  {type:10,content:"*Only live, requestable schedules are listed. Crew requests are reviewed by organisation administrators.*"}
 ]};
}
async function storedPanel(){const [row]=await getDb().select().from(appSettings).where(eq(appSettings.key,PANEL_KEY)).limit(1);return (row?.value||{}) as {channelId?:string;messageId?:string};}
async function savePanel(channelId:string,messageId:string){await getDb().insert(appSettings).values({key:PANEL_KEY,value:{channelId,messageId},updatedAt:new Date()}).onConflictDoUpdate({target:appSettings.key,set:{value:{channelId,messageId},updatedAt:new Date()}});}
export async function stickyCrewStatus():Promise<StickyPanelResult>{
 const db=getDb();
 const [settings]=await db.select().from(appSettings).where(eq(appSettings.key,CONFIG_KEY)).limit(1);
 const channelId=String((settings?.value as {channelId?:string}|undefined)?.channelId||"");
 if(!channelId)return{exists:false,reason:"channel_missing"};
 const stored=await storedPanel();
 if(!stored.messageId||stored.channelId!==channelId)return{exists:false,reason:"message_missing"};
 const response=await fetch("https://discord.com/api/v10/channels/"+channelId+"/messages/"+stored.messageId,{headers:{Authorization:"Bot "+(process.env.DISCORD_BOT_TOKEN||"")},cache:"no-store"});
 if(response.status===404)return{exists:false,reason:"message_deleted"};
 if(!response.ok)throw new Error("Could not verify Sticky Crew message in Discord (HTTP "+response.status+").");
 const data=await response.json() as {id?:string;components?:Array<Record<string,unknown>>};
 try{await editDiscordMessage(channelId,stored.messageId,{components:data.components||[]});}
 catch{return{exists:false,reason:"message_not_editable",messageId:stored.messageId};}
 return{exists:Boolean(data.id),messageId:data.id};
}
export async function publishStickyCrewPanel(session:IFSession):Promise<StickyPanelResult>{
 const db=getDb();const [settings]=await db.select().from(appSettings).where(eq(appSettings.key,CONFIG_KEY)).limit(1);
 const channelId=String((settings?.value as {channelId?:string}|undefined)?.channelId||"");
 if(!channelId)return{exists:false,reason:"channel_missing"};
 const [aircraftRaw,scheduleRaw]=await Promise.all([
  ifFetch<Aircraft[]>(`/live/organizations/${ORGANIZATION_ID}/aircraft`,session),
  ifFetch<Schedule[]|{items?:Schedule[]}>(`/live/organizations/${ORGANIZATION_ID}/schedules?page=1&pageSize=100`,session)
 ]);
 const schedules=Array.isArray(scheduleRaw)?scheduleRaw:scheduleRaw.items||[];
 const aircraft=aircraftRaw||[];
 const payload=stickyPanelPayload(aircraft,schedules);
 const stored=await storedPanel();
 if(stored.messageId&&stored.channelId===channelId){
  try{
   await editDiscordMessage(channelId,stored.messageId,payload);
   return{exists:true,updated:true,messageId:stored.messageId,aircraftCount:aircraft.filter(a=>schedules.some(s=>s.aircraftId===a.id&&REQUESTABLE.includes(s.status))).length,scheduleCount:aircraft.filter(a=>schedules.some(s=>s.aircraftId===a.id&&REQUESTABLE.includes(s.status))).reduce((n,a)=>n+schedules.filter(s=>s.aircraftId===a.id&&REQUESTABLE.includes(s.status)).length,0)};
  }catch(error){
   const check=await fetch("https://discord.com/api/v10/channels/"+channelId+"/messages/"+stored.messageId,{headers:{Authorization:"Bot "+(process.env.DISCORD_BOT_TOKEN||"")},cache:"no-store"});
   if(check.status!==404&&check.ok){
    // The message still exists but the bot cannot edit it; publish a fresh managed panel.
   }else if(check.status!==404&&!check.ok)throw error;
  }
 }
 const sent=await sendDiscordMessage(channelId,payload);
 await savePanel(channelId,sent.id);
 return{exists:true,created:true,messageId:sent.id,aircraftCount:aircraft.filter(a=>schedules.some(s=>s.aircraftId===a.id&&REQUESTABLE.includes(s.status))).length,scheduleCount:schedules.filter(s=>REQUESTABLE.includes(s.status)).length};
}
async function refreshStoredPanelFromData(aircraft:Aircraft[],schedules:Schedule[]){
 const stored=await storedPanel();if(!stored.channelId||!stored.messageId)return;
 try{await editDiscordMessage(stored.channelId,stored.messageId,stickyPanelPayload(aircraft,schedules));}catch{}
}
export async function stickyCrewAircraftSelection(discordId:string,values:string[],session:IFSession){
 if(!values.length||values.includes("none"))throw new Error("Choose at least one aircraft with a live schedule.");
 const [raw,aircraftRaw]=await Promise.all([
  ifFetch<Schedule[]|{items?:Schedule[]}>(`/live/organizations/${ORGANIZATION_ID}/schedules?page=1&pageSize=100`,session),
  ifFetch<Aircraft[]>(`/live/organizations/${ORGANIZATION_ID}/aircraft`,session)
 ]);
 const schedules=Array.isArray(raw)?raw:raw.items||[];
 await refreshStoredPanelFromData(aircraftRaw||[],schedules);
 const selected=new Set(values);
 const aircraft=(aircraftRaw||[]).filter(a=>selected.has(a.id));
 const legs=schedules.filter(s=>selected.has(s.aircraftId)&&REQUESTABLE.includes(s.status)).sort((a,b)=>a.sequence-b.sequence);
 if(!legs.length)throw new Error("Those aircraft no longer have requestable live schedules.");
 const options=legs.slice(0,25).map(s=>{const a=aircraft.find(x=>x.id===s.aircraftId);const label=(s.callsign+" · "+(a?.registration||"Aircraft")).slice(0,100);const desc=(s.originIcao+" → "+s.destinationIcao+" · "+(s.crew||[]).filter(c=>c.role===0||c.role===1).length+"/2 crew").slice(0,100);return{label,value:s.id,description:desc};});
 const key="sticky_crew_session:"+discordId;
 await getDb().insert(appSettings).values({key,value:{aircraftIds:values,scheduleIds:[],seat:""},updatedAt:new Date()}).onConflictDoUpdate({target:appSettings.key,set:{value:{aircraftIds:values,scheduleIds:[],seat:""},updatedAt:new Date()}});
 const summary=legs.slice(0,18).map(s=>{const a=aircraft.find(x=>x.id===s.aircraftId);const captain=(s.crew||[]).some(x=>x.role===0),fo=(s.crew||[]).some(x=>x.role===1);const when=s.isTimeless?"Anytime":s.scheduledDepartureUtc?new Date(s.scheduledDepartureUtc).toISOString().replace("T"," ").slice(0,16)+" UTC":"Time TBD";return `**${s.callsign} · ${a?.registration||"Aircraft"}** — ${s.originIcao} → ${s.destinationIcao}\nCaptain: ${captain?"Assigned":"Open"} · First Officer: ${fo?"Assigned":"Open"} · ${when}`;}).join("\n\n");
 return {flags:32768|64,allowed_mentions:{parse:[]},components:[
  {type:10,content:"# Your Sticky Crew selection\nChoose one or more live schedules from the aircraft you selected.\n\n"+summary+(legs.length>18?"\n\n…and more schedules are available in the selector.":"")},
  {type:1,components:[{type:3,custom_id:"sticky:schedules",placeholder:"Choose schedules…",min_values:1,max_values:Math.max(1,Math.min(25,options.length)),options}]},
  {type:1,components:[{type:3,custom_id:"sticky:seat",placeholder:"Choose your crew seat…",min_values:1,max_values:1,options:[{label:"Captain",value:"captain",description:"Request the Captain seat"},{label:"First Officer",value:"first_officer",description:"Request the First Officer seat"}]}]},
  {type:1,components:[{type:2,style:3,label:"Submit crew requests",custom_id:"sticky:confirm"}]}
 ]};
}
export async function stickyCrewScheduleSelection(discordId:string,values:string[]){
 const key="sticky_crew_session:"+discordId;const [row]=await getDb().select().from(appSettings).where(eq(appSettings.key,key)).limit(1);if(!row)throw new Error("Your Sticky Crew selection expired. Start again from the panel.");
 const state=row.value as {aircraftIds?:string[];scheduleIds?:string[];seat?:string};
 await getDb().update(appSettings).set({value:{...state,scheduleIds:values},updatedAt:new Date()}).where(eq(appSettings.key,key));
 return{flags:32768|64,components:[{type:10,content:`**${values.length} schedule(s) selected.** Choose your seat, then submit your requests.`},{type:1,components:[{type:3,custom_id:"sticky:seat",placeholder:"Choose your crew seat…",min_values:1,max_values:1,options:[{label:"Captain",value:"captain"},{label:"First Officer",value:"first_officer"}]}]},{type:1,components:[{type:2,style:3,label:"Submit crew requests",custom_id:"sticky:confirm"}]}]};
}
export async function stickyCrewSeatSelection(discordId:string,seat:string){
 if(seat!=="captain"&&seat!=="first_officer")throw new Error("Choose a valid crew seat.");
 const key="sticky_crew_session:"+discordId;const [row]=await getDb().select().from(appSettings).where(eq(appSettings.key,key)).limit(1);if(!row)throw new Error("Your Sticky Crew selection expired. Start again from the panel.");
 const state=row.value as {aircraftIds?:string[];scheduleIds?:string[]};
 await getDb().update(appSettings).set({value:{...state,seat},updatedAt:new Date()}).where(eq(appSettings.key,key));
 return{flags:32768|64,components:[{type:10,content:`Seat selected: **${seat==="captain"?"Captain":"First Officer"}**. Press submit to create the crew requests.`},{type:1,components:[{type:2,style:3,label:"Submit crew requests",custom_id:"sticky:confirm"}]}]};
}
export async function submitStickyCrewRequests(discordId:string,operator:IFSession){
 const db=getDb();const key="sticky_crew_session:"+discordId;const [stateRow]=await db.select().from(appSettings).where(eq(appSettings.key,key)).limit(1);
 if(!stateRow)throw new Error("Your Sticky Crew selection expired. Start again from the panel.");
 const state=stateRow.value as {scheduleIds?:string[];seat?:string};
 if(!state.scheduleIds?.length||!["captain","first_officer"].includes(state.seat||""))throw new Error("Select at least one schedule and a crew seat first.");
 const [pilot]=await db.select().from(appUsers).where(eq(appUsers.discordUserId,discordId)).limit(1);
 if(!pilot?.onboardingCompletedAt||!pilot.discordUserId)throw new Error("Link your Infinite Flight and Discord accounts in Live Dock before requesting a flight.");
 const [cfg]=await db.select().from(discordIntegrations).where(eq(discordIntegrations.id,"virtual-blue")).limit(1);
 if(!cfg?.crewRequestsChannelId)throw new Error("Crew Requests channel is not configured.");
 const [raw,aircraftRaw]=await Promise.all([
  ifFetch<Schedule[]|{items?:Schedule[]}>(`/live/organizations/${ORGANIZATION_ID}/schedules?page=1&pageSize=100`,operator),
  ifFetch<Aircraft[]>(`/live/organizations/${ORGANIZATION_ID}/aircraft`,operator)
 ]);
 const schedules=Array.isArray(raw)?raw:raw.items||[];
 const created:string[]=[];const errors:string[]=[];
 for(const scheduleId of state.scheduleIds){
  const schedule=schedules.find(s=>s.id===scheduleId);
  if(!schedule||!REQUESTABLE.includes(schedule.status)){errors.push(scheduleId+": schedule unavailable");continue;}
  const role=state.seat==="captain"?0:1;
  if((schedule.crew||[]).some(c=>c.role===role)){errors.push(schedule.callsign+": seat already assigned");continue;}
  const [pending]=await db.select({id:crewRequests.id}).from(crewRequests).where(and(eq(crewRequests.scheduleId,scheduleId),eq(crewRequests.seat,state.seat!),inArray(crewRequests.status,["pending","processing","approved"]))).limit(1);
  if(pending){errors.push(schedule.callsign+": request already exists");continue;}
  const id=randomUUID();
  try{await db.insert(crewRequests).values({id,scheduleId,aircraftId:schedule.aircraftId,pilotIfcUserId:pilot.ifcUserId,seat:state.seat!,status:"pending"});}catch{errors.push(schedule.callsign+": seat has a pending request");continue;}
  const aircraft=(aircraftRaw||[]).find(a=>a.id===schedule.aircraftId);
  const departure=schedule.isTimeless?"**Anytime**":schedule.scheduledDepartureUtc?`<t:${Math.floor(new Date(schedule.scheduledDepartureUtc).getTime()/1000)}:F>`:"**Anytime**";
  try{const {crewRequestMessage,sendDiscordMessage}=await import("@/lib/discord/components");const sent=await sendDiscordMessage(cfg.crewRequestsChannelId,crewRequestMessage({discordUserId:pilot.discordUserId,pilot:pilot.ifcUsername||"Infinite Flight pilot",requestId:id,registration:aircraft?.registration||"Aircraft",role:state.seat==="captain"?"Captain":"First Officer",origin:schedule.originIcao,destination:schedule.destinationIcao,departure}));await db.update(crewRequests).set({discordMessageId:sent.id}).where(eq(crewRequests.id,id));created.push(schedule.callsign);}catch{await db.update(crewRequests).set({status:"failed",failureCode:"discord_delivery_failed"}).where(eq(crewRequests.id,id));errors.push(schedule.callsign+": Discord delivery failed");}
 }
 await publishStickyCrewPanel(operator);
 await db.delete(appSettings).where(eq(appSettings.key,key));
 return {created,errors};
}
