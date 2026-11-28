"use client";
import { useMemo,useState } from "react";
import { Check,Clock3,LoaderCircle,Plane,Sparkles,X } from "lucide-react";
import { RouteMap } from "@/components/dispatch/route-map";
import type { SimBriefWaypoint } from "@/lib/simbrief/server";
import styles from "./ai-route-suggestions.module.css";

type Airport={icao?:string;icaoCode?:string;code?:string;name?:string;latitude?:number;longitude?:number;location?:{latitude?:number;longitude?:number}};
type Aircraft={id:string;aircraftId:string;registration:string;visibility:number;status:number;isFleetActiveSlot:boolean};
type AircraftType={id:string;name:string};
type Point={name:string;identifier:string;location:{latitude:number;longitude:number}};
type Suggestion={callsign:string;flightType:number;originIcao:string;destinationIcao:string;flightPlan:{flightPlanItems:Point[]}};
type Props={airline:string;aircraft:Aircraft[];aircraftTypes:AircraftType[];airports:Airport[];onCreated:()=>Promise<void>};
const localDateTime=(date:Date)=>{const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);return local.toISOString().slice(0,16);};
const distanceKm=(a:Point["location"],b:Point["location"])=>{const r=(n:number)=>n*Math.PI/180,dl=r(b.latitude-a.latitude),dn=r(b.longitude-a.longitude),v=Math.sin(dl/2)**2+Math.cos(r(a.latitude))*Math.cos(r(b.latitude))*Math.sin(dn/2)**2;return 6371*2*Math.atan2(Math.sqrt(v),Math.sqrt(1-v));};
async function ifRequest(path:string,init:RequestInit){const response=await fetch("/api/if"+path,{...init,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",...(init.headers||{})}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error_description||data.error||data.message||"Infinite Flight returned HTTP "+response.status+".");if(data.errorCode&&data.errorCode!==0)throw new Error(data.message||"Infinite Flight API error "+data.errorCode+".");return data.result;}

export function AIRouteSuggestions({airline,aircraft,aircraftTypes,airports,onCreated}:Props){
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[publishing,setPublishing]=useState(false);
 const [suggestions,setSuggestions]=useState<Suggestion[]>([]),[selected,setSelected]=useState<number[]>([]),[assigned,setAssigned]=useState<Record<number,string>>({});
 const [timeless,setTimeless]=useState(false),[departure,setDeparture]=useState(()=>localDateTime(new Date(Date.now()+86400000)));
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const airportMap=useMemo(()=>new Map(airports.map(a=>[String(a.icao||a.icaoCode||a.code||"").toUpperCase(),a])),[airports]);
 const activeAircraft=aircraft;
 const airportName=(icao:string)=>airportMap.get(icao)?.name||icao;
 const aircraftName=(id:string)=>{const a=aircraft.find(x=>x.id===id);return a?a.registration+" · "+(aircraftTypes.find(t=>t.id===a.aircraftId)?.name||"Aircraft"):"Select aircraft";};
 const metrics=(s:Suggestion)=>{const p=s.flightPlan.flightPlanItems,km=distanceKm(p[0].location,p[p.length-1].location),minutes=Math.max(60,Math.round(km/780*60+45));return{km,minutes};};
 const generate=async()=>{setLoading(true);setError("");setNotice("");setSuggestions([]);setSelected([]);try{
  const response=await fetch("/api/admin/ai-route-suggestions",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({airline})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not generate route suggestions.");
  if(!Array.isArray(data.suggestions)||data.suggestions.length!==3)throw new Error("The AI did not return exactly three valid suggestions. Try again.");
  setSuggestions(data.suggestions);setAssigned(Object.fromEntries(data.suggestions.map((_:Suggestion,i:number)=>[i,activeAircraft[0]?.id||""])));
  setNotice("Three "+airline+" route ideas are ready. Review each map and select the routes to publish.");
 }catch(e){setError(e instanceof Error?e.message:"Route generation failed.");}finally{setLoading(false);}};
 const toggle=(i:number)=>setSelected(v=>v.includes(i)?v.filter(x=>x!==i):[...v,i]);
 const publish=async()=>{if(!selected.length)return;if(selected.some(i=>!assigned[i])){setError("Assign an aircraft to every selected route.");return;}if(!timeless&&!departure){setError("Choose a departure date and time.");return;}
  setPublishing(true);setError("");setNotice("");const done:string[]=[],failed:string[]=[];
  for(const i of selected){const s=suggestions[i];try{
   const m=metrics(s),start=timeless?null:new Date(departure);if(!timeless&&(!start||Number.isNaN(start.getTime())))throw new Error("Invalid departure time.");
   const end=start?new Date(start.getTime()+m.minutes*60000):null;
   const payload={callsign:s.callsign,flightType:1,originIcao:s.originIcao,destinationIcao:s.destinationIcao,isTimeless:timeless,
    ...(start?{scheduledDepartureUtc:start.toISOString(),scheduledArrivalUtc:end!.toISOString()}:{}),
    briefing:airline+" scheduled passenger service · "+s.originIcao+" to "+s.destinationIcao+". AI-assisted route proposal; review operational details before flight."};
   const created=await ifRequest("/live/aircraft/"+assigned[i]+"/schedules",{method:"POST",body:JSON.stringify(payload)});
   const id=created?.id||created?.scheduleId;if(!id)throw new Error("Infinite Flight did not return a schedule ID.");
   await ifRequest("/live/schedules/"+id+"/flightplan",{method:"PUT",body:JSON.stringify({flightPlan:s.flightPlan})});
   done.push(s.callsign+" ("+s.originIcao+"–"+s.destinationIcao+")");
  }catch(e){failed.push(s.callsign+": "+(e instanceof Error?e.message:"creation failed"));}}
  setPublishing(false);
  if(done.length){setNotice("Created "+done.length+" schedule(s) in Infinite Flight: "+done.join(", ")+(failed.length?".":""));await onCreated();if(!failed.length){setSelected([]);setSuggestions([]);setOpen(false);}}
  if(failed.length)setError("Some schedules could not be completed: "+failed.join(" · "));
 };
 return <div className={styles.root}>
  <button type="button" className={styles.aiButton} onClick={()=>{setOpen(v=>!v);setError("");}} aria-expanded={open}><Sparkles size={15}/> AI</button>
  {open&&<div className={styles.backdrop} onMouseDown={e=>{if(e.target===e.currentTarget&&!publishing)setOpen(false);}}>
   <section className={styles.panel} role="dialog" aria-modal="true" aria-label={airline+" AI schedule planner"}>
    <header className={styles.header}><div className={styles.mark}><Sparkles size={19}/></div><div><small>GEMINI-POWERED SCHEDULE PLANNER</small><h3>{airline} route suggestions</h3><p>Generate three real-world airline route ideas with map previews.</p></div><button className={styles.close} onClick={()=>setOpen(false)} disabled={publishing} aria-label="Close"><X size={18}/></button></header>
    <div className={styles.toolbar}><span><i/> AIRLINE <b>{airline.toUpperCase()}</b></span><button className={styles.generate} onClick={()=>void generate()} disabled={loading||publishing}>{loading?<LoaderCircle className={styles.spin} size={15}/>:<Sparkles size={15}/>} {loading?"Generating…":suggestions.length?"Regenerate suggestions":"Generate 3 suggestions"}</button></div>
    {error&&<p className={styles.error} role="alert">{error}</p>}{notice&&<p className={styles.notice} role="status">{notice}</p>}
    {loading&&<div className={styles.loading}><LoaderCircle className={styles.spin} size={25}/><b>Planning {airline} routes</b><span>Matching real airport codes and building route previews…</span></div>}
    {suggestions.length>0&&<>
     <div className={styles.resultsHead}><div><b>Suggested routes</b><span>Choose any combination — up to all three.</span></div><strong>{selected.length} / 3 SELECTED</strong></div>
     <div className={styles.grid}>{suggestions.map((s,i)=>{const m=metrics(s),chosen=selected.includes(i),mapPoints=s.flightPlan.flightPlanItems as unknown as SimBriefWaypoint[];
      return <article className={chosen?styles.routeSelected:styles.route} key={s.callsign}>
       <div className={styles.routeHead}><span className={styles.index}>0{i+1}</span><div className={styles.routeTitle}><b>{s.callsign} <small>FLIGHT NUMBER</small></b><strong>{airportName(s.originIcao)} <i>→</i> {airportName(s.destinationIcao)}</strong><span>{s.originIcao} — {s.destinationIcao}</span></div><button className={chosen?styles.chosen:styles.choose} onClick={()=>toggle(i)}>{chosen?<><Check size={13}/> Selected</>:"Select"}</button></div>
       <div className={styles.map}><RouteMap points={mapPoints} origin={s.originIcao} destination={s.destinationIcao} position={null} theme="light"/></div>
       <div className={styles.metrics}><span><b>{Math.round(m.km).toLocaleString()} km</b><small>Distance</small></span><span><b>~{Math.floor(m.minutes/60)}h {m.minutes%60}m</b><small>Est. block time</small></span><span><b>Commercial</b><small>Flight type</small></span></div>
       {chosen&&<label className={styles.aircraft}>Aircraft assignment<select value={assigned[i]||""} onChange={e=>setAssigned(v=>({...v,[i]:e.target.value}))}><option value="">Choose aircraft</option>{activeAircraft.map(a=><option key={a.id} value={a.id}>{aircraftName(a.id)}</option>)}</select></label>}
      </article>;
     })}</div>
     {selected.length>0&&<div className={styles.scheduleBox}><div className={styles.scheduleHead}><b>Schedule timing</b><span>{selected.length} route(s) selected</span></div>
      <label className={styles.timeless}><span><b>Anytime schedule</b><small>Allow pilots to fly this leg at any time.</small></span><input type="checkbox" checked={timeless} onChange={e=>setTimeless(e.target.checked)}/></label>
      {!timeless&&<label className={styles.departure}>Departure date and time<input type="datetime-local" value={departure} onChange={e=>setDeparture(e.target.value)}/><small>Arrival time is estimated from route distance at a typical cruise speed. Adjust it later in Edit Schedules if needed.</small></label>}
      <button className={styles.publish} disabled={publishing||selected.some(i=>!assigned[i])} onClick={()=>void publish()}>{publishing?<LoaderCircle className={styles.spin} size={16}/>:<Plane size={16}/>} {publishing?"Creating schedules…":"Create "+selected.length+" schedule"+(selected.length===1?"":"s")+" in Infinite Flight"}</button>
      <p className={styles.disclaimer}>Route previews are great-circle airport-to-airport paths, not certified airways, dispatch releases or ATC clearances. Each schedule and structured flight plan is sent to Infinite Flight.</p>
     </div>}
    </>}
   </section>
  </div>}
 </div>;
}
