"use client";
import {useEffect,useRef} from "react";
import type {Map as MapLibreMap} from "maplibre-gl";
import type {SimBriefWaypoint} from "@/lib/simbrief/server";
export function RouteMap({points,origin,destination}:{points:SimBriefWaypoint[];origin:string;destination:string}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  let map:MapLibreMap|undefined,disposed=false;
  if(!ref.current||points.length<2)return;
  void import("maplibre-gl").then(({default:maplibregl})=>{
   if(disposed||!ref.current)return;
   map=new maplibregl.Map({container:ref.current,style:"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",center:[0,20],zoom:1.5});
   map.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-right");
   map.on("load",()=>{
    if(!map)return;
    const coords=points.map(p=>[p.location.longitude,p.location.latitude] as [number,number]);
    map.addSource("dispatch-route",{type:"geojson",data:{type:"Feature",properties:{},geometry:{type:"LineString",coordinates:coords}}});
    map.addLayer({id:"dispatch-route-glow",type:"line",source:"dispatch-route",paint:{"line-color":"#49a4ff","line-width":7,"line-opacity":.22,"line-blur":3}});
    map.addLayer({id:"dispatch-route-line",type:"line",source:"dispatch-route",paint:{"line-color":"#65b6ff","line-width":2.5,"line-dasharray":[2,1]}});
    map.addSource("dispatch-points",{type:"geojson",data:{type:"FeatureCollection",features:coords.map((c,i)=>({type:"Feature" as const,properties:{name:points[i].name},geometry:{type:"Point" as const,coordinates:c}}))}});
    map.addLayer({id:"dispatch-points-layer",type:"circle",source:"dispatch-points",paint:{"circle-radius":3,"circle-color":"#c4e4ff","circle-stroke-color":"#1d5b91","circle-stroke-width":1}});
    const bounds=coords.reduce((b,c)=>b.extend(c),new maplibregl.LngLatBounds(coords[0],coords[0]));
    map.fitBounds(bounds,{padding:55,maxZoom:5,duration:700});
   });
  });
  return()=>{disposed=true;map?.remove();};
 },[points]);
 if(points.length<2)return <div className="dispatch-map-empty">The OFP did not include geocoded route points. The filed route remains available above.</div>;
 return <div className="dispatch-route-map" ref={ref} aria-label={origin+" to "+destination+" route map"}/>;
}