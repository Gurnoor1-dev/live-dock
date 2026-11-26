"use client";
import {useMemo,useState} from "react";
const first=["Hannah","Oliver","Amelia","Noah","Mia","Ethan","Sofia","Leo","Grace","Lucas","Ella","Jack","Chloe","James","Ava","Henry","Lily","Oscar","Isla","Theo","Zoe","Mason","Aria","Finn"];
const last=["Mitchell","Carter","Bennett","Morgan","Reed","Parker","Brooks","Hayes","Turner","Cooper","Foster","Ward","Collins","Price","Murphy","Bailey"];
type Layout={columns:string[];rows:number;businessRows:number;premiumRows:number;aisles:number[];businessColumns:string[];businessAisles:number[];premiumColumns:string[];premiumAisles:number[]};
function layoutFor(type:string):Layout{
 const t=type.toUpperCase();
 if(/A380|B748|B747|B77/.test(t))return{columns:["A","B","C","D","E","F","G","H","J","K"],rows:34,businessRows:5,premiumRows:8,aisles:[2,6],businessColumns:["A","D","G","K"],businessAisles:[0,2],premiumColumns:["A","C","D","E","F","H","K"],premiumAisles:[1,4]};
 if(/B78|A35/.test(t))return{columns:["A","B","C","D","E","F","G","H","J"],rows:30,businessRows:5,premiumRows:7,aisles:[2,5],businessColumns:["A","D","G","J"],businessAisles:[0,2],premiumColumns:["A","C","D","E","G","H","J"],premiumAisles:[1,4]};
 if(/A33|A34/.test(t))return{columns:["A","C","D","E","F","G","H","K"],rows:30,businessRows:5,premiumRows:0,aisles:[1,5],businessColumns:["A","C","D","G","H","K"],businessAisles:[1,3],premiumColumns:[],premiumAisles:[]};
 if(/A20N|A21N|A32|B73|B38|B39/.test(t))return{columns:["A","B","C","D","E","F"],rows:28,businessRows:4,premiumRows:0,aisles:[2],businessColumns:["A","C","D","F"],businessAisles:[1],premiumColumns:[],premiumAisles:[]};
 if(/B75/.test(t))return{columns:["A","B","C","D","E","F"],rows:26,businessRows:4,premiumRows:0,aisles:[2],businessColumns:["A","C","D","F"],businessAisles:[1],premiumColumns:[],premiumAisles:[]};
 if(/B76/.test(t))return{columns:["A","C","D","E","F","H","K"],rows:26,businessRows:4,premiumRows:0,aisles:[1,4],businessColumns:["A","C","D","G","H","K"],businessAisles:[1,3],premiumColumns:[],premiumAisles:[]};
 if(/BCS|A22/.test(t))return{columns:["A","C","D","E","F"],rows:25,businessRows:3,premiumRows:0,aisles:[1],businessColumns:["A","C","D","F"],businessAisles:[1],premiumColumns:[],premiumAisles:[]};
 if(/E17|E19|E75|E90|E95|CRJ|AT4|AT7|DH8/.test(t))return{columns:["A","B","C","D"],rows:24,businessRows:3,premiumRows:0,aisles:[1],businessColumns:["A","B","C","D"],businessAisles:[1],premiumColumns:[],premiumAisles:[]};
 return{columns:["A","B","C","D","E","F"],rows:24,businessRows:3,premiumRows:0,aisles:[2],businessColumns:["A","C","D","F"],businessAisles:[1],premiumColumns:[],premiumAisles:[]};
}
function hash(s:string){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return h>>>0;}
export function SeatMap({aircraftType,scheduleId}:{aircraftType:string;scheduleId:string}){
 const cfg=useMemo(()=>layoutFor(aircraftType),[aircraftType]);
 const seats=useMemo(()=>{
  const out:{id:string;occupied:boolean;name:string;zone:string}[]=[];
  for(let row=1;row<=cfg.rows;row++){
   const zone=row<=cfg.businessRows?"Business":row<=cfg.premiumRows?"Premium Economy":"Economy";
   const columns=zone==="Business"?cfg.businessColumns:zone==="Premium Economy"?cfg.premiumColumns:cfg.columns;
   for(const col of columns){const id=String(row)+col,h=hash(scheduleId+":"+id);out.push({id,occupied:h%100<(zone==="Business"?52:zone==="Premium Economy"?68:71),name:(h%3===0?"Ms. ":h%3===1?"Mr. ":"Mx. ")+first[h%first.length]+" "+last[(h>>>5)%last.length],zone});}
  }
  return out;
 },[cfg,scheduleId]);
 const [selected,setSelected]=useState<string|null>(null),chosen=seats.find(s=>s.id===selected),occupied=seats.filter(s=>s.occupied).length;
 const zones=["Business","Premium Economy","Economy"];
 return <section className="dispatch-card seat-card">
  <div className="dispatch-card-head"><div><span className="dispatch-kicker">CABIN CONFIGURATION</span><h2>Passenger seat plan</h2><p>Aircraft-specific cabin sections · illustrative occupancy</p></div><span className="dispatch-chip">{aircraftType.toUpperCase()}</span></div>
  <div className="seat-summary"><span><b>{occupied}</b><small>Occupied</small></span><span><b>{seats.length-occupied}</b><small>Available</small></span><span><b>{Math.round(occupied/seats.length*100)}%</b><small>Load factor</small></span></div>
  <div className="seat-legend"><span><i className="seat-dot occupied"/> Passenger assigned</span><span><i className="seat-dot available"/> Available</span><span><i className="seat-dot selected"/> Selected</span></div>
  <div className="seat-map-shell"><div className="seat-nose"><span>FLIGHT DECK</span><b>✦</b></div>
   {zones.map(zone=>{const zoneSeats=seats.filter(s=>s.zone===zone);if(!zoneSeats.length)return null;const columns=zone==="Business"?cfg.businessColumns:zone==="Premium Economy"?cfg.premiumColumns:cfg.columns;const aisles=zone==="Business"?cfg.businessAisles:zone==="Premium Economy"?cfg.premiumAisles:cfg.aisles;return <div className="seat-zone" key={zone}><div className="seat-zone-title">{zone}</div>{Array.from(new Set(zoneSeats.map(s=>Number(s.id.slice(0,-1))))).map(row=><div className="seat-row" key={row}><small>{row}</small>{columns.map((col,i)=>{const seat=zoneSeats.find(s=>s.id===row+col);return <span key={col} className={"seat-position"+(aisles.includes(i)?" aisle-gap":"")}>{seat&&<button type="button" title={seat.id+(seat.occupied?" · "+seat.name:" · Available")} aria-label={seat.id+(seat.occupied?" occupied":" available")} onClick={()=>setSelected(seat.id)} className={"seat "+(seat.occupied?"is-occupied":"is-available")+(selected===seat.id?" is-selected":"")}>{col}</button>}</span>;})}</div>)}</div>})}
   <div className="seat-tail">REAR GALLEY · LAVATORIES</div>
  </div>
  <div className="seat-passenger-detail">{chosen?<><div className="seat-passenger-avatar">{chosen.occupied?chosen.name.replace(/^(Ms\.|Mr\.|Mx\.)\s/,"").split(" ").map(n=>n[0]).join(""):"—"}</div><div><small>SEAT {chosen.id} · {chosen.zone.toUpperCase()}</small><b>{chosen.occupied?chosen.name:"Available seat"}</b><span>{chosen.occupied?"Sample passenger · fictional assignment":"No passenger assigned"}</span></div><button type="button" onClick={()=>setSelected(null)}>Close</button></>:<p>Select any seat to view its passenger assignment.</p>}</div>
  <p className="seat-disclaimer">Passenger names and occupancy are fictional sample data for the visual seat-plan experience. They are not real bookings or passenger records.</p>
 </section>;
}