import { InfiniteFlightDashboard } from "@/components/infinite-flight-dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

export default function Page() {
  return <InfiniteFlightDashboard initialPage="Home" />;
}
