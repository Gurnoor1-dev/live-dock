"use client";

import { Command } from "lucide-react";
import type { ReactNode } from "react";

export function Stat({label,value,note,icon}:{label:string;value:number;note:string;icon:ReactNode}){
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value.toLocaleString()}</strong><div className="stat-note">{note}</div></div>;
}

export function Empty({title,body}:{title:string;body:string}){
  return <div className="empty-state"><span className="empty-icon"><Command size={20}/></span><b>{title}</b><p>{body}</p></div>;
}
