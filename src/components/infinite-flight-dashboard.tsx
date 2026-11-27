"use client";

/* Existing effects intentionally synchronize browser-backed state after mount. */
/* eslint-disable react-hooks/purity, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState, useRef, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { HomePage } from "@/components/workspace/pages/home-page";
import { SchedulesPage } from "@/components/workspace/pages/schedules-page";
import { HistoryPage } from "@/components/workspace/pages/history-page";
import { AdminSchedulesPage } from "@/components/workspace/pages/admin-schedules-page";
import { EditSchedulesPage } from "@/components/workspace/pages/edit-schedules-page";
import { MyFlightsPage } from "@/components/workspace/pages/my-flights-page";
import { OrganisationDockPage } from "@/components/workspace/pages/organisation-dock-page";
import { IntegrationsPage } from "@/components/workspace/pages/integrations-page";
import { ApplicationsPage } from "@/components/workspace/pages/applications-page";
import { UserManagementPage } from "@/components/workspace/pages/user-management-page";
import { FeatureSelectionPage } from "@/components/workspace/pages/feature-selection-page";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { OnboardingGate } from "@/components/workspace/onboarding-gate";
import { updateCachedPilotProfile } from "@/lib/client/pilot-profile";

import Link from "next/link";
import Image from "next/image";
import vbLogo from "@/assets/vb.png";
import veyroLiveLogo from "@/assets/veyro-live.png";
import maplibregl from "maplibre-gl";
import { Activity, ArrowUpRight, Building2, CalendarDays, ClipboardList, Compass, LogOut, Menu, Moon, Plane, PlaneTakeoff, Plug, RadioTower, RefreshCw, ShieldCheck, SlidersHorizontal, Sun, UserRoundCog, X } from "lucide-react";

type Organization={id:string;name:string;role:number;description?:string|null;worldType:number;operationType:number};
type Aircraft={id:string;aircraftId:string;organizationId:string;registration:string;status:number;visibility:number;fleetPriority:number|null;fleetRank:number;isFleetActiveSlot:boolean};
type Member={userId:string;username:string|null;role:number;joinedAt:string;activeLifts:number};
type Crew={userId:string;username:string|null;role:number};
type Schedule={id:string;status:number;callsign:string;organizationId:string;aircraftId:string;flightType:number;originIcao:string;destinationIcao:string;isTimeless:boolean;scheduledDepartureUtc:string;scheduledArrivalUtc:string;briefing:string|null;flightPlan:string|null;crew:Crew[];sequence:number};
type FlightHistoryCrewMember={username?:string|null;userId?:string};
type FlightHistoryRecord={id?:string;callsign?:string;actualDepartureUtc?:string;actualArrivalUtc?:string;originIcao?:string;destinationIcao?:string;flightTimeMinutes?:number;crew?:FlightHistoryCrewMember[]};
type Tab="Home"|"Schedules"|"My Flights"|"Organisation Dock"|"Admin Schedules"|"Edit Schedules"|"Integrations"|"Applications"|"User Management"|"Feature Selection"|"History";
type Position={id:string;state:number;isOnGround:boolean;latitude:number;longitude:number;altitude:number;heading:number;speed:number;verticalSpeed:number;lastPilotId?:string;lastPilotUsername?:string;updatedAt:string;airportIcao?:string;airportName?:string};
type AircraftType={id:string;name:string};
type AirportRecord={icao?:string;icaoCode?:string;code?:string;name?:string;latitude?:number;longitude?:number;location?:{latitude?:number;longitude?:number}};
type AirportCandidate={icao:string;name:string;latitude:number;longitude:number;distance:number};
type GalleryPhoto={id:string;url:string;altText:string;caption:string;credit:{name:string;url:string;displayText:string};displayOrder:number;isVisible:boolean};
type GalleryManifest={settings:{maxPhotosPerAircraft:number;slideshowIntervalMs:number};aircraft:Record<string,{photos:GalleryPhoto[]}>};
type WorkspaceSnapshot={organization:Organization|null;aircraft:Aircraft[];members:Member[];schedules:Schedule[];refreshedAt:number};
let sharedWorkspaceSnapshot:WorkspaceSnapshot|null=null;
let sharedWorkspacePromise:Promise<WorkspaceSnapshot>|null=null;
let sharedSnapshotData:any=null;
let sharedAuthState:"unknown"|"signed-out"|"signed-in"="unknown";
let sharedAuthCheckedAt=0;
let sharedAuthPromise:Promise<boolean>|null=null;
let sharedProfile:{username?:string;role?:number;discordUserId?:string;discordUsername?:string}|null=null;
const sharedPositions:Record<string,Position>={};
let sharedIsPro=false;

let sharedAircraftTypes:AircraftType[]=[];
let sharedGallery:GalleryManifest|null=null;
const WORKSPACE_REFRESH_MS=120_000;

const ORGANIZATION_ID="d50dcc80-8dac-4608-970c-61d6a4739488";
const PAGE_ROUTES:Record<Tab,string>={
  "Home":"/home",
  "Schedules":"/schedules",
  "My Flights":"/my-flights",
  "Organisation Dock":"/organisation-dock",
  "Admin Schedules":"/admin/schedules",
  "Edit Schedules":"/admin/edit-schedules",
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
  const proHeader=response.headers.get("x-user-pro");if(proHeader!==null)sharedIsPro=proHeader.toLowerCase()==="true";
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error_description||payload.error||payload.message||`Infinite Flight returned HTTP ${response.status}.`);
  if(typeof payload.errorCode==="number"&&payload.errorCode!==0) throw new Error(payload.message||`Infinite Flight API error ${payload.errorCode}.`);
  return payload.result;
}
function roleName(role:number){return role===2?"Owner":role===1?"Admin":"Member";}
function statusName(status:number){return ({0:"Status unavailable",1:"Scheduled",2:"Boarding",3:"Boarded",4:"Taxiing to runway",6:"In flight",7:"Diverted",8:"Delayed",9:"Cancelled",10:"Taxiing to parking",11:"Arrived"} as Record<number,string>)[status]??"Status unavailable";}
function dateTime(value:string|undefined,timeless=false){return timeless?"Timeless":value?.startsWith("0001-")?"—":value?new Date(value).toLocaleString():"—";}
function aircraftCategory(code:string){const value=code.toUpperCase();if(/(A33|A34|A35|A38|B74|B76|B77|B78|B79|777|787|330|340|350|380|747|767|MD1|DC1)/.test(value))return "Wide-body";if(/(A19|A20|A21|B70|B71|B72|B73|B75|737|319|320|321|220|E17|E19|CRJ)/.test(value))return "Narrow-body";if(/(C17|C13|C30|C5|AN2|AN7|DH8)/.test(value))return "Regional / cargo";return "Unknown";}
function haversineKm(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){const rad=(n:number)=>n*Math.PI/180;const dLat=rad(b.latitude-a.latitude),dLon=rad(b.longitude-a.longitude);const value=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value));}

export function InfiniteFlightDashboard({initialPage="Home"}:{initialPage?:Tab}={}){
  const router=useRouter();
  const [auth,setAuth]=useState<"checking"|"signed-out"|"signed-in">(sharedAuthState==="signed-in"&&Date.now()-sharedAuthCheckedAt<5*60_000?"signed-in":sharedAuthState==="signed-out"&&Date.now()-sharedAuthCheckedAt<5*60_000?"signed-out":"checking");
  const [organization,setOrganization]=useState<Organization|null>(sharedWorkspaceSnapshot?.organization??null);
  const [aircraft,setAircraft]=useState<Aircraft[]>(sharedWorkspaceSnapshot?.aircraft??[]);
  const [aircraftTypes,setAircraftTypes]=useState<AircraftType[]>(sharedSnapshotData?.aircraftTypes||sharedAircraftTypes);
  const [snapshotData,setSnapshotData]=useState<any>(sharedSnapshotData||{airports:[],airportPoints:{},requests:[],myFlights:{live:[],future:[],past:[],pastCoverage:null},activity:[],admin:{registered:[],pending:[],connected:false,codes:[],integrations:{},features:[],stickyPanel:{exists:false,reason:""}}});
  const [members,setMembers]=useState<Member[]>(sharedWorkspaceSnapshot?.members??[]);
  const [schedules,setSchedules]=useState<Schedule[]>(sharedWorkspaceSnapshot?.schedules??[]);
  const [active,setActive]=useState<Tab>(initialPage);
  const [theme,setTheme]=useState<"light"|"dark">("light");
  const [themeReady,setThemeReady]=useState(false);
  const [mobileNav,setMobileNav]=useState(false);
  const [profileName,setProfileName]=useState("Infinite Flight Pilot");
  const [profileRole,setProfileRole]=useState<number|null>(null);
  const [discordUserId,setDiscordUserId]=useState("");
  const [discordUsername,setDiscordUsername]=useState("");
  const [profileSaving,setProfileSaving]=useState(false);
  const [profileNotice,setProfileNotice]=useState("");
  const [profileOpen,setProfileOpen]=useState(false);
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
  const landingGlobeContainer=useRef<HTMLDivElement|null>(null);
  const landingGlobeMap=useRef<maplibregl.Map|null>(null);
  const mapContainer=useRef<HTMLDivElement|null>(null);
  const mapRef=useRef<maplibregl.Map|null>(null);
  const markerRefs=useRef<maplibregl.Marker[]>([]);
  const hubMarkerRefs=useRef<maplibregl.Marker[]>([]);
  const mapHasFitted=useRef(false);
  const [positions,setPositions]=useState<Record<string,Position>>(sharedSnapshotData?.positions||sharedPositions);
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
  useEffect(()=>{
    if(auth!=="signed-out"||!landingGlobeContainer.current)return;
    const globeOptions={
      container:landingGlobeContainer.current,
      style:"https://tiles.openfreemap.org/styles/dark",
      center:[8,22] as [number,number],
      zoom:1.35,
      minZoom:1.15,
      maxZoom:1.35,
      attributionControl:false,
      interactive:false,
      projection:{type:"globe"},
      renderWorldCopies:false
    } as maplibregl.MapOptions;
    const globe=new maplibregl.Map(globeOptions);
    landingGlobeMap.current=globe;
    globe.on("style.load",()=>{
      for(const layer of globe.getStyle().layers||[]){
        if(layer.type==="symbol")try{globe.setLayoutProperty(layer.id,"visibility","none");}catch{}
      }
    });
    globe.on("load",()=>{
      globe.addSource("landing-flight-routes",{type:"geojson",data:{
        type:"FeatureCollection",
        features:[
          {type:"Feature",properties:{},geometry:{type:"LineString",coordinates:[[-73.78,40.64],[-45,52],[-20,54],[-.45,51.47]]}},
          {type:"Feature",properties:{},geometry:{type:"LineString",coordinates:[[55.36,25.25],[68,29],[77.1,28.55]]}}
        ]
      }});
      globe.addLayer({id:"landing-flight-routes-line",type:"line",source:"landing-flight-routes",paint:{"line-color":"#91bfff","line-width":1.6,"line-opacity":0.85,"line-dasharray":[2,2]}});
      globe.addSource("landing-flight-airports",{type:"geojson",data:{
        type:"FeatureCollection",
        features:[[-73.78,40.64],[-.45,51.47],[55.36,25.25],[77.1,28.55]].map(coordinates=>({type:"Feature" as const,properties:{},geometry:{type:"Point" as const,coordinates}}))
      }});
      globe.addLayer({id:"landing-flight-airports-glow",type:"circle",source:"landing-flight-airports",paint:{"circle-radius":5,"circle-color":"#9ed5ff","circle-opacity":0.18,"circle-blur":0.8}});
      globe.addLayer({id:"landing-flight-airports-dot",type:"circle",source:"landing-flight-airports",paint:{"circle-radius":2.2,"circle-color":"#d9edff","circle-stroke-width":1,"circle-stroke-color":"#8fc8ff"}});
    });
    let rotationFrame=0;
    let longitude=8;
    const rotate=()=>{
      if(document.visibilityState==="visible"){
        longitude+=0.012;
        globe.setCenter([longitude,22]);
      }
      rotationFrame=window.requestAnimationFrame(rotate);
    };
    rotationFrame=window.requestAnimationFrame(rotate);
    return()=>{
      window.cancelAnimationFrame(rotationFrame);
      globe.remove();
      landingGlobeMap.current=null;
    };
  },[auth]);


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

  const loadOrganization=useCallback(async(force=false,invalidateIFCache=false)=>{
    if(!force&&sharedSnapshotData&&Date.now()-Number(sharedSnapshotData.refreshedAt||0)<WORKSPACE_REFRESH_MS){
      setOrganization(sharedSnapshotData.organization||null);setAircraft(sharedSnapshotData.aircraft||[]);setMembers(sharedSnapshotData.members||[]);setSchedules(sharedSnapshotData.schedules||[]);setAircraftTypes(sharedSnapshotData.aircraftTypes||[]);setPositions(sharedSnapshotData.positions||{});setSnapshotData(sharedSnapshotData);return;
    }
    setBusy(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/workspace/snapshot"+(force?"?refresh=1"+(invalidateIFCache?"&invalidate=1":""):""),{cache:"no-store",credentials:"same-origin"});
      const data=await response.json().catch(()=>({}));
      if(response.status===401){sharedAuthState="signed-out";sharedAuthCheckedAt=Date.now();setAuth("signed-out");return;}
      if(!response.ok)throw new Error(data.error||"Unable to load the unified workspace snapshot.");
      sharedSnapshotData=data;sharedAuthState="signed-in";sharedAuthCheckedAt=Date.now();
      sharedWorkspaceSnapshot={organization:data.organization||null,aircraft:data.aircraft||[],members:data.members||[],schedules:data.schedules||[],refreshedAt:Number(data.refreshedAt||Date.now())};
      setOrganization(data.organization||null);setAircraft(data.aircraft||[]);setMembers(data.members||[]);setSchedules(data.schedules||[]);setAircraftTypes(data.aircraftTypes||[]);setPositions(data.positions||{});setSnapshotData(data);
      const profile=data.profile||{};
      sharedProfile={username:profile.username||undefined,role:profile.role??undefined,discordUserId:profile.discordUserId||"",discordUsername:profile.discordUsername||""};
      if(profile.username)setProfileName(profile.username);if(typeof profile.role==="number")setProfileRole(profile.role);setDiscordUserId(profile.discordUserId||"");setDiscordUsername(profile.discordUsername||"");
      setAuth("signed-in");
    }catch(e){
      setAuth("signed-in");
      setError(e instanceof Error?e.message:"Unable to refresh the Virtual Blue workspace.");
      if(sharedSnapshotData){setOrganization(sharedSnapshotData.organization||null);setAircraft(sharedSnapshotData.aircraft||[]);setMembers(sharedSnapshotData.members||[]);setSchedules(sharedSnapshotData.schedules||[]);setAircraftTypes(sharedSnapshotData.aircraftTypes||[]);setPositions(sharedSnapshotData.positions||{});setSnapshotData(sharedSnapshotData);}
      else{setOrganization(null);setAircraft([]);setMembers([]);setSchedules([]);}
    }finally{setBusy(false);}
  },[]);

  useEffect(()=>{
    let mounted=true;
    void loadOrganization().then(()=>{if(mounted&&sharedAuthState==="signed-in")setAuth("signed-in");});
    return()=>{mounted=false;};
  },[loadOrganization]);


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
    map.on("style.load",()=>{for(const layer of map.getStyle().layers||[]){if(/country|admin[_-]?0/i.test(layer.id))try{map.setLayoutProperty(layer.id,"visibility","none");}catch{}}});
    map.on("load",()=>{
      const points=Object.values(positions).filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
      if(points.length>1){
        const bounds=new maplibregl.LngLatBounds();
        points.forEach(p=>bounds.extend([p.longitude,p.latitude]));
        map.fitBounds(bounds,{padding:70,maxZoom:6});
      }else if(points.length===1)map.flyTo({center:[points[0].longitude,points[0].latitude],zoom:5});
      for(const [icao,point] of Object.entries(snapshotData.airportPoints||{}) as [string,{latitude:number;longitude:number}][]){
        const element=document.createElement("div");element.className="vb-hub-marker";element.title=icao;element.style.backgroundImage="url("+vbLogo.src+")";
        const hub=new maplibregl.Marker({element,anchor:"bottom"}).setLngLat([point.longitude,point.latitude]).addTo(map);hubMarkerRefs.current.push(hub);
      }
    });
    return()=>{markerRefs.current.forEach(marker=>marker.remove());markerRefs.current=[];hubMarkerRefs.current.forEach(marker=>marker.remove());hubMarkerRefs.current=[];map.remove();mapRef.current=null;};
  },[active,theme,organization,schedules,snapshotData.airportPoints]);

  useEffect(()=>{
    const map=mapRef.current;
    if(!map)return;
    markerRefs.current.forEach(marker=>marker.remove());
    markerRefs.current=[];
    for(const aircraftItem of aircraft){
      const position=positions[aircraftItem.id];
      if(!position||!Number.isFinite(position.latitude)||!Number.isFinite(position.longitude))continue;
      const stale=(position.state===1||position.state===4)&&Boolean(position.updatedAt)&&Date.now()-new Date(position.updatedAt).getTime()>18*60*60*1000;
      let color:string;
      if(aircraftItem.visibility===2)color="#ef4444";
      else if(stale)color="#b28a18";
      else if(position.state===2)color="#25b96b";
      else if(position.state===4)color="#8b5cf6";
      else if(position.state===1)color="#3b82f6";
      else continue;
      const element=document.createElement("button");
      element.type="button";element.className="aircraft-map-marker";element.title=aircraftItem.registration;
      element.style.setProperty("--marker-color",color,"important");
      element.style.setProperty("background","transparent","important");
      element.style.setProperty("border","0","important");
      element.style.setProperty("box-shadow","none","important");
      element.style.setProperty("padding","0","important");
      element.style.setProperty("width","34px","important");
      element.style.setProperty("height","34px","important");
      const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
      svg.setAttribute("viewBox","0 0 32 32");svg.setAttribute("aria-hidden","true");
      svg.style.width="32px";svg.style.height="32px";svg.style.overflow="visible";
      const path=document.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("d","M15 1.8c-.8 0-1.4.7-1.4 1.5v9.2L3.2 18v2.2l10.4-3.1v8l-3.1 2.2v1.8l4.5-1.3 4.5 1.3v-1.8l-3.1-2.2v-8L26.8 20V18l-10.4-5.5V3.3c0-.8-.6-1.5-1.4-1.5Z");
      path.style.setProperty("fill",color,"important");path.style.setProperty("stroke","#101820","important");path.style.setProperty("stroke-width","0.35","important");
      svg.appendChild(path);element.appendChild(svg);
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
    const schedule=selectedActiveSchedule;
    const position=selectedPosition;
    if(!schedule||!position){setRouteProgress(null);return;}
    const originPoint=snapshotData.airportPoints?.[schedule.originIcao];
    const destinationPoint=snapshotData.airportPoints?.[schedule.destinationIcao];
    if(originPoint&&destinationPoint){
      const total=haversineKm(originPoint,destinationPoint);
      const travelled=haversineKm(originPoint,{latitude:position.latitude,longitude:position.longitude});
      setRouteProgress(total>0?Math.max(0,Math.min(100,Math.round(travelled/total*100))):null);
    }else setRouteProgress(null);
  },[selectedActiveSchedule?.id,selectedPosition?.latitude,selectedPosition?.longitude,snapshotData.airportPoints]);

  useEffect(()=>{
    if(!selectedAircraft?.id){setFlightHistory([]);return;}
    setFlightHistory(snapshotData.flightHistoryByAircraft?.[selectedAircraft.id]||[]);
  },[selectedAircraft?.id,snapshotData.flightHistoryByAircraft]);

  useEffect(()=>{
    if(!selectedAircraft||selectedPosition?.state!==1){setParkedAirport("Unknown");return;}
    if(selectedPosition.airportIcao){setParkedAirport(selectedPosition.airportIcao+(selectedPosition.airportName?" · "+selectedPosition.airportName:""));return;}
    const candidates=(snapshotData.airports||[]).map((airport:AirportRecord)=>({icao:airport.icao||airport.icaoCode||airport.code||"",name:airport.name||airport.icao||airport.icaoCode||"Airport",latitude:Number(airport.latitude??airport.location?.latitude),longitude:Number(airport.longitude??airport.location?.longitude)})).filter((airport:any)=>Boolean(airport.icao)&&Number.isFinite(airport.latitude)&&Number.isFinite(airport.longitude));
    const nearest=candidates.map((airport:any)=>({...airport,distance:haversineKm(airport,{latitude:selectedPosition.latitude,longitude:selectedPosition.longitude})})).sort((a:any,b:any)=>a.distance-b.distance)[0];
    setParkedAirport(nearest&&nearest.distance<=15?nearest.icao+" · "+nearest.name:"Airport not identified");
  },[selectedAircraft?.id,selectedPosition?.latitude,selectedPosition?.longitude,selectedPosition?.state,selectedPosition?.airportIcao,selectedPosition?.airportName,snapshotData.airports]);

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

  async function saveDiscordProfile(event:FormEvent){
    event.preventDefault();setProfileSaving(true);setProfileNotice("");setError("");
    try{const response=await fetch("/api/profile",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({discordUserId,discordUsername}),credentials:"same-origin"});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"Could not save Discord profile.");updateCachedPilotProfile({discordUserId,discordUsername});sharedProfile={...(sharedProfile||{}),discordUserId,discordUsername};setProfileNotice("Discord account saved.");}
    catch(e){setError(e instanceof Error?e.message:"Could not save Discord profile.");}
    finally{setProfileSaving(false);}
  }

  async function refresh(invalidateIFCache=false){await loadOrganization(true,invalidateIFCache);}
  async function signOut(){
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/auth/if/logout",{method:"POST",credentials:"same-origin",cache:"no-store"});
      if(!response.ok)throw new Error("Infinite Flight sign out failed. Please try again.");
      sharedAuthState="signed-out";sharedAuthCheckedAt=Date.now();sharedAuthPromise=null;sharedProfile=null;sharedWorkspaceSnapshot=null;sharedWorkspacePromise=null;sharedSnapshotData=null;for(const key of Object.keys(sharedPositions))delete sharedPositions[key];setAuth("signed-out");setOrganization(null);setAircraft([]);setMembers([]);setSchedules([]);setPositions({});setSelectedAircraft(null);setFlightHistory([]);
    }catch(e){setError(e instanceof Error?e.message:"Could not sign out of Infinite Flight.");}
    finally{setBusy(false);}
  }
  async function createSchedule(event:FormEvent){
    event.preventDefault();if(!canManage||!aircraftId)return;
    const selected=aircraft.find(item=>item.id===aircraftId);
    if(!selected){
      setError("This aircraft is no longer listed in the organisation fleet. Refresh the fleet and select an aircraft that is still listed.");
      return;
    }
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
      await refresh(true);
    }catch(e){setError(e instanceof Error?e.message:"Could not publish schedule.");}
    finally{setBusy(false);}
  }
  async function deleteSchedule(id:string){
    if(!canManage)return;
    setBusy(true);setError("");setNotice("");
    try{await api(`/live/schedules/${id}`,{method:"DELETE"});setNotice("Schedule deleted in Infinite Flight.");await refresh(true);}
    catch(e){setError(e instanceof Error?e.message:"Could not delete schedule.");}
    finally{setBusy(false);}
  }
  async function assignCrew(schedule:Schedule){
    if(!canManage)return;
    const userId=crewSelections[schedule.id];if(!userId)return;
    setBusy(true);setError("");setNotice("");
    try{
      await api(`/live/schedules/${schedule.id}/crew/${userId}`,{method:"PUT",body:JSON.stringify({role:Number(crewRoles[schedule.id]??0)})});
      setNotice("Crew assignment saved to Infinite Flight.");await refresh(true);
    }catch(e){setError(e instanceof Error?e.message:"Could not assign crew.");}
    finally{setBusy(false);}
  }
  const workspaceValue={
    active,refreshWorkspace:refresh,organization,snapshotData,aircraft,aircraftTypes,members,schedules,liveSchedules,positions,selectedAircraft,
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
    <div className="landing-ambient landing-ambient-a" aria-hidden="true"/>
    <div className="landing-ambient landing-ambient-b" aria-hidden="true"/>
    <header className="landing-header">
      <Link href="/" className="landing-brand" aria-label="Virtual Blue home">
        <Image src={vbLogo} alt="Virtual Blue" className="landing-vb-logo" priority/>
      </Link>
      <div className="landing-header-veyro" aria-label="Powered by Veyro"><Image src={veyroLiveLogo} alt="Veyro" priority/></div>
    </header>
    <section className="landing-hero">
      <div className="landing-copy">
        <div className="landing-eyebrow"><span/> VIRTUAL BLUE <b>×</b> VEYRO</div>
        <h1><em>Feel Connected.</em></h1>
        <p className="landing-description">Your airline. Your crew. Every flight, connected.</p>
        <div className="landing-actions">
          <button className="landing-signin" onClick={()=>window.location.assign("/api/auth/if/login")}>
            <span className="landing-signin-icon"><Plane size={19}/></span>
            <span>Continue with Infinite Flight</span>
            <span className="landing-signin-arrow"><ArrowUpRight size={19}/></span>
          </button>
          <span className="landing-auth-note"><ShieldCheck size={14}/> Secure sign-in with Infinite Flight</span>
        </div>
      </div>
      <div className="landing-globe-stage" aria-label="Minimal dark 3D globe with flight routes">
        <div ref={landingGlobeContainer} className="landing-maplibre-globe"/>
        <div className="globe-flight-chip chip-one"><span className="flight-chip-dot"/> <b>VB 204</b><small>JFK → LHR</small></div>
        <div className="globe-flight-chip chip-two"><span className="flight-chip-dot"/> <b>VB 731</b><small>DXB → DEL</small></div>
        <div className="globe-caption"><span>GLOBAL OPERATIONS</span><i/> CONNECTED IN REAL TIME</div>
      </div>
    </section>
    <footer className="landing-footer">
      <span>© {new Date().getFullYear()} Virtual Blue</span>
      <span className="landing-powered"><span>Powered by</span><Image src={veyroLiveLogo} alt="Veyro" className="landing-veyro-logo"/></span>
    </footer>
  </main>;

  return <div className="app-frame" data-theme={theme}>
    <OnboardingGate initialProfile={snapshotData.profile||null}/>
    <aside className={`sidebar ${mobileNav?"open":""}`}>
      <div className="brand"><Image src={vbLogo} alt="Virtual Blue" className="brand-logo" priority/><span>VIRTUAL BLUE<small>FLEET OPERATIONS</small></span><button className="icon-button mobile-close" onClick={()=>setMobileNav(false)} aria-label="Close menu"><X size={18}/></button></div>
      <button className="user-row sidebar-account sidebar-profile-button" onClick={()=>setProfileOpen(true)}><div className="avatar">{(profileName||"IF").slice(0,2).toUpperCase()}</div><span><b>{profileName}</b><small>{profileRole!==null?roleName(profileRole):organization?roleName(organization.role):"Member"}</small></span><UserRoundCog size={16}/></button>
      <div className="sidebar-section">
        <p className="nav-caption">PILOT</p>
        <nav>
          {([{label:"Home",icon:<Plane size={17}/>},{label:"Schedules",icon:<CalendarDays size={17}/>},{label:"My Flights",icon:<PlaneTakeoff size={17}/>},{label:"Organisation Dock",icon:<Building2 size={17}/>} ] as {label:Tab;icon:ReactNode}[]).map(item=><button key={item.label} className={active===item.label?"nav-item active":"nav-item"} onClick={()=>navigatePage(item.label)}>{item.icon}<span>{item.label}</span></button>)}
        </nav>
      </div>
      {canManage&&<div className="sidebar-section admin-sidebar-section">
        <p className="nav-caption">ADMIN</p>
        <nav>
          {([{label:"Schedules",tab:"Admin Schedules" as Tab,icon:<CalendarDays size={17}/>},{label:"Edit Schedules",tab:"Edit Schedules" as Tab,icon:<ArrowUpRight size={17}/>},{label:"Integrations",tab:"Integrations" as Tab,icon:<Plug size={17}/>},{label:"Applications",tab:"Applications" as Tab,icon:<ClipboardList size={17}/>},{label:"User Management",tab:"User Management" as Tab,icon:<UserRoundCog size={17}/>},{label:"Feature Selection",tab:"Feature Selection" as Tab,icon:<SlidersHorizontal size={17}/>}]).map(item=><button key={item.tab} className={active===item.tab?"nav-item active":"nav-item"} onClick={()=>navigatePage(item.tab)}>{item.icon}<span>{item.label}</span></button>)}
        </nav>
      </div>}

    </aside>
    {mobileNav&&<button className="mobile-scrim" onClick={()=>setMobileNav(false)} aria-label="Close navigation"/>}
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={()=>setMobileNav(true)} aria-label="Open menu"><Menu size={19}/></button><a className="topbar-brand-button" href="https://community.infiniteflight.com/t/veyro-pilot-and-atc-analytics-for-infinite-flight/1294083" target="_blank" rel="noopener noreferrer" aria-label="Visit Veyro on the Infinite Flight Community" title="Veyro · Infinite Flight Community"><Image src={veyroLiveLogo} alt="Veyro Live" priority/></a></div><div className="topbar-actions"><button className="icon-button" onClick={refresh} aria-label="Refresh Infinite Flight data" title="Refresh"><RefreshCw size={16}/></button><button className={`theme-switch ${theme}`} onClick={()=>setTheme(theme==="light"?"dark":"light")} aria-label={`Switch to ${theme==="light"?"dark":"light"} theme`} aria-pressed={theme==="dark"} title={`Switch to ${theme==="light"?"dark":"light"} theme`}><span className="theme-switch-copy"><span className="theme-switch-icon">{theme==="light"?<Sun size={15}/>:<Moon size={15}/>}</span></span><span className="theme-switch-track" aria-hidden="true"><span className="theme-switch-thumb"/></span></button></div></header>
      {profileOpen&&<><button className="profile-popover-backdrop" aria-label="Close profile menu" onClick={()=>setProfileOpen(false)}/><div className="profile-popover"><button className="profile-popover-close" aria-label="Close profile menu" onClick={()=>setProfileOpen(false)}><X size={16}/></button><div className="profile-popover-head"><span className="avatar">{(profileName||"IF").slice(0,2).toUpperCase()}</span><div><b>{profileName}</b><small>{profileRole!==null?roleName(profileRole):"Virtual Blue member"}</small></div></div><form className="profile-link-form" onSubmit={saveDiscordProfile}><label>Discord User ID<input required inputMode="numeric" pattern="[0-9]{17,20}" value={discordUserId} onChange={event=>setDiscordUserId(event.target.value)} placeholder="17–20 digit Discord ID"/></label><label>Discord username<input value={discordUsername} onChange={event=>setDiscordUsername(event.target.value)} placeholder="@username"/></label><button className="primary-button" type="submit" disabled={profileSaving}>{profileSaving?"Saving…":"Save Discord account"}</button>{profileNotice&&<small className="profile-inline-notice">{profileNotice}</small>}</form><button className="signout-button" onClick={signOut} disabled={busy}><LogOut size={15}/> Sign out</button></div></>}
      <div className="content">
        <div className="page-heading"><div><p className="eyebrow">VIRTUAL BLUE · INFINITE FLIGHT LIVE</p><h1>{active==="Admin Schedules"?"Schedules":active==="Edit Schedules"?"Edit Schedules":active}</h1><p className="muted">{active==="Home"?"Your Virtual Blue operations overview and live fleet picture.":active==="Schedules"?"Explore published Virtual Blue schedules and available crew positions.":active==="My Flights"?"Your flight activity, crew assignments and booked upcoming legs.":active==="Organisation Dock"?"Your organisation profile, airline information and operational reference.":active==="Admin Schedules"?"Publish schedules and operate schedule automations.":active==="Edit Schedules"?"Advanced editing, flight plans, crew assignments and aircraft schedule sequencing.":active==="Integrations"?"Configure Discord connections, channels and automated operational messages.":active==="Applications"?"Review pilot applications and approve eligible Infinite Flight usernames.":active==="User Management"?"Manage approved app accounts and the wider organisation pilot directory.":active==="Feature Selection"?"Enable or disable optional premium organisation features.":"Aircraft flight history."}</p></div><div className="heading-actions"><span className="date-chip"><CalendarDays size={15}/>{new Intl.DateTimeFormat("en",{dateStyle:"medium"}).format(new Date())}</span></div></div>
        {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="form-success" role="status">{notice}</p>}
        {!organization&&<section className="section-card"><div className="empty-state"><span className="empty-icon"><Compass size={20}/></span><b>Virtual Blue workspace unavailable</b><p>This Infinite Flight account could not access the configured Virtual Blue organisation. Confirm that your account is a member and has the required API permissions, then try again.</p><button className="outline-button" onClick={()=>void loadOrganization()} disabled={busy}>{busy?"Connecting…":"Retry connection"}</button></div></section>}
        {organization&&<WorkspaceProvider value={workspaceValue}>
          {active==="Home"&&<HomePage/>}
          {active==="Schedules"&&<SchedulesPage/>}
          {active==="History"&&<HistoryPage/>}
          {active==="Admin Schedules"&&<AdminSchedulesPage/>}
          {active==="Edit Schedules"&&<EditSchedulesPage/>}
          {active==="My Flights"&&<MyFlightsPage/>}
          {active==="Organisation Dock"&&<OrganisationDockPage/>}
          {active==="Integrations"&&<IntegrationsPage/>}
          {active==="Applications"&&<ApplicationsPage/>}
          {active==="User Management"&&<UserManagementPage/>}
          {active==="Feature Selection"&&<FeatureSelectionPage/>}
        </WorkspaceProvider>}
        <footer className="footer"><span>© {new Date().getFullYear()} Virtual Blue</span><span className="dashboard-powered"><span>Powered by</span><Image src={veyroLiveLogo} alt="Veyro" className="dashboard-veyro-logo"/></span><span>Infinite Flight Public API v3 · Live data</span></footer>
      </div>
    </main>
  </div>;
}
