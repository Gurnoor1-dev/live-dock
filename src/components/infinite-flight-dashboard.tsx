"use client";

import { useCallback, useEffect, useMemo, useState, useRef, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import vbLogo from "@/assets/vb.png";
import maplibregl from "maplibre-gl";
import { Activity, ArrowUpRight, CalendarDays, Command, Compass, LogOut, Menu, Moon, Plane, RadioTower, RefreshCw, ShieldCheck, Sun, Users, X, Home as HomeIcon, PlaneTakeoff, Plug, ClipboardList, UserCog, SlidersHorizontal } from "lucide-react";

type Organization={id:string;name:string;role:number;description?:string|null;worldType:number;operationType:number};
type Aircraft={id:string;aircraftId:string;organizationId:string;registration:string;status:number;visibility:number;fleetPriority:number|null;fleetRank:number;isFleetActiveSlot:boolean};
type Member={userId:string;username:string|null;role:number;joinedAt:string;activeLifts:number};
type Crew={userId:string;username:string|null;role:number};
type Schedule={id:string;status:number;callsign:string;organizationId:string;aircraftId:string;flightType:number;originIcao:string;destinationIcao:string;isTimeless:boolean;scheduledDepartureUtc:string;scheduledArrivalUtc:string;briefing:string|null;flightPlan:string|null;crew:Crew[];sequence:number};
type Tab="Home"|"Schedules"|"My Flights"|"Organisation Dock"|"Admin Schedules"|"Integrations"|"Applications"|"User Management"|"Feature Selection"|"History";
type Position={id:string;state:number;isOnGround:boolean;latitude:number;longitude:number;altitude:number;heading:number;speed:number;verticalSpeed:number;lastPilotId?:string;lastPilotUsername?:string;updatedAt:string};
type AircraftType={id:string;name:string};
type GalleryPhoto={id:string;url:string;altText:string;caption:string;credit:{name:string;url:string;displayText:string};displayOrder:number;isVisible:boolean};
type GalleryManifest={settings:{maxPhotosPerAircraft:number;slideshowIntervalMs:number};aircraft:Record<string,{photos:GalleryPhoto[]}>};
const ORGANIZATION_ID="d50dcc80-8dac-4608-970c-61d6a4739488";

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
function aircraftCategory(code:string){const value=code.toUpperCase();if(/(A33|A34|A35|A38|B74|B76|B77|B78|B79|777|787|330|340|350|380|747|767|MD1|DC1)/.test(value))return "Wide-body";if(/(A19|A20|A21|B70|B71|B72|B73|B75|737|319|320|321|220|E17|E19|CRJ)/.test(value))return "Narrow-body";if(/(C17|C13|C30|C5|AN2|AN7|DH8)/.test(value))return "Regional / cargo";return "Unknown";}
function haversineKm(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){const rad=(n:number)=>n*Math.PI/180;const dLat=rad(b.latitude-a.latitude),dLon=rad(b.longitude-a.longitude);const value=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value));}

