import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Set by `next upgrade --agent=security` when moving 16.4.0 → 16.4.5.
    agentUpgrade: "security",
  },
};

export default nextConfig;
