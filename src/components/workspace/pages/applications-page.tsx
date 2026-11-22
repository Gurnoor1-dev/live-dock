"use client";

import { ClipboardList } from "lucide-react";
import { Empty } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";

export function ApplicationsPage(){
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
  return <>{{active==="Applications"&&<section className="section-card"><div className="section-head"><div><h2>Pilot applications</h2><p>Review requests to access the Virtual Blue flight deck.</p></div><ClipboardList size={18}/></div><Empty title="Application review workspace" body="The planned access flow will require an approved Infinite Flight Community username before a pilot can use the app. Applications, review decisions and approval status will be managed here."/></section>}}</>;
}
