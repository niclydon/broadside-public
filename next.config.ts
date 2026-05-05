import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // This showcase serves its own hostname and local media by default.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Allow runtime reads from the local projects root without bundling
  // those files into the Next build. Server-only code paths only.
  serverExternalPackages: ["pg"],
};

export default config;
