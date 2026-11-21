import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request:Request) {
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const body=await request.json().catch(()=>null) as {organizationId?:string;flightNumber?:string;departureAirport?:string;arrivalAirport?:string;scheduledDeparture?:string;aircraftId?:string|null}|null;
  const origin=body?.departureAirport?.trim().toUpperCase(), destination=body?.arrivalAirport?.trim().toUpperCase();
  const departure=body?.scheduledDeparture;
  if(!body?.organizationId||!origin||!destination||origin.length!==4||destination.length!==4||!departure||Number.isNaN(Date.parse(departure))) {
    return NextResponse.json({error:"Provide an organization, valid 4-letter ICAO airports and a departure time."},{status:400});
  }
  const {data,error}=await supabase.from("flight_legs").insert({
    organization_id:body.organizationId,flight_number:body.flightNumber?.trim()||null,
    departure_airport:origin,arrival_airport:destination,scheduled_departure:departure,
    aircraft_id:body.aircraftId||null,created_by:user.id
  }).select().single();
  if(error) return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({leg:data},{status:201});
}
