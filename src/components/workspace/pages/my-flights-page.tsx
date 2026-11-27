"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect,useState,type ReactNode } from "react";
import { CalendarDays,History,Radio,RefreshCw,ChevronLeft,ChevronRight } from "lucide-react";
import { Empty } from "@/components/workspace/shared-ui";
import { DispatchButton } from "@/components/dispatch/dispatch-button";
import { useWorkspace } from "../workspace-context";

type Flight={id:string;callsign?:string;originIcao?:string|null;destinationIcao?:string|null;actualDepartureUtc?:string|null;actualArrivalUtc?:string|null;scheduledDepartureUtc?:string;isTimeless?:boolean;aircraftRegistration?:string;flightTimeMinutes?:number};
type Coverage={checked:number;total:number;complete:boolean;limited:boolean};

function FlightGroup({title,description,icon,flights,empty,showDispatch}:{title:string;description:string;icon:ReactNode;flights:Flight[];empty:string;showDispatch?:boolean}){
 const [page,setPage]=useState(1);
 const pageSize=10;
 const pages=Math.max(1,Math.ceil(flights.length/pageSize));
 useEffect(()=>{setPage(1);},[flights.length]);
 const visible=flights.slice((page-1)*pageSize,page*pageSize);
 return <section className="section-card"><div className="section-head"><div className="flight-group-title">{icon}<span><h2>{title}</h2><p>{description}</p></span></div><span className="count-pill">{flights.length}</span></div>{flights.length?visible.map((flight,index)=><div className="personal-flight-row" key={flight.id||index}><div className="personal-flight-main"><b>{flight.callsign||"Flight"}</b><small>{flight.aircraftRegistration||"Virtual Blue aircraft"}</small></div><div className="personal-flight-route"><small>ROUTE</small><b>{flight.originIcao||"—"} <span>→</span> {flight.destinationIcao||"—"}</b></div><div className="personal-flight-duration">{flight.isTimeless?"Anytime":flight.actualDepartureUtc||flight.scheduledDepartureUtc?new Date(flight.actualDepartureUtc||flight.scheduledDepartureUtc!).toLocaleString():"Time not available"}{flight.flightTimeMinutes?" · "+Math.round(flight.flightTimeMinutes)+" min":""}</div>{showDispatch&&<DispatchButton scheduleId={flight.id}/>}</div>):<Empty title={empty} body="Flights will appear here when they match your Infinite Flight organisation crew records."/>}{flights.length>pageSize&&<div className="flight-pagination"><span>Showing {(page-1)*pageSize+1}–{Math.min(page*pageSize,flights.length)} of {flights.length}</span><div><button className="outline-button" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} aria-label="Previous page"><ChevronLeft size={15}/></button><b>{page} / {pages}</b><button className="outline-button" onClick={()=>setPage(p=>Math.min(pages,p+1))} disabled={page===pages} aria-label="Next page"><ChevronRight size={15}/></button></div></div>}</section>;
}

export function MyFlightsPage(){
 const {active,snapshotData,refreshWorkspace}=useWorkspace();
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const data=snapshotData.myFlights||{live:[],future:[],past:[],pastCoverage:null};
 const coverage=data.pastCoverage as Coverage|null;
 async function refresh(){setLoading(true);setError("");try{await refreshWorkspace(true);}catch(e){setError(e instanceof Error?e.message:"Unable to refresh flight data.");}finally{setLoading(false)}}
 if(active!=="My Flights")return null;
 return <div className="my-flights-page">
  <div className="page-intro-inline"><div><h2>Your flight logbook</h2><p className="muted">Live assignments, approved upcoming legs and completed Virtual Blue aircraft flights.</p></div><button className="outline-button" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={14}/>{loading?"Refreshing":"Refresh flights"}</button></div>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <FlightGroup title="Live Flights" description="Flights you are currently operating as crew." icon={<Radio size={17}/>} flights={data.live} empty="No live flights right now"/>
  <FlightGroup title="Future Flights" description="Approved crew assignments that have not started yet." icon={<CalendarDays size={17}/>} flights={data.future} empty="No future flights assigned" showDispatch/>
  <FlightGroup title="Past Flights" description="Completed fleet flights where Infinite Flight confirms you were crew." icon={<History size={17}/>} flights={data.past} empty="No completed fleet flights found"/>
  {coverage&&!coverage.complete&&<p className="muted past-coverage-note">{coverage.limited?"The API request budget limited this initial snapshot. ":""}Checked {coverage.checked} of {coverage.total} sampled flyable aircraft for completed flights. Refresh later to check a new sample.</p>}
 </div>;
}
