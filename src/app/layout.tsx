import type { Metadata } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata: Metadata = {
  title: { default: "Virtual Blue | Fleet Operations", template: "%s | Virtual Blue" },
  description: "Virtual Blue fleet operations, schedules and pilot flight bag.",
  applicationName: "Virtual Blue"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
