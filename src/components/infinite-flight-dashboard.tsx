"use client";

/* Existing effects intentionally synchronize browser-backed state after mount. */
/* eslint-disable react-hooks/purity, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState, useRef, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { HomePage } from "@/components/workspace/pages/home-page";
import { SchedulesPage } from "@/components/workspace/pages/schedules-page";
import { HistoryPage } from "@/components/workspace/pages/history-page";
import { AdminSchedulesPage } from "@/components/workspace/pages/admin-schedules-page";
import { MyFlightsPage } from "@/components/workspace/pages/my-flights-page";
import { OrganisationDockPage } from "@/components/workspace/pages/organisation-dock-page";
import { IntegrationsPage } from "@/components/workspace/pages/integrations-page";
import { ApplicationsPage } from "@/components/workspace/pages/applications-page";
import { UserManagementPage } from "@/components/workspace/pages/user-management-page";
import { FeatureSelectionPage } from "@/components/workspace/pages/feature-selection-page";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { OnboardingGate } from "@/components/workspace/onboarding-gate";

import Link from "next/link";
import Image from "next/image";
import vbLogo from "@/assets/vb.png";
import maplibregl from "maplibre-gl";
import { Activity, ArrowUpRight, Building2, CalendarDays, ClipboardList, Compass, LogOut, Menu, Moon, Plane, PlaneTakeoff, Plug, RadioTower, RefreshCw, ShieldCheck, SlidersHorizontal, Sun, UserRoundCog, X } from "lucide-react";

type Organization={id:string;name:string;role:number;description?:string|null;worldType:number;operationType:number};
type Aircraft={id:string;aircraftId:string;organizationId:string;registration:string;status:number;visibility:number;fleetPriority:number|null;fleetRank:number;isFleetActiveSlot:boolean};
type Member={userId:string;username:string|null;role:number;joinedAt:string;activeLifts:number};
type Crew={userId:string;username:string|null;role:number};
type Schedule={id:string;status:number;callsign:string;organizationId:string;aircraftId:string;flightType:number;originIcao:string;destinationIcao:string;isTimeless:boolean;scheduledDepartureUtc:string;scheduledArrivalUtc:string;briefing:string|null;flightPlan:string|null;crew:Crew[];sequence:number};
type FlightHistoryCrewMember={username?:string|null;userId?:string};
type FlightHistoryRecord={id?:string;actualDepartureUtc?:string;actualArrivalUtc?:string;originIcao?:string;destinationIcao?:string;flightTimeMinutes?:number;crew?:FlightHistoryCrewMember[]};
type Tab="Home"|"Schedules"|"My Flights"|"Organisation Dock"|"Admin Schedules"|"Integrations"|"Applications"|"User Management"|"Feature Selection"|"History";
type Position={id:string;state:number;isOnGround:boolean;latitude:number;longitude:number;altitude:number;heading:number;speed:number;verticalSpeed:number;lastPilotId?:string;lastPilotUsername?:string;updatedAt:string};
type AircraftType={id:string;name:string};
type GalleryPhoto={id:string;url:string;altText:string;caption:string;credit:{name:string;url:string;displayText:string};displayOrder:number;isVisible:boolean};
type GalleryManifest={settings:{maxPhotosPerAircraft:number;slideshowIntervalMs:number};aircraft:Record<string,{photos:GalleryPhoto[]}>};
type WorkspaceSnapshot={organization:Organization|null;aircraft:Aircraft[];members:Member[];schedules:Schedule[];refreshedAt:number};
let sharedWorkspaceSnapshot:WorkspaceSnapshot|null=null;
const sharedPositions:Record<string,Position>={};
let positionsRefreshedAt=0;
let supportingDataLoaded=false;
let sharedAircraftTypes:AircraftType[]=[];
let sharedGallery:GalleryManifest|null=null;
const WORKSPACE_REFRESH_MS=90_000;

const ORGANIZATION_ID="d50dcc80-8dac-4608-970c-61d6a4739488";
const PAGE_ROUTES:Record<Tab,string>={
  "Home":"/home",
  "Schedules":"/schedules",
  "My Flights":"/my-flights",
  "Organisation Dock":"/organisation-dock",
  "Admin Schedules":"/admin/schedules",
  "Integrations":"/admin/integrations",
  "Applications":"/admin/applications",
  "User Management":"/admin/users",
  "Feature Selection":"/admin/features",
  "History":"/history"
};

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
function dateTime(value:string|undefined,timeless=false){return timeless?"Timeless":value?.startsWith("0001-")?"—":value?new Date(value).toLocaleString():"—";}
function aircraftCategory(code:string){const value=code.toUpperCase();if(/(A33|A34|A35|A38|B74|B76|B77|B78|B79|777|787|330|340|350|380|747|767|MD1|DC1)/.test(value))return "Wide-body";if(/(A19|A20|A21|B70|B71|B72|B73|B75|737|319|320|321|220|E17|E19|CRJ)/.test(value))return "Narrow-body";if(/(C17|C13|C30|C5|AN2|AN7|DH8)/.test(value))return "Regional / cargo";return "Unknown";}
function haversineKm(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){const rad=(n:number)=>n*Math.PI/180;const dLat=rad(b.latitude-a.latitude),dLon=rad(b.longitude-a.longitude);const value=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value));}

export function InfiniteFlightDashboard({initialPage="Home"}:{initialPage?:Tab}={}){
  const router=useRouter();
  const [auth,setAuth]=useState<"checking"|"signed-out"|"signed-in">("checking");
  const [organization,setOrganization]=useState<Organization|null>(sharedWorkspaceSnapshot?.organization??null);
  const [aircraft,setAircraft]=useState<Aircraft[]>(sharedWorkspaceSnapshot?.aircraft??[]);
  const [aircraftTypes,setAircraftTypes]=useState<AircraftType[]>(sharedAircraftTypes);
  const [members,setMembers]=useState<Member[]>(sharedWorkspaceSnapshot?.members??[]);
  const [schedules,setSchedules]=useState<Schedule[]>(sharedWorkspaceSnapshot?.schedules??[]);
  const [active,setActive]=useState<Tab>(initialPage);
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
  const [positions,setPositions]=useState<Record<string,Position>>(sharedPositions);
  const [selectedAircraft,setSelectedAircraft]=useState<Aircraft|null>(null);
  const [gallery,setGallery]=useState<GalleryManifest|null>(sharedGallery);
  const [flightHistory,setFlightHistory]=useState<FlightHistoryRecord[]>([]);
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
  const navigatePage=useCallback((page:Tab)=>{
    setActive(page);
    setMobileNav(false);
    router.push(PAGE_ROUTES[page]);
  },[router]);

  useEffect(()=>{setActive(initialPage);},[initialPage]);
  const visibleAircraft=useMemo(()=>aircraft.filter(item=>item.registration.toLowerCase().includes(query.toLowerCase())),[aircraft,query]);
  const liveSchedules=schedules.filter(item=>[1,2,3,4,6].includes(item.status));
  const selectedPosition=selectedAircraft?positions[selectedAircraft.id]:undefined;
  const selectedActiveSchedule=selectedAircraft?schedules.find(item=>item.aircraftId===selectedAircraft.id&&[2,3,4,6].includes(item.status)):undefined;
  const selectedNextSchedule=selectedAircraft?schedules.filter(item=>item.aircraftId===selectedAircraft.id&&item.status===1&&!item.isTimeless&&new Date(item.scheduledDepartureUtc).getTime()>Date.now()).sort((a,b)=>new Date(a.scheduledDepartureUtc).getTime()-new Date(b.scheduledDepartureUtc).getTime())[0]:undefined;
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

  const loadOrganization=useCallback(async(force=false)=>{
    if(!force&&sharedWorkspaceSnapshot&&Date.now()-sharedWorkspaceSnapshot.refreshedAt<WORKSPACE_REFRESH_MS){
      setOrganization(sharedWorkspaceSnapshot.organization);
      setAircraft(sharedWorkspaceSnapshot.aircraft);
      setMembers(sharedWorkspaceSnapshot.members);
      setSchedules(sharedWorkspaceSnapshot.schedules);
      return;
    }
    setBusy(true);setError("");setNotice("");
    try{
      const [organizationResult,aircraftResult,membersResult,scheduleResult]=await Promise.all([
        api("/live/organizations/"+ORGANIZATION_ID),
        api("/live/organizations/"+ORGANIZATION_ID+"/aircraft"),
        api("/live/organizations/"+ORGANIZATION_ID+"/members"),
        api("/live/organizations/"+ORGANIZATION_ID+"/schedules?page=1&pageSize=100")
      ]);
      const next={organization:organizationResult as Organization,aircraft:Array.isArray(aircraftResult)?aircraftResult:[],members:Array.isArray(membersResult)?membersResult:[],schedules:Array.isArray(scheduleResult)?scheduleResult:(scheduleResult?.items||[]),refreshedAt:Date.now()};
      sharedWorkspaceSnapshot=next;
      setOrganization(next.organization);setAircraft(next.aircraft);setMembers(next.members);setSchedules(next.schedules);
    }catch(e){
      setError(e instanceof Error?e.message:"Unable to refresh the Virtual Blue workspace.");
      if(!sharedWorkspaceSnapshot){setOrganization(null);setAircraft([]);setMembers([]);setSchedules([]);}
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
    if(auth!=="signed-in")return;
    let lastActivityAt=Date.now();
    const markActivity=()=>{lastActivityAt=Date.now();};
    const refreshIfActive=()=>{if(document.visibilityState==="visible"&&Date.now()-lastActivityAt<15*60_000)void loadOrganization(true);};
    window.addEventListener("pointerdown",markActivity,{passive:true});
    window.addEventListener("keydown",markActivity);
    window.addEventListener("touchstart",markActivity,{passive:true});
    document.addEventListener("visibilitychange",refreshIfActive);
    const timer=window.setInterval(refreshIfActive,WORKSPACE_REFRESH_MS);
    return()=>{window.clearInterval(timer);window.removeEventListener("pointerdown",markActivity);window.removeEventListener("keydown",markActivity);window.removeEventListener("touchstart",markActivity);document.removeEventListener("visibilitychange",refreshIfActive);};
  },[auth,loadOrganization]);

  useEffect(()=>{
    if(auth!=="signed-in"||!aircraft.length)return;
    let alive=true;
    if(Object.keys(sharedPositions).length&&Date.now()-positionsRefreshedAt<WORKSPACE_REFRESH_MS)setPositions(sharedPositions);
    let lastActivityAt=Date.now();
    const markActivity=()=>{lastActivityAt=Date.now();};
    const refreshPositions=async()=>{
      if(document.visibilityState!=="visible"||Date.now()-lastActivityAt>=15*60_000)return;
      if(Object.keys(sharedPositions).length&&Date.now()-positionsRefreshedAt<WORKSPACE_REFRESH_MS)return;
      const entries=await Promise.all(aircraft.map(async item=>{
        try{
          const position=await api("/live/aircraft/"+item.id+"/position");
          return [item.id,position] as const;
        }catch{return null;}
      }));
      if(!alive)return;
      const updated:Record<string,Position>={};
      for(const entry of entries)if(entry&&entry[1]&&Number.isFinite(entry[1].latitude)&&Number.isFinite(entry[1].longitude))updated[entry[0]]=entry[1] as Position;
      for(const key of Object.keys(sharedPositions))delete sharedPositions[key];
      Object.assign(sharedPositions,updated);
      positionsRefreshedAt=Date.now();
      setPositions(updated);
    };
    void refreshPositions();
    window.addEventListener("pointerdown",markActivity,{passive:true});
    window.addEventListener("keydown",markActivity);
    window.addEventListener("touchstart",markActivity,{passive:true});
    const timer=window.setInterval(()=>{if(Date.now()-positionsRefreshedAt>=WORKSPACE_REFRESH_MS)void refreshPositions();},WORKSPACE_REFRESH_MS);
    return()=>{alive=false;window.clearInterval(timer);window.removeEventListener("pointerdown",markActivity);window.removeEventListener("keydown",markActivity);window.removeEventListener("touchstart",markActivity);};
  },[auth,aircraft]);

  useEffect(()=>{
    if(auth!=="signed-in"||supportingDataLoaded)return;
    supportingDataLoaded=true;
    api("/aircraft").then(value=>{const next=Array.isArray(value)?value:[];sharedAircraftTypes=next;setAircraftTypes(next);}).catch(()=>{supportingDataLoaded=false;});
    fetch("/api/if/gallery",{cache:"no-store"}).then(response=>response.ok?response.json():null).then(data=>{if(data?.aircraft){sharedGallery=data;setGallery(data);}}).catch(()=>{});
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
      const position=positions[aircraftItem.id];
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
    if(!selectedAircraft||!selectedAircraft.id)return;
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

  async function refresh(){await loadOrganization(true);}
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
    const selected=aircraft.find(item=>item.id===aircraftId);
    if(!selected||selected.status!==0||selected.visibility===2||!selected.isFleetActiveSlot){setError("This aircraft is not currently in the active flyable fleet. Select an available aircraft; hangared, hidden or inactive aircraft cannot receive new schedules in Infinite Flight.");return;}
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
  const workspaceValue={
    active,organization,aircraft,aircraftTypes,members,schedules,liveSchedules,positions,selectedAircraft,
    selectedPosition,selectedActiveSchedule,selectedNextSchedule,selectedPhotos,photoIndex,
    routeProgress,parkedAirport,flightHistory,canManage,query,setQuery,visibleAircraft,
    mapContainer,setSelectedAircraft,navigatePage,statusName,dateTime,aircraftCategory,
    busy,deleteSchedule,callsign,setCallsign,aircraftId,setAircraftId,origin,setOrigin,
    destination,setDestination,timeless,setTimeless,departure,setDeparture,arrival,setArrival,
    briefing,setBriefing,createSchedule,crewSelections,setCrewSelections,crewRoles,setCrewRoles,
    assignCrew,gallery,galleryLoading,galleryRegistration,setGalleryRegistration,galleryCredit,
    setGalleryCredit,galleryCreditUrl,setGalleryCreditUrl,galleryCaption,setGalleryCaption,
    galleryFile,setGalleryFile,uploadAircraftPhoto,deleteAircraftPhoto,roleName
  };

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
    <OnboardingGate/>
    <aside className={`sidebar ${mobileNav?"open":""}`}>
      <div className="brand"><Image src={vbLogo} alt="Virtual Blue" className="brand-logo" priority/><span>VIRTUAL BLUE<small>FLEET OPERATIONS</small></span><button className="icon-button mobile-close" onClick={()=>setMobileNav(false)} aria-label="Close menu"><X size={18}/></button></div>
      <div className="user-row sidebar-account"><div className="avatar">IF</div><span><b>Infinite Flight pilot</b><small>{organization?roleName(organization.role):"Signed in"}</small></span><button className="signout-button" onClick={signOut} disabled={busy} title="Sign out of Infinite Flight"><LogOut size={15}/><span>Sign out</span></button></div>
      <div className="sidebar-section">
        <p className="nav-caption">PILOT</p>
        <nav>
          {([{label:"Home",icon:<Plane size={17}/>},{label:"Schedules",icon:<CalendarDays size={17}/>},{label:"My Flights",icon:<PlaneTakeoff size={17}/>},{label:"Organisation Dock",icon:<Building2 size={17}/>} ] as {label:Tab;icon:ReactNode}[]).map(item=><button key={item.label} className={active===item.label?"nav-item active":"nav-item"} onClick={()=>navigatePage(item.label)}>{item.icon}<span>{item.label}</span></button>)}
        </nav>
      </div>
      {canManage&&<div className="sidebar-section admin-sidebar-section">
        <p className="nav-caption">ADMIN</p>
        <nav>
          {([{label:"Schedules",tab:"Admin Schedules" as Tab,icon:<CalendarDays size={17}/>},{label:"Integrations",tab:"Integrations" as Tab,icon:<Plug size={17}/>},{label:"Applications",tab:"Applications" as Tab,icon:<ClipboardList size={17}/>},{label:"User Management",tab:"User Management" as Tab,icon:<UserRoundCog size={17}/>},{label:"Feature Selection",tab:"Feature Selection" as Tab,icon:<SlidersHorizontal size={17}/>}]).map(item=><button key={item.tab} className={active===item.tab?"nav-item active":"nav-item"} onClick={()=>navigatePage(item.tab)}>{item.icon}<span>{item.label}</span></button>)}
        </nav>
      </div>}

    </aside>
    {mobileNav&&<button className="mobile-scrim" onClick={()=>setMobileNav(false)} aria-label="Close navigation"/>}
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={()=>setMobileNav(true)} aria-label="Open menu"><Menu size={19}/></button><span className="breadcrumb">Virtual Blue <b>/</b> {active==="Admin Schedules"?"Admin / Schedules":active==="Integrations"?"Admin / Integrations":active==="Applications"?"Admin / Applications":active==="User Management"?"Admin / User Management":active==="Feature Selection"?"Admin / Feature Selection":active}</span></div><div className="topbar-actions"><span className="live-indicator"><i/> IF API connected</span><button className="icon-button" onClick={refresh} aria-label="Refresh Infinite Flight data" title="Refresh"><RefreshCw size={16}/></button><button className={`theme-switch ${theme}`} onClick={()=>setTheme(theme==="light"?"dark":"light")} aria-label={`Switch to ${theme==="light"?"dark":"light"} theme`} aria-pressed={theme==="dark"} title={`Switch to ${theme==="light"?"dark":"light"} theme`}><span className="theme-switch-copy"><span className="theme-switch-icon">{theme==="light"?<Sun size={15}/>:<Moon size={15}/>}</span><span>{theme==="light"?"Light":"Dark"}</span></span><span className="theme-switch-track" aria-hidden="true"><span className="theme-switch-thumb"/></span></button></div></header>
      <div className="content">
        <div className="page-heading"><div><p className="eyebrow">VIRTUAL BLUE · INFINITE FLIGHT LIVE</p><h1>{active==="Admin Schedules"?"Schedules":active}</h1><p className="muted">{active==="Home"?"Your Virtual Blue operations overview and live fleet picture.":active==="Schedules"?"Explore published Virtual Blue schedules and available crew positions.":active==="My Flights"?"Your flight activity, crew assignments and booked upcoming legs.":active==="Organisation Dock"?"Your organisation profile, airline information and operational reference.":active==="Admin Schedules"?"Create, publish and maintain your organisation’s schedules.":active==="Integrations"?"Configure Discord connections, channels and automated operational messages.":active==="Applications"?"Review pilot applications and approve eligible Infinite Flight usernames.":active==="User Management"?"Manage approved app accounts and the wider organisation pilot directory.":active==="Feature Selection"?"Enable or disable optional premium organisation features.":"Aircraft flight history."}</p></div><div className="heading-actions"><span className="date-chip"><CalendarDays size={15}/>{new Intl.DateTimeFormat("en",{dateStyle:"medium"}).format(new Date())}</span></div></div>
        {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="form-success" role="status">{notice}</p>}
        {!organization&&<section className="section-card"><div className="empty-state"><span className="empty-icon"><Compass size={20}/></span><b>Virtual Blue workspace unavailable</b><p>This Infinite Flight account could not access the configured Virtual Blue organisation. Confirm that your account is a member and has the required API permissions, then try again.</p><button className="outline-button" onClick={()=>void loadOrganization()} disabled={busy}>{busy?"Connecting…":"Retry connection"}</button></div></section>}
        {organization&&<WorkspaceProvider value={workspaceValue}>
          {active==="Home"&&<HomePage/>}
          {active==="Schedules"&&<SchedulesPage/>}
          {active==="History"&&<HistoryPage/>}
          {active==="Admin Schedules"&&<AdminSchedulesPage/>}
          {active==="My Flights"&&<MyFlightsPage/>}
          {active==="Organisation Dock"&&<OrganisationDockPage/>}
          {active==="Integrations"&&<IntegrationsPage/>}
          {active==="Applications"&&<ApplicationsPage/>}
          {active==="User Management"&&<UserManagementPage/>}
          {active==="Feature Selection"&&<FeatureSelectionPage/>}
        </WorkspaceProvider>}
        <footer className="footer"><span>© {new Date().getFullYear()} Virtual Blue</span><span>Powered by Infinite Flight PublicApi v3</span><span>Live data · No permanent API data storage</span></footer>
      </div>
    </main>
  </div>;
}
