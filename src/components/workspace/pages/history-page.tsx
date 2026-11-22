"use client";

import { Empty } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";

export function HistoryPage(){
  const {
 active,organization,aircraft,aircraftTypes,members,schedules,positions,selectedAircraft,
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
  return <>{{active==="History"&&<section className="section-card"><div className="section-head"><div><p className="eyebrow">AIRCRAFT HISTORY</p><h2>{selectedAircraft?selectedAircraft.registration:"Select an aircraft"}</h2><p>Flight records are requested from Infinite Flight when this page is opened.</p></div></div>{selectedAircraft?(flightHistory.length?<div className="table-wrap"><table><thead><tr><th>Flight date</th><th>Route</th><th>Departure</th><th>Arrival</th><th>Duration</th><th>Pilots</th></tr></thead><tbody>{flightHistory.map((flight,index)=><tr key={flight.id||index}><td>{dateTime(flight.actualDepartureUtc||flight.actualArrivalUtc)}</td><td>{flight.originIcao||"—"} → {flight.destinationIcao||"—"}</td><td>{dateTime(flight.actualDepartureUtc)}</td><td>{dateTime(flight.actualArrivalUtc)}</td><td>{typeof flight.flightTimeMinutes==="number"?Math.round(flight.flightTimeMinutes)+" min":"—"}</td><td>{flight.crew?.map((pilot)=>pilot.username).filter(Boolean).join(", ")||"Unknown"}</td></tr>)}</tbody></table></div>:<Empty title="No flight history returned" body="Infinite Flight did not return any flight records for this aircraft."/>) : <Empty title="Choose an aircraft first" body="Return to Fleet and select an aircraft to inspect its flight history."/>}</section>}}</>;
}
