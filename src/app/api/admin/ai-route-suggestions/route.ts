import { NextResponse } from "next/server";
import { ifFetch,requireIFSession,requireOrganizationAdmin } from "@/lib/infinite-flight/server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Airport={icao?:string;icaoCode?:string;code?:string;name?:string;latitude?:number;longitude?:number;location?:{latitude?:number;longitude?:number}};
type ModelSuggestion={callsign?:unknown;flightType?:unknown;originIcao?:unknown;destinationIcao?:unknown};
function airportsFrom(value:unknown):Airport[]{if(Array.isArray(value))return value as Airport[];if(value&&typeof value==="object"){const v=value as {items?:unknown[];airports?:unknown[]};if(Array.isArray(v.items))return v.items as Airport[];if(Array.isArray(v.airports))return v.airports as Airport[];}return [];}
const model=process.env.GROQ_MODEL||"openai/gpt-oss-120b";
export async function POST(request:Request){
 try{
  const {session}=await requireIFSession();await requireOrganizationAdmin(session);
  if(!process.env.GROQ_API_KEY)return NextResponse.json({error:"Groq is not configured. Add GROQ_API_KEY to the server environment and redeploy."},{status:503});
  const body=await request.json().catch(()=>({})) as {airline?:unknown};
  const airline=typeof body.airline==="string"?body.airline.trim().slice(0,48):"";
  if(!/^[A-Za-z0-9 .&'-]{2,48}$/.test(airline))return NextResponse.json({error:"Enter a valid airline name."},{status:400});
  const raw=airportsFrom(await ifFetch<unknown>("/airports",session));
  const airportMap=new Map<string,Airport>();
  for(const a of raw){const code=String(a.icao||a.icaoCode||a.code||"").toUpperCase(),lat=Number(a.latitude??a.location?.latitude),lon=Number(a.longitude??a.location?.longitude);if(/^[A-Z]{4}$/.test(code)&&Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lon)&&Math.abs(lon)<=180)airportMap.set(code,{...a,latitude:lat,longitude:lon});}
  if(!airportMap.size)return NextResponse.json({error:"Infinite Flight airport reference data is unavailable. Refresh the workspace and retry."},{status:503});
  const instructions="You are a commercial airline network planner. Use browser search to verify current scheduled passenger routes operated by "+airline+" using reliable sources, prioritising the airline's official route map, timetable or booking pages. Generate exactly three distinct real-world routes the airline currently operates. Do not suggest historical, announced-only, seasonal-unverified or fictional services. Find an actual published flight number for each route where possible. The callsign property is the airline FLIGHT NUMBER, not a radio callsign. For JetBlue, use the B6 IATA designator followed by the published flight digits. flightType is always 1 (Commercial). Use four-letter ICAO airport identifiers, not IATA codes. Output ONLY one JSON object with this exact schema: {\"suggestions\":[{\"callsign\":\"B6421\",\"flightType\":1,\"originIcao\":\"KJFK\",\"destinationIcao\":\"KLAX\"},{\"callsign\":\"B6123\",\"flightType\":1,\"originIcao\":\"KBOS\",\"destinationIcao\":\"KFLL\"},{\"callsign\":\"B6456\",\"flightType\":1,\"originIcao\":\"KJFK\",\"destinationIcao\":\"KSJU\"}]}. Exactly three distinct suggestions. No markdown, no code fence, no commentary.";
  const response=await fetch("https://api.groq.com/openai/v1/responses",{method:"POST",headers:{"Authorization":"Bearer "+process.env.GROQ_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({
   model,
   instructions,
   input:"Search the web to verify current "+airline+" scheduled passenger services. Return exactly three distinct routes as the JSON object described in the instructions.",
   tools:[{type:"browser_search"}],
   tool_choice:"required",
   max_output_tokens:2200
  }),cache:"no-store",signal:AbortSignal.timeout(60000)});
  const result=await response.json().catch(()=>({})) as {output_text?:string;output?:Array<{type?:string;content?:Array<{type?:string;text?:string}>}>;error?:{message?:string}};
  if(!response.ok)return NextResponse.json({error:result.error?.message||"Groq returned HTTP "+response.status+"."},{status:response.status===429?429:502});
  const rawContent=result.output_text||result.output?.filter(x=>x.type==="message").flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text;
  if(!rawContent)return NextResponse.json({error:"Groq returned an empty response. Please try again."},{status:502});
  const jsonStart=rawContent.indexOf("{"),jsonEnd=rawContent.lastIndexOf("}");
  if(jsonStart<0||jsonEnd<=jsonStart)return NextResponse.json({error:"Groq did not return a JSON object. Please regenerate."},{status:502});
  let parsed:{suggestions?:ModelSuggestion[]};try{parsed=JSON.parse(rawContent.slice(jsonStart,jsonEnd+1)) as {suggestions?:ModelSuggestion[]};}catch{return NextResponse.json({error:"Groq returned invalid JSON. Please regenerate."},{status:502});}
  if(!Array.isArray(parsed.suggestions)||parsed.suggestions.length!==3)return NextResponse.json({error:"Groq must return exactly three suggestions. Please regenerate."},{status:502});
  const seen=new Set<string>(),routes=new Set<string>();
  const suggestions=parsed.suggestions.map(item=>{
   const callsign=typeof item.callsign==="string"?item.callsign.trim().toUpperCase().replace(/\s+/g,""):"";
   const origin=typeof item.originIcao==="string"?item.originIcao.trim().toUpperCase():"",destination=typeof item.destinationIcao==="string"?item.destinationIcao.trim().toUpperCase():"";
   if(!/^[A-Z0-9]{2,10}$/.test(callsign)||seen.has(callsign))throw new Error("Groq returned a missing or duplicate flight number.");
   if(airline.toLowerCase()==="jetblue"&&!/^B6\d{1,4}$/.test(callsign))throw new Error("JetBlue flight numbers must use the B6 airline designator followed by digits. Please regenerate.");
   if(!/^[A-Z]{4}$/.test(origin)||!/^[A-Z]{4}$/.test(destination)||origin===destination)throw new Error("Groq returned an invalid airport pair.");
   const pair=origin+"-"+destination;if(routes.has(pair))throw new Error("Groq returned a duplicate route. Please regenerate.");routes.add(pair);
   const from=airportMap.get(origin),to=airportMap.get(destination);if(!from||!to)throw new Error("Groq suggested "+pair+", but an airport is not present in Infinite Flight's airport reference data.");
   seen.add(callsign);
   const point=(code:string,a:Airport)=>({name:code,identifier:code,location:{latitude:Number(a.latitude),longitude:Number(a.longitude)}});
   return {callsign,flightType:1,originIcao:origin,destinationIcao:destination,flightPlan:{flightPlanItems:[point(origin,from),point(destination,to)]}};
  });
  return NextResponse.json({suggestions},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to generate AI route suggestions."},{status:Number((error as {status?:number})?.status)||500,headers:{"Cache-Control":"no-store"}});}
}
