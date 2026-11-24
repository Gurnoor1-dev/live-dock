"use client";
import { useEffect,useMemo,useState } from "react";
import { ChevronDown,Users,ArrowRight } from "lucide-react";
import { Empty } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";
type SeatRequest={scheduleId:string;seat:"captain"|"first_officer";status:"pending"|"processing"|"approved"|"rejected"|"failed"};
type PositionLike={state:number;isOnGround:boolean;latitude:number;longitude:number;updatedAt?:string;airportIcao?:string;airportName?:string;lastPilotUsername?:string};
type ScheduleLike={aircraftId:string;status:number;sequence:number;callsign:string;originIcao:string;destinationIcao:string};
type Airport={icao?:string;icaoCode?:string;code?:string;name?:string;latitude?:number;longitude?:number;location?:{latitude?:number;longitude?:number}};
function airportDistance(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){const rad=(n:number)=>n*Math.PI/180;const dLat=rad(b.latitude-a.latitude),dLon=rad(b.longitude-a.longitude);const v=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(v),Math.sqrt(1-v));}
function aircraftState(position:PositionLike|undefined,aircraftId:string,schedules:ScheduleLike[],airports:Airport[]){
 const active=schedules.find(s=>s.aircraftId===aircraftId&&[2,3,4,6,7,8,10].includes(s.status));
 const arrived=schedules.filter(s=>s.aircraftId===aircraftId&&s.status===11).sort((a,b)=>b.sequence-a.sequence)[0];
 const next=schedules.filter(s=>s.aircraftId===aircraftId&&s.status===1).sort((a,b)=>a.sequence-b.sequence)[0];
 const flight=active?active.callsign+" · "+active.originIcao+" → "+active.destinationIcao:"active flight not identified";
 if(!position)return{label:"Status unavailable",tone:"unknown",detail:"Live position is not available"};
 const age=position.updatedAt?Date.now()-new Date(position.updatedAt).getTime():0;const stale=(position.state===1||position.state===4)&&age>18*60*60*1000;const reported=position.airportIcao?(position.airportIcao+(position.airportName?" · "+position.airportName:"")):null;const nearest=position.state===1||position.isOnGround?airports.map(a=>({icao:a.icao||a.icaoCode||a.code,name:a.name||a.icao||a.icaoCode||"Airport",latitude:Number(a.latitude??a.location?.latitude),longitude:Number(a.longitude??a.location?.longitude)})).filter(a=>a.icao&&Number.isFinite(a.latitude)&&Number.isFinite(a.longitude)).map(a=>({...a,distance:airportDistance(a,{latitude:position.latitude,longitude:position.longitude})})).sort((a,b)=>a.distance-b.distance)[0]:null;const airport=reported||(nearest&&nearest.distance<=15?nearest.icao+" · "+nearest.name:"airport not identified");if(stale)return{label:"Inactive · 18h+",tone:"inactive",detail:position.state===1?"On ground at "+airport+" for over 18 hours":"Stopped for over 18 hours · "+flight};if(position.state===1||(position.isOnGround&&position.state!==4))return{label:"On Ground",tone:"ground",detail:"Parked at "+airport};
 if(position.state===3)return{label:"Cancelled",tone:"unknown",detail:"Last flight was cancelled"};
 if(position.state===4)return{label:"Stopped",tone:"stopped",detail:"Stopped · "+flight};
 if(position.state===2)return{label:"In Flight",tone:"flight",detail:"Flying · "+flight};
 if(position.state===5)return{label:"Maintenance",tone:"maintenance",detail:"Aircraft in maintenance"};
 return{label:"Status unavailable",tone:"unknown",detail:"Live aircraft status unavailable"};
}
export function SchedulesPage(){
 const {active,aircraft,aircraftTypes,schedules,positions,dateTime}=useWorkspace();
 const [airports,setAirports]=useState<Airport[]>([]);
 useEffect(()=>{if(active!=="Schedules")return;let alive=true;fetch("/api/if/airports",{cache:"force-cache"}).then(async r=>{const d=await r.json();if(alive&&r.ok)setAirports(Array.isArray(d.result)?d.result:Array.isArray(d)?d:[])}).catch(()=>{});return()=>{alive=false};},[active]);
 const [expanded,setExpanded]=useState<string|null>(null);
 const [requests,setRequests]=useState<SeatRequest[]>([]);
 const [choice,setChoice]=useState<{scheduleId:string;seat:"captain"|"first_officer"}|null>(null);
 const [loading,setLoading]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
 useEffect(()=>{if(active!=="Schedules")return;let alive=true;const load=()=>fetch("/api/schedules/requests",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{if(alive&&d?.requests)setRequests(d.requests)}).catch(()=>{});void load();const timer=window.setInterval(load,30000);return()=>{alive=false;window.clearInterval(timer)}},[active]);
 const fleet=useMemo(()=>aircraft.filter(item=>schedules.some(schedule=>schedule.aircraftId===item.id&&schedule.status!==9)),[aircraft,schedules]);
 const typeName=(id:string)=>aircraftTypes.find(t=>t.id===id)?.name||"Aircraft type";
 async function submitRequest(){if(!choice)return;setLoading(true);setError("");setSuccess("");try{const r=await fetch("/api/schedules/requests",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(choice)});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not send request.");setRequests(v=>[...v,{...choice,status:"pending"}]);setSuccess("Your seat request was sent to the organisation administrators.");setChoice(null)}catch(e){setError(e instanceof Error?e.message:"Could not send request.")}finally{setLoading(false)}}
 if(active!=="Schedules")return null;
 return <div className="schedule-workspace">
  <div className="page-intro-inline"><div><p className="eyebrow">FLIGHT OPERATIONS</p><h2>Fleet schedules</h2><p className="muted">Choose an aircraft to see its upcoming legs and available crew seats.</p></div><span className="count-pill">{fleet.length} aircraft with schedules</span></div>
  {error&&<p className="form-error" role="alert">{error}</p>}{success&&<p className="form-success" role="status">{success}</p>}
  <section className="fleet-accordion-card">
   {fleet.map(item=>{const pos=positions[item.id];const state=aircraftState(pos,item.id,schedules,airports);const rows=schedules.filter(s=>s.aircraftId===item.id&&s.status!==9).sort((a,b)=>a.sequence-b.sequence);const open=expanded===item.id;
    return <div className="fleet-accordion-item" key={item.id}>
     <button className="fleet-aircraft-trigger" aria-expanded={open} onClick={()=>setExpanded(open?null:item.id)}>
      <span className={"fleet-status-dot "+state.tone}/><span className="fleet-aircraft-identity"><b>{item.registration}</b><small>{typeName(item.aircraftId)}</small></span><span className={"fleet-status-pill "+state.tone}>{state.label}</span><span className="fleet-aircraft-context">{state.detail}</span><span className="fleet-row-count">{rows.length} legs</span><ChevronDown className={open?"rotated":""} size={17}/>
     </button>
     {open&&<div className="fleet-schedules-panel">{rows.length?rows.map(schedule=>{const requestable=[1,2,3,4].includes(schedule.status);const captain=(schedule.crew||[]).some(c=>c.role===0),fo=(schedule.crew||[]).some(c=>c.role===1);const captainPending=requests.some(r=>r.scheduleId===schedule.id&&r.seat==="captain"&&["pending","processing"].includes(r.status));const foPending=requests.some(r=>r.scheduleId===schedule.id&&r.seat==="first_officer"&&["pending","processing"].includes(r.status));const flightType=({0:"Unspecified",1:"Commercial",2:"Charter",3:"Cargo",4:"Training",5:"Test flight",6:"Medical emergency",7:"Military",8:"VIP / Executive",9:"Humanitarian relief",10:"General aviation",11:"Airshow",12:"Other"} as Record<number,string>)[schedule.flightType]||"Scheduled flight";
      return <article className="schedule-leg-row" key={schedule.id}><div className="schedule-leg-heading"><div><span><small>FLIGHT NUMBER</small><b>{schedule.callsign}</b></span><span className="count-pill">{flightType}</span></div><span className="schedule-seat-summary"><Users size={13}/>{captain?"Captain assigned":"Captain open"} · {fo?"FO assigned":"FO open"}</span></div>
       <div className="schedule-route-line"><span><small>DEPARTURE</small><b>{schedule.originIcao}</b></span><ArrowRight size={16}/><span><small>ARRIVAL</small><b>{schedule.destinationIcao}</b></span><span className="schedule-time"><small>DEPARTURE TIME</small><b>{schedule.isTimeless?"Anytime":dateTime(schedule.scheduledDepartureUtc)}</b></span></div>
       <div className="schedule-seat-actions">{requestable&&!captain&&!captainPending?<button className="outline-button" onClick={()=>setChoice({scheduleId:schedule.id,seat:"captain"})}>Request Captain</button>:<span className="seat-locked">{captain?"Captain assigned":captainPending?"Captain requested":"Captain unavailable"}</span>}{requestable&&!fo&&!foPending?<button className="outline-button" onClick={()=>setChoice({scheduleId:schedule.id,seat:"first_officer"})}>Request First Officer</button>:<span className="seat-locked">{fo?"First Officer assigned":foPending?"First Officer requested":"First Officer unavailable"}</span>}</div>
      </article>}) : <Empty title="No schedules for this aircraft" body="Newly published legs will appear here automatically."/>}</div>}
    </div>})}
   {!fleet.length&&<Empty title="No scheduled aircraft found" body="Aircraft appear here whenever Infinite Flight returns a non-cancelled schedule for them, including hangared aircraft."/>}
  </section>
  {choice&&<div className="modal-scrim" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setChoice(null)}}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="request-title"><button className="modal-close" onClick={()=>setChoice(null)}>×</button><p className="eyebrow">CREW REQUEST</p><h2 id="request-title">Request this seat?</h2><p className="muted">You are requesting the <b>{choice.seat==="captain"?"Captain":"First Officer"}</b> position. An administrator will review your request in Discord.</p><div className="modal-actions"><button className="outline-button" onClick={()=>setChoice(null)}>Cancel</button><button className="primary-button" disabled={loading} onClick={()=>void submitRequest()}>{loading?"Sending…":"Confirm request"}</button></div></section></div>}
 </div>;
}
