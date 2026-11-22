"use client";

/* eslint-disable @typescript-eslint/no-unused-vars, no-unused-vars */

import { Building2 } from "lucide-react";
import { Empty } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";

export function OrganisationDockPage(){
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
  return <>{active==="Organisation Dock"&&<section className="section-card"><div className="section-head"><div><h2>Virtual Blue · Organisation Dock</h2><p>Your organisation’s public profile and operational reference in one place.</p></div><Building2 size={18}/></div><Empty title="Organisation profile foundation" body="This page will combine organisation information returned by Infinite Flight with approved Virtual Blue profile details maintained in the application."/></section>}</>;
}
