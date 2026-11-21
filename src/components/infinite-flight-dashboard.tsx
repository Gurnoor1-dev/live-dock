"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Activity, ArrowUpRight, CalendarDays, ChevronDown, Command, Compass, LogOut, Menu, Moon, Plane, RadioTower, RefreshCw, ShieldCheck, Sun, Users, X } from "lucide-react";

type Organization={id:string;name:string;role:number;description?:string|null;worldType:number;operationType:number};
type Aircraft={id:string;aircraftId:string;organizationId:string;registration:string;status:number;visibility:number;fleetPriority:number|null;fleetRank:number;isFleetActiveSlot:boolean};
type Member={userId:string;username:string|null;role:number;joinedAt:string;activeLifts:number};
type Crew={userId:string;username:string|null;role:number};
type Schedule={id:string;status:number;callsign:string;organizationId:string;aircraftId:string;flightType:number;originIcao:string;destinationIcao:string;isTimeless:boolean;scheduledDepartureUtc:string;scheduledArrivalUtc:string;briefing:string|null;flightPlan:string|null;crew:Crew[];sequence:number};
type Tab="Fleet"|"Schedules"|"Crew"|"Admin";

async function api(path:string,init:RequestInit={}) {
  const response=await fetch(`/api/if${path}`,{
    ...init,cache:"no-store",credentials:"same-origin",
    headers:{"Content-Type":"application/json",...(init.headers||{})}
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error_description||payload.error||payload.message||`Infinite Flight returned HTTP ${response.status}.`);
  if(typeof payload.errorCode==="number"&&payload.errorCode!==0) throw new Error(payload.message||`Infinite Flight API error ${payload.errorCode}.`);
  return payload.result;
}
function roleName(role:number){return role===2?"Owner":role===1?"Admin":"Member";}
function statusName(status:number){return ({0:"Unknown",1:"Scheduled",2:"Boarding",3:"Boarded",4:"Taxiing to runway",6:"In flight",7:"Diverted",8:"Delayed",9:"Cancelled",10:"Taxiing to parking",11:"Arrived"} as Record<number,string>)[status]??"Unknown";}
function visibilityName(value:number){return value===1?"Visible":value===2?"Hangared":"Unknown";}
function dateTime(value:string,timeless=false){return timeless?"Timeless":value?.startsWith("0001-")?"—":value?new Date(value).toLocaleString():"—";}

export function InfiniteFlightDashboard(){
  const [auth,setAuth]=useState<"checking"|"signed-out"|"signed-in">("checking");
  const [orgs,setOrgs]=useState<Organization[]>([]);
  const [orgId,setOrgId]=useState("");
  const [aircraft,setAircraft]=useState<Aircraft[]>([]);
  const [members,setMembers]=useState<Member[]>([]);
  const [schedules,setSchedules]=useState<Schedule[]>([]);
  const [active,setActive]=useState<Tab>("Fleet");
  const [theme,setTheme]=useState<"light"|"dark">("light");
  const [mobileNav,setMobileNav]=useState(false);
  const [query,setQuery]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [callsign,setCallsign]=useState("");
  const [aircraftId,setAircraftId]=useState("");
  const [origin,setOrigin]=useState("");
  const [destination,setDestination]=useState("");
  const [departure,setDeparture]=useState("");
  const [arrival,setArrival]=useState("");
  const [timeless,setTimeless]=useState(false);
  const [briefing,setBriefing]=useState("");
  const [crewSelections,setCrewSelections]=useState<Record<string,string>>({});
  const [crewRoles,setCrewRoles]=useState<Record<string,string>>({});

  const organization=orgs.find(item=>item.id===orgId)||orgs[0]||null;
  const canManage=Boolean(organization&&(organization.role===1||organization.role===2));
  const visibleAircraft=useMemo(()=>aircraft.filter(item=>item.registration.toLowerCase().includes(query.toLowerCase())),[aircraft,query]);
  const liveSchedules=schedules.filter(item=>[1,2,3,4,6].includes(item.status));

  async function loadOrganization(id:string){
    setBusy(true);setError("");
    try{
      const [aircraftResult,membersResult,scheduleResult]=await Promise.all([
        api(`/live/organizations/${id}/aircraft`),
        api(`/live/organizations/${id}/members`),
        api(`/live/organizations/${id}/schedules?page=1&pageSize=100`)
      ]);
      setAircraft(Array.isArray(aircraftResult)?aircraftResult:[]);
      setMembers(Array.isArray(membersResult)?membersResult:[]);
      setSchedules(Array.isArray(scheduleResult)?scheduleResult:(scheduleResult?.items||[]));
    }catch(e){setError(e instanceof Error?e.message:"Unable to load organization data.");}
    finally{setBusy(false);}
  }

  async function loadOrganizations(){
    setError("");
    try{
      const result=await api("/live/organizations");
      const list=Array.isArray(result)?result:[];
      setOrgs(list);
      const nextId=list.some((item:Organization)=>item.id===orgId)?orgId:list[0]?.id||"";
      setOrgId(nextId);
      if(nextId) await loadOrganization(nextId);
      else {setAircraft([]);setMembers([]);setSchedules([]);}
    }catch(e){setError(e instanceof Error?e.message:"Unable to load your Infinite Flight organizations.");}
  }

  useEffect(()=>{
    let mounted=true;
    fetch("/api/auth/if/session",{cache:"no-store"}).then(r=>r.json()).then(async data=>{
      if(!mounted)return;
      if(!data.authenticated){setAuth("signed-out");return;}
      setAuth("signed-in");
      try{
        const result=await api("/live/organizations");
        if(!mounted)return;
        const list=Array.isArray(result)?result:[];
        setOrgs(list);
        const id=list[0]?.id||"";
        setOrgId(id);
        if(id){
          const [a,m,s]=await Promise.all([
            api(`/live/organizations/${id}/aircraft`),
            api(`/live/organizations/${id}/members`),
            api(`/live/organizations/${id}/schedules?page=1&pageSize=100`)
          ]);
          if(!mounted)return;
          setAircraft(Array.isArray(a)?a:[]);
          setMembers(Array.isArray(m)?m:[]);
          setSchedules(Array.isArray(s)?s:(s?.items||[]));
        }
      }catch(e){if(mounted)setError(e instanceof Error?e.message:"Unable to load Infinite Flight data.");}
    }).catch(()=>{if(mounted)setAuth("signed-out");});
    return()=>{mounted=false;};
  },[]);

  async function refresh(){if(organization)await loadOrganization(organization.id);else await loadOrganizations();}
  async function signOut(){
    await fetch("/api/auth/if/logout",{method:"POST"});
    setAuth("signed-out");setOrgs([]);setAircraft([]);setMembers([]);setSchedules([]);setOrgId("");
  }
  async function createSchedule(event:FormEvent){
    event.preventDefault();if(!canManage||!aircraftId)return;
    setBusy(true);setError("");setNotice("");
    try{
      const payload={
        callsign:callsign.trim(),flightType:1,originIcao:origin.trim().toUpperCase(),destinationIcao:destination.trim().toUpperCase(),
        isTimeless:timeless,
        ...(timeless?{}:{scheduledDepartureUtc:new Date(departure).toISOString(),scheduledArrivalUtc:new Date(arrival).toISOString()}),
        briefing:briefing.trim()||null
      };
      await api(`/live/aircraft/${aircraftId}/schedules`,{method:"POST",body:JSON.stringify(payload)});
      setNotice("Schedule published to Infinite Flight.");
      setCallsign("");setOrigin("");setDestination("");setDeparture("");setArrival("");setBriefing("");
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Could not publish schedule.");}
    finally{setBusy(false);}
  }
  async function deleteSchedule(id:string){
    if(!canManage)return;
    setBusy(true);setError("");setNotice("");
    try{await api(`/live/schedules/${id}`,{method:"DELETE"});setNotice("Schedule deleted in Infinite Flight.");await refresh();}
    catch(e){setError(e instanceof Error?e.message:"Could not delete schedule.");}
    finally{setBusy(false);}
  }
  async function assignCrew(schedule:Schedule){
    if(!canManage)return;
    const userId=crewSelections[schedule.id];if(!userId)return;
    setBusy(true);setError("");setNotice("");
    try{
      await api(`/live/schedules/${schedule.id}/crew/${userId}`,{method:"PUT",body:JSON.stringify({role:Number(crewRoles[schedule.id]??0)})});
      setNotice("Crew assignment saved to Infinite Flight.");await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Could not assign crew.");}
    finally{setBusy(false);}
  }
  async function removeCrew(scheduleId:string,userId:string){
    setBusy(true);setError("");setNotice("");
    try{await api(`/live/schedules/${scheduleId}/crew/${userId}`,{method:"DELETE"});setNotice("Crew member removed from the Infinite Flight schedule.");await refresh();}
    catch(e){setError(e instanceof Error?e.message:"Could not remove crew member.");}
    finally{setBusy(false);}
  }

  if(auth==="checking")return <main className="auth-page"><div className="auth-card"><span className="brand-mark">VB</span><h1>Preparing your flight deck</h1><p className="muted">Checking your Infinite Flight session…</p></div></main>;
  if(auth==="signed-out")return <main className="auth-page"><a href="/" className="brand"><span className="brand-mark">VB</span><span>VIRTUAL BLUE<small>FLEET OPERATIONS</small></span></a><section className="auth-card"><p className="eyebrow">INFINITE FLIGHT · SECURE SIGN IN</p><h1>Welcome aboard.</h1><p className="muted">Continue with your Infinite Flight account. Your airline membership, fleet and schedules are read directly from Infinite Flight.</p><a className="primary-button full" href="/api/auth/if/login">Continue with Infinite Flight <ArrowUpRight size={15}/></a><p className="fine-print">Virtual Blue does not use email/password accounts. Authentication is handled by Infinite Flight OAuth 2.0.</p></section></main>;

  return <div className="app-frame" data-theme={theme}>
    <aside className={`sidebar ${mobileNav?"open":""}`}>
      <div className="brand"><span className="brand-mark">VB</span><span>VIRTUAL BLUE<small>FLEET OPERATIONS</small></span><button className="icon-button mobile-close" onClick={()=>setMobileNav(false)} aria-label="Close menu"><X size={18}/></button></div>
      <div className="workspace"><span className="workspace-icon">VB</span><span><b>{organization?.name||"Infinite Flight"}</b><small>{organization?roleName(organization.role):"No airline membership"}</small></span><ChevronDown size={15}/></div>
      <p className="nav-caption">OPERATIONS</p>
      <nav>{(["Fleet","Schedules","Crew"] as Tab[]).map((item,index)=><button key={item} className={active===item?"nav-item active":"nav-item"} onClick={()=>{setActive(item);setMobileNav(false);}}>{index===0?<Plane size={17}/>:index===1?<CalendarDays size={17}/>:<Users size={17}/>}<span>{item}</span></button>)}</nav>
      <p className="nav-caption secondary">MANAGEMENT</p>
      <nav><button className={active==="Admin"?"nav-item active":"nav-item"} onClick={()=>{setActive("Admin");setMobileNav(false);}}><ShieldCheck size={17}/><span>Admin</span></button></nav>
      <div className="sidebar-bottom"><div className="help-card"><Command size={17}/><span><b>Live API v3 connected</b><small>Infinite Flight is the source of truth</small></span><Activity size={14}/></div><div className="user-row"><div className="avatar">IF</div><span><b>Infinite Flight pilot</b><small>{organization?roleName(organization.role):"Signed in"}</small></span><button className="icon-button" onClick={signOut} title="Sign out"><LogOut size={16}/></button></div></div>
    </aside>
    {mobileNav&&<button className="mobile-scrim" onClick={()=>setMobileNav(false)} aria-label="Close navigation"/>}
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={()=>setMobileNav(true)} aria-label="Open menu"><Menu size={19}/></button><span className="breadcrumb">Virtual Blue <b>/</b> {active}</span></div><div className="topbar-actions"><span className="live-indicator"><i/> IF API connected</span><button className="icon-button" onClick={refresh} aria-label="Refresh Infinite Flight data" title="Refresh"><RefreshCw size={16}/></button><button className="icon-button" onClick={()=>setTheme(theme==="light"?"dark":"light")} aria-label="Toggle theme">{theme==="light"?<Moon size={17}/>:<Sun size={17}/>}</button></div></header>
      <div className="content">
        <div className="page-heading"><div><p className="eyebrow">VIRTUAL BLUE · INFINITE FLIGHT LIVE</p><h1>{active}</h1><p className="muted">{active==="Fleet"?"Your organisation's live aircraft from Infinite Flight.":active==="Schedules"?"Schedules are created and managed directly in Infinite Flight.":active==="Crew"?"Live organisation members and assigned schedule crew.":"Authorised organisation operations."}</p></div><div className="heading-actions">{orgs.length>1&&<select className="org-select" value={orgId} onChange={e=>{setOrgId(e.target.value);void loadOrganization(e.target.value);}}>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>}<span className="date-chip"><CalendarDays size={15}/>{new Intl.DateTimeFormat("en",{dateStyle:"medium"}).format(new Date())}</span></div></div>
        {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="form-success" role="status">{notice}</p>}
        {!organization&&<section className="section-card"><div className="empty-state"><span className="empty-icon"><Compass size={20}/></span><b>No Live organisation found</b><p>This Infinite Flight account is authenticated, but the API returned no Live organisation memberships. Join Virtual Blue in Infinite Flight, then refresh this page.</p><button className="outline-button" onClick={loadOrganizations}>Check again</button></div></section>}
        {organization&&<><div className="stat-grid"><Stat label="Fleet aircraft" value={aircraft.length} icon={<Plane/>} note="From Live organisation"/><Stat label="Live schedules" value={schedules.length} icon={<CalendarDays/>} note="Open fleet schedules"/><Stat label="Organisation members" value={members.length} icon={<Users/>} note="Current membership"/><Stat label="Active legs" value={liveSchedules.length} icon={<RadioTower/>} note="Boarding through in-flight"/></div>
        {active==="Fleet"&&<section className="section-card"><div className="section-head"><div><h2>Organisation fleet</h2><p>Aircraft records are fetched directly from Infinite Flight.</p></div><span className="count-pill">{visibleAircraft.length} aircraft</span></div><div className="toolbar"><div className="search-field"><Plane size={15}/><input placeholder="Search aircraft registration" value={query} onChange={e=>setQuery(e.target.value)}/></div></div>{visibleAircraft.length?<div className="table-wrap"><table><thead><tr><th>Registration</th><th>Fleet rank</th><th>Visibility</th><th>Fleet slot</th><th>Record</th></tr></thead><tbody>{visibleAircraft.map(a=><tr key={a.id}><td className="mono"><b>{a.registration}</b></td><td>{a.fleetRank}</td><td>{visibilityName(a.visibility)}</td><td>{a.isFleetActiveSlot?"Active slot":"Storage"}</td><td><span className={a.status===0?"status available":"status stored"}><i/>{a.status===0?"Active":"Deleted"}</span></td></tr>)}</tbody></table></div>:<Empty title="No aircraft found" body="The Infinite Flight API returned no active aircraft for this organisation."/>}</section>}
        {active==="Schedules"&&<section className="section-card"><div className="section-head"><div><h2>Fleet schedules</h2><p>Schedule changes are written directly to Infinite Flight.</p></div><span className="count-pill">{schedules.length} schedules</span></div>{schedules.length?<div className="table-wrap"><table><thead><tr><th>Callsign</th><th>Route</th><th>Departure</th><th>Arrival</th><th>Status</th><th>Crew</th>{canManage&&<th/>}</tr></thead><tbody>{schedules.map(s=><tr key={s.id}><td className="mono"><b>{s.callsign}</b></td><td className="mono">{s.originIcao} → {s.destinationIcao}</td><td>{dateTime(s.scheduledDepartureUtc,s.isTimeless)}</td><td>{dateTime(s.scheduledArrivalUtc,s.isTimeless)}</td><td><span className="status scheduled"><i/>{statusName(s.status)}</span></td><td>{s.crew?.length||0}/3</td>{canManage&&<td><button className="row-action danger" onClick={()=>void deleteSchedule(s.id)} disabled={busy} title="Delete schedule">Delete</button></td>}</tr>)}</tbody></table></div>:<Empty title="No open schedules" body="When Virtual Blue publishes schedules in Infinite Flight, they will appear here."/>}</section>}
        {active==="Crew"&&<div className="lower-grid"><section className="section-card"><div className="section-head"><div><h2>Organisation members</h2><p>Live membership and roles from Infinite Flight.</p></div></div>{members.length?members.map(m=><div className="condition-row" key={m.userId}><span><b>{m.username||"Unknown pilot"}</b><small className="member-sub">{roleName(m.role)} · {m.activeLifts} active lifts</small></span><small>{new Date(m.joinedAt).toLocaleDateString()}</small></div>):<Empty title="No members returned" body="The organisation currently has no visible member records."/></section><section className="section-card"><div className="section-head"><div><h2>Schedule crew</h2><p>Assigned crew comes from each Live schedule.</p></div></div>{schedules.filter(s=>s.crew?.length).map(s=><div className="crew-schedule" key={s.id}><b>{s.callsign} · {s.originIcao} → {s.destinationIcao}</b>{s.crew.map(c=><div className="condition-row" key={c.userId}><span>{c.username||c.userId}</span><span>{c.role===0?"Captain":"First Officer"} {canManage&&<button className="row-action danger" onClick={()=>void removeCrew(s.id,c.userId)} disabled={busy}>Remove</button>}</span></div>)}</div>)}{!schedules.some(s=>s.crew?.length)&&<Empty title="No crew assigned" body="Assigned pilots will appear alongside their schedules." />}</section></div>}
        {active==="Admin"&&(canManage?<div className="admin-grid"><section className="section-card"><div className="section-head"><div><h2>Publish a schedule</h2><p>Creates the schedule on Infinite Flight, not in a local database.</p></div><CalendarDays size={17}/></div><form className="admin-form" onSubmit={createSchedule}><label>Callsign<input required maxLength={32} value={callsign} onChange={e=>setCallsign(e.target.value.toUpperCase())} placeholder="VB 101"/></label><label>Aircraft<select required value={aircraftId} onChange={e=>setAircraftId(e.target.value)}><option value="">Select aircraft</option>{aircraft.map(a=><option key={a.id} value={a.id}>{a.registration} · Fleet rank {a.fleetRank}</option>)}</select></label><div className="form-two"><label>Origin ICAO<input required maxLength={8} value={origin} onChange={e=>setOrigin(e.target.value.toUpperCase())} placeholder="VIDP"/></label><label>Destination ICAO<input required maxLength={8} value={destination} onChange={e=>setDestination(e.target.value.toUpperCase())} placeholder="VABB"/></label></div><label className="check-line"><input type="checkbox" checked={timeless} onChange={e=>setTimeless(e.target.checked)}/> Timeless schedule</label>{!timeless&&<div className="form-two"><label>Departure (local time)<input required type="datetime-local" value={departure} onChange={e=>setDeparture(e.target.value)}/></label><label>Arrival (local time)<input required type="datetime-local" value={arrival} onChange={e=>setArrival(e.target.value)}/></label></div>}<label>Briefing<input maxLength={4000} value={briefing} onChange={e=>setBriefing(e.target.value)} placeholder="Flight briefing (optional)"/></label><button className="primary-button" disabled={busy||!aircraft.length}>{busy?"Publishing…":"Publish to Infinite Flight"} <ArrowUpRight size={14}/></button></form></section><section className="section-card"><div className="section-head"><div><h2>Manage schedule crew</h2><p>Assign an organisation member to a schedule.</p></div><Users size={17}/></div>{schedules.length?schedules.map(s=><div className="crew-editor" key={s.id}><b>{s.callsign} · {s.originIcao} → {s.destinationIcao}</b><div className="form-two"><select value={crewSelections[s.id]||""} onChange={e=>setCrewSelections(v=>({...v,[s.id]:e.target.value}))}><option value="">Select member</option>{members.map(m=><option key={m.userId} value={m.userId}>{m.username||m.userId}</option>)}</select><select value={crewRoles[s.id]||"0"} onChange={e=>setCrewRoles(v=>({...v,[s.id]:e.target.value}))}><option value="0">Captain</option><option value="1">First Officer</option></select></div><button className="outline-button" disabled={busy||!crewSelections[s.id]} onClick={()=>void assignCrew(s)}>Assign crew member</button></div>):<Empty title="No schedules to manage" body="Publish a schedule first, then assign up to three crew members." />}</section></div>:<section className="section-card"><Empty title="Administrator access required" body="Only Infinite Flight organisation owners and admins can publish schedules or manage schedule crew."/></section>)}
        </>}
        <footer className="footer"><span>© {new Date().getFullYear()} Virtual Blue</span><span>Powered by Infinite Flight PublicApi v3</span><span>Live data · No permanent API data storage</span></footer>
      </div>
    </main>
  </div>;
}

function Stat({label,value,note,icon}:{label:string;value:number;note:string;icon:ReactNode}){return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value.toLocaleString()}</strong><div className="stat-note">{note}</div></div>}
function Empty({title,body}:{title:string;body:string}){return <div className="empty-state"><span className="empty-icon"><Command size={20}/></span><b>{title}</b><p>{body}</p></div>}
