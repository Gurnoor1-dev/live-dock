"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect,useState } from "react";
import { ShieldCheck,X } from "lucide-react";
import { loadPilotProfile, updateCachedPilotProfile } from "@/lib/client/pilot-profile";
type Profile={ifcUserId:string;onboardingRequired:boolean;discordUserId:string|null;discordUsername:string|null;username:string|null;role:number|null};
export function OnboardingGate(){
 const [profile,setProfile]=useState<Profile|null>(null);
 const [open,setOpen]=useState(false);
 const [code,setCode]=useState("");
 const [discordUserId,setDiscordUserId]=useState("");
 const [discordUsername,setDiscordUsername]=useState("");
 const [loading,setLoading]=useState(false);
 const [bootstrapLoading,setBootstrapLoading]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 async function load(){
  const d=await loadPilotProfile();
  setProfile(d);setDiscordUserId(d.discordUserId||"");setDiscordUsername(d.discordUsername||"");setOpen(Boolean(d.onboardingRequired));
 }
 useEffect(()=>{void load().catch(e=>setError(e.message))},[]);
 async function generateBootstrapCode(){
  setBootstrapLoading(true);setError("");
  try{
   const r=await fetch("/api/onboarding/bootstrap-code",{method:"POST",cache:"no-store"});
   const d=await r.json();
   if(!r.ok)throw new Error(d.error||"Could not generate the first-admin code.");
   setCode(d.code);
   setNotice("Your one-time first-admin code is ready. It expires in 30 minutes.");
  }catch(e){setError(e instanceof Error?e.message:"Could not generate the first-admin code.");}
  finally{setBootstrapLoading(false);}
 }
 async function submit(){
  setLoading(true);setError("");setNotice("");
  try{
   const r=await fetch(profile?.onboardingRequired?"/api/onboarding/complete":"/api/profile",{
    method:profile?.onboardingRequired?"POST":"PATCH",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({code,discordUserId,discordUsername})
   });
   const d=await r.json();
   if(!r.ok)throw new Error(d.error||"Could not save your profile.");
   const updated={onboardingRequired:false,discordUserId,discordUsername};
   updateCachedPilotProfile(updated);
   setProfile(v=>v?{...v,...updated}:v);
   setCode("");setOpen(false);setNotice("Your profile has been saved.");
  }catch(e){setError(e instanceof Error?e.message:"Could not save profile.");}
  finally{setLoading(false);}
 }
 if(!profile)return error?<div className="modal-scrim onboarding-scrim"><section className="modal-card onboarding-modal" role="alertdialog" aria-modal="true"><span className="setup-icon"><ShieldCheck size={21}/></span><h2>Account verification unavailable</h2><p className="muted">{error}</p><button className="primary-button" onClick={()=>void load().catch(e=>setError(e.message))}>Retry verification</button></section></div>:null;
 return <>{open&&<div className="modal-scrim onboarding-scrim"><section className="modal-card onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">{!profile.onboardingRequired&&<button className="modal-close" onClick={()=>setOpen(false)}><X size={17}/></button>}<span className="setup-icon"><ShieldCheck size={21}/></span><p className="eyebrow">{profile.onboardingRequired?"FIRST-LOGIN VERIFICATION":"PILOT PROFILE"}</p><h2 id="onboarding-title">{profile.onboardingRequired?"Complete your pilot profile":"Your profile"}</h2><p className="muted">{profile.onboardingRequired?"Enter the one-time application code issued by a Virtual Blue administrator and link your Discord account. This step is required before using the flight deck.":"Update the Discord account used for crew request notifications and bot mentions."}</p><form className="setup-form" onSubmit={e=>{e.preventDefault();void submit()}}>{profile.onboardingRequired&&<><div className="setup-field"><label>10-character application code<input required minLength={10} maxLength={10} autoCapitalize="characters" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="AB12CD34EF"/></label><button className="outline-button" type="button" onClick={()=>void generateBootstrapCode()} disabled={bootstrapLoading}>{bootstrapLoading?"Generating…":"Generate first-admin code"}</button><p className="muted">Only the Infinite Flight account configured as the initial administrator can use this one-time setup.</p></div></> }<label>Discord User ID<input required inputMode="numeric" pattern="[0-9]{17,20}" value={discordUserId} onChange={e=>setDiscordUserId(e.target.value)} placeholder="17–20 digit Discord ID"/></label><label>Discord username (optional)<input value={discordUsername} onChange={e=>setDiscordUsername(e.target.value)} placeholder="@username"/></label>{error&&<p className="form-error">{error}</p>}{notice&&<p className="muted">{notice}</p>}<button className="primary-button" type="submit" disabled={loading}>{loading?"Saving…":profile.onboardingRequired?"Verify and continue":"Save profile"}</button></form></section></div>}{notice&&!open&&<span className="profile-save-notice">{notice}</span>}</>;
}
