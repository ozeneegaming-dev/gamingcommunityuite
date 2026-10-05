import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Rădăcina monorepo-ului, ca build-ul standalone să includă și pachetele @gcs/*.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@gcs/core", "@gcs/ui"],
};

export default nextConfig;
