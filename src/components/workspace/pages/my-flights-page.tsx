"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect,useState,type ReactNode } from "react";
import { CalendarDays,History,Radio,RefreshCw,ChevronLeft,ChevronRight } from "lucide-react";
import { Empty } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";

type Flight={id:string;callsign?:string;originIcao?:string|null;destinationIcao?:string|null;actualDepartureUtc?:string|null;actualArrivalUtc?:string|null;scheduledDepartureUtc?:string;isTimeless?:boolean;aircraftRegistration?:string;flightTimeMinutes?:number};
type Coverage={checked:number;total:number;complete:boolean;limited:boolean};

function FlightGroup({title,description,icon,flights,empty}:{title:string;description:string;icon:ReactNode;flights:Flight[];empty:string}){
 const [page,setPage]=useState(1);
 const pageSize=10;
 const pages=Math.max(1,Math.ceil(flights.length/pageSize));
 useEffect(()=>{setPage(1);},[flights.length]);
 const visible=flights.slice((page-1)*pageSize,page*pageSize);
 return <section className="section-card"><div className="section-head"><div className="flight-group-title">{icon}<span><h2>{title}</h2><p>{description}</p></span></div><span className="count-pill">{flights.length}</span></div>{flights.length?visible.map((flight,index)=><div className="personal-flight-row" key={flight.id||index}><div className="personal-flight-main"><b>{flight.callsign||"Flight"}</b><small>{flight.aircraftRegistration||"Virtual Blue aircraft"}</small></div><div className="personal-flight-route"><small>ROUTE</small><b>{flight.originIcao||"—"} <span>→</span> {flight.destinationIcao||"—"}</b></div><div className="personal-flight-duration">{flight.isTimeless?"Anytime":flight.actualDepartureUtc||flight.scheduledDepartureUtc?new Date(flight.actualDepartureUtc||flight.scheduledDepartureUtc!).toLocaleString():"Time not available"}{flight.flightTimeMinutes?" · "+Math.round(flight.flightTimeMinutes)+" min":""}</div></div>):<Empty title={empty} body="Flights will appear here when they match your Infinite Flight organisation crew records."/>}{flights.length>pageSize&&<div className="flight-pagination"><span>Showing {(page-1)*pageSize+1}–{Math.min(page*pageSize,flights.length)} of {flights.length}</span><div><button className="outline-button" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} aria-label="Previous page"><ChevronLeft size={15}/></button><b>{page} / {pages}</b><button className="outline-button" onClick={()=>setPage(p=>Math.min(pages,p+1))} disabled={page===pages} aria-label="Next page"><ChevronRight size={15}/></button></div></div>}</section>;
}

export function MyFlightsPage(){
 const {active}=useWorkspace();
 const [data,setData]=useState<{live:Flight[];future:Flight[];past:Flight[]}>({live:[],future:[],past:[]});
 const [coverage,setCoverage]=useState<Coverage|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [refreshKey,setRefreshKey]=useState(0);
 useEffect(()=>{
  if(active!=="My Flights")return;
  let alive=true;
  setLoading(true);setError("");
  fetch("/api/my-flights",{cache:"no-store"}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||"Unable to load your flights.");return body;}).then(body=>{
   if(alive){setData({live:body.live||[],future:body.future||[],past:body.past||[]});setCoverage(body.pastCoverage||null);}
  }).catch(reason=>{if(alive)setError(reason instanceof Error?reason.message:"Unable to load your flights.");}).finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false;};
 },[active,refreshKey]);
 if(active!=="My Flights")return null;
 return <div className="my-flights-page">
  <div className="page-intro-inline"><div><h2>Your flight logbook</h2><p className="muted">Live assignments, approved upcoming legs and completed Virtual Blue aircraft flights.</p></div><button className="outline-button" onClick={()=>setRefreshKey(v=>v+1)} disabled={loading}><RefreshCw size={14}/>{loading?"Refreshing":"Refresh flights"}</button></div>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <FlightGroup title="Live Flights" description="Flights you are currently operating as crew." icon={<Radio size={17}/>} flights={data.live} empty="No live flights right now"/>
  <FlightGroup title="Future Flights" description="Approved crew assignments that have not started yet." icon={<CalendarDays size={17}/>} flights={data.future} empty="No future flights assigned"/>
  <FlightGroup title="Past Flights" description="Completed fleet flights where Infinite Flight confirms you were crew." icon={<History size={17}/>} flights={data.past} empty="No completed fleet flights found"/>
  {coverage&&!coverage.complete&&<p className="muted past-coverage-note">{coverage.limited?"The API rate limit was reached. ":""}Checked {coverage.checked} of {coverage.total} flyable aircraft for completed flights. Refresh later to check the remaining fleet.</p>}
 </div>;
}
