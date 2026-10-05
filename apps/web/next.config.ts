import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Rădăcina monorepo-ului, ca build-ul standalone să includă și pachetele @gcs/*.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@gcs/core", "@gcs/modules", "@gcs/ui"],
  // Module native: rămân `require` la runtime, nu intră în bundle.
  serverExternalPackages: ["@node-rs/argon2", "@prisma/client", ".prisma/client"],
};

export default nextConfig;
