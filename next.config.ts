import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: { remotePatterns: [{ protocol: "https", hostname: "infiniteflight.com" }, { protocol: "https", hostname: "iflytics.com" }] }
};

export default nextConfig;
