"use client";

/* eslint-disable @typescript-eslint/no-unused-vars */

import { SlidersHorizontal } from "lucide-react";
import { AdminGate, Empty } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";

export function FeatureSelectionPage(){
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
  return <AdminGate>{active==="Feature Selection"&&<section className="section-card"><div className="section-head"><div><h2>Organisation features</h2><p>Choose which optional capabilities are enabled for Virtual Blue.</p></div><SlidersHorizontal size={18}/></div><div className="condition-row"><span><b>Auto-Crew</b><small className="member-sub">Automatically assist with schedule crew assignment.</small></span><span className="count-pill">Not configured</span></div><div className="condition-row"><span><b>Schedule Revisor</b><small className="member-sub">Review and revise schedule operations.</small></span><span className="count-pill">Not configured</span></div><Empty title="Feature controls are not active yet" body="These are structural placeholders only. Feature flags, permissions, persistence and the actual Auto-Crew / Schedule Revisor workflows will be implemented in a later step."/></section>}</AdminGate>;
}
