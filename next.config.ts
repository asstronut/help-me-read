import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The dev tools button sits over the phone selection menu's first action.
  devIndicators: false,
  experimental: {
    agentUpgrade: "security",
    // Playwright stops its dev server with a hard kill, which can leave this cache half-written; the next
    // run's server then sends a Turbopack restart on every page load and the page reloads forever.
    turbopackFileSystemCacheForDev: process.env.NEXT_PUBLIC_E2E !== "1",
  },
  partialPrefetching: true,
  reactCompiler: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
