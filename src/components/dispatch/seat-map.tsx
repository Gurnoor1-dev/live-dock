"use client";
import {useMemo,useState} from "react";
const first=["Hannah","Oliver","Amelia","Noah","Mia","Ethan","Sofia","Leo","Grace","Lucas","Ella","Jack","Chloe","James","Ava","Henry","Lily","Oscar","Isla","Theo","Zoe","Mason","Aria","Finn"];
const last=["Mitchell","Carter","Bennett","Morgan","Reed","Parker","Brooks","Hayes","Turner","Cooper","Foster","Ward","Collins","Price","Murphy","Bailey"];
type Layout={columns:string[];rows:number;businessRows:number;premiumRows:number};
function layoutFor(type:string):Layout{
 const t=type.toUpperCase();
 if(/A380|B748|B747/.test(t))return{columns:["A","B","C","D","E","F","G","H","J","K"],rows:34,businessRows:5,premiumRows:8};
 if(/B77|B78|A33|A35/.test(t))return{columns:["A","B","C","D","E","F","G","H","J","K"],rows:30,businessRows:5,premiumRows:7};
 if(/A32|B73|B38|B39/.test(t))return{columns:["A","B","C","D","E","F"],rows:28,businessRows:4,premiumRows:0};
 if(/E17|E19|CRJ/.test(t))return{columns:["A","B","C","D"],rows:24,businessRows:3,premiumRows:0};
 return{columns:["A","B","C","D","E","F"],rows:24,businessRows:3,premiumRows:0};
}
function hash(s:string){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return h>>>0;}
export function SeatMap({aircraftType,scheduleId}:{aircraftType:string;scheduleId:string}){
 const cfg=useMemo(()=>layoutFor(aircraftType),[aircraftType]);
 const seats=useMemo(()=>{
  const out:{id:string;occupied:boolean;name:string;zone:string}[]=[];
  for(let row=1;row<=cfg.rows;row++)for(const col of cfg.columns){const id=String(row)+col,h=hash(scheduleId+":"+id),zone=row<=cfg.businessRows?"Business":row<=cfg.premiumRows?"Premium Economy":"Economy";out.push({id,occupied:h%100<(zone==="Business"?52:zone==="Premium Economy"?68:71),name:first[h%first.length]+" "+last[(h>>>5)%last.length],zone});}
  return out;
 },[cfg,scheduleId]);
 const [selected,setSelected]=useState<string|null>(null),chosen=seats.find(s=>s.id===selected),occupied=seats.filter(s=>s.occupied).length;
 const zones=["Business","Premium Economy","Economy"];
 return <section className="dispatch-card seat-card">
  <div className="dispatch-card-head"><div><span className="dispatch-kicker">CABIN CONFIGURATION</span><h2>Passenger seat plan</h2><p>Aircraft-specific layout · illustrative occupancy</p></div><span className="dispatch-chip">{aircraftType.toUpperCase()}</span></div>
  <div className="seat-summary"><span><b>{occupied}</b><small>Occupied</small></span><span><b>{seats.length-occupied}</b><small>Available</small></span><span><b>{Math.round(occupied/seats.length*100)}%</b><small>Load factor</small></span></div>
  <div className="seat-legend"><span><i className="seat-dot occupied"/> Passenger assigned</span><span><i className="seat-dot available"/> Available</span><span><i className="seat-dot selected"/> Selected</span></div>
  <div className="seat-map-shell"><div className="seat-nose"><span>FLIGHT DECK</span><b>✦</b></div>
   {zones.map(zone=>{const zoneSeats=seats.filter(s=>s.zone===zone);if(!zoneSeats.length)return null;return <div className="seat-zone" key={zone}><div className="seat-zone-title">{zone}</div>{Array.from(new Set(zoneSeats.map(s=>Number(s.id.slice(0,-1))))).map(row=><div className="seat-row" key={row}><small>{row}</small>{cfg.columns.map((col,i)=>{const seat=zoneSeats.find(s=>s.id===row+col);const aisle=(cfg.columns.length===10&&(i===3||i===7))||(cfg.columns.length===6&&i===3)||(cfg.columns.length===4&&i===2);return <span key={col} className={"seat-position"+(aisle?" aisle-gap":"")}>{seat&&<button type="button" title={seat.id+(seat.occupied?" · "+seat.name:" · Available")} aria-label={seat.id+(seat.occupied?" occupied":" available")} onClick={()=>setSelected(seat.id)} className={"seat "+(seat.occupied?"is-occupied":"is-available")+(selected===seat.id?" is-selected":"")}>{col}</button>}</span>;})}</div>)}</div>})}
   <div className="seat-tail">REAR GALLEY · LAVATORIES</div>
  </div>
  <div className="seat-passenger-detail">{chosen?<><div className="seat-passenger-avatar">{chosen.occupied?chosen.name.split(" ").map(n=>n[0]).join(""):"—"}</div><div><small>SEAT {chosen.id} · {chosen.zone.toUpperCase()}</small><b>{chosen.occupied?chosen.name:"Available seat"}</b><span>{chosen.occupied?"Sample passenger · fictional assignment":"No passenger assigned"}</span></div><button type="button" onClick={()=>setSelected(null)}>Close</button></>:<p>Select any seat to view its passenger assignment.</p>}</div>
  <p className="seat-disclaimer">Passenger names and occupancy are fictional sample data for the visual seat-plan experience. They are not real bookings or passenger records.</p>
 </section>;
}