"use client";

/* eslint-disable @typescript-eslint/no-unused-vars */

import { Plug } from "lucide-react";
import { AdminGate, Empty } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";

export function IntegrationsPage(){
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
  return <AdminGate>{active==="Integrations"&&<section className="section-card"><div className="section-head"><div><h2>Discord integrations</h2><p>Manage connected Discord services and automated organisation updates.</p></div><Plug size={18}/></div><Empty title="Integration controls coming next" body="This page is reserved for Discord connection settings, embed destinations, channel selection, message content, formatting and delivery preferences."/></section>}</AdminGate>;
}
