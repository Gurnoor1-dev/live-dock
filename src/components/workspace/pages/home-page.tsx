"use client";

import { Plane, CalendarDays, Users, RadioTower, X, ArrowRight, Clock3, Gauge, Navigation, Activity } from "lucide-react";
import { Stat } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";

function aircraftStatus(item:any,pos:any){
  if(item.visibility===2)return {label:"Hangared",tone:"hangared"};
  if(!pos)return {label:"Position unavailable",tone:"offline"};
  const age=pos.updatedAt?Date.now()-new Date(pos.updatedAt).getTime():0;
  if((pos.state===1||pos.state===4)&&age>18*60*60*1000)return {label:"Inactive · 18h+",tone:"inactive"};
  if(pos.state===2)return {label:"In flight",tone:"flight"};
  if(pos.state===4)return {label:"Stopped",tone:"stopped"};
  if(pos.state===1)return {label:"On ground",tone:"ground"};
  return {label:"Position unavailable",tone:"offline"};
}
export function HomePage(){
 const {active,aircraft,members,schedules,liveSchedules,positions,selectedAircraft,selectedPosition,selectedActiveSchedule,selectedNextSchedule,selectedPhotos,photoIndex,routeProgress,query,setQuery,mapContainer,setSelectedAircraft,navigatePage,dateTime}=useWorkspace();
 const currentSchedule=selectedActiveSchedule||selectedNextSchedule;
 const status=selectedAircraft?aircraftStatus(selectedAircraft,selectedPosition):null;
 return <>{active==="Home"&&<>
  <div className="stat-grid unified-stats home-stats">
   <Stat label="Fleet aircraft" value={aircraft.length} icon={<Plane/>} note="Organisation fleet"/>
   <Stat label="Live schedules" value={schedules.length} icon={<CalendarDays/>} note="Published schedules"/>
   <Stat label="Organisation members" value={members.length} icon={<Users/>} note="Current membership"/>
   <Stat label="Active legs" value={liveSchedules.length} icon={<RadioTower/>} note="Operational legs"/>
  </div>
  <section className="section-card fleet-map-card home-map-card">
   <div className="section-head"><div><p className="eyebrow">VIRTUAL BLUE · LIVE OPERATIONS</p><h2>Live fleet map</h2><p>Aircraft positions refresh every 90 seconds.</p></div><span className="count-pill">{Object.keys(positions).length} live positions</span></div>
   <div className="map-legend"><span><i className="legend-flight"/>In flight</span><span><i className="legend-ground"/>On ground</span><span><i className="legend-stopped"/>Stopped</span><span><i className="legend-inactive"/>Inactive 18h+</span><span><i className="legend-hangared"/>Hangared</span></div>
   <div ref={mapContainer} className="fleet-map" aria-label="Virtual Blue live aircraft map"/>
   {selectedAircraft&&<section className="aircraft-detail-card map-aircraft-popup" aria-label="Selected aircraft details">
    <div className="aircraft-popup-grabber"/>
    <div className="aircraft-popup-header"><div><p className="eyebrow">AIRCRAFT</p><div className="aircraft-popup-title"><h2>{selectedAircraft.registration}</h2><span className="aircraft-type-chip">{selectedAircraft.aircraftId}</span><span className={"aircraft-status-chip "+status?.tone}><i/>{status?.label}</span></div><p className="aircraft-popup-subtitle">Fleet aircraft · #{selectedAircraft.fleetRank}</p></div><button className="icon-button aircraft-popup-close" onClick={()=>setSelectedAircraft(null)} aria-label="Close aircraft details"><X size={20}/></button></div>
    <div className="aircraft-popup-photo">{selectedPhotos.length>0?<img key={selectedPhotos[photoIndex]?.id} src={selectedPhotos[photoIndex]?.url} alt={selectedPhotos[photoIndex]?.altText||selectedAircraft.registration}/>:<div className="aircraft-photo-placeholder"><Plane size={48}/><span>{selectedAircraft.registration}</span></div>}{selectedPhotos[photoIndex]?.caption&&<span className="photo-caption">{selectedPhotos[photoIndex].caption}</span>}{selectedPhotos[photoIndex]?.credit?.displayText&&<span className="photo-credit">{selectedPhotos[photoIndex].credit.displayText}</span>}</div>
    <div className="aircraft-popup-route"><div className="aircraft-route-kicker"><span>{selectedPosition?.state===2?"IN THE AIR NOW":"FLIGHT INFORMATION"}</span><b>{currentSchedule?.callsign||"NO ACTIVE FLIGHT"}</b></div><div className="aircraft-route-points"><div><b>{currentSchedule?.originIcao||"—"}</b><small>Origin</small></div><span className="route-dash"><i/><ArrowRight size={17}/></span><div className="destination"><b>{currentSchedule?.destinationIcao||"—"}</b><small>Destination</small></div></div><div className="aircraft-route-meta"><span>{currentSchedule?dateTime(currentSchedule.scheduledDepartureUtc):"No published departure"}</span><span>{routeProgress===null?"Live route progress unavailable":routeProgress+"% complete"}</span></div></div>
    <div className="aircraft-popup-facts">
     <div><small><Gauge size={13}/> Altitude</small><b>{selectedPosition?Math.round(selectedPosition.altitude).toLocaleString()+" ft":"—"}</b></div>
     <div><small><Activity size={13}/> Ground speed</small><b>{selectedPosition?Math.round(selectedPosition.speed)+" kt":"—"}</b></div>
     <div><small><Activity size={13}/> Vertical speed</small><b>{selectedPosition?Math.round(selectedPosition.verticalSpeed).toLocaleString()+" ft/min":"—"}</b></div>
     <div><small><Navigation size={13}/> Heading</small><b>{selectedPosition?Math.round(selectedPosition.heading)+"°":"—"}</b></div>
     <div><small><Users size={13}/> Flown by</small><b>{selectedPosition?.lastPilotUsername||"—"}</b></div>
     <div><small><Clock3 size={13}/> Last update</small><b>{selectedPosition?.updatedAt?dateTime(selectedPosition.updatedAt):"—"}</b></div>
    </div>
    <div className="aircraft-popup-actions"><button className="outline-button" onClick={()=>{setQuery(selectedAircraft.registration);navigatePage("Schedules");}}>View schedules</button><button className="outline-button" onClick={()=>navigatePage("History")}>Flight history</button></div>
   </section>}
  </section>
 </>}</>;
}
