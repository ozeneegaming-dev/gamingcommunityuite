import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@gcs/core", "@gcs/ui"],
};

export default nextConfig;
