"use client";
import { useEffect,useMemo,useState } from "react";
import { ChevronDown,Users,ArrowRight } from "lucide-react";
import { Empty } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";
type SeatRequest={scheduleId:string;seat:"captain"|"first_officer";status:"pending"|"processing"|"approved"|"rejected"|"failed"};
type PositionLike={state:number;isOnGround:boolean;airportIcao?:string;lastPilotUsername?:string};
type ScheduleLike={aircraftId:string;status:number;sequence:number;callsign:string;originIcao:string;destinationIcao:string};
function aircraftState(position:PositionLike|undefined,aircraftId:string,schedules:ScheduleLike[]){
 const active=schedules.find(s=>s.aircraftId===aircraftId&&[2,3,4,6].includes(s.status));
 const arrived=schedules.filter(s=>s.aircraftId===aircraftId&&s.status===11).sort((a,b)=>b.sequence-a.sequence)[0];
 const next=schedules.filter(s=>s.aircraftId===aircraftId&&s.status===1).sort((a,b)=>a.sequence-b.sequence)[0];
 const flight=active?active.callsign+" · "+active.originIcao+" → "+active.destinationIcao:"active flight not identified";
 if(!position)return{label:"Status unavailable",tone:"unknown",detail:"Live position is not available"};
 if(position.state===1||position.isOnGround)return{label:"On Ground",tone:"ground",detail:"Parked at "+(position.airportIcao||arrived?.destinationIcao||next?.originIcao||"airport not identified")};
 if(position.state===3)return{label:"Cancelled",tone:"unknown",detail:"Last flight was cancelled"};
 if(position.state===4)return{label:"Stopped",tone:"stopped",detail:"Stopped · "+flight};
 if(position.state===2)return{label:"In Flight",tone:"flight",detail:"Flying · "+flight};
 if(position.state===5)return{label:"Maintenance",tone:"maintenance",detail:"Aircraft in maintenance"};
 return{label:"Unknown",tone:"unknown",detail:"Live aircraft status unavailable"};
}
export function SchedulesPage(){
 const {active,aircraft,aircraftTypes,schedules,positions,dateTime}=useWorkspace();
 const [expanded,setExpanded]=useState<string|null>(null);
 const [requests,setRequests]=useState<SeatRequest[]>([]);
 const [choice,setChoice]=useState<{scheduleId:string;seat:"captain"|"first_officer"}|null>(null);
 const [loading,setLoading]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
 useEffect(()=>{if(active!=="Schedules")return;let alive=true;const load=()=>fetch("/api/schedules/requests",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{if(alive&&d?.requests)setRequests(d.requests)}).catch(()=>{});void load();const timer=window.setInterval(load,30000);return()=>{alive=false;window.clearInterval(timer)}},[active]);
 const fleet=useMemo(()=>aircraft.filter(a=>a.status===0&&a.visibility!==2&&a.isFleetActiveSlot),[aircraft]);
 const typeName=(id:string)=>aircraftTypes.find(t=>t.id===id)?.name||id;
 async function submitRequest(){if(!choice)return;setLoading(true);setError("");setSuccess("");try{const r=await fetch("/api/schedules/requests",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(choice)});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not send request.");setRequests(v=>[...v,{...choice,status:"pending"}]);setSuccess("Your seat request was sent to the organisation administrators.");setChoice(null)}catch(e){setError(e instanceof Error?e.message:"Could not send request.")}finally{setLoading(false)}}
 if(active!=="Schedules")return null;
 return <div className="schedule-workspace">
  <div className="page-intro-inline"><div><p className="eyebrow">FLIGHT OPERATIONS</p><h2>Fleet schedules</h2><p className="muted">Choose an aircraft to see its upcoming legs and available crew seats.</p></div><span className="count-pill">{fleet.length} flyable aircraft</span></div>
  {error&&<p className="form-error" role="alert">{error}</p>}{success&&<p className="form-success" role="status">{success}</p>}
  <section className="fleet-accordion-card">
   {fleet.map(item=>{const pos=positions[item.aircraftId];const state=aircraftState(pos,item.aircraftId,schedules);const rows=schedules.filter(s=>s.aircraftId===item.aircraftId&&[1,2,3,4,6].includes(s.status)).sort((a,b)=>a.sequence-b.sequence);const open=expanded===item.id;
    return <div className="fleet-accordion-item" key={item.id}>
     <button className="fleet-aircraft-trigger" aria-expanded={open} onClick={()=>setExpanded(open?null:item.id)}>
      <span className={"fleet-status-dot "+state.tone}/><span className="fleet-aircraft-identity"><b>{item.registration}</b><small>{typeName(item.aircraftId)}</small></span><span className={"fleet-status-pill "+state.tone}>{state.label}</span><span className="fleet-aircraft-context">{state.detail}</span><span className="fleet-row-count">{rows.length} legs</span><ChevronDown className={open?"rotated":""} size={17}/>
     </button>
     {open&&<div className="fleet-schedules-panel">{rows.length?rows.map(schedule=>{const requestable=[1,2,3,4].includes(schedule.status);const captain=(schedule.crew||[]).some(c=>c.role===0),fo=(schedule.crew||[]).some(c=>c.role===1);const captainPending=requests.some(r=>r.scheduleId===schedule.id&&r.seat==="captain"&&["pending","processing","approved"].includes(r.status));const foPending=requests.some(r=>r.scheduleId===schedule.id&&r.seat==="first_officer"&&["pending","processing","approved"].includes(r.status));const flightType=schedule.flightType===1?"Passenger flight":schedule.flightType===2?"Charter flight":schedule.flightType===3?"Cargo flight":schedule.flightType===4?"Training flight":"Scheduled flight";
      return <article className="schedule-leg-row" key={schedule.id}><div className="schedule-leg-heading"><div><span><small>FLIGHT NUMBER</small><b>{schedule.callsign}</b></span><span className="count-pill">{flightType}</span></div><span className="schedule-seat-summary"><Users size={13}/>{captain?"Captain assigned":"Captain open"} · {fo?"FO assigned":"FO open"}</span></div>
       <div className="schedule-route-line"><span><small>DEPARTURE</small><b>{schedule.originIcao}</b></span><ArrowRight size={16}/><span><small>ARRIVAL</small><b>{schedule.destinationIcao}</b></span><span className="schedule-time"><small>DEPARTURE TIME</small><b>{schedule.isTimeless?"Anytime":dateTime(schedule.scheduledDepartureUtc)}</b></span></div>
       <div className="schedule-seat-actions">{requestable&&!captain&&!captainPending?<button className="outline-button" onClick={()=>setChoice({scheduleId:schedule.id,seat:"captain"})}>Request Captain</button>:<span className="seat-locked">{captain?"Captain assigned":captainPending?"Captain requested":"Captain unavailable"}</span>}{requestable&&!fo&&!foPending?<button className="outline-button" onClick={()=>setChoice({scheduleId:schedule.id,seat:"first_officer"})}>Request First Officer</button>:<span className="seat-locked">{fo?"First Officer assigned":foPending?"First Officer requested":"First Officer unavailable"}</span>}</div>
      </article>}) : <Empty title="No schedules for this aircraft" body="Newly published legs will appear here automatically."/>}</div>}
    </div>})}
   {!fleet.length&&<Empty title="No flyable aircraft found" body="Aircraft marked as inactive or in the hangar are excluded from this list."/>}
  </section>
  {choice&&<div className="modal-scrim" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setChoice(null)}}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="request-title"><button className="modal-close" onClick={()=>setChoice(null)}>×</button><p className="eyebrow">CREW REQUEST</p><h2 id="request-title">Request this seat?</h2><p className="muted">You are requesting the <b>{choice.seat==="captain"?"Captain":"First Officer"}</b> position. An administrator will review your request in Discord.</p><div className="modal-actions"><button className="outline-button" onClick={()=>setChoice(null)}>Cancel</button><button className="primary-button" disabled={loading} onClick={()=>void submitRequest()}>{loading?"Sending…":"Confirm request"}</button></div></section></div>}
 </div>;
}
