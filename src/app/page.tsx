import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FleetDashboard } from "@/components/fleet-dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  let supabase;
  try { supabase = await createClient(); } catch { return <FleetDashboard user={null} aircraft={[]} legs={[]} setupRequired />; }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <FleetDashboard user={null} aircraft={[]} legs={[]} />;
  const [{ data: organizations }, { data: aircraft }, { data: legs }] = await Promise.all([
    supabase.from("organizations").select("id,name,slug,timezone").order("name"),
    supabase.from("aircraft").select("id,registration,aircraft_type,manufacturer,status,current_airport,home_airport,image_url,organization_id").order("registration"),
    supabase.from("flight_legs").select("id,organization_id,flight_number,departure_airport,arrival_airport,scheduled_departure,status,aircraft:aircraft_id(id,registration,aircraft_type),pilot:pilot_id(callsign,if_username)").order("scheduled_departure", { ascending: true }).limit(100)
  ]);
  return <FleetDashboard user={{ email: user.email ?? "Pilot" }} organizations={organizations ?? []} aircraft={aircraft ?? []} legs={legs ?? []} />;
}
