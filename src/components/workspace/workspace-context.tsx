"use client";

import { createContext, useContext, type Dispatch, type ReactNode, type RefObject, type SetStateAction, type FormEvent } from "react";

type WorkspacePageKey="Home"|"Schedules"|"My Flights"|"Organisation Dock"|"Admin Schedules"|"Integrations"|"Applications"|"User Management"|"Feature Selection"|"History";
type Organization={id:string;name:string;role:number;description?:string|null;worldType:number;operationType:number};
type Aircraft={id:string;aircraftId:string;organizationId:string;registration:string;status:number;visibility:number;fleetPriority:number|null;fleetRank:number;isFleetActiveSlot:boolean};
type Member={userId:string;username:string|null;role:number;joinedAt:string;activeLifts:number};
type Crew={userId:string;username:string|null;role:number};
type Schedule={id:string;status:number;callsign:string;organizationId:string;aircraftId:string;flightType:number;originIcao:string;destinationIcao:string;isTimeless:boolean;scheduledDepartureUtc:string;scheduledArrivalUtc:string;briefing:string|null;flightPlan:string|null;crew:Crew[];sequence:number};
type FlightHistoryCrewMember={username?:string|null;userId?:string};
type FlightHistoryRecord={id?:string;actualDepartureUtc?:string;actualArrivalUtc?:string;originIcao?:string;destinationIcao?:string;flightTimeMinutes?:number;crew?:FlightHistoryCrewMember[]};
type Position={id:string;state:number;isOnGround:boolean;latitude:number;longitude:number;altitude:number;heading:number;speed:number;verticalSpeed:number;lastPilotId?:string;lastPilotUsername?:string;updatedAt:string;airportIcao?:string;airportName?:string};
type AircraftType={id:string;name:string};
type GalleryPhoto={id:string;url:string;altText:string;caption:string;credit:{name:string;url:string;displayText:string};displayOrder:number;isVisible:boolean};
type GalleryManifest={settings:{maxPhotosPerAircraft:number;slideshowIntervalMs:number};aircraft:Record<string,{photos:GalleryPhoto[]}>};
type Airport={icao?:string;icaoCode?:string;code?:string;name?:string;latitude?:number;longitude?:number;location?:{latitude?:number;longitude?:number}};
type Flight={id:string;callsign?:string;originIcao?:string|null;destinationIcao?:string|null;actualDepartureUtc?:string|null;actualArrivalUtc?:string|null;scheduledDepartureUtc?:string;isTimeless?:boolean;aircraftRegistration?:string;flightTimeMinutes?:number};
type AdminSnapshot={registered:Array<any>;pending:Array<any>;connected:boolean;codes:Array<any>;integrations:Record<string,any>;features:Array<{featureKey:string;enabled:boolean}>;stickyPanel:{exists:boolean;reason:string}};
type WorkspaceSnapshotData={airports:Airport[];airportPoints:Record<string,{latitude:number;longitude:number}>;requests:Array<{scheduleId:string;seat:"captain"|"first_officer";status:"pending"|"processing"|"approved"|"rejected"|"failed"}>;myFlights:{live:Flight[];future:Flight[];past:Flight[];pastCoverage:{checked:number;total:number;complete:boolean;limited:boolean}};activity:Array<any>;admin:AdminSnapshot;requestUsage:{initial:number;additional:number;total:number;limit:number;quota:{isPro:boolean;remaining:number}}};

export interface WorkspaceContextValue {
  active:string;
  refreshWorkspace:(invalidateIFCache?:boolean)=>Promise<void>;
  organization:Organization|null;
  snapshotData:WorkspaceSnapshotData;
  aircraft:Aircraft[];
  aircraftTypes:AircraftType[];
  members:Member[];
  schedules:Schedule[];
  liveSchedules:Schedule[];
  positions:Record<string,Position>;
  selectedAircraft:Aircraft|null;
  selectedPosition:Position|undefined;
  selectedActiveSchedule:Schedule|undefined;
  selectedNextSchedule:Schedule|undefined;
  selectedPhotos:GalleryPhoto[];
  photoIndex:number;
  routeProgress:number|null;
  parkedAirport:string;
  flightHistory:FlightHistoryRecord[];
  canManage:boolean;
  query:string;
  setQuery:Dispatch<SetStateAction<string>>;
  visibleAircraft:Aircraft[];
  mapContainer:RefObject<HTMLDivElement|null>;
  setSelectedAircraft:Dispatch<SetStateAction<Aircraft|null>>;
  navigatePage:(page:WorkspacePageKey)=>void;
  statusName:(status:number)=>string;
  dateTime:(value:string|undefined,timeless?:boolean)=>string;
  aircraftCategory:(code:string)=>string;
  busy:boolean;
  deleteSchedule:(id:string)=>Promise<void>;
  callsign:string;
  setCallsign:Dispatch<SetStateAction<string>>;
  aircraftId:string;
  setAircraftId:Dispatch<SetStateAction<string>>;
  origin:string;
  setOrigin:Dispatch<SetStateAction<string>>;
  destination:string;
  setDestination:Dispatch<SetStateAction<string>>;
  timeless:boolean;
  setTimeless:Dispatch<SetStateAction<boolean>>;
  departure:string;
  setDeparture:Dispatch<SetStateAction<string>>;
  arrival:string;
  setArrival:Dispatch<SetStateAction<string>>;
  briefing:string;
  setBriefing:Dispatch<SetStateAction<string>>;
  createSchedule:(event:FormEvent)=>Promise<void>;
  crewSelections:Record<string,string>;
  setCrewSelections:Dispatch<SetStateAction<Record<string,string>>>;
  crewRoles:Record<string,string>;
  setCrewRoles:Dispatch<SetStateAction<Record<string,string>>>;
  assignCrew:(schedule:Schedule)=>Promise<void>;
  gallery:GalleryManifest|null;
  galleryLoading:boolean;
  galleryRegistration:string;
  setGalleryRegistration:Dispatch<SetStateAction<string>>;
  galleryCredit:string;
  setGalleryCredit:Dispatch<SetStateAction<string>>;
  galleryCreditUrl:string;
  setGalleryCreditUrl:Dispatch<SetStateAction<string>>;
  galleryCaption:string;
  setGalleryCaption:Dispatch<SetStateAction<string>>;
  galleryFile:File|null;
  setGalleryFile:Dispatch<SetStateAction<File|null>>;
  uploadAircraftPhoto:(event:FormEvent)=>Promise<void>;
  deleteAircraftPhoto:(registration:string,photoId:string)=>Promise<void>;
  roleName:(role:number)=>string;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({value,children}:{value:WorkspaceContextValue;children:ReactNode}){
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace():WorkspaceContextValue{
  const value=useContext(WorkspaceContext);
  if(!value)throw new Error("Workspace page components must be rendered inside WorkspaceProvider.");
  return value;
}
