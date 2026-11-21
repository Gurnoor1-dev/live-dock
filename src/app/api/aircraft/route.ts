import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request:Request) {
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const body=await request.json().catch(()=>null) as {organizationId?:string;registration?:string;aircraftType?:string;manufacturer?:string;homeAirport?:string;currentAirport?:string}|null;
  const registration=body?.registration?.trim().toUpperCase(), aircraftType=body?.aircraftType?.trim();
  if(!body?.organizationId||!registration||!aircraftType) return NextResponse.json({error:"Organization, registration and aircraft type are required."},{status:400});
  const {data,error}=await supabase.from("aircraft").insert({
    organization_id:body.organizationId,registration,aircraft_type:aircraftType,
    manufacturer:body.manufacturer?.trim()||null,home_airport:body.homeAirport?.trim().toUpperCase()||null,
    current_airport:body.currentAirport?.trim().toUpperCase()||null,created_by:user.id
  }).select().single();
  if(error) return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({aircraft:data},{status:201});
}
