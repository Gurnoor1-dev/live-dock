import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FleetDashboard } from "@/components/fleet-dashboard";
import type { FlightLeg } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  let supabase;
  try { supabase = await createClient(); } catch { return <FleetDashboard user={null} organizations={[]} aircraft={[]} legs={[]} setupRequired />; }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <FleetDashboard user={null} organizations={[]} aircraft={[]} legs={[]} />;
  const [{ data: organizations }, { data: aircraft }, { data: legs }] = await Promise.all([
    supabase.from("organizations").select("id,name,slug,timezone").order("name"),
    supabase.from("aircraft").select("id,registration,aircraft_type,manufacturer,status,current_airport,home_airport,image_url,organization_id").order("registration"),
    supabase.from("flight_legs").select("id,organization_id,flight_number,departure_airport,arrival_airport,scheduled_departure,status,aircraft:aircraft_id(id,registration,aircraft_type),pilot:pilot_id(callsign,if_username)").order("scheduled_departure", { ascending: true }).limit(100)
  ]);
  const normalizedLegs = (legs ?? []).map((leg) => ({ ...leg, aircraft: Array.isArray(leg.aircraft) ? leg.aircraft[0] ?? null : leg.aircraft, pilot: Array.isArray(leg.pilot) ? leg.pilot[0] ?? null : leg.pilot })) as unknown as FlightLeg[];
  return <FleetDashboard user={{ email: user.email ?? "Pilot" }} organizations={organizations ?? []} aircraft={aircraft ?? []} legs={normalizedLegs} />;
}
