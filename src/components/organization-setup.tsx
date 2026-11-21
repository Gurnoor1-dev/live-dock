"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ArrowUpRight } from "lucide-react";

export function OrganizationSetup() {
  const [name,setName]=useState("Virtual Blue");
  const [slug,setSlug]=useState("virtual-blue");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const router=useRouter();
  async function submit(e:FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const response=await fetch("/api/organizations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,slug,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})});
      const payload=await response.json();
      if(!response.ok) throw new Error(payload.error || "Unable to create organization.");
      router.refresh();
    } catch(err) { setError(err instanceof Error ? err.message : "Something went wrong."); }
    finally { setBusy(false); }
  }
  return <section className="section-card setup-card"><div className="setup-icon"><Building2 size={20}/></div><p className="eyebrow">FIRST-TIME SETUP</p><h2>Create your airline workspace</h2><p className="muted">This account is not linked to an organization yet. Create the Virtual Blue workspace; your account will become its owner.</p><form onSubmit={submit} className="setup-form"><label>Organization name<input required value={name} onChange={e=>setName(e.target.value)}/></label><label>Workspace slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={e=>setSlug(e.target.value.toLowerCase())}/></label><button className="primary-button" disabled={busy}>{busy?"Creating…":"Create workspace"} <ArrowUpRight size={14}/></button></form>{error&&<p className="form-error" role="alert">{error}</p>}</section>;
}
