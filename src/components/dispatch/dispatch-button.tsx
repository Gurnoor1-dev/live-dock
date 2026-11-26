"use client";
import {useState} from "react";
import {PlaneTakeoff,LoaderCircle} from "lucide-react";
export function DispatchButton({scheduleId}:{scheduleId:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 async function dispatch(){
  setBusy(true);setError("");
  const popup=window.open("about:blank","SBworker","width=1040,height=760,menubar=no,toolbar=no,location=yes,status=yes,resizable=yes,scrollbars=yes");
  if(!popup){setError("Allow pop-ups for LiveDock to open SimBrief.");setBusy(false);return;}
  try{
   const response=await fetch("/api/dispatch/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scheduleId})});
   const result=await response.json();if(!response.ok)throw new Error(result.error||"Unable to start dispatch.");
   if(result.alreadyDispatched){popup.close();window.location.href="/dispatch/"+scheduleId;return;}
   const form=document.createElement("form");form.method="GET";form.action=result.workerUrl;form.target="SBworker";
   const values:Record<string,string>={...result.fields,apicode:result.apicode,outputpage:result.outputPage,timestamp:result.timestamp};
   for(const [name,value] of Object.entries(values)){const input=document.createElement("input");input.type="hidden";input.name=name;input.value=String(value??"");form.appendChild(input);}
   document.body.appendChild(form);window.name="SBcaller";form.submit();form.remove();popup.focus();
   await new Promise<void>((resolve,reject)=>{
    const started=Date.now(),poll=window.setInterval(()=>{
     if(popup.closed){window.clearInterval(poll);resolve();}
     else if(Date.now()-started>10*60*1000){window.clearInterval(poll);popup.close();reject(new Error("SimBrief dispatch timed out. You can try again from My Flights."));}
    },500);
   });
   await new Promise(resolve=>window.setTimeout(resolve,1000));
   window.location.href="/api/dispatch/callback?scheduleId="+encodeURIComponent(scheduleId)+"&ofp_id="+encodeURIComponent(result.ofpId);
  }catch(reason){if(!popup.closed)popup.close();setError(reason instanceof Error?reason.message:"Dispatch could not be started.");}
  finally{setBusy(false);}
 }
 return <span className="dispatch-button-wrap"><button type="button" className="dispatch-launch-button" onClick={()=>void dispatch()} disabled={busy}>{busy?<LoaderCircle size={14} className="spin"/>:<PlaneTakeoff size={14}/>} {busy?"Waiting for SimBrief…":"Dispatch"}</button>{error&&<small className="dispatch-launch-error" role="alert">{error}</small>}</span>;
}