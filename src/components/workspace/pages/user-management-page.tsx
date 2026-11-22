"use client";

import { UserRoundCog, Users } from "lucide-react";
import { AdminGate } from "@/components/workspace/shared-ui";
import { useWorkspace } from "../workspace-context";

export function UserManagementPage(){
  const {active,members,roleName,dateTime}=useWorkspace();
  return <AdminGate>{active==="User Management"&&<section className="section-card">
    <div className="section-head"><div><p className="eyebrow">ADMINISTRATION</p><h2>Organisation users</h2><p>Live organisation membership from Infinite Flight. App registration status is intentionally kept separate and is not inferred from membership.</p></div><UserRoundCog size={18}/></div>
    <div className="stat-grid"><div className="stat-card"><div className="stat-top"><span>Organisation members</span><span className="stat-icon"><Users size={17}/></span></div><strong>{members.length}</strong><div className="stat-note">Returned by Infinite Flight</div></div><div className="stat-card"><div className="stat-top"><span>Administrators</span><span className="stat-icon"><UserRoundCog size={17}/></span></div><strong>{members.filter(member=>member.role===1||member.role===2).length}</strong><div className="stat-note">Owners and admins</div></div></div>
    <div className="section-head"><div><h3>Infinite Flight member directory</h3><p>Username, organisation role, join date and active lifts</p></div></div>
    {members.length?<div className="table-wrap"><table><thead><tr><th>Pilot</th><th>Role</th><th>Joined</th><th>Active lifts</th></tr></thead><tbody>{members.map(member=><tr key={member.userId}><td><b>{member.username||"Unknown pilot"}</b><small className="member-sub mono">{member.userId}</small></td><td>{roleName(member.role)}</td><td>{dateTime(member.joinedAt)}</td><td>{member.activeLifts}</td></tr>)}</tbody></table></div>:<div className="empty-state"><b>No members returned</b><p>Infinite Flight did not return any members for this organisation.</p></div>}
    <div className="condition-row"><span><b>App account registry</b><small className="member-sub">Registered and unregistered app users will be separated here once the approved-IFC-username registry and account-linking workflow are added.</small></span><span className="count-pill">Not connected</span></div>
  </section>}</AdminGate>;
}
