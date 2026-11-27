"use client";
import {useEffect,useRef} from "react";
import type {Map as MapLibreMap} from "maplibre-gl";
import type {SimBriefWaypoint} from "@/lib/simbrief/server";
type LivePosition={latitude:number;longitude:number;altitude?:number;heading?:number;speed?:number;updatedAt?:string;isOnGround?:boolean;lastPilotUsername?:string};
export function RouteMap({points,origin,destination,position,theme}:{points:SimBriefWaypoint[];origin:string;destination:string;position:LivePosition|null;theme:"light"|"dark"}){
 const ref=useRef<HTMLDivElement>(null),mapRef=useRef<MapLibreMap|null>(null);
 useEffect(()=>{
  let map:MapLibreMap|undefined,disposed=false;
  if(!ref.current||points.length<2)return;
  void import("maplibre-gl").then(({default:maplibregl})=>{
   if(disposed||!ref.current)return;
   map=new maplibregl.Map({container:ref.current,style:theme==="dark"?"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json":"https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",center:[0,20],zoom:1.5,attributionControl:true});
   mapRef.current=map;
   map.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-right");
   map.on("load",()=>{
    if(!map)return;
    const coords=points.map(p=>[p.location.longitude,p.location.latitude] as [number,number]);
    map.addSource("dispatch-route",{type:"geojson",data:{type:"Feature",properties:{},geometry:{type:"LineString",coordinates:coords}}});
    map.addLayer({id:"dispatch-route-glow",type:"line",source:"dispatch-route",paint:{"line-color":"#3289ed","line-width":8,"line-opacity":.16,"line-blur":3}});
    map.addLayer({id:"dispatch-route-line",type:"line",source:"dispatch-route",paint:{"line-color":"#3289ed","line-width":2.6,"line-dasharray":[2,1]}});
    map.addSource("dispatch-points",{type:"geojson",data:{type:"FeatureCollection",features:coords.map((c,i)=>({type:"Feature" as const,properties:{name:points[i].name},geometry:{type:"Point" as const,coordinates:c}}))}});
    map.addLayer({id:"dispatch-points-layer",type:"circle",source:"dispatch-points",paint:{"circle-radius":3,"circle-color":"#7db9f5","circle-stroke-color":"#fff","circle-stroke-width":1}});
    map.addSource("dispatch-live-aircraft",{type:"geojson",data:{type:"FeatureCollection",features:position&&Number.isFinite(position.latitude)&&Number.isFinite(position.longitude)?[{type:"Feature" as const,properties:{},geometry:{type:"Point" as const,coordinates:[position.longitude,position.latitude]}}]:[]}});
    map.addLayer({id:"dispatch-aircraft-halo",type:"circle",source:"dispatch-live-aircraft",paint:{"circle-radius":17,"circle-color":"#18a76b","circle-opacity":.16,"circle-blur":.5}});
    map.addLayer({id:"dispatch-aircraft-dot",type:"circle",source:"dispatch-live-aircraft",paint:{"circle-radius":7,"circle-color":"#16a36a","circle-stroke-color":"#fff","circle-stroke-width":2}});
    const bounds=coords.reduce((b,c)=>b.extend(c),new maplibregl.LngLatBounds(coords[0],coords[0]));
    if(position&&Number.isFinite(position.latitude)&&Number.isFinite(position.longitude))bounds.extend([position.longitude,position.latitude]);
    map.fitBounds(bounds,{padding:55,maxZoom:5,duration:700});
   });
  });
  return()=>{disposed=true;mapRef.current=null;map?.remove();};
 },[points,theme]);
 useEffect(()=>{
  const map=mapRef.current;if(!map||!map.isStyleLoaded())return;
  const source=map.getSource("dispatch-live-aircraft") as import("maplibre-gl").GeoJSONSource|undefined;
  if(!source)return;
  source.setData({type:"FeatureCollection",features:position&&Number.isFinite(position.latitude)&&Number.isFinite(position.longitude)?[{type:"Feature",properties:{},geometry:{type:"Point",coordinates:[position.longitude,position.latitude]}}]:[]});
 },[position]);
 if(points.length<2)return <div className="dispatch-map-empty">The OFP did not include geocoded route points. The filed route remains available above.</div>;
 return <div className="dispatch-map-wrap"><div className="dispatch-route-map" ref={ref} aria-label={origin+" to "+destination+" route map"}/><div className="dispatch-map-legend"><span><i className="route-line-key"/> Filed route</span><span><i className="aircraft-dot-key"/> Assigned aircraft</span></div></div>;
}
