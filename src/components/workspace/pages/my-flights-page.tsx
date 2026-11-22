"use client";

/* eslint-disable @typescript-eslint/no-unused-vars, no-unused-vars */

import { PlaneTakeoff } from "lucide-react";
import { Empty } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";

export function MyFlightsPage(){
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
  return <>{active==="My Flights"&&<section className="section-card"><div className="section-head"><div><h2>My flight activity</h2><p>One place for flights you have flown, are currently operating as crew, or have booked for the future.</p></div><PlaneTakeoff size={18}/></div><Empty title="Your flight timeline is being prepared" body="This page will combine your personal Infinite Flight flight history, current crew assignments and future booked legs. It will use your authenticated pilot identity and live organisation data."/></section>}</>;
}
