import { InfiniteFlightDashboard } from "@/components/infinite-flight-dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organisation Dock" };

export default function Page() {
  return <InfiniteFlightDashboard initialPage="Organisation Dock" />;
}
