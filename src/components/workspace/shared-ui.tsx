"use client";

import { Command } from "lucide-react";
import type { ReactNode } from "react";
import { useWorkspace } from "@/components/workspace/workspace-context";

export function Stat({label,value,note,icon}:{label:string;value:number;note:string;icon:ReactNode}){
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value.toLocaleString()}</strong><div className="stat-note">{note}</div></div>;
}

export function Empty({title,body}:{title:string;body:string}){
  return <div className="empty-state"><span className="empty-icon"><Command size={20}/></span><b>{title}</b><p>{body}</p></div>;
}

export function AdminGate({children}:{children:ReactNode}){
  const {canManage}=useWorkspace();
  if(canManage)return <>{children}</>;
  return <section className="section-card"><div className="empty-state"><span className="empty-icon"><Command size={20}/></span><b>Administrator access required</b><p>This workspace section is available only to Virtual Blue organisation owners and administrators.</p></div></section>;
}
