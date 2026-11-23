"use client";

/* eslint-disable @typescript-eslint/no-unused-vars */

import { Plane, CalendarDays, Users, RadioTower, X } from "lucide-react";
import { Stat } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";

export function HomePage(){
  const {
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
}=useWorkspace();
  return <>{active==="Home"&&<div className="stat-grid"><Stat label="Fleet aircraft" value={aircraft.length} icon={<Plane/>} note="From Live organisation"/><Stat label="Live schedules" value={schedules.length} icon={<CalendarDays/>} note="Open fleet schedules"/><Stat label="Organisation members" value={members.length} icon={<Users/>} note="Current membership"/><Stat label="Active legs" value={liveSchedules.length} icon={<RadioTower/>} note="Boarding through in-flight"/></div>}
        {active==="Home"&&<div className="fleet-layout">
          <section className="section-card fleet-map-card">
            <div className="section-head"><div><h2>Live fleet map</h2><p>Aircraft positions refresh every 15 seconds. Heading follows the Infinite Flight true-heading value.</p></div><span className="count-pill">{Object.keys(positions).length} live positions</span></div>
            <div className="map-legend"><span><i className="legend-flight"/>In flight</span><span><i className="legend-ground"/>On ground</span><span><i className="legend-maintenance"/>Maintenance</span><span><i className="legend-stopped"/>Stopped</span><span><i className="legend-unknown"/>Unknown</span></div>
            <div ref={mapContainer} className="fleet-map" aria-label="Virtual Blue live aircraft map"/>
          </section>
          <section className="section-card fleet-list-card">
            <div className="section-head"><div><h2>Fleet aircraft</h2><p>Select an aircraft to inspect its live details.</p></div><span className="count-pill">{visibleAircraft.length}</span></div>
            <div className="search-field"><Plane size={15}/><input placeholder="Search registration" value={query} onChange={e=>setQuery(e.target.value)}/></div>
            <div className="fleet-aircraft-list">{visibleAircraft.map(item=>{const pos=positions[item.id];return <button key={item.id} className={"fleet-aircraft-row "+(selectedAircraft?.id===item.id?"selected":"")} onClick={()=>setSelectedAircraft(item)}><span className="fleet-row-icon"><Plane size={16}/></span><span className="fleet-row-copy"><b>{item.registration}</b><small>{pos?.state===2?"In flight":pos?.state===1?"On ground":pos?.state===5?"Maintenance":pos?.state===4?"Stopped":"Position unavailable"}</small></span><span className="fleet-row-number">#{item.fleetRank}</span></button>;})}</div>
          </section>
          {selectedAircraft&&<section className="section-card aircraft-detail-card">
            <div className="section-head"><div><p className="eyebrow">AIRCRAFT RECORD</p><h2>{selectedAircraft.registration}</h2><p>Fleet number #{selectedAircraft.fleetRank} · {selectedPosition?.state===2?"In flight":selectedPosition?.state===1?"On ground":selectedPosition?.state===5?"Maintenance":selectedPosition?.state===4?"Stopped":"Status unknown"}</p></div><button className="icon-button" onClick={()=>setSelectedAircraft(null)} aria-label="Close aircraft details"><X size={17}/></button></div>
            {selectedPhotos.length>0&&<div className="aircraft-photo-frame"><img key={selectedPhotos[photoIndex]?.id} src={selectedPhotos[photoIndex]?.url} alt={selectedPhotos[photoIndex]?.altText||selectedAircraft.registration}/>{selectedPhotos[photoIndex]?.caption&&<span className="photo-caption">{selectedPhotos[photoIndex].caption}</span>}{selectedPhotos[photoIndex]?.credit?.displayText&&<span className="photo-credit">{selectedPhotos[photoIndex].credit.displayText}</span>}</div>}
            <div className="aircraft-route-card"><div><small>{selectedPosition?.state===2?"Current flight":"Next flight"}</small><b>{selectedActiveSchedule?.callsign||selectedNextSchedule?.callsign||"No scheduled flight"}</b></div><strong>{selectedActiveSchedule?selectedActiveSchedule.originIcao+" → "+selectedActiveSchedule.destinationIcao:selectedNextSchedule?selectedNextSchedule.originIcao+" → "+selectedNextSchedule.destinationIcao:"Route not scheduled"}</strong><span>{selectedActiveSchedule?"In progress":selectedNextSchedule?(selectedNextSchedule.crew?.length?"Crew assigned":"Ready to fly"):selectedPosition?.state===1?"Ready to fly":"No upcoming leg"}</span></div><div className="aircraft-facts"><div><small>Aircraft type</small><b>{aircraftTypes.find(type=>type.id===selectedAircraft.aircraftId)?.name||"Unknown"}</b></div><div><small>Aircraft ICAO</small><b>{"Not supplied by Infinite Flight API"}</b></div><div><small>Aircraft category</small><b>{aircraftCategory(aircraftTypes.find(type=>type.id===selectedAircraft.aircraftId)?.name||"")}</b></div><div><small>Flight number</small><b>{selectedActiveSchedule?.callsign||"Unknown"}</b></div><div><small>Estimated route progress</small><b>{routeProgress===null?"Unknown":routeProgress+"%"}</b></div><div><small>Departure / scheduled ETA</small><b>{selectedActiveSchedule?dateTime(selectedActiveSchedule.scheduledDepartureUtc)+" / "+dateTime(selectedActiveSchedule.scheduledArrivalUtc):selectedNextSchedule?dateTime(selectedNextSchedule.scheduledDepartureUtc):"Unknown"}</b></div><div><small>Heading</small><b>{selectedPosition?Math.round(selectedPosition.heading)+"°":"Unknown"}</b></div><div><small>Last pilot</small><b>{selectedPosition?.lastPilotUsername||"Unknown"}</b></div><div><small>Altitude</small><b>{selectedPosition?Math.round(selectedPosition.altitude).toLocaleString()+" ft":"Unknown"}</b></div><div><small>Ground speed</small><b>{selectedPosition?Math.round(selectedPosition.speed)+" kt":"Unknown"}</b></div><div><small>Vertical speed</small><b>{selectedPosition?Math.round(selectedPosition.verticalSpeed)+" ft/min":"Unknown"}</b></div><div><small>Last update</small><b>{selectedPosition?.updatedAt?dateTime(selectedPosition.updatedAt):"Unknown"}</b></div><div><small>Last flown</small><b>{flightHistory[0]?.actualArrivalUtc?dateTime(flightHistory[0].actualArrivalUtc):flightHistory[0]?.actualDepartureUtc?dateTime(flightHistory[0].actualDepartureUtc):"Unknown"}</b></div><div><small>Parked at</small><b>{selectedPosition?.state===1?parkedAirport:"—"}</b></div><div><small>Last movement</small><b>{selectedPosition?.updatedAt?dateTime(selectedPosition.updatedAt):"Unknown"}</b></div><div><small>Schedules</small><b>{schedules.filter(item=>item.aircraftId===selectedAircraft.aircraftId).length}</b></div></div>
            <div className="aircraft-detail-actions"><button className="outline-button" onClick={()=>navigatePage("History")}>View flight history</button><button className="outline-button" onClick={()=>{setQuery(selectedAircraft.registration);navigatePage("Schedules");}}>View schedules</button></div>
          </section>}
        </div>}</>;
}
