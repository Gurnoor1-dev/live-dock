"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  AlertTriangle, ArrowDown, ArrowDownUp, ArrowLeft, ArrowUp, Check, CheckCircle2,
  ChevronDown, ChevronRight, Clock3, Code2, Copy, FileJson, GripVertical, Layers3,
  MapPin, Plane, RefreshCw, Save, Search, ShieldAlert, Trash2, Undo2, X
} from "lucide-react";
import { useWorkspace } from "../workspace-context";
import { Empty } from "../shared-ui";
import styles from "./edit-schedules-page.module.css";

type Crew = { userId: string; username?: string | null; role: number };
type Schedule = {
  id: string; status: number; callsign: string; organizationId: string; aircraftId: string;
  flightType: number; originIcao: string; destinationIcao: string; isTimeless: boolean;
  scheduledDepartureUtc: string; scheduledArrivalUtc: string; briefing: string | null;
  flightPlan: string | null; crew: Crew[]; sequence: number;
};
type ScheduleDraft = {
  callsign: string; flightType: number; originIcao: string; destinationIcao: string;
  isTimeless: boolean; departure: string; arrival: string; briefing: string;
};
type PendingAction = { title: string; description: string; warning: string; confirmLabel: string; run: () => Promise<void>; danger?: boolean };

