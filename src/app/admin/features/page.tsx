import { InfiniteFlightDashboard } from "@/components/infinite-flight-dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Feature Selection" };

export default function Page() {
  return <InfiniteFlightDashboard initialPage="Feature Selection" />;
}
