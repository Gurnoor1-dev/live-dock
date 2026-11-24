"use client";

import { Plane, CalendarDays, Users, RadioTower, X, ArrowRight, Clock3, Gauge, Navigation, Activity } from "lucide-react";
import { Stat } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";
import { aircraftImages } from "@/lib/aircraft-images.generated";

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
 const {active,aircraft,members,schedules,liveSchedules,positions,selectedAircraft,selectedPosition,selectedActiveSchedule,selectedNextSchedule,selectedPhotos,photoIndex,routeProgress,flightHistory,parkedAirport,query,setQuery,mapContainer,setSelectedAircraft,navigatePage,dateTime}=useWorkspace();
 const previousFlight=flightHistory[0];\n const currentSchedule=selectedPosition?.state===4?previousFlight:selectedPosition?.state===1?selectedNextSchedule:selectedActiveSchedule||selectedNextSchedule;\n const parkedLabel=selectedPosition?.airportIcao||parkedAirport||"Airport not identified";\n const inactiveFor=selectedPosition?.updatedAt?Math.max(0,Date.now()-new Date(selectedPosition.updatedAt).getTime()):0;\n const inactiveLabel=inactiveFor>=86400000?Math.floor(inactiveFor/86400000)+"d "+Math.floor(inactiveFor%86400000/3600000)+"h":Math.floor(inactiveFor/3600000)+"h "+Math.floor(inactiveFor%3600000/60000)+"m";
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
    <div className="aircraft-popup-header"><div><p className="eyebrow">AIRCRAFT</p><div className="aircraft-popup-title"><h2>{selectedAircraft.registration}</h2><span className={"aircraft-status-chip "+status?.tone}><i/>{status?.label}</span></div><p className="aircraft-popup-subtitle">{selectedPosition?.state===1?"Parked at "+parkedLabel:selectedPosition?.state===4?"Stopped · last flight shown below":selectedAircraft.visibility===2?"Hangared · "+inactiveLabel+" since last position":"Fleet aircraft · #"+selectedAircraft.fleetRank}</p></div><button className="icon-button aircraft-popup-close" onClick={()=>setSelectedAircraft(null)} aria-label="Close aircraft details"><X size={20}/></button></div>
    <div className="aircraft-popup-photo">{selectedPhotos.length>0?<img key={selectedPhotos[photoIndex]?.id} src={selectedPhotos[photoIndex]?.url} alt={selectedPhotos[photoIndex]?.altText||selectedAircraft.registration}/>:aircraftImages[selectedAircraft.registration.toUpperCase()]?<img src={aircraftImages[selectedAircraft.registration.toUpperCase()]} alt={selectedAircraft.registration}/>:<div className="aircraft-photo-placeholder"><Plane size={48}/><span>{selectedAircraft.registration}</span></div>}{selectedPhotos[photoIndex]?.caption&&<span className="photo-caption">{selectedPhotos[photoIndex].caption}</span>}{selectedPhotos[photoIndex]?.credit?.displayText&&<span className="photo-credit">{selectedPhotos[photoIndex].credit.displayText}</span>}</div>
    <div className="aircraft-popup-route"><div className="aircraft-route-kicker"><span>{selectedPosition?.state===2?"IN THE AIR NOW":selectedPosition?.state===4?"LAST OPERATED FLIGHT":selectedPosition?.state===1?"NEXT SCHEDULED FLIGHT":selectedAircraft.visibility===2?"HANGARED AIRCRAFT":"FLIGHT INFORMATION"}</span><b>{currentSchedule?.callsign||"NO FLIGHTS"}</b></div><div className="aircraft-route-points"><div><b>{currentSchedule?.originIcao||"—"}</b><small>{selectedPosition?.state===4?"Previous departure":"Origin"}</small></div><span className="route-dash"><i/><ArrowRight size={17}/></span><div className="destination"><b>{currentSchedule?.destinationIcao||"—"}</b><small>{selectedPosition?.state===4?"Last arrival":selectedPosition?.state===1?"Next destination":"Destination"}</small></div></div><div className="aircraft-route-meta"><span>{currentSchedule?(selectedPosition?.state===4?dateTime(previousFlight?.actualDepartureUtc):dateTime(currentSchedule.scheduledDepartureUtc)):selectedAircraft.visibility===2?"No schedules for this registration":"No flights — there are no schedules for this registration"}</span><span>{selectedPosition?.state===1?"Currently at "+parkedLabel:selectedAircraft.visibility===2?"Inactive for "+inactiveLabel:routeProgress===null?"Live route progress unavailable":routeProgress+"% complete"}</span></div></div>
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
