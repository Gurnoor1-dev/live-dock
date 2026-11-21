"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Plane, CalendarPlus } from "lucide-react";
import type { Aircraft } from "@/lib/types";

type Org={id:string;name:string;slug:string;timezone:string};
export function AdminPanel({organization,aircraft}:{organization:Org;aircraft:Aircraft[]}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
  const [registration,setRegistration]=useState(""),[type,setType]=useState(""),[manufacturer,setManufacturer]=useState(""),[airport,setAirport]=useState("");
  const [flight,setFlight]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState(""),[departure,setDeparture]=useState(""),[aircraftId,setAircraftId]=useState("");
  const router=useRouter();
  async function send(path:string,body:unknown) {
    setBusy(true);setMessage("");setError("");
    try {
      const res=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await res.json();
      if(!res.ok) throw new Error(data.error || "Request failed. Confirm your administrator role.");
      setMessage("Saved successfully.");router.refresh();return true;
    } catch(e) {setError(e instanceof Error?e.message:"Request failed.");return false;}
    finally {setBusy(false);}
  }
  async function addAircraft(e:FormEvent){e.preventDefault();if(await send("/api/aircraft",{organizationId:organization.id,registration,aircraftType:type,manufacturer,homeAirport:airport,currentAirport:airport})){setRegistration("");setType("");setManufacturer("");setAirport("");}}
  async function addLeg(e:FormEvent){e.preventDefault();if(await send("/api/legs",{organizationId:organization.id,flightNumber:flight,departureAirport:from.toUpperCase(),arrivalAirport:to.toUpperCase(),scheduledDeparture:new Date(departure).toISOString(),aircraftId:aircraftId||null})){setFlight("");setFrom("");setTo("");setDeparture("");setAircraftId("");}}
  return <div className="admin-grid"><section className="section-card"><div className="section-head"><div><h2><Plane size={16}/> Add aircraft</h2><p>Register a tail in {organization.name}.</p></div><Plus size={17}/></div><form className="admin-form" onSubmit={addAircraft}><label>Registration<input required value={registration} onChange={e=>setRegistration(e.target.value.toUpperCase())} placeholder="e.g. VT-VBA"/></label><label>Aircraft type<input required value={type} onChange={e=>setType(e.target.value)} placeholder="e.g. Airbus A320-200"/></label><label>Manufacturer<input value={manufacturer} onChange={e=>setManufacturer(e.target.value)} placeholder="Airbus"/></label><label>Home airport<input maxLength={4} value={airport} onChange={e=>setAirport(e.target.value.toUpperCase())} placeholder="VIDP"/></label><button className="primary-button" disabled={busy}>Save aircraft</button></form></section><section className="section-card"><div className="section-head"><div><h2><CalendarPlus size={16}/> Publish a flight leg</h2><p>Add a leg to the operations board.</p></div><Plus size={17}/></div><form className="admin-form" onSubmit={addLeg}><label>Flight number<input value={flight} onChange={e=>setFlight(e.target.value.toUpperCase())} placeholder="VB 101"/></label><div className="form-two"><label>From<input required maxLength={4} value={from} onChange={e=>setFrom(e.target.value.toUpperCase())} placeholder="VIDP"/></label><label>To<input required maxLength={4} value={to} onChange={e=>setTo(e.target.value.toUpperCase())} placeholder="VABB"/></label></div><label>Departure time<input required type="datetime-local" value={departure} onChange={e=>setDeparture(e.target.value)}/></label><label>Aircraft<select value={aircraftId} onChange={e=>setAircraftId(e.target.value)}><option value="">Unassigned</option>{aircraft.filter(a=>(a as Aircraft & {organization_id?:string}).organization_id===organization.id).map(a=><option key={a.id} value={a.id}>{a.registration} · {a.aircraft_type}</option>)}</select></label><button className="primary-button" disabled={busy}>Publish leg</button></form></section>{message&&<p className="form-success" role="status">{message}</p>}{error&&<p className="form-error" role="alert">{error}</p>}</div>;
}
