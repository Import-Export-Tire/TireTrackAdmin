import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  // Suppress hydration warnings from Convex during SSR
  reactStrictMode: true,
};

export default nextConfig;
