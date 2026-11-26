"use client";
import {useState} from "react";
import {PlaneTakeoff,LoaderCircle} from "lucide-react";
export function DispatchButton({scheduleId}:{scheduleId:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 async function dispatch(){
  setBusy(true);setError("");
  const popup=window.open("about:blank","simbrief_dispatch","width=1040,height=760,menubar=no,toolbar=no,location=yes,status=yes,resizable=yes,scrollbars=yes");
  if(!popup){setError("Allow pop-ups for LiveDock to open SimBrief.");setBusy(false);return;}
  try{
   const response=await fetch("/api/dispatch/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scheduleId})});
   const result=await response.json();if(!response.ok)throw new Error(result.error||"Unable to start dispatch.");
   const form=document.createElement("form");form.method="GET";form.action=result.workerUrl;form.target="simbrief_dispatch";
   const values:Record<string,string>={...result.fields,apicode:result.apicode,outputpage:result.outputPage,timestamp:result.timestamp};
   for(const [name,value] of Object.entries(values)){const input=document.createElement("input");input.type="hidden";input.name=name;input.value=String(value??"");form.appendChild(input);}
   document.body.appendChild(form);form.submit();form.remove();popup.focus();
  }catch(reason){popup.close();setError(reason instanceof Error?reason.message:"Dispatch could not be started.");}
  finally{setBusy(false);}
 }
 return <span className="dispatch-button-wrap"><button type="button" className="dispatch-launch-button" onClick={()=>void dispatch()} disabled={busy}>{busy?<LoaderCircle size={14} className="spin"/>:<PlaneTakeoff size={14}/>} {busy?"Preparing":"Dispatch"}</button>{error&&<small className="dispatch-launch-error" role="alert">{error}</small>}</span>;
}