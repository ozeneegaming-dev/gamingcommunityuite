import path from "node:path";
import type { NextConfig } from "next";

/**
 * next-intl găsește configurarea (`i18n.ts`) prin aliasul `next-intl/config`. Îl setăm direct, în locul
 * plugin-ului `next-intl/plugin`, care încarcă `@swc/core` (binar nativ ce refuză să pornească pe unele
 * sisteme Windows din cauza permisiunilor folderului de cache) doar pentru funcții pe care nu le folosim.
 */
const I18N_CONFIG = "./i18n.ts";

const nextConfig: NextConfig = {
  output: "standalone",
  // Nu genera AGENTS.md/CLAUDE.md în proiect la `next dev`.
  agentRules: false,
  // Rădăcina monorepo-ului, ca build-ul standalone să includă și pachetele @gcs/*.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@gcs/core", "@gcs/modules", "@gcs/ui"],
  // Module native: rămân `require` la runtime, nu intră în bundle.
  serverExternalPackages: ["@node-rs/argon2", "@prisma/client", ".prisma/client"],
  turbopack: {
    resolveAlias: { "next-intl/config": I18N_CONFIG },
  },
  webpack(config: { resolve: { alias: Record<string, string> } }) {
    config.resolve.alias["next-intl/config"] = path.resolve(process.cwd(), I18N_CONFIG);
    return config;
  },
};

export default nextConfig;