export function InfiniteFlightDashboard(){
  const [auth,setAuth]=useState<"checking"|"signed-out"|"signed-in">("checking");
  const [organization,setOrganization]=useState<Organization|null>(null);
  const [aircraft,setAircraft]=useState<Aircraft[]>([]);
  const [aircraftTypes,setAircraftTypes]=useState<AircraftType[]>([]);
  const [members,setMembers]=useState<Member[]>([]);
  const [schedules,setSchedules]=useState<Schedule[]>([]);
  const [active,setActive]=useState<Tab>("Home");
  const [theme,setTheme]=useState<"light"|"dark">("light");
  const [themeReady,setThemeReady]=useState(false);
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
  const mapContainer=useRef<HTMLDivElement|null>(null);
  const mapRef=useRef<maplibregl.Map|null>(null);
  const markerRefs=useRef<maplibregl.Marker[]>([]);
  const hubMarkerRefs=useRef<maplibregl.Marker[]>([]);
  const mapHasFitted=useRef(false);
  const [positions,setPositions]=useState<Record<string,Position>>({});
  const [selectedAircraft,setSelectedAircraft]=useState<Aircraft|null>(null);
  const [gallery,setGallery]=useState<GalleryManifest|null>(null);
  const [flightHistory,setFlightHistory]=useState<any[]>([]);
  const [photoIndex,setPhotoIndex]=useState(0);
  const [routeProgress,setRouteProgress]=useState<number|null>(null);
  const [parkedAirport,setParkedAirport]=useState<string>("Unknown");
  const airportCoordinateCache=useRef<Record<string,{latitude:number;longitude:number}>>({});
  const [galleryLoading,setGalleryLoading]=useState(false);
  const [galleryRegistration,setGalleryRegistration]=useState("");
  const [galleryCredit,setGalleryCredit]=useState("");
  const [galleryCreditUrl,setGalleryCreditUrl]=useState("");
  const [galleryCaption,setGalleryCaption]=useState("");
  const [galleryFile,setGalleryFile]=useState<File|null>(null);

  const canManage=Boolean(organization&&(organization.role===1||organization.role===2));
  const visibleAircraft=useMemo(()=>aircraft.filter(item=>item.registration.toLowerCase().includes(query.toLowerCase())),[aircraft,query]);
  const liveSchedules=schedules.filter(item=>[1,2,3,4,6].includes(item.status));
  const selectedPosition=selectedAircraft?positions[selectedAircraft.aircraftId]:undefined;
  const selectedActiveSchedule=selectedAircraft?schedules.find(item=>item.aircraftId===selectedAircraft.aircraftId&&[2,3,4,6].includes(item.status)):undefined;
  const selectedNextSchedule=selectedAircraft?schedules.filter(item=>item.aircraftId===selectedAircraft.aircraftId&&item.status===1&&!item.isTimeless&&new Date(item.scheduledDepartureUtc).getTime()>Date.now()).sort((a,b)=>new Date(a.scheduledDepartureUtc).getTime()-new Date(b.scheduledDepartureUtc).getTime())[0]:undefined;
  const selectedPhotos=selectedAircraft?(gallery?.aircraft?.[selectedAircraft.registration]?.photos||[]).filter(photo=>photo.isVisible).sort((a,b)=>a.displayOrder-b.displayOrder):[];

  useEffect(()=>{
    try{
      const saved=window.localStorage.getItem("vb-theme");
      if(saved==="light"||saved==="dark")setTheme(saved);
    }catch{}
    setThemeReady(true);
  },[]);

  useEffect(()=>{
    if(!themeReady)return;
    try{window.localStorage.setItem("vb-theme",theme);}catch{}
  },[theme,themeReady]);

  const loadOrganization=useCallback(async()=>{
    setBusy(true);setError("");setNotice("");
    try{
      const [organizationResult,aircraftResult,membersResult,scheduleResult]=await Promise.all([
        api("/live/organizations/"+ORGANIZATION_ID),
        api("/live/organizations/"+ORGANIZATION_ID+"/aircraft"),
        api("/live/organizations/"+ORGANIZATION_ID+"/members"),
        api("/live/organizations/"+ORGANIZATION_ID+"/schedules?page=1&pageSize=100")
      ]);
      setOrganization(organizationResult as Organization);
      setAircraft(Array.isArray(aircraftResult)?aircraftResult:[]);
      setMembers(Array.isArray(membersResult)?membersResult:[]);
      setSchedules(Array.isArray(scheduleResult)?scheduleResult:(scheduleResult?.items||[]));
    }catch(e){
      setOrganization(null);setAircraft([]);setMembers([]);setSchedules([]);
      setError(e instanceof Error?e.message:"Unable to load the Virtual Blue workspace.");
    }finally{setBusy(false);}
  },[]);

  useEffect(()=>{
    let mounted=true;
    (async()=>{
      try{
        const response=await fetch("/api/auth/if/session",{cache:"no-store"});
        const data=await response.json();
        if(!mounted)return;
        if(!data.authenticated){setAuth("signed-out");return;}
        setAuth("signed-in");
        await loadOrganization();
      }catch(e){
        if(mounted){setAuth("signed-in");setError(e instanceof Error?e.message:"Unable to connect to Virtual Blue.");}
      }
    })();
    return()=>{mounted=false;};
  },[loadOrganization]);


  useEffect(()=>{
    if(auth!=="signed-in"||!aircraft.length)return;
    let alive=true;
    const refreshPositions=async()=>{
      const entries=await Promise.all(aircraft.map(async item=>{
        try{
          const position=await api("/live/aircraft/"+item.id+"/position");
          return [item.aircraftId,position] as const;
        }catch{return null;}
      }));
      if(!alive)return;
      setPositions(()=>{
        const next:Record<string,Position>={};
        for(const entry of entries)if(entry&&entry[1]&&Number.isFinite(entry[1].latitude)&&Number.isFinite(entry[1].longitude))next[entry[0]]=entry[1] as Position;
        return next;
      });
    };
    void refreshPositions();
    const timer=window.setInterval(refreshPositions,15000);
    return()=>{alive=false;window.clearInterval(timer);};
  },[auth,aircraft]);

  useEffect(()=>{
    if(auth!=="signed-in")return;
    api("/aircraft").then(value=>setAircraftTypes(Array.isArray(value)?value:[])).catch(()=>setAircraftTypes([]));
    fetch("/api/if/gallery",{cache:"no-store"}).then(response=>response.ok?response.json():null).then(data=>{if(data?.aircraft)setGallery(data);}).catch(()=>{});
  },[auth]);

  useEffect(()=>{
    if(active!=="Home"||!mapContainer.current||!organization)return;
    mapHasFitted.current=false;
    const map=new maplibregl.Map({
      container:mapContainer.current,
      style:theme==="dark"?"https://tiles.openfreemap.org/styles/dark":"https://tiles.openfreemap.org/styles/positron",
      center:[75,25],zoom:3,attributionControl:{compact:true}
    });
    map.addControl(new maplibregl.NavigationControl({showCompass:true}),"top-right");
    mapRef.current=map;
    map.on("load",async()=>{
      const points=Object.values(positions).filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
      if(points.length>1){
        const bounds=new maplibregl.LngLatBounds();
        points.forEach(p=>bounds.extend([p.longitude,p.latitude]));
        map.fitBounds(bounds,{padding:70,maxZoom:6});
      }else if(points.length===1)map.flyTo({center:[points[0].longitude,points[0].latitude],zoom:5});
      const counts=new Map<string,number>();
      schedules.forEach(schedule=>{const code=(schedule.originIcao||"").toUpperCase();if(code)counts.set(code,(counts.get(code)||0)+1);});
      const hubs=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3);
      for(const [icao] of hubs){
        try{
          const airport=await api("/airport/"+icao);
          const latitude=Number(airport?.latitude??airport?.location?.latitude??airport?.coordinates?.latitude);
          const longitude=Number(airport?.longitude??airport?.location?.longitude??airport?.coordinates?.longitude);
          if(!Number.isFinite(latitude)||!Number.isFinite(longitude))continue;
          const element=document.createElement("div");element.className="vb-hub-marker";element.title=icao;
          element.style.backgroundImage="url("+vbLogo.src+")";
          const hub=new maplibregl.Marker({element,anchor:"bottom"}).setLngLat([longitude,latitude]).addTo(map);
          hubMarkerRefs.current.push(hub);
        }catch{}
      }
    });
    return()=>{markerRefs.current.forEach(marker=>marker.remove());markerRefs.current=[];hubMarkerRefs.current.forEach(marker=>marker.remove());hubMarkerRefs.current=[];map.remove();mapRef.current=null;};
  },[active,theme,organization,schedules]);

  useEffect(()=>{
    const map=mapRef.current;
    if(!map)return;
    markerRefs.current.forEach(marker=>marker.remove());
    markerRefs.current=[];
    for(const aircraftItem of aircraft){
      const position=positions[aircraftItem.aircraftId];
      if(!position||!Number.isFinite(position.latitude)||!Number.isFinite(position.longitude))continue;
      const color=position.state===2?"#111111":position.state===1?"#444444":position.state===5?"#777777":position.state===4?"#999999":position.state===3?"#555555":"#bbbbbb";
      const element=document.createElement("button");
      element.type="button";element.className="aircraft-map-marker";element.title=aircraftItem.registration;
      element.style.setProperty("--marker-color",color);
      element.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M15 1.8c-.8 0-1.4.7-1.4 1.5v9.2L3.2 18v2.2l10.4-3.1v8l-3.1 2.2v1.8l4.5-1.3 4.5 1.3v-1.8l-3.1-2.2v-8L26.8 20V18l-10.4-5.5V3.3c0-.8-.6-1.5-1.4-1.5Z" fill="'+color+'"/></svg>';
      element.addEventListener("click",()=>setSelectedAircraft(aircraftItem));
      const marker=new maplibregl.Marker({element,rotationAlignment:"map",pitchAlignment:"map"}).setLngLat([position.longitude,position.latitude]).setRotation(position.heading||0).addTo(map);
      markerRefs.current.push(marker);
    }
    if(!mapHasFitted.current){
      const points=Object.values(positions).filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
      if(points.length>1){const bounds=new maplibregl.LngLatBounds();points.forEach(p=>bounds.extend([p.longitude,p.latitude]));map.fitBounds(bounds,{padding:70,maxZoom:6});mapHasFitted.current=true;}
      else if(points.length===1){map.flyTo({center:[points[0].longitude,points[0].latitude],zoom:5});mapHasFitted.current=true;}
    }
  },[aircraft,positions]);

  useEffect(()=>{if(selectedAircraft)setPhotoIndex(0);},[selectedAircraft]);

  useEffect(()=>{
    let alive=true;
    const schedule=selectedActiveSchedule;
    const position=selectedPosition;
    if(!schedule||!position){setRouteProgress(null);return;}
    const getAirport=async(icao:string)=>{
      if(airportCoordinateCache.current[icao])return airportCoordinateCache.current[icao];
      const value=await api("/airport/"+icao);
      const coordinates={latitude:Number(value?.latitude??value?.location?.latitude??value?.coordinates?.latitude),longitude:Number(value?.longitude??value?.location?.longitude??value?.coordinates?.longitude)};
      if(Number.isFinite(coordinates.latitude)&&Number.isFinite(coordinates.longitude))airportCoordinateCache.current[icao]=coordinates;
      return coordinates;
    };
    Promise.all([getAirport(schedule.originIcao),getAirport(schedule.destinationIcao)]).then(([originPoint,destinationPoint])=>{
      if(!alive)return;
      const total=haversineKm(originPoint,destinationPoint);
      const travelled=haversineKm(originPoint,{latitude:position.latitude,longitude:position.longitude});
      setRouteProgress(total>0?Math.max(0,Math.min(100,Math.round(travelled/total*100))):null);
    }).catch(()=>{if(alive)setRouteProgress(null);});
    return()=>{alive=false;};
  },[selectedActiveSchedule?.id,selectedPosition?.latitude,selectedPosition?.longitude]);

  useEffect(()=>{
    if(!selectedAircraft||!selectedAircraft.aircraftId)return;
    setFlightHistory([]);
    let alive=true;
    api("/live/aircraft/"+selectedAircraft.id+"/flights?page=1&pageSize=50").then(value=>{
      if(alive)setFlightHistory(Array.isArray(value)?value:(value?.items||[]));
    }).catch(()=>{if(alive)setFlightHistory([]);});
    return()=>{alive=false;};
  },[selectedAircraft]);


  useEffect(()=>{
    let alive=true;
    if(!selectedAircraft||selectedPosition?.state!==1){setParkedAirport("Unknown");return;}
    const candidates=[selectedNextSchedule?.originIcao,flightHistory[0]?.destinationIcao,flightHistory[0]?.originIcao].filter((value,index,array):value is string=>Boolean(value)&&array.indexOf(value)===index);
    if(!candidates.length){setParkedAirport("Unknown");return;}
    Promise.all(candidates.map(async icao=>{
      const airport=await api("/airport/"+icao);
      const point={latitude:Number(airport?.latitude),longitude:Number(airport?.longitude)};
      if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude))return null;
      return {icao,name:airport?.name||icao,distance:haversineKm(point,{latitude:selectedPosition.latitude,longitude:selectedPosition.longitude})};
    })).then(results=>{
      if(!alive)return;
      const nearest=results.filter(Boolean).sort((a,b)=>a!.distance-b!.distance)[0];
      setParkedAirport(nearest&&nearest.distance<=15?nearest.icao+" · "+nearest.name:"Unknown");
    }).catch(()=>{if(alive)setParkedAirport("Unknown");});
    return()=>{alive=false;};
  },[selectedAircraft?.id,selectedPosition?.latitude,selectedPosition?.longitude,selectedPosition?.state,selectedNextSchedule?.id,flightHistory[0]?.id]);

  useEffect(()=>{
    if(selectedPhotos.length<2)return;
    const timer=window.setInterval(()=>setPhotoIndex(index=>(index+1)%selectedPhotos.length),gallery?.settings?.slideshowIntervalMs||2000);
    return()=>window.clearInterval(timer);
  },[selectedAircraft,selectedPhotos.length,gallery]);


  async function uploadAircraftPhoto(event:FormEvent){
    event.preventDefault();
    if(!canManage||!galleryRegistration||!galleryFile)return;
    setGalleryLoading(true);setError("");setNotice("");
    try{
      const form=new FormData();
      form.set("registration",galleryRegistration.trim().toUpperCase());
      form.set("file",galleryFile);
      form.set("creditName",galleryCredit);
      form.set("creditUrl",galleryCreditUrl);
      form.set("caption",galleryCaption);
      const response=await fetch("/api/if/gallery/upload",{method:"POST",body:form,credentials:"same-origin"});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||"Could not upload aircraft photo.");
      const manifestResponse=await fetch("/api/if/gallery",{cache:"no-store"});
      if(manifestResponse.ok)setGallery(await manifestResponse.json());
      setGalleryFile(null);setGalleryCredit("");setGalleryCreditUrl("");setGalleryCaption("");
      setNotice("Aircraft photo uploaded and added to the Blob manifest.");
    }catch(e){setError(e instanceof Error?e.message:"Could not upload aircraft photo.");}
    finally{setGalleryLoading(false);}
  }
  async function deleteAircraftPhoto(registration:string,photoId:string){
    if(!canManage)return;
    setGalleryLoading(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/if/gallery/photo",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({registration,photoId}),credentials:"same-origin"});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||"Could not delete aircraft photo.");
      const manifestResponse=await fetch("/api/if/gallery",{cache:"no-store"});
      if(manifestResponse.ok)setGallery(await manifestResponse.json());
      setNotice("Photo deleted from Blob and removed from the manifest.");
    }catch(e){setError(e instanceof Error?e.message:"Could not delete aircraft photo.");}
    finally{setGalleryLoading(false);}
  }

  async function refresh(){await loadOrganization();}
  async function signOut(){
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/auth/if/logout",{method:"POST",credentials:"same-origin",cache:"no-store"});
      if(!response.ok)throw new Error("Infinite Flight sign out failed. Please try again.");
      setAuth("signed-out");setOrganization(null);setAircraft([]);setMembers([]);setSchedules([]);setPositions({});setSelectedAircraft(null);setFlightHistory([]);
    }catch(e){setError(e instanceof Error?e.message:"Could not sign out of Infinite Flight.");}
    finally{setBusy(false);}
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

  if(auth==="checking")return <main className="auth-page"><div className="auth-card"><Image src={vbLogo} alt="Virtual Blue" className="brand-logo" priority/><h1>Preparing your flight deck</h1><p className="muted">Checking your Infinite Flight session…</p></div></main>;
  if(auth==="signed-out")return <main className="landing-page">
    <div className="landing-glow landing-glow-one"/><div className="landing-glow landing-glow-two"/>
    <header className="landing-header">
      <Link href="/" className="landing-brand"><Image src={vbLogo} alt="Virtual Blue" priority/><span><b>VIRTUAL BLUE</b><small>FLEET OPERATIONS</small></span></Link>
      <div className="landing-header-right"><span className="landing-secure"><i/> INFINITE FLIGHT CONNECT</span><span className="landing-version">LIVE API V3</span></div>
    </header>
    <section className="landing-hero">
      <div className="landing-copy">
        <div className="landing-kicker"><span/> THE VIRTUAL BLUE FLIGHT DECK <b>·</b> LIVE</div>
        <h1>Every aircraft.<br/><em>One clear view.</em></h1>
        <p className="landing-description">Your airline, in motion. Follow the Virtual Blue fleet in real time, explore aircraft details and keep every operation in sync with Infinite Flight.</p>
        <div className="landing-actions">
          <button className="landing-signin" onClick={()=>window.location.assign("/api/auth/if/login")}><span className="landing-signin-icon"><ArrowUpRight size={18}/></span>Sign in with Infinite Flight<ArrowUpRight className="landing-signin-arrow" size={17}/></button>
          <span className="landing-auth-note"><ShieldCheck size={14}/> Secure OAuth 2.0 · No separate password</span>
        </div>
        <div className="landing-divider"/>
        <div className="landing-highlights"><div><span className="landing-highlight-icon"><RadioTower size={16}/></span><span><b>Live fleet tracking</b><small>Aircraft positions and status</small></span></div><div><span className="landing-highlight-icon"><Compass size={16}/></span><span><b>Flight operations</b><small>Schedules, crew and history</small></span></div><div><span className="landing-highlight-icon"><Activity size={16}/></span><span><b>Always in sync</b><small>Powered by Infinite Flight Live</small></span></div></div>
      </div>
      <div className="landing-art" aria-hidden="true">
        <div className="landing-orbit landing-orbit-one"/><div className="landing-orbit landing-orbit-two"/>
        <img className="landing-globe" src="https://raw.githubusercontent.com/Gurnoor1-dev/live-dock/main/example/fleet-globe.png" alt=""/>
        <img className="landing-yoke" src="https://raw.githubusercontent.com/Gurnoor1-dev/live-dock/main/example/fleet-yoke.png" alt=""/>
        <div className="landing-art-caption"><span>VB</span><div><b>VIRTUAL BLUE</b><small>BUILT FOR THE WAY YOU FLY</small></div></div>
      </div>
    </section>
    <footer className="landing-footer"><span>© {new Date().getFullYear()} Virtual Blue</span><span>AN INFINITE FLIGHT VIRTUAL AIRLINE</span><span><i/> SYSTEM READY</span></footer>
  </main>;

  return <div className="app-frame" data-theme={theme}>
    <aside className={`sidebar ${mobileNav?"open":""}`}>
      <div className="brand"><Image src={vbLogo} alt="Virtual Blue" className="brand-logo" priority/><span>VIRTUAL BLUE<small>FLEET OPERATIONS</small></span><button className="icon-button mobile-close" onClick={()=>setMobileNav(false)} aria-label="Close menu"><X size={18}/></button></div>
      <div className="user-row sidebar-account"><div className="avatar">IF</div><span><b>Infinite Flight pilot</b><small>{organization?roleName(organization.role):"Signed in"}</small></span><button className="signout-button" onClick={signOut} disabled={busy} title="Sign out of Infinite Flight"><LogOut size={15}/><span>Sign out</span></button></div>
      <div className="sidebar-section">
        <p className="nav-caption">PILOT</p>
        <nav>
          {([{label:"Home",icon:<HomeIcon size={17}/>},{label:"Schedules",icon:<CalendarDays size={17}/>},{label:"My Flights",icon:<PlaneTakeoff size={17}/>},{label:"Organisation Dock",icon:<Compass size={17}/>} ] as {label:Tab;icon:ReactNode}[]).map(item=><button key={item.label} className={active===item.label?"nav-item active":"nav-item"} onClick={()=>{setActive(item.label);setMobileNav(false);}}>{item.icon}<span>{item.label}</span></button>)}
        </nav>
      </div>
      {canManage&&<div className="sidebar-section admin-sidebar-section">
        <p className="nav-caption">ADMIN</p>
        <nav>
          {([{label:"Admin Schedules",icon:<CalendarDays size={17}/>},{label:"Integrations",icon:<Plug size={17}/>},{label:"Applications",icon:<ClipboardList size={17}/>},{label:"User Management",icon:<UserCog size={17}/>},{label:"Feature Selection",icon:<SlidersHorizontal size={17}/>} ] as {label:Tab;icon:ReactNode}[]).map(item=><button key={item.label} className={active===item.label?"nav-item active":"nav-item"} onClick={()=>{setActive(item.label);setMobileNav(false);}}>{item.icon}<span>{item.label==="Admin Schedules"?"Schedules":item.label}</span></button>)}
        </nav>
      </div>}

    </aside>
    {mobileNav&&<button className="mobile-scrim" onClick={()=>setMobileNav(false)} aria-label="Close navigation"/>}
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={()=>setMobileNav(true)} aria-label="Open menu"><Menu size={19}/></button><span className="breadcrumb">Virtual Blue <b>/</b> {active==="Admin Schedules"?"Admin / Schedules":active}</span></div><div className="topbar-actions"><span className="live-indicator"><i/> IF API connected</span><button className="icon-button" onClick={refresh} aria-label="Refresh Infinite Flight data" title="Refresh"><RefreshCw size={16}/></button><button className={`theme-switch ${theme}`} onClick={()=>setTheme(theme==="light"?"dark":"light")} aria-label={`Switch to ${theme==="light"?"dark":"light"} theme`} aria-pressed={theme==="dark"} title={`Switch to ${theme==="light"?"dark":"light"} theme`}><span className="theme-switch-copy"><span className="theme-switch-icon">{theme==="light"?<Sun size={15}/>:<Moon size={15}/>}</span><span>{theme==="light"?"Light":"Dark"}</span></span><span className="theme-switch-track" aria-hidden="true"><span className="theme-switch-thumb"/></span></button></div></header>
      <div className="content">
        <div className="page-heading"><div><p className="eyebrow">VIRTUAL BLUE · INFINITE FLIGHT LIVE</p><h1>{active==="Admin Schedules"?"Schedules":active}</h1><p className="muted">{active==="Home"?"Your Virtual Blue flight deck, live fleet and operational overview.":active==="Schedules"?"Browse the organisation flight schedule.":active==="My Flights"?"Your flight history, active crew assignments and booked flights.":active==="Organisation Dock"?"Organisation information, resources and operational links.":active==="Admin Schedules"?"Publish, revise and manage Virtual Blue schedules.":active==="Integrations"?"Configure connected services and Discord operations.":active==="Applications"?"Review pilot access applications and approved IFC usernames.":active==="User Management"?"Manage registered and pending organisation users.":"Choose which premium operational features are enabled for this organisation."}</p></div><div className="heading-actions"><span className="date-chip"><CalendarDays size={15}/>{new Intl.DateTimeFormat("en",{dateStyle:"medium"}).format(new Date())}</span></div></div>
        {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="form-success" role="status">{notice}</p>}
        {!organization&&<section className="section-card"><div className="empty-state"><span className="empty-icon"><Compass size={20}/></span><b>Virtual Blue workspace unavailable</b><p>This Infinite Flight account could not access the configured Virtual Blue organisation. Confirm that your account is a member and has the required API permissions, then try again.</p><button className="outline-button" onClick={()=>void loadOrganization()} disabled={busy}>{busy?"Connecting…":"Retry connection"}</button></div></section>}
        {organization&&<><div className="stat-grid"><Stat label="Fleet aircraft" value={aircraft.length} icon={<Plane/>} note="From Live organisation"/><Stat label="Live schedules" value={schedules.length} icon={<CalendarDays/>} note="Open fleet schedules"/><Stat label="Organisation members" value={members.length} icon={<Users/>} note="Current membership"/><Stat label="Active legs" value={liveSchedules.length} icon={<RadioTower/>} note="Boarding through in-flight"/></div>
        {active==="Home"&&<div className="fleet-layout">
          <section className="section-card fleet-map-card">
            <div className="section-head"><div><h2>Live fleet map</h2><p>Aircraft positions refresh every 15 seconds. Heading follows the Infinite Flight true-heading value.</p></div><span className="count-pill">{Object.keys(positions).length} live positions</span></div>
            <div className="map-legend"><span><i className="legend-flight"/>In flight</span><span><i className="legend-ground"/>On ground</span><span><i className="legend-maintenance"/>Maintenance</span><span><i className="legend-stopped"/>Stopped</span><span><i className="legend-unknown"/>Unknown</span></div>
            <div ref={mapContainer} className="fleet-map" aria-label="Virtual Blue live aircraft map"/>
          </section>
          <section className="section-card fleet-list-card">
            <div className="section-head"><div><h2>Fleet aircraft</h2><p>Select an aircraft to inspect its live details.</p></div><span className="count-pill">{visibleAircraft.length}</span></div>
            <div className="search-field"><Plane size={15}/><input placeholder="Search registration" value={query} onChange={e=>setQuery(e.target.value)}/></div>
            <div className="fleet-aircraft-list">{visibleAircraft.map(item=>{const pos=positions[item.aircraftId];return <button key={item.id} className={"fleet-aircraft-row "+(selectedAircraft?.id===item.id?"selected":"")} onClick={()=>setSelectedAircraft(item)}><span className="fleet-row-icon"><Plane size={16}/></span><span className="fleet-row-copy"><b>{item.registration}</b><small>{pos?.state===2?"In flight":pos?.state===1?"On ground":pos?.state===5?"Maintenance":pos?.state===4?"Stopped":"Position unavailable"}</small></span><span className="fleet-row-number">#{item.fleetRank}</span></button>;})}</div>
          </section>
          {selectedAircraft&&<section className="section-card aircraft-detail-card">
            <div className="section-head"><div><p className="eyebrow">AIRCRAFT RECORD</p><h2>{selectedAircraft.registration}</h2><p>Fleet number #{selectedAircraft.fleetRank} · {selectedPosition?.state===2?"In flight":selectedPosition?.state===1?"On ground":selectedPosition?.state===5?"Maintenance":selectedPosition?.state===4?"Stopped":"Status unknown"}</p></div><button className="icon-button" onClick={()=>setSelectedAircraft(null)} aria-label="Close aircraft details"><X size={17}/></button></div>
            {selectedPhotos.length>0&&<div className="aircraft-photo-frame"><img key={selectedPhotos[photoIndex]?.id} src={selectedPhotos[photoIndex]?.url} alt={selectedPhotos[photoIndex]?.altText||selectedAircraft.registration}/>{selectedPhotos[photoIndex]?.caption&&<span className="photo-caption">{selectedPhotos[photoIndex].caption}</span>}{selectedPhotos[photoIndex]?.credit?.displayText&&<span className="photo-credit">{selectedPhotos[photoIndex].credit.displayText}</span>}</div>}
            <div className="aircraft-route-card"><div><small>{selectedPosition?.state===2?"Current flight":"Next flight"}</small><b>{selectedActiveSchedule?.callsign||selectedNextSchedule?.callsign||"No scheduled flight"}</b></div><strong>{selectedActiveSchedule?selectedActiveSchedule.originIcao+" → "+selectedActiveSchedule.destinationIcao:selectedNextSchedule?selectedNextSchedule.originIcao+" → "+selectedNextSchedule.destinationIcao:"Route not scheduled"}</strong><span>{selectedActiveSchedule?"In progress":selectedNextSchedule?(selectedNextSchedule.crew?.length?"Crew assigned":"Ready to fly"):selectedPosition?.state===1?"Ready to fly":"No upcoming leg"}</span></div><div className="aircraft-facts"><div><small>Aircraft type</small><b>{aircraftTypes.find(type=>type.id===selectedAircraft.aircraftId)?.name||"Unknown"}</b></div><div><small>Aircraft ICAO</small><b>{"Not supplied by Infinite Flight API"}</b></div><div><small>Aircraft category</small><b>{aircraftCategory(aircraftTypes.find(type=>type.id===selectedAircraft.aircraftId)?.name||"")}</b></div><div><small>Flight number</small><b>{selectedActiveSchedule?.callsign||"Unknown"}</b></div><div><small>Estimated route progress</small><b>{routeProgress===null?"Unknown":routeProgress+"%"}</b></div><div><small>Departure / scheduled ETA</small><b>{selectedActiveSchedule?dateTime(selectedActiveSchedule.scheduledDepartureUtc)+" / "+dateTime(selectedActiveSchedule.scheduledArrivalUtc):selectedNextSchedule?dateTime(selectedNextSchedule.scheduledDepartureUtc):"Unknown"}</b></div><div><small>Heading</small><b>{selectedPosition?Math.round(selectedPosition.heading)+"°":"Unknown"}</b></div><div><small>Last pilot</small><b>{selectedPosition?.lastPilotUsername||"Unknown"}</b></div><div><small>Altitude</small><b>{selectedPosition?Math.round(selectedPosition.altitude).toLocaleString()+" ft":"Unknown"}</b></div><div><small>Ground speed</small><b>{selectedPosition?Math.round(selectedPosition.speed)+" kt":"Unknown"}</b></div><div><small>Vertical speed</small><b>{selectedPosition?Math.round(selectedPosition.verticalSpeed)+" ft/min":"Unknown"}</b></div><div><small>Last update</small><b>{selectedPosition?.updatedAt?dateTime(selectedPosition.updatedAt):"Unknown"}</b></div><div><small>Last flown</small><b>{flightHistory[0]?.actualArrivalUtc?dateTime(flightHistory[0].actualArrivalUtc):flightHistory[0]?.actualDepartureUtc?dateTime(flightHistory[0].actualDepartureUtc):"Unknown"}</b></div><div><small>Parked at</small><b>{selectedPosition?.state===1?parkedAirport:"—"}</b></div><div><small>Last movement</small><b>{selectedPosition?.updatedAt?dateTime(selectedPosition.updatedAt):"Unknown"}</b></div><div><small>Schedules</small><b>{schedules.filter(item=>item.aircraftId===selectedAircraft.aircraftId).length}</b></div></div>
            <div className="aircraft-detail-actions"><button className="outline-button" onClick={()=>setActive("History")}>View flight history</button><button className="outline-button" onClick={()=>{setActive("Schedules");setQuery(selectedAircraft.registration);}}>View schedules</button></div>
          </section>}
        </div>}
        {active==="Schedules"&&<section className="section-card"><div className="section-head"><div><h2>Fleet schedules</h2><p>Schedule changes are written directly to Infinite Flight.</p></div><span className="count-pill">{schedules.length} schedules</span></div>{schedules.length?<div className="table-wrap"><table><thead><tr><th>Flight number</th><th>Route</th><th>Departure</th><th>Arrival</th><th>Status</th><th>Crew</th></tr></thead><tbody>{schedules.filter(s=>!selectedAircraft||s.aircraftId===selectedAircraft.aircraftId).map(s=><tr key={s.id}><td className="mono"><b>{s.callsign}</b></td><td className="mono">{s.originIcao} → {s.destinationIcao}</td><td>{dateTime(s.scheduledDepartureUtc,s.isTimeless)}</td><td>{dateTime(s.scheduledArrivalUtc,s.isTimeless)}</td><td><span className="status scheduled"><i/>{statusName(s.status)}</span></td><td>{s.crew?.length||0}/3</td></tr>)}</tbody></table></div>:<Empty title="No open schedules" body="When Virtual Blue publishes schedules in Infinite Flight, they will appear here."/>}</section>}
        {active==="Integrations"&&<section className="section-card"><div className="section-head"><div><h2>Integrations</h2><p>Discord connections, message destinations and embed presentation.</p></div><Plug size={18}/></div><Empty title="Integrations workspace created" body="Discord integration settings will live here, including embed channels, message content, layouts and delivery preferences."/></section>}
        {active==="Applications"&&<section className="section-card"><div className="section-head"><div><h2>Pilot applications</h2><p>Review access requests against approved Infinite Flight usernames.</p></div><ClipboardList size={18}/></div><Empty title="Application review is ready" body="Applications will be reviewed here before a pilot is allowed to sign in. Pending, approved and rejected application states will be added in a later step."/></section>}
        {active==="User Management"&&<section className="section-card"><div className="section-head"><div><h2>User management</h2><p>Registered users and pilots who have not registered or been approved.</p></div><UserCog size={18}/></div><Empty title="User directory is ready" body="This page will separate registered, approved users from unregistered pilots and applicants who are still awaiting a decision."/></section>}
        {active==="Feature Selection"&&<section className="section-card"><div className="section-head"><div><h2>Feature selection</h2><p>Enable or disable premium organisation capabilities.</p></div><SlidersHorizontal size={18}/></div><Empty title="Feature controls are ready" body="Organisation admins will be able to enable or disable premium features such as Auto-Crew and Schedule Revisor here."/></section>}
        {active==="History"&&<section className="section-card"><div className="section-head"><div><p className="eyebrow">AIRCRAFT HISTORY</p><h2>{selectedAircraft?selectedAircraft.registration:"Select an aircraft"}</h2><p>Flight records are requested from Infinite Flight when this page is opened.</p></div></div>{selectedAircraft?(flightHistory.length?<div className="table-wrap"><table><thead><tr><th>Flight date</th><th>Route</th><th>Departure</th><th>Arrival</th><th>Duration</th><th>Pilots</th></tr></thead><tbody>{flightHistory.map((flight,index)=><tr key={flight.id||index}><td>{dateTime(flight.actualDepartureUtc||flight.actualArrivalUtc)}</td><td>{flight.originIcao||"—"} → {flight.destinationIcao||"—"}</td><td>{dateTime(flight.actualDepartureUtc)}</td><td>{dateTime(flight.actualArrivalUtc)}</td><td>{typeof flight.flightTimeMinutes==="number"?Math.round(flight.flightTimeMinutes)+" min":"—"}</td><td>{flight.crew?.map((pilot:any)=>pilot.username).filter(Boolean).join(", ")||"Unknown"}</td></tr>)}</tbody></table></div>:<Empty title="No flight history returned" body="Infinite Flight did not return any flight records for this aircraft."/>) : <Empty title="Choose an aircraft first" body="Return to Fleet and select an aircraft to inspect its flight history."/>}</section>}
{active==="Organisation Dock"&&<section className="section-card"><div className="section-head"><div><h2>Organisation Dock</h2><p>Organisation profile and resources will be assembled here.</p></div><Compass size={18}/></div><Empty title="Organisation Dock is ready for content" body="This page will combine selected Infinite Flight organisation details with Virtual Blue resources and information maintained in the application."/></section>}
        {active==="My Flights"&&<section className="section-card"><div className="section-head"><div><h2>My Flights</h2><p>Your completed flights, active crew assignments and future bookings.</p></div><PlaneTakeoff size={18}/></div><Empty title="Your flight centre is ready" body="This page will bring together your past flight records, flights you are currently operating as crew, and future flights you have booked."/></section>}
        {active==="Admin Schedules"&&(canManage?<><div className="admin-grid"><section className="section-card"><div className="section-head"><div><h2>Publish a schedule</h2><p>Creates the schedule on Infinite Flight, not in a local database.</p></div><CalendarDays size={17}/></div><form className="admin-form" onSubmit={createSchedule}><label>Flight number<input required maxLength={32} value={callsign} onChange={e=>setCallsign(e.target.value.toUpperCase())} placeholder="VB 101"/></label><label>Aircraft<select required value={aircraftId} onChange={e=>setAircraftId(e.target.value)}><option value="">Select aircraft</option>{aircraft.map(a=><option key={a.id} value={a.id}>{a.registration} · Fleet rank {a.fleetRank}</option>)}</select></label><div className="form-two"><label>Origin ICAO<input required maxLength={8} value={origin} onChange={e=>setOrigin(e.target.value.toUpperCase())} placeholder="VIDP"/></label><label>Destination ICAO<input required maxLength={8} value={destination} onChange={e=>setDestination(e.target.value.toUpperCase())} placeholder="VABB"/></label></div><label className="check-line"><input type="checkbox" checked={timeless} onChange={e=>setTimeless(e.target.checked)}/> Timeless schedule</label>{!timeless&&<div className="form-two"><label>Departure (local time)<input required type="datetime-local" value={departure} onChange={e=>setDeparture(e.target.value)}/></label><label>Arrival (local time)<input required type="datetime-local" value={arrival} onChange={e=>setArrival(e.target.value)}/></label></div>}<label>Briefing<input maxLength={4000} value={briefing} onChange={e=>setBriefing(e.target.value)} placeholder="Flight briefing (optional)"/></label><button className="primary-button" disabled={busy||!aircraft.length}>{busy?"Publishing…":"Publish to Infinite Flight"} <ArrowUpRight size={14}/></button></form></section><section className="section-card"><div className="section-head"><div><h2>Manage schedule crew</h2><p>Assign an organisation member to a schedule.</p></div><Users size={17}/></div>{schedules.length?schedules.map(s=><div className="crew-editor" key={s.id}><b>{s.callsign} · {s.originIcao} → {s.destinationIcao}</b><div className="form-two"><select value={crewSelections[s.id]||""} onChange={e=>setCrewSelections(v=>({...v,[s.id]:e.target.value}))}><option value="">Select member</option>{members.map(m=><option key={m.userId} value={m.userId}>{m.username||m.userId}</option>)}</select><select value={crewRoles[s.id]||"0"} onChange={e=>setCrewRoles(v=>({...v,[s.id]:e.target.value}))}><option value="0">Captain</option><option value="1">First Officer</option></select></div><button className="outline-button" disabled={busy||!crewSelections[s.id]} onClick={()=>void assignCrew(s)}>Assign crew member</button></div>):<Empty title="No schedules to manage" body="Publish a schedule first, then assign up to three crew members." />}</section></div>
          <section className="section-card gallery-admin-card">
            <div className="section-head"><div><h2>Aircraft photo gallery</h2><p>Images and the editable manifest are stored in Vercel Blob. Up to four images per registration.</p></div><span className="count-pill">{Object.values(gallery?.aircraft||{}).reduce((sum,item)=>sum+item.photos.length,0)} photos</span></div>
            <form className="admin-form gallery-upload-form" onSubmit={uploadAircraftPhoto}>
              <div className="form-two"><label>Aircraft registration<input required value={galleryRegistration} onChange={e=>setGalleryRegistration(e.target.value.toUpperCase())} placeholder="N123VB"/></label><label>Photographer credit<input value={galleryCredit} onChange={e=>setGalleryCredit(e.target.value)} placeholder="Photographer name"/></label></div>
              <div className="form-two"><label>Credit link (optional)<input type="url" value={galleryCreditUrl} onChange={e=>setGalleryCreditUrl(e.target.value)} placeholder="https://…"/></label><label>Caption (optional)<input value={galleryCaption} onChange={e=>setGalleryCaption(e.target.value)} placeholder="Aircraft at the gate"/></label></div>
              <label>Aircraft image (JPEG, PNG or WebP · max 4 MB)<input required type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setGalleryFile(e.target.files?.[0]||null)}/></label>
              <button className="primary-button" disabled={galleryLoading||!galleryFile}>{galleryLoading?"Uploading…":"Upload aircraft photo"}</button>
            </form>
            <div className="gallery-admin-list">{Object.entries(gallery?.aircraft||{}).map(([registration,entry])=><div className="gallery-admin-entry" key={registration}><b>{registration}</b><div className="gallery-admin-photos">{entry.photos.map(photo=><div className="gallery-admin-photo" key={photo.id}><img src={photo.url} alt={photo.altText}/><span>{photo.credit?.displayText||"No photo credit"}</span><button className="row-action danger" disabled={galleryLoading} onClick={()=>void deleteAircraftPhoto(registration,photo.id)}>Delete</button></div>)}</div></div>)}</div>
            <p className="fine-print">Manual Vercel upload: put images in <code>aircraft-gallery/images/</code>, then edit <code>aircraft-gallery/manifest.json</code>. Add the image URL and pathname to the matching registration’s <code>photos</code> array. Keep the array at four or fewer entries.</p>
          </section></>:<section className="section-card"><Empty title="Administrator access required" body="Only Infinite Flight organisation owners and admins can publish schedules or manage schedule crew."/></section>)}
        <footer className="footer"><span>© {new Date().getFullYear()} Virtual Blue</span><span>Powered by Infinite Flight PublicApi v3</span><span>Live data · No permanent API data storage</span></footer>
      </div>
    </main>
  </div>;
}

function Stat({label,value,note,icon}:{label:string;value:number;note:string;icon:ReactNode}){return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value.toLocaleString()}</strong><div className="stat-note">{note}</div></div>}
function Empty({title,body}:{title:string;body:string}){return <div className="empty-state"><span className="empty-icon"><Command size={20}/></span><b>{title}</b><p>{body}</p></div>}
