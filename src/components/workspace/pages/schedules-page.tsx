"use client";

/* eslint-disable @typescript-eslint/no-unused-vars */

import { Empty } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";

export function SchedulesPage(){
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
  return <>{active==="Schedules"&&<section className="section-card"><div className="section-head"><div><h2>Fleet schedules</h2><p>Schedule changes are written directly to Infinite Flight.</p></div><span className="count-pill">{schedules.length} schedules</span></div>{schedules.length?<div className="table-wrap"><table><thead><tr><th>Flight number</th><th>Route</th><th>Departure</th><th>Arrival</th><th>Status</th><th>Crew</th>{canManage&&<th/>}</tr></thead><tbody>{schedules.filter(s=>!selectedAircraft||s.aircraftId===selectedAircraft.aircraftId).map(s=><tr key={s.id}><td className="mono"><b>{s.callsign}</b></td><td className="mono">{s.originIcao} → {s.destinationIcao}</td><td>{dateTime(s.scheduledDepartureUtc,s.isTimeless)}</td><td>{dateTime(s.scheduledArrivalUtc,s.isTimeless)}</td><td><span className="status scheduled"><i/>{statusName(s.status)}</span></td><td>{s.crew?.length||0}/3</td>{canManage&&<td><button className="row-action danger" onClick={()=>void deleteSchedule(s.id)} disabled={busy} title="Delete schedule">Delete</button></td>}</tr>)}</tbody></table></div>:<Empty title="No open schedules" body="When Virtual Blue publishes schedules in Infinite Flight, they will appear here."/>}</section>}</>;
}
