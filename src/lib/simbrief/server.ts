import "server-only";
import { createHash } from "node:crypto";
export type SimBriefWaypoint = { name: string; identifier: string; location: { latitude: number; longitude: number }; altitude?: number };
export type SimBriefData = {
 ofpId:string;callsign:string;airline:string;flightNumber:string;origin:string;destination:string;aircraftType:string;aircraftName:string;registration:string;route:string;alternate:string;departureTime:string;arrivalTime:string;enrouteTime:string;distance:string;cruiseAltitude:string;
 fuel:Record<string,string>;weights:Record<string,string>;weather:Record<string,string>;originMetar:string;destinationMetar:string;navlog:SimBriefWaypoint[];pdfUrl:string;
};
const decode=(s:string)=>s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
function tag(xml:string,name:string,scope=xml):string {const m=scope.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+name+">","i"));return m?decode(m[1].replace(/<[^>]+>/g,"").trim()):"";}
function section(xml:string,name:string):string{return xml.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+name+">","i"))?.[1]||"";}
export function parseSimBriefXml(xml:string,ofpId:string):SimBriefData {
 if(!xml.includes("<OFP")&&!xml.includes("<ofp"))throw new Error("SimBrief returned an unexpected OFP document.");
 const general=section(xml,"general"),origin=section(xml,"origin"),destination=section(xml,"destination"),aircraft=section(xml,"aircraft"),fuel=section(xml,"fuel"),weights=section(xml,"weights"),weather=section(xml,"weather"),nav=section(xml,"navlog");
 const navlog:SimBriefWaypoint[]=[];
 const blocks=[...nav.matchAll(/<(?:fix|point|waypoint)(?:\s[^>]*)?>([\s\S]*?)<\/(?:fix|point|waypoint)>/gi)];
 for(const m of blocks){const b=m[1],name=tag(b,"name")||tag(b,"ident")||tag(b,"identifier"),lat=Number(tag(b,"pos_lat")||tag(b,"lat")),lon=Number(tag(b,"pos_long")||tag(b,"lon"));if(name&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&!(lat===0&&lon===0))navlog.push({name,identifier:tag(b,"ident")||name,location:{latitude:lat,longitude:lon},altitude:Number(tag(b,"altitude_feet")||tag(b,"altitude"))||undefined});}
 const originCode=tag(origin,"icao_code")||tag(origin,"icao"),destinationCode=tag(destination,"icao_code")||tag(destination,"icao");
 const originLat=Number(tag(origin,"pos_lat")),originLon=Number(tag(origin,"pos_long")),destinationLat=Number(tag(destination,"pos_lat")),destinationLon=Number(tag(destination,"pos_long"));
 const validPoint=(lat:number,lon:number)=>Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&!(lat===0&&lon===0);
 if(originCode&&validPoint(originLat,originLon)&&navlog[0]?.identifier!==originCode)navlog.unshift({name:originCode,identifier:originCode,location:{latitude:originLat,longitude:originLon}});
 if(destinationCode&&validPoint(destinationLat,destinationLon)&&navlog[navlog.length-1]?.identifier!==destinationCode)navlog.push({name:destinationCode,identifier:destinationCode,location:{latitude:destinationLat,longitude:destinationLon}});
 const collect=(scope:string,keys:string[])=>Object.fromEntries(keys.map(k=>[k.replace(/^plan_/,""),tag(scope,k)]).filter(x=>x[1]));
 return {ofpId,callsign:(tag(general,"icao_airline")&&tag(general,"flight_number"))?tag(general,"icao_airline")+tag(general,"flight_number"):tag(general,"callsign"),airline:tag(general,"icao_airline"),flightNumber:tag(general,"flight_number"),
 origin:originCode,destination:destinationCode,aircraftType:tag(aircraft,"icaocode")||tag(aircraft,"icaotype"),aircraftName:tag(aircraft,"name")||tag(aircraft,"icaotype"),registration:tag(aircraft,"reg"),route:tag(general,"route"),alternate:tag(section(xml,"alternate"),"icao_code")||tag(section(xml,"alternate"),"icao"),
 departureTime:tag(general,"sched_out")||tag(general,"orig_time"),arrivalTime:tag(general,"sched_in")||tag(general,"dest_time"),enrouteTime:tag(general,"ete"),distance:tag(general,"distance"),cruiseAltitude:tag(general,"initial_altitude")||tag(general,"cruise_altitude"),
 fuel:collect(fuel,["plan_ramp","plan_takeoff","plan_landing","plan_min","plan_flt","plan_taxi","plan_alternate","plan_reserve","plan_contingency"]),weights:collect(weights,["oew","mzfw","mtow","mlw","zfw","tow","ldw","payload"]),weather:collect(weather,["avg_wind","avg_temp","avg_trop","isa_dev"]),
 originMetar:tag(origin,"metar"),destinationMetar:tag(destination,"metar"),navlog,pdfUrl:"https://www.simbrief.com/ofp/flightplans/"+encodeURIComponent(ofpId)+".pdf"};
}
export type IFFlightPlanItem = {
 name:string;
 identifier:string;
 location:{latitude:number;longitude:number};
};
export type IFStructuredFlightPlan = {flightPlanItems:IFFlightPlanItem[]};
export function buildSimBriefFlightPlan(data:SimBriefData):IFStructuredFlightPlan {
 const origin=data.origin.trim().toUpperCase(),destination=data.destination.trim().toUpperCase();
 if(!origin||!destination)throw new Error("The SimBrief XML is missing the origin or destination.");
 const valid=(point:SimBriefWaypoint)=>Number.isFinite(point.location?.latitude)&&Number.isFinite(point.location?.longitude)&&Math.abs(point.location.latitude)<=90&&Math.abs(point.location.longitude)<=180&&!(point.location.latitude===0&&point.location.longitude===0);
 const source=data.navlog.filter(valid);
 const items:IFFlightPlanItem[]=[];
 const add=(point:SimBriefWaypoint)=>{const identifier=(point.identifier||point.name).trim().toUpperCase();if(!identifier)return;if(items[items.length-1]?.identifier===identifier)return;items.push({name:(point.name||identifier).trim(),identifier,location:{latitude:point.location.latitude,longitude:point.location.longitude}});};
 for(const point of source)add(point);
 if(items[0]?.identifier!==origin)throw new Error("SimBrief's navigation log is missing coordinates for origin "+origin+". The structured flight plan cannot be sent without airport coordinates.");
 if(items[items.length-1]?.identifier!==destination)throw new Error("SimBrief's navigation log is missing coordinates for destination "+destination+". The structured flight plan cannot be sent without airport coordinates.");
 if(items.length<2)throw new Error("The SimBrief navigation log does not contain enough coordinate-based waypoints to build a flight plan.");
 return {flightPlanItems:items};
}
export function isSimBriefFlightPlanSynced(actual:unknown,expected:IFStructuredFlightPlan):boolean {
 let value:unknown=actual;
 // Live API v3 serializes Schedule.flightPlan as a JSON string in Schedule responses.
 if(typeof value==="string"){try{value=JSON.parse(value);}catch{return false;}}
 if(!value||typeof value!=="object")return false;
 const items=(value as {flightPlanItems?:unknown}).flightPlanItems;
 if(!Array.isArray(items))return false;
 const normalize=(entries:unknown[])=>entries.map(item=>{if(!item||typeof item!=="object")return "";const p=item as IFFlightPlanItem;return [String(p.identifier||p.name||"").trim().toUpperCase(),Number(p.location?.latitude).toFixed(5),Number(p.location?.longitude).toFixed(5)].join("|");});
 const left=normalize(items),right=normalize(expected.flightPlanItems);
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