const api = async (path: string, init: RequestInit = {}) => {
  const response = await fetch("/api/if" + path, {
    ...init, credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.error || payload.message || `Infinite Flight returned HTTP ${response.status}.`);
  if (typeof payload.errorCode === "number" && payload.errorCode !== 0) throw new Error(payload.message || `Infinite Flight API error ${payload.errorCode}.`);
  return payload.result;
};

const toLocalInput = (value?: string) => {
  if (!value || value.startsWith("0001-")) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const toDraft = (s: Schedule): ScheduleDraft => ({
  callsign: s.callsign || "", flightType: Number(s.flightType ?? 1),
  originIcao: s.originIcao || "", destinationIcao: s.destinationIcao || "",
  isTimeless: Boolean(s.isTimeless), departure: toLocalInput(s.scheduledDepartureUtc),
  arrival: toLocalInput(s.scheduledArrivalUtc), briefing: s.briefing || ""
});
const statusLabel = (status: number) => ({ 1: "Scheduled", 2: "Boarding", 3: "Boarded", 4: "Taxiing", 6: "In flight", 7: "Diverted", 8: "Delayed", 9: "Cancelled", 10: "Taxiing to parking", 11: "Arrived" } as Record<number, string>)[status] || "Unknown";
const statusClass = (status: number) => status === 1 ? "scheduled" : status === 6 ? "flight" : [2,3,4,10].includes(status) ? "active" : "other";
const parseFlightPlan = (value: string | null) => {
  if (!value) return "";
  try { return JSON.stringify(JSON.parse(value), null, 2); }
  catch { return value; }
};
const formatDate = (value: string, timeless: boolean) => timeless ? "Timeless" : value ? new Date(value).toLocaleString() : "—";

export function EditSchedulesPage() {
  const { active, canManage, schedules, aircraft, aircraftTypes, dateTime, refreshWorkspace } = useWorkspace();
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [aircraftFilter, setAircraftFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [flightPlanText, setFlightPlanText] = useState("");
  const [dirtyFlightPlan, setDirtyFlightPlan] = useState(false);
  const [section, setSection] = useState<"details" | "flightplan" | "crew">("details");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [draggedId, setDraggedId] = useState("");
  const [dragOverId, setDragOverId] = useState("");
  const [jsonMode, setJsonMode] = useState(true);

  const records = schedules as Schedule[];
  const selected = records.find(item => item.id === selectedId) || null;
  const selectedAircraft = selected ? aircraft.find(item => item.id === selected.aircraftId) : null;
  const aircraftName = (id: string) => {
    const item = aircraft.find(value => value.id === id);
    return item ? item.registration + " · " + (aircraftTypes.find(t => t.id === item.aircraftId)?.name || "Aircraft") : "Aircraft unavailable";
  };
  const filtered = useMemo(() => records.filter(item => {
    const text = (item.callsign + " " + item.originIcao + " " + item.destinationIcao + " " + aircraftName(item.aircraftId)).toLowerCase();
    return (!search || text.includes(search.toLowerCase())) &&
      (aircraftFilter === "all" || item.aircraftId === aircraftFilter) &&
      (statusFilter === "all" || String(item.status) === statusFilter);
  }), [records, search, aircraftFilter, statusFilter, aircraft, aircraftTypes]);

  useEffect(() => {
    if (!selectedId && records.length) setSelectedId(records[0].id);
    if (selectedId && !records.some(item => item.id === selectedId)) setSelectedId(records[0]?.id || "");
  }, [records, selectedId]);
  useEffect(() => {
    if (!selected) { setDraft(null); setFlightPlanText(""); return; }
    setDraft(toDraft(selected));
    setFlightPlanText(parseFlightPlan(selected.flightPlan));
    setDirtyFlightPlan(false);
  }, [selected?.id, selected?.updatedAt, selected?.callsign, selected?.flightPlan]);

  const changedFields = useMemo(() => {
    if (!selected || !draft) return [];
    const original = toDraft(selected);
    const fields: Array<[string, string, string]> = [
      ["Flight number", original.callsign, draft.callsign],
      ["Flight type", String(original.flightType), String(draft.flightType)],
      ["Origin", original.originIcao, draft.originIcao],
      ["Destination", original.destinationIcao, draft.destinationIcao],
      ["Schedule type", original.isTimeless ? "Timeless" : "Timed", draft.isTimeless ? "Timeless" : "Timed"],
      ["Departure", original.departure || "—", draft.isTimeless ? "—" : draft.departure || "—"],
      ["Arrival", original.arrival || "—", draft.isTimeless ? "—" : draft.arrival || "—"],
      ["Briefing", original.briefing || "Empty", draft.briefing || "Empty"]
    ];
    return fields.filter(([, before, after]) => before !== after);
  }, [selected, draft]);

  const planValidation = useMemo(() => {
    if (!flightPlanText.trim()) return { valid: true, value: null as unknown, message: "An empty value clears the stored flight plan." };
    try {
      const value = JSON.parse(flightPlanText);
      if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, value: null, message: "Flight plan must be a JSON object or null." };
      if (!Array.isArray(value.flightPlanItems) || value.flightPlanItems.length < 1 || value.flightPlanItems.length > 500) return { valid: false, value: null, message: "flightPlanItems must contain between 1 and 500 items." };
      return { valid: true, value, message: value.flightPlanItems.length + " flight-plan item(s) ready to submit." };
    } catch { return { valid: false, value: null, message: "JSON is invalid. Check commas, braces and quotation marks." }; }
  }, [flightPlanText]);

  const groupSchedules = useMemo(() => {
    if (!selected) return [];
    return records.filter(item => item.aircraftId === selected.aircraftId).sort((a,b) => a.sequence - b.sequence);
  }, [records, selected?.aircraftId]);

  const queueAction = (action: PendingAction) => { setError(""); setNotice(""); setPending(action); };
  const executePending = async () => {
    if (!pending || busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await pending.run(); setPending(null); }
    catch (e) { setError(e instanceof Error ? e.message : "The Infinite Flight operation failed."); }
    finally { setBusy(false); }
  };

  const saveDetails = () => {
    if (!selected || !draft || !changedFields.length) return;
    const departure = draft.isTimeless ? null : new Date(draft.departure).toISOString();
    const arrival = draft.isTimeless ? null : new Date(draft.arrival).toISOString();
    if (!draft.isTimeless && (!draft.departure || !draft.arrival || new Date(arrival!).getTime() <= new Date(departure!).getTime())) {
      setError("Arrival must be later than departure. Choose valid local date and times."); return;
    }
    if (!draft.callsign.trim() || !draft.originIcao.trim() || !draft.destinationIcao.trim()) {
      setError("Flight number, origin and destination are required."); return;
    }
    const payload = {
      callsign: draft.callsign.trim(), flightType: Number(draft.flightType),
      originIcao: draft.originIcao.trim().toUpperCase(), destinationIcao: draft.destinationIcao.trim().toUpperCase(),
      isTimeless: draft.isTimeless, scheduledDepartureUtc: departure, scheduledArrivalUtc: arrival,
      briefing: draft.briefing.trim() || null
    };
    queueAction({
      title: "Update schedule details",
      description: `You are updating ${selected.callsign} · ${selected.originIcao} → ${selected.destinationIcao}.`,
      warning: "Infinite Flight does not provide schedule revision history or an undo operation. Save the before-values shown below if you may need to restore them manually.",
      confirmLabel: "Update schedule",
      run: async () => {
        await api("/live/schedules/" + selected.id, { method: "PUT", body: JSON.stringify(payload) });
        setNotice("Schedule details updated in Infinite Flight.");
        await refreshWorkspace();
      }
    });
  };

  const saveFlightPlan = () => {
    if (!selected || !dirtyFlightPlan || !planValidation.valid) return;
    queueAction({
      title: "Update flight plan",
      description: `You are changing the flight plan attached to ${selected.callsign}.`,
      warning: "This replaces the existing stored flight plan. Infinite Flight does not provide an undo or revision-history endpoint. Keep a copy of the current plan before continuing.",
      confirmLabel: flightPlanText.trim() ? "Save flight plan" : "Clear flight plan",
      danger: !flightPlanText.trim(),
      run: async () => {
        await api("/live/schedules/" + selected.id + "/flightplan", {
          method: "PUT", body: JSON.stringify({ flightPlan: planValidation.value })
        });
        setNotice(flightPlanText.trim() ? "Flight plan updated in Infinite Flight." : "Stored flight plan cleared.");
        setDirtyFlightPlan(false);
        await refreshWorkspace();
      }
    });
  };

  const deleteSelected = () => {
    if (!selected) return;
    queueAction({
      title: "Permanently delete schedule",
      description: `Delete ${selected.callsign} · ${selected.originIcao} → ${selected.destinationIcao} from Infinite Flight?`,
      warning: "This is destructive and cannot be undone through LiveDock. Record the complete schedule details and crew assignments before proceeding. Any associated crew assignment workflow may also be affected.",
      confirmLabel: "Delete permanently", danger: true,
      run: async () => {
        await api("/live/schedules/" + selected.id, { method: "DELETE" });
        setNotice("Schedule deleted from Infinite Flight.");
        setSelectedId("");
        await refreshWorkspace();
      }
    });
  };

  const moveSchedule = (schedule: Schedule, afterId: string | null) => {
    if (![1,6].includes(schedule.status)) {
      setError("Infinite Flight only allows reordering schedules with Scheduled or InFlight status."); return;
    }
    if (schedule.id === afterId) return;
    const after = afterId ? groupSchedules.find(item => item.id === afterId) : null;
    if (after && after.aircraftId !== schedule.aircraftId) return;
    queueAction({
      title: "Change aircraft schedule order",
      description: afterId
        ? `Move ${schedule.callsign} after ${after?.callsign || "the selected schedule"} on ${aircraftName(schedule.aircraftId)}.`
        : `Move ${schedule.callsign} to the top of the schedule sequence for ${aircraftName(schedule.aircraftId)}.`,
      warning: "This changes the live sequence in Infinite Flight immediately after confirmation. There is no built-in undo; you can manually move the schedule again to restore its previous position.",
      confirmLabel: "Apply new order",
      run: async () => {
        await api("/live/aircraft/" + schedule.aircraftId + "/schedules/reorder", {
          method: "PUT", body: JSON.stringify({ scheduleId: schedule.id, afterId })
        });
        setNotice("Schedule order updated in Infinite Flight.");
        await refreshWorkspace();
      }
    });
  };

  const onDragStart = (event: DragEvent<HTMLButtonElement>, id: string) => {
    setDraggedId(id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id);
  };
  const onDropOn = (event: DragEvent<HTMLDivElement>, target: Schedule) => {
    event.preventDefault(); const id = draggedId || event.dataTransfer.getData("text/plain");
    const moving = groupSchedules.find(item => item.id === id);
    setDraggedId(""); setDragOverId("");
    if (!moving || moving.id === target.id) return;
    if (![1,6].includes(moving.status) || ![1,6].includes(target.status)) {
      setError("Only Scheduled and InFlight schedule records can be reordered."); return;
    }
    moveSchedule(moving, target.id);
  };

  if (active !== "Edit Schedules") return null;
  if (!canManage) return <section className="section-card"><Empty title="Administrator access required" body="Only Infinite Flight organisation owners and administrators can edit schedules."/></section>;

  return <div className={styles.editor}>
    <div className={styles.hero}>
      <div><p className={styles.eyebrow}>ADMINISTRATION / LIVE SCHEDULES</p><h2>Schedule Editor</h2><p>Review, refine, sequence and manage the schedules published to Infinite Flight.</p></div>
      <div className={styles.heroActions}><span className={styles.liveTag}><i/> LIVE DATA</span><button className={styles.secondaryButton} onClick={() => void refreshWorkspace()} disabled={busy}><RefreshCw size={15}/> Refresh schedules</button></div>
    </div>

    <div className={styles.metrics}>
      <div><span>Total schedules</span><b>{records.length}</b><small>Current organization roster</small></div>
      <div><span>Scheduled</span><b>{records.filter(s=>s.status===1).length}</b><small>Available for sequencing</small></div>
      <div><span>In flight</span><b>{records.filter(s=>s.status===6).length}</b><small>Live operational legs</small></div>
      <div><span>Aircraft represented</span><b>{new Set(records.map(s=>s.aircraftId)).size}</b><small>Across the organization fleet</small></div>
    </div>

    {(error || notice) && <div className={error ? styles.errorBanner : styles.successBanner} role="status">{error ? <AlertTriangle size={17}/> : <CheckCircle2 size={17}/>}<span>{error || notice}</span><button onClick={() => {setError("");setNotice("");}} aria-label="Dismiss"><X size={15}/></button></div>}

    <div className={styles.layout}>
      <aside className={styles.listPanel}>
        <div className={styles.listHeader}><div><b>Published schedules</b><span>{filtered.length} of {records.length} records</span></div><Layers3 size={18}/></div>
        <label className={styles.search}><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search callsign, route, aircraft…"/></label>
        <div className={styles.filters}>
          <select value={aircraftFilter} onChange={e=>setAircraftFilter(e.target.value)} aria-label="Filter by aircraft"><option value="all">All aircraft</option>{aircraft.map(a=><option key={a.id} value={a.id}>{a.registration}</option>)}</select>
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} aria-label="Filter by status"><option value="all">All statuses</option>{[1,2,3,4,6,7,8,9,10,11].map(n=><option key={n} value={String(n)}>{statusLabel(n)}</option>)}</select>
        </div>
        <div className={styles.scheduleList}>
          {filtered.map(item => <button key={item.id} className={item.id===selectedId?styles.scheduleItemActive:styles.scheduleItem} onClick={()=>{setSelectedId(item.id);setSection("details");setError("");}} draggable={false}>
            <span className={styles.itemTop}><b>{item.callsign}</b><i className={styles[statusClass(item.status)]}>{statusLabel(item.status)}</i></span>
            <span className={styles.itemRoute}>{item.originIcao}<ArrowRightIcon/> {item.destinationIcao}</span>
            <span className={styles.itemMeta}><span><Plane size={12}/>{aircraftName(item.aircraftId).split(" · ")[0]}</span><span><Clock3 size={12}/>{formatDate(item.scheduledDepartureUtc,item.isTimeless)}</span></span>
            {item.id===selectedId&&<span className={styles.selectedIndicator}><Check size={12}/> Selected for editing</span>}
          </button>)}
          {!filtered.length&&<Empty title="No matching schedules" body="Change your search or filters to see more records."/>}
        </div>
        <div className={styles.listFoot}><ShieldAlert size={14}/> Changes are written directly to Infinite Flight after confirmation.</div>
      </aside>

      <section className={styles.workspace}>
        {!selected || !draft ? <div className={styles.noSelection}><Empty title="Select a schedule" body="Choose a published schedule from the list to open its full editor."/></div> : <>
          <div className={styles.recordHeader}>
            <div><div className={styles.recordKicker}>EDITING LIVE SCHEDULE <span>·</span> {selected.id.slice(0,8).toUpperCase()}</div><h3>{selected.callsign}</h3><p>{selected.originIcao} <ArrowRightIcon/> {selected.destinationIcao} <span>·</span> {aircraftName(selected.aircraftId)}</p></div>
            <div className={styles.recordStatus}><i className={styles[statusClass(selected.status)]}/>{statusLabel(selected.status)}</div>
          </div>
          <div className={styles.tabs}>
            <button className={section==="details"?styles.tabActive:styles.tab} onClick={()=>setSection("details")}><Plane size={15}/> Schedule details {changedFields.length>0&&<i>{changedFields.length}</i>}</button>
            <button className={section==="flightplan"?styles.tabActive:styles.tab} onClick={()=>setSection("flightplan")}><FileJson size={15}/> Flight plan {dirtyFlightPlan&&<i>•</i>}</button>
            <button className={section==="crew"?styles.tabActive:styles.tab} onClick={()=>setSection("crew")}><Layers3 size={15}/> Crew & sequence</button>
          </div>

          {section==="details"&&<div className={styles.formArea}>
            <div className={styles.sectionIntro}><div><h4>Schedule configuration</h4><p>These fields update the live schedule record. The schedule ID and aircraft association remain unchanged.</p></div><span className={styles.readonlyPill}>ID locked</span></div>
            <div className={styles.formGrid}>
              <label className={styles.field}>Flight number<input maxLength={32} value={draft.callsign} onChange={e=>setDraft({...draft,callsign:e.target.value.toUpperCase()})}/><small>Maximum 32 characters.</small></label>
              <label className={styles.field}>Flight type code<input type="number" min={0} max={255} value={draft.flightType} onChange={e=>setDraft({...draft,flightType:Number(e.target.value)})}/><small>Retain the existing code unless you know the required enum value.</small></label>
              <label className={styles.field}>Origin ICAO<input maxLength={8} value={draft.originIcao} onChange={e=>setDraft({...draft,originIcao:e.target.value.toUpperCase()})}/><small>1–8 alphanumeric characters.</small></label>
              <label className={styles.field}>Destination ICAO<input maxLength={8} value={draft.destinationIcao} onChange={e=>setDraft({...draft,destinationIcao:e.target.value.toUpperCase()})}/><small>1–8 alphanumeric characters.</small></label>
            </div>
            <div className={styles.scheduleMode}><div><b>Timeless schedule</b><small>Allow the pilot to fly this leg at any time without scheduled departure or arrival values.</small></div><button type="button" role="switch" aria-checked={draft.isTimeless} className={draft.isTimeless?styles.switchOn:styles.switchOff} onClick={()=>setDraft({...draft,isTimeless:!draft.isTimeless})}><span/></button></div>
            {!draft.isTimeless&&<div className={styles.formGrid}><label className={styles.field}>Departure date & time<input type="datetime-local" value={draft.departure} onChange={e=>setDraft({...draft,departure:e.target.value})}/><small>Entered in your local timezone; sent to Infinite Flight in UTC.</small></label><label className={styles.field}>Arrival date & time<input type="datetime-local" value={draft.arrival} onChange={e=>setDraft({...draft,arrival:e.target.value})}/><small>Must be later than departure.</small></label></div>}
            <label className={styles.field}>Crew briefing<textarea rows={5} maxLength={4000} value={draft.briefing} onChange={e=>setDraft({...draft,briefing:e.target.value})} placeholder="Operational briefing, notes, restrictions and pilot instructions…"/><small>{draft.briefing.length}/4000 characters · Plain text briefing.</small></label>
            <div className={styles.changePreview}>
              <div className={styles.previewHeading}><b>Change preview</b><span>{changedFields.length ? changedFields.length+" field(s) changed" : "No unsaved changes"}</span></div>
              {changedFields.length ? changedFields.map(([name,before,after])=><div className={styles.diffRow} key={name}><b>{name}</b><span>{before}</span><ChevronRight size={13}/><strong>{after}</strong></div>) : <p className={styles.cleanState}><CheckCircle2 size={14}/> This schedule matches its current Infinite Flight values.</p>}
            </div>
            <div className={styles.actionBar}><button className={styles.dangerButton} onClick={deleteSelected}><Trash2 size={15}/> Delete schedule</button><span className={styles.actionSpacer}/><button className={styles.secondaryButton} disabled={!changedFields.length||busy} onClick={()=>setDraft(toDraft(selected))}><Undo2 size={15}/> Discard changes</button><button className={styles.primaryButton} disabled={!changedFields.length||busy} onClick={saveDetails}><Save size={15}/> Review & save</button></div>
          </div>}

          {section==="flightplan"&&<div className={styles.formArea}>
            <div className={styles.sectionIntro}><div><h4>Stored flight plan</h4><p>Update the structured flight plan independently from the schedule's callsign and timings.</p></div><span className={styles.readonlyPill}>Dedicated API operation</span></div>
            <div className={styles.planInfo}><Code2 size={18}/><div><b>FlightPlanInfo JSON</b><p>Infinite Flight expects a JSON object containing 1–500 flightPlanItems. Each top-level waypoint needs a name or identifier and a valid location. Procedures may contain child waypoints.</p></div></div>
            <div className={styles.planToolbar}><span>ADVANCED JSON EDITOR</span><button className={styles.textButton} onClick={()=>setFlightPlanText(parseFlightPlan(selected.flightPlan))}><Undo2 size={14}/> Restore current plan</button><button className={styles.textButton} onClick={()=>{try{setFlightPlanText(JSON.stringify(JSON.parse(flightPlanText),null,2));}catch{}}}>Format JSON</button></div>
            <textarea className={styles.jsonEditor} spellCheck={false} value={flightPlanText} onChange={e=>{setFlightPlanText(e.target.value);setDirtyFlightPlan(true);}} placeholder={'{\n  "flightPlanItems": [\n    {\n      "name": "VIDP",\n      "identifier": "VIDP",\n      "location": { "latitude": 28.5562, "longitude": 77.1000 }\n    }\n  ]\n}'}/>
            <div className={planValidation.valid?styles.validationGood:styles.validationBad}>{planValidation.valid?<CheckCircle2 size={15}/>:<AlertTriangle size={15}/>}<span>{planValidation.message}</span></div>
            <div className={styles.planActions}><button className={styles.secondaryButton} onClick={()=>{setFlightPlanText("");setDirtyFlightPlan(true);}}><Trash2 size={14}/> Clear plan</button><span className={styles.actionSpacer}/><button className={styles.primaryButton} disabled={!dirtyFlightPlan||!planValidation.valid||busy} onClick={saveFlightPlan}><Save size={15}/> Review & save plan</button></div>
            <p className={styles.footnote}>The existing API returns flightPlan as a JSON string. Legacy plain-text route strings cannot be submitted as a structured flight plan; replace them with a valid FlightPlanInfo object before saving.</p>
          </div>}

          {section==="crew"&&<div className={styles.formArea}>
            <div className={styles.sectionIntro}><div><h4>Crew & schedule sequence</h4><p>Review assigned crew and adjust this aircraft's schedule order.</p></div><span className={styles.readonlyPill}>{groupSchedules.length} aircraft schedules</span></div>
            <div className={styles.crewSummary}><div><span>Captain</span><b>{selected.crew?.find(c=>c.role===0)?.username||"Unassigned"}</b></div><div><span>First officer</span><b>{selected.crew?.find(c=>c.role===1)?.username||"Unassigned"}</b></div><div><span>Crew total</span><b>{selected.crew?.length||0}/2</b></div></div>
            <div className={styles.sequenceHeader}><div><h4>Aircraft schedule sequence</h4><p>Drag a movable schedule onto another schedule to place it after that record. Use the top target to move it to first position.</p></div><span>DRAG & DROP</span></div>
            <div className={styles.dropTop} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const id=draggedId||e.dataTransfer.getData("text/plain");const item=groupSchedules.find(s=>s.id===id);setDraggedId("");if(item)moveSchedule(item,null);}}><ArrowUp size={14}/> Drop here to move to the top</div>
            <div className={styles.sequenceList}>
              {groupSchedules.map((item,index)=><div key={item.id} className={dragOverId===item.id?styles.sequenceDropTarget:styles.sequenceRow} onDragOver={e=>{if(draggedId&&draggedId!==item.id){e.preventDefault();setDragOverId(item.id);}}} onDragLeave={()=>setDragOverId("")} onDrop={e=>onDropOn(e,item)}>
                <button className={styles.dragHandle} draggable={![1,6].includes(item.status)} onDragStart={e=>onDragStart(e,item.id)} onDragEnd={()=>{setDraggedId("");setDragOverId("");}} aria-label={"Drag "+item.callsign} title="Drag to reorder"><GripVertical size={17}/></button>
                <span className={styles.sequenceNumber}>{index+1}</span><div className={styles.sequenceRoute}><b>{item.callsign}</b><span>{item.originIcao} → {item.destinationIcao}</span></div><span className={styles.sequenceStatus}>{statusLabel(item.status)}</span>
                <div className={styles.moveButtons}><button disabled={index===0||![1,6].includes(item.status)||![1,6].includes(groupSchedules[index-1]?.status)} onClick={()=>moveSchedule(item,index===1?null:groupSchedules[index-2]?.id||null)} title="Move up"><ArrowUp size={14}/></button><button disabled={index===groupSchedules.length-1||![1,6].includes(item.status)||![1,6].includes(groupSchedules[index+1]?.status)} onClick={()=>moveSchedule(item,groupSchedules[index+1]?.id||null)} title="Move down"><ArrowDown size={14}/></button></div>
                {![1,6].includes(item.status)&&<span className={styles.lockedLabel}>Locked by status</span>}
              </div>)}
              {!groupSchedules.length&&<Empty title="No schedules for this aircraft" body="This aircraft has no schedule records."/>}
            </div>
            <p className={styles.footnote}>Infinite Flight only permits reordering records with Scheduled or InFlight status. Each confirmed move sends one reorder request. No multi-record batch operation is available.</p>
          </div>}
        </>}
      </section>
    </div>

    {pending&&<div className={styles.modalBackdrop} role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setPending(null);}}>
      <section className={styles.confirmModal} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className={pending.danger?styles.modalIconDanger:styles.modalIcon}><AlertTriangle size={21}/></div>
        <button className={styles.modalClose} onClick={()=>setPending(null)} disabled={busy} aria-label="Close"><X size={17}/></button>
        <p className={styles.eyebrow}>INFINITE FLIGHT LIVE · CONFIRMATION</p><h3 id="confirm-title">{pending.title}</h3><p className={styles.modalDescription}>{pending.description}</p>
        {pending.title==="Update schedule details"&&changedFields.length>0&&<div className={styles.modalDiff}>{changedFields.map(([name,before,after])=><div key={name}><b>{name}</b><span>{before} → {after}</span></div>)}</div>}
        <div className={styles.warningBox}><ShieldAlert size={17}/><span>{pending.warning}</span></div>
        <div className={styles.modalActions}><button className={styles.secondaryButton} onClick={()=>setPending(null)} disabled={busy}>Cancel</button><button className={pending.danger?styles.dangerConfirm:styles.primaryButton} onClick={()=>void executePending()} disabled={busy}>{busy?<RefreshCw size={15} className={styles.spinning}/>:<Check size={15}/>} {busy?"Applying…":pending.confirmLabel}</button></div>
      </section>
    </div>}
  </div>;
}

function ArrowRightIcon(){ return <ChevronRight size={13} aria-hidden="true"/>; }
