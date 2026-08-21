import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Needed for 'use cache: remote' — see src/lib/lookup.ts
  cacheComponents: true,
  /* config options here */
};

export default nextConfig;
