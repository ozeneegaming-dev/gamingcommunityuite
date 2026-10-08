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
  // Migrațiile SQL, aplicate la pornire și de installer (fără CLI-ul Prisma în imagine), și binarele pluginurilor de
  // server (pasul de release), puse în pachetele descărcate din ACP.
  outputFileTracingIncludes: { "/*": ["../../packages/db/prisma/migrations/**/*", "../../servers-plugins/release/**/*"] },
  transpilePackages: ["@gcs/core", "@gcs/modules", "@gcs/ui"],
  // Module native: rămân `require` la runtime, nu intră în bundle.
  serverExternalPackages: ["@node-rs/argon2", "@prisma/client", ".prisma/client"],
  // Cu proxy-ul activ, corpul cererilor e limitat (implicit 10 MB, apoi trunchiat): fișierele media ale pluginurilor
  // (video ≤ 50 MB, plus posterul și câmpurile) trebuie să ajungă întregi la ruta API.
  experimental: { proxyClientMaxBodySize: "64mb" },
  // Header-e de securitate pe toate răspunsurile (spec §15). CSP-ul strict vine odată cu editorul (etapa 2).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
      // Imaginea unei hărți poate redirecționa spre o adresă externă (șablonul în modul direct, specul punții §13):
      // cererea următoare pleacă fără referrer. Ultima regulă potrivită câștigă.
      {
        source: "/api/servers/maps/image/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      // Previzualizarea editorului vizual de temă rulează într-un iframe pe aceeași origine: doar pentru cererile ei
      // (parametrul sau cookie-ul de previzualizare) `DENY` devine `SAMEORIGIN`. Ultima regulă potrivită câștigă.
      ...["query", "cookie"].map((type) => ({
        source: "/:path*",
        has: [{ type: type as "query" | "cookie", key: "gcs-theme-preview" }],
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      })),
    ];
  },
  turbopack: {
    resolveAlias: { "next-intl/config": I18N_CONFIG },
  },
  webpack(config: { resolve: { alias: Record<string, string> } }) {
    config.resolve.alias["next-intl/config"] = path.resolve(process.cwd(), I18N_CONFIG);
    return config;
  },
};

export default nextConfig;
