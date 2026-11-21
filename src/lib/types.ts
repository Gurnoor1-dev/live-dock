export type AircraftStatus = "available" | "in_flight" | "maintenance" | "reserved" | "stored";
export type LegStatus = "scheduled" | "boarding" | "taxiing" | "airborne" | "landed" | "cancelled" | "diverted";

export type Aircraft = {
  id: string;
  registration: string;
  aircraft_type: string;
  manufacturer: string | null;
  status: AircraftStatus;
  current_airport: string | null;
  home_airport: string | null;
  image_url: string | null;
  organization_id?: string;
};

export type FlightLeg = {
  id: string;
  flight_number: string | null;
  departure_airport: string;
  arrival_airport: string;
  scheduled_departure: string;
  status: LegStatus;
  aircraft: Pick<Aircraft, "id" | "registration" | "aircraft_type"> | null;
  pilot: { callsign: string | null; if_username: string | null } | null;
};

export const statusLabel: Record<string, string> = {
  available: "Available", in_flight: "In flight", maintenance: "Maintenance", reserved: "Reserved", stored: "Stored",
  scheduled: "Scheduled", boarding: "Boarding", taxiing: "Taxiing", airborne: "Airborne", landed: "Landed", cancelled: "Cancelled", diverted: "Diverted"
};
