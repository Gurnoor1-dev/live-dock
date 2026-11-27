import "server-only";
import { createHash } from "node:crypto";
export type SimBriefWaypoint = { name: string; identifier: string; location: { latitude: number; longitude: number }; altitude?: number; isSidStar?: boolean; stage?: string; viaAirway?: string };
export type SimBriefData = {
 ofpId:string;callsign:string;airline:string;flightNumber:string;origin:string;destination:string;aircraftType:string;aircraftName:string;registration:string;route:string;alternate:string;departureTime:string;arrivalTime:string;enrouteTime:string;distance:string;cruiseAltitude:string;
 units:string;fuel:Record<string,string>;weights:Record<string,string>;weather:Record<string,string>;originMetar:string;destinationMetar:string;sidIdent:string;starIdent:string;navlog:SimBriefWaypoint[];pdfUrl:string;
};
const decode=(s:string)=>s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
function tag(xml:string,name:string,scope=xml):string {const m=scope.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+name+">","i"));return m?decode(m[1].replace(/<[^>]+>/g,"").trim()):"";}
function section(xml:string,name:string):string{return xml.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+name+">","i"))?.[1]||"";}
export function parseSimBriefXml(xml:string,ofpId:string):SimBriefData {
 if(!xml.includes("<OFP")&&!xml.includes("<ofp"))throw new Error("SimBrief returned an unexpected OFP document.");
 const general=section(xml,"general"),origin=section(xml,"origin"),destination=section(xml,"destination"),aircraft=section(xml,"aircraft"),fuel=section(xml,"fuel"),weights=section(xml,"weights"),weather=section(xml,"weather"),times=section(xml,"times"),params=section(xml,"params"),nav=section(xml,"navlog");
 const navlog:SimBriefWaypoint[]=[];
 const blocks=[...nav.matchAll(/<(?:fix|point|waypoint)(?:\s[^>]*)?>([\s\S]*?)<\/(?:fix|point|waypoint)>/gi)];
 for(const m of blocks){const b=m[1],name=tag(b,"name")||tag(b,"ident")||tag(b,"identifier"),lat=Number(tag(b,"pos_lat")||tag(b,"lat")),lon=Number(tag(b,"pos_long")||tag(b,"lon")),altitude=Number(tag(b,"altitude_feet")||tag(b,"altitude"));if(name&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&!(lat===0&&lon===0))navlog.push({name,identifier:tag(b,"ident")||name,location:{latitude:lat,longitude:lon},altitude:Number.isFinite(altitude)&&altitude>0?altitude:undefined,isSidStar:/^(1|true|yes)$/i.test(tag(b,"is_sid_star")),stage:tag(b,"stage").toUpperCase(),viaAirway:tag(b,"via_airway").trim()});}
 const originCode=tag(origin,"icao_code")||tag(origin,"icao"),destinationCode=tag(destination,"icao_code")||tag(destination,"icao");
 const originLat=Number(tag(origin,"pos_lat")),originLon=Number(tag(origin,"pos_long")),destinationLat=Number(tag(destination,"pos_lat")),destinationLon=Number(tag(destination,"pos_long"));
 const validPoint=(lat:number,lon:number)=>Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&!(lat===0&&lon===0);
 if(originCode&&validPoint(originLat,originLon)&&navlog[0]?.identifier!==originCode)navlog.unshift({name:originCode,identifier:originCode,location:{latitude:originLat,longitude:originLon}});
 if(destinationCode&&validPoint(destinationLat,destinationLon)&&navlog[navlog.length-1]?.identifier!==destinationCode)navlog.push({name:destinationCode,identifier:destinationCode,location:{latitude:destinationLat,longitude:destinationLon}});
 const first=(scope:string,...keys:string[])=>{for(const key of keys){const value=tag(scope,key);if(value)return value;}return "";};
 const windDirection=first(general,"avg_wind_dir"),windSpeed=first(general,"avg_wind_spd");
 const averageWind=windDirection&&windSpeed?windDirection+"° / "+windSpeed+" kt":first(general,"avg_wind");
 const duration=first(times,"est_time_enroute","ete")||first(general,"ete");
 const durationSeconds=Number(duration);
 const enrouteTime=duration&&Number.isFinite(durationSeconds)&&/^\\d+(?:\\.\\d+)?$/.test(duration)?[Math.floor(durationSeconds/3600),Math.floor(durationSeconds%3600/60)].map(v=>String(v).padStart(2,"0")).join(":"):duration;
 return {ofpId,callsign:(tag(general,"icao_airline")&&tag(general,"flight_number"))?tag(general,"icao_airline")+tag(general,"flight_number"):tag(general,"callsign"),airline:tag(general,"icao_airline"),flightNumber:tag(general,"flight_number"),
 origin:originCode,destination:destinationCode,aircraftType:tag(aircraft,"icaocode")||tag(aircraft,"icaotype"),aircraftName:tag(aircraft,"name")||tag(aircraft,"icaotype"),registration:tag(aircraft,"reg"),route:tag(general,"route"),alternate:tag(section(xml,"alternate"),"icao_code")||tag(section(xml,"alternate"),"icao"),
 departureTime:first(times,"est_out","sched_out")||first(general,"sched_out","orig_time"),arrivalTime:first(times,"est_in","sched_in")||first(general,"sched_in","dest_time"),enrouteTime,distance:first(general,"route_distance","distance","gc_distance"),cruiseAltitude:first(general,"initial_altitude","cruise_altitude"),
 units:first(params,"units")||"kgs",fuel:{ramp:first(fuel,"plan_ramp"),takeoff:first(fuel,"plan_takeoff"),landing:first(fuel,"plan_landing"),trip:first(fuel,"enroute_burn","plan_flt"),contingency:first(fuel,"contingency","plan_contingency"),taxi:first(fuel,"taxi","plan_taxi"),alternate:first(fuel,"alternate_burn","plan_alternate"),reserve:first(fuel,"reserve","plan_reserve")},weights:{oew:first(weights,"oew"),zfw:first(weights,"est_zfw","zfw"),tow:first(weights,"est_tow","tow"),ldw:first(weights,"est_ldw","ldw"),mzfw:first(weights,"mzfw"),mtow:first(weights,"mtow"),mlw:first(weights,"mlw"),payload:first(weights,"payload")},weather:{avg_wind:averageWind,avg_temp:first(general,"avg_temp")||first(weather,"avg_temp"),avg_trop:first(general,"avg_trop"),isa_dev:first(general,"isa_dev")},
 originMetar:tag(origin,"metar"),destinationMetar:tag(destination,"metar"),sidIdent:tag(general,"sid_ident")||tag(general,"sid"),starIdent:tag(general,"star_ident")||tag(general,"star"),navlog,pdfUrl:"https://www.simbrief.com/ofp/flightplans/"+encodeURIComponent(ofpId)+".pdf"};
}
export type IFFlightPlanItem = {
 name:string;
 type:number;
 children:IFFlightPlanItem[]|null;
 identifier:string;
 altitude:number;
 location:{latitude:number;longitude:number;altitude:number};
};
export type IFStructuredFlightPlan = {flightPlanItems:IFFlightPlanItem[]};
const IF_SID=0,IF_STAR=1;
function normalizedIdent(value:string|undefined):string{return (value||"").trim().toUpperCase();}
function toIFWaypoint(point:SimBriefWaypoint):IFFlightPlanItem {
 const identifier=normalizedIdent(point.identifier||point.name);
 return {name:(point.name||identifier).trim(),type:0,children:null,identifier,altitude:Number.isFinite(point.altitude)&&Number(point.altitude)>0?Math.round(Number(point.altitude)):-1,location:{latitude:point.location.latitude,longitude:point.location.longitude,altitude:0}};
}
export function buildSimBriefFlightPlan(data:SimBriefData):IFStructuredFlightPlan {
 const origin=normalizedIdent(data.origin),destination=normalizedIdent(data.destination);
 if(!origin||!destination)throw new Error("The SimBrief XML is missing the origin or destination.");
 const valid=(point:SimBriefWaypoint)=>!!point&&!!point.location&&Number.isFinite(point.location.latitude)&&Number.isFinite(point.location.longitude)&&Math.abs(point.location.latitude)<=90&&Math.abs(point.location.longitude)<=180&&!(point.location.latitude===0&&point.location.longitude===0)&&!!normalizedIdent(point.identifier||point.name);
 const source=data.navlog.filter(valid);
 if(!source.length)throw new Error("SimBrief did not provide coordinate-based navigation log waypoints.");
 if(normalizedIdent(source[0].identifier||source[0].name)!==origin)throw new Error("SimBrief's navigation log is missing coordinates for origin "+origin+". The structured flight plan cannot be sent without airport coordinates.");
 if(normalizedIdent(source[source.length-1].identifier||source[source.length-1].name)!==destination)throw new Error("SimBrief's navigation log is missing coordinates for destination "+destination+". The structured flight plan cannot be sent without airport coordinates.");
 const sid=normalizedIdent(data.sidIdent),star=normalizedIdent(data.starIdent);
 // SimBrief marks navlog fixes that belong to SID/STAR procedures. Its final
 // procedure fix can be unmarked, so only marked contiguous endpoint runs are
 // grouped; we never guess by swallowing ordinary en-route fixes.
 let sidEnd=-1;
 if(sid){for(let i=1;i<source.length-1&&(source[i].isSidStar||normalizedIdent(source[i].viaAirway)===sid);i++)sidEnd=i;}
 let starStart=source.length;
 if(star){for(let i=source.length-2;i>0&&(source[i].isSidStar||normalizedIdent(source[i].viaAirway)===star);i--)starStart=i;}
 // Do not allow overlapping groups to consume the whole route or each other.
 if(sidEnd>=starStart){sidEnd=-1;starStart=source.length;}
 const grouped=new Set<number>();
 const items:IFFlightPlanItem[]=[];
 const addProcedure=(ident:string,type:number,points:SimBriefWaypoint[])=>{
  const children=points.map(toIFWaypoint);
  if(!ident||!children.length)return;
  const first=children[0];
  items.push({name:ident,type,children,identifier:ident,altitude:-1,location:{...first.location}});
 };
 if(sidEnd>=1){
  const children=source.slice(1,sidEnd+1);
  addProcedure(sid,IF_SID,children);
  for(let i=1;i<=sidEnd;i++)grouped.add(i);
 }
 for(let i=0;i<source.length;i++){
  if(grouped.has(i))continue;
  if(i===starStart&&starStart<source.length-1){
   const children=source.slice(starStart,source.length-1);
   addProcedure(star,IF_STAR,children);
   for(let j=starStart;j<source.length-1;j++)grouped.add(j);
  }
  if(grouped.has(i))continue;
  items.push(toIFWaypoint(source[i]));
 }
 if(items.length<2)throw new Error("The SimBrief navigation log does not contain enough flight-plan items.");
 if(items.length>500)throw new Error("The generated flight plan exceeds Infinite Flight's 500 top-level item limit.");
 const plan:IFStructuredFlightPlan={flightPlanItems:items};
 if(JSON.stringify(plan).length>16000)throw new Error("The generated flight plan exceeds Infinite Flight's 16,000-character limit. Reduce the route detail in SimBrief and dispatch again.");
 return plan;
}
export function isSimBriefFlightPlanSynced(actual:unknown,expected:IFStructuredFlightPlan):boolean {
 let value:unknown=actual;
 if(typeof value==="string"){try{value=JSON.parse(value);}catch{return false;}}
 if(!value||typeof value!=="object")return false;
 const items=(value as {flightPlanItems?:unknown}).flightPlanItems;
 if(!Array.isArray(items))return false;
 const signature=(entries:unknown[]):string[]=>entries.map(raw=>{
  if(!raw||typeof raw!=="object")return "invalid";
  const item=raw as Partial<IFFlightPlanItem>;
  const id=normalizedIdent(item.identifier||item.name);
  const location=item.location;
  const coords=location&&Number.isFinite(location.latitude)&&Number.isFinite(location.longitude)
   ?Number(location.latitude).toFixed(5)+"|"+Number(location.longitude).toFixed(5):"no-location";
  const children=Array.isArray(item.children)?signature(item.children):[];
  return [id,String(Number(item.type??0)),coords,children.join("~")].join("|");
 });
 const left=signature(items),right=signature(expected.flightPlanItems);
 return left.length===right.length&&left.every((item,index)=>item===right[index]);
}
export function simBriefOFPId(orig:string,dest:string,type:string,timestamp:string):string {
 return timestamp+"_"+createHash("md5").update(orig+dest+type).digest("hex").toUpperCase().slice(0,10);
}
export function simBriefSignature(orig:string,dest:string,type:string,timestamp:string,outputPage:string):string {
 const key=process.env.SIMBRIEF_API_KEY;if(!key)throw new Error("SIMBRIEF_API_KEY is not configured in the server environment.");
 return createHash("md5").update(key+orig+dest+type+timestamp+outputPage).digest("hex");
}
export async function fetchSimBriefOFP(ofpId:string):Promise<string>{
 if(!/^\d{10}_[A-Za-z0-9]{10}$/.test(ofpId))throw new Error("Invalid SimBrief OFP identifier.");
 const url="https://www.simbrief.com/ofp/flightplans/xml/"+encodeURIComponent(ofpId)+".xml";
 let lastStatus=0;
 for(let attempt=0;attempt<8;attempt++){
  const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(8000)});
  if(response.ok){const xml=await response.text();if(xml.length>8000000)throw new Error("SimBrief OFP is larger than the supported size.");return xml;}
  lastStatus=response.status;
  if(response.status!==404&&response.status!==503)throw new Error("SimBrief could not return the OFP (HTTP "+response.status+").");
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw new Error("SimBrief has not published this OFP yet (HTTP "+lastStatus+"). Please wait a moment and open the dispatch again.");
}