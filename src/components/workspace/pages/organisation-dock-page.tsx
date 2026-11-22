"use client";

import { Building2, CalendarDays, Plane, Users } from "lucide-react";
import { Stat } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";

export function OrganisationDockPage(){
  const {active,organization,aircraft,aircraftTypes,members,schedules,roleName,dateTime}=useWorkspace();
  if(!organization)return null;
  return <>{active==="Organisation Dock"&&<>
    <section className="section-card">
      <div className="section-head">
        <div><p className="eyebrow">ORGANISATION PROFILE</p><h2>{organization.name}</h2><p>{organization.description||"Virtual Blue organisation profile and operational reference."}</p></div>
        <span className="count-pill">{roleName(organization.role)}</span>
      </div>
      <div className="stat-grid">
        <Stat label="Fleet aircraft" value={aircraft.length} note="Live organisation fleet" icon={<Plane size={17}/>}/>
        <Stat label="Organisation members" value={members.length} note="Current Infinite Flight membership" icon={<Users size={17}/>}/>
        <Stat label="Schedules" value={schedules.length} note="Published in Infinite Flight" icon={<CalendarDays size={17}/>}/>
        <Stat label="Active aircraft" value={aircraft.filter(item=>item.isFleetActiveSlot).length} note="Active fleet slots" icon={<Building2 size={17}/>}/>
      </div>
    </section>
    <div className="lower-grid">
      <section className="section-card">
        <div className="section-head"><div><h2>Organisation details</h2><p>Values returned by Infinite Flight PublicApi v3</p></div></div>
        <div className="aircraft-facts">
          <div><small>Organisation ID</small><b className="mono">{organization.id}</b></div>
          <div><small>Your organisation role</small><b>{roleName(organization.role)}</b></div>
          <div><small>World type</small><b>{organization.worldType}</b></div>
          <div><small>Operation type</small><b>{organization.operationType}</b></div>
        </div>
      </section>
      <section className="section-card">
        <div className="section-head"><div><h2>Fleet overview</h2><p>Aircraft records supplied by Infinite Flight</p></div><span className="count-pill">{aircraft.length}</span></div>
        {aircraft.length?<div className="table-wrap"><table><thead><tr><th>Registration</th><th>Aircraft type</th><th>Fleet rank</th><th>Slot</th></tr></thead><tbody>{aircraft.map(item=><tr key={item.id}><td className="mono"><b>{item.registration}</b></td><td>{aircraftTypes.find(type=>type.id===item.aircraftId)?.name||"Unknown"}</td><td>#{item.fleetRank}</td><td>{item.isFleetActiveSlot?"Active":"Inactive"}</td></tr>)}</tbody></table></div>:<p className="muted">No aircraft are attached to this organisation.</p>}
      </section>
    </div>
    <section className="section-card">
      <div className="section-head"><div><h2>Organisation members</h2><p>Membership and activity are read live from Infinite Flight</p></div><span className="count-pill">{members.length} pilots</span></div>
      {members.length?<div className="table-wrap"><table><thead><tr><th>Pilot</th><th>Role</th><th>Joined</th><th>Active lifts</th></tr></thead><tbody>{members.map(member=><tr key={member.userId}><td><b>{member.username||"Unknown pilot"}</b><small className="member-sub mono">{member.userId}</small></td><td>{roleName(member.role)}</td><td>{dateTime(member.joinedAt)}</td><td>{member.activeLifts}</td></tr>)}</tbody></table></div>:<p className="muted">No organisation members were returned.</p>}
    </section>
  </>}</>;
}
