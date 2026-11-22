"use client";

/* eslint-disable @typescript-eslint/no-unused-vars */

import { UserRoundCog } from "lucide-react";
import { AdminGate, Empty } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";

export function UserManagementPage(){
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
  return <AdminGate>{active==="User Management"&&<section className="section-card"><div className="section-head"><div><h2>Organisation users</h2><p>Separate pilots with app access from the wider organisation pilot directory.</p></div><UserRoundCog size={18}/></div><div className="lower-grid"><div className="section-card"><h3>Registered</h3><p className="muted">Approved pilots who have created an account and can sign in.</p><Empty title="Registered users" body="Approved and registered app users will appear here."/></div><div className="section-card"><h3>Un-Registered</h3><p className="muted">Pilots not using the app, including pending applicants.</p><Empty title="Un-Registered pilots" body="This list will include organisation pilots who have not registered, plus applicants awaiting an approval decision."/></div></div></section>}</AdminGate>;
}